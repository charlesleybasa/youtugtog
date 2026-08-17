package com.youtugtog.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the web player's play/pause state to PlaybackService.
 *
 * The service is tied to playback rather than to the app being open, so the
 * ongoing notification only exists while something is actually playing —
 * holding a foreground service for a paused app would be a battery cost with
 * nothing to show for it, and Android increasingly penalises it.
 */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        PlaybackService.start(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }
}
