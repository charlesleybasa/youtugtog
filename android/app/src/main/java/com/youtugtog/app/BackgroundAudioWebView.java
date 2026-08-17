package com.youtugtog.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * A CapacitorWebView that never reports itself as hidden.
 *
 * Android calls onWindowVisibilityChanged(INVISIBLE) when the activity stops —
 * on screen lock or when the app is backgrounded — and WebView reacts by
 * suspending media in every frame it hosts. The YouTube player runs inside a
 * cross-origin iframe, so there is no way to reach it from page JavaScript to
 * stop it pausing; the signal has to be intercepted here, on the native side,
 * where it applies to the whole WebView including that iframe.
 *
 * Forwarding VISIBLE unconditionally keeps audio running while the screen is
 * off. The WebView is still torn down normally when the activity is destroyed,
 * because that path does not depend on window visibility.
 *
 * This only keeps the WebView willing to play. The process itself still needs
 * to survive being backgrounded, which is what PlaybackService is for.
 */
public class BackgroundAudioWebView extends CapacitorWebView {

    public BackgroundAudioWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        // Deliberately ignore the reported visibility.
        super.onWindowVisibilityChanged(View.VISIBLE);
    }
}
