import Combine
import SwiftUI
import UIKit
@preconcurrency import WebKit

enum YouTubePlaybackState: Equatable, Sendable {
    case loading
    case ready
    case cued
    case buffering
    case playing
    case paused
    case ended
    case failed(message: String)

    var statusLabel: String {
        switch self {
        case .loading: "Loading player"
        case .ready, .cued: "Ready"
        case .buffering: "Buffering"
        case .playing: "Playing now"
        case .paused: "Paused"
        case .ended: "Finished"
        case .failed: "Player unavailable"
        }
    }
}

@MainActor
private protocol PlayerScriptMessageReceiving: AnyObject {
    func receivePlayerMessage(_ body: Any)
}

@MainActor
private final class WeakPlayerScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var receiver: PlayerScriptMessageReceiving?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        receiver?.receivePlayerMessage(message.body)
    }
}

@MainActor
final class YouTubePlayerController: NSObject, ObservableObject {
    @Published private(set) var state: YouTubePlaybackState = .loading
    @Published private(set) var loadedVideoID: String?

    let webView: WKWebView
    var onEnded: (() -> Void)?
    var onStateChange: ((YouTubePlaybackState) -> Void)?

    private let messageHandler: WeakPlayerScriptMessageHandler
    private var didLoadHTML = false
    private var pendingVideoID: String?

    override init() {
        let handler = WeakPlayerScriptMessageHandler()
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(handler, name: "tugtogPlayer")

        messageHandler = handler
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        handler.receiver = self
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.accessibilityLabel = "Official YouTube video player"
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func loadIfNeeded() {
        guard !didLoadHTML else { return }
        didLoadHTML = true
        state = .loading
        webView.loadHTMLString(Self.playerHTML, baseURL: AppConstants.playerOriginURL)
    }

    func cue(videoID: String) {
        guard YouTubeVideoID.isValid(videoID) else { return }
        loadIfNeeded()
        pendingVideoID = videoID
        loadedVideoID = videoID
        runJavaScript("window.tugtogCue(\(Self.javaScriptString(videoID))); ")
    }

    func play() {
        loadIfNeeded()
        runJavaScript("window.tugtogPlay();")
    }

    func pause() {
        guard didLoadHTML else { return }
        runJavaScript("window.tugtogPause();")
    }

    func stop() {
        guard didLoadHTML else { return }
        runJavaScript("window.tugtogStop();")
        loadedVideoID = nil
        pendingVideoID = nil
        setState(.ready)
    }

    private func runJavaScript(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func setState(_ newState: YouTubePlaybackState) {
        state = newState
        onStateChange?(newState)
    }

    private static func javaScriptString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let encoded = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        return encoded
    }

    private static let playerHTML = """
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>
          html, body, #player { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
        </style>
      </head>
      <body>
        <div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
          let player = null;
          let pendingVideoID = null;

          function post(type, value) {
            window.webkit.messageHandlers.tugtogPlayer.postMessage({ type, value });
          }

          function onYouTubeIframeAPIReady() {
            player = new YT.Player('player', {
              width: '100%',
              height: '100%',
              playerVars: {
                controls: 1,
                playsinline: 1,
                rel: 0,
                enablejsapi: 1,
                origin: '\(AppConstants.playerOriginURL.absoluteString)'
              },
              events: {
                onReady: function() {
                  post('ready', true);
                  if (pendingVideoID) {
                    player.cueVideoById(pendingVideoID);
                    pendingVideoID = null;
                  }
                },
                onStateChange: function(event) { post('state', event.data); },
                onError: function(event) { post('error', event.data); }
              }
            });
          }

          window.tugtogCue = function(videoID) {
            if (!videoID) return;
            if (player && player.cueVideoById) player.cueVideoById(videoID);
            else pendingVideoID = videoID;
          };
          window.tugtogPlay = function() {
            if (player && player.playVideo) player.playVideo();
          };
          window.tugtogPause = function() {
            if (player && player.pauseVideo) player.pauseVideo();
          };
          window.tugtogStop = function() {
            if (player && player.stopVideo) player.stopVideo();
          };
        </script>
      </body>
    </html>
    """
}

extension YouTubePlayerController: PlayerScriptMessageReceiving {
    func receivePlayerMessage(_ body: Any) {
        guard let payload = body as? [String: Any],
              let type = payload["type"] as? String
        else {
            return
        }

        switch type {
        case "ready":
            setState(.ready)
            if let pendingVideoID {
                runJavaScript("window.tugtogCue(\(Self.javaScriptString(pendingVideoID))); ")
                self.pendingVideoID = nil
            }
        case "state":
            let value = (payload["value"] as? NSNumber)?.intValue
            switch value {
            case 0:
                setState(.ended)
                onEnded?()
            case 1:
                setState(.playing)
            case 2:
                setState(.paused)
            case 3:
                setState(.buffering)
            case 5:
                setState(.cued)
            default:
                break
            }
        case "error":
            setState(.failed(message: "This video can’t be played in Tugtog."))
        default:
            break
        }
    }
}

extension YouTubePlayerController: WKNavigationDelegate, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        guard navigationAction.targetFrame?.isMainFrame == true,
              navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              url.scheme == "https"
        else {
            return .allow
        }

        _ = await UIApplication.shared.open(url)
        return .cancel
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

struct YouTubePlayerView: UIViewRepresentable {
    let controller: YouTubePlayerController

    func makeUIView(context: Context) -> WKWebView {
        controller.loadIfNeeded()
        return controller.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
