package com.aaradhya.upbeat;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * Custom WebView that stays active when the app is in the background or the screen is off,
 * preventing Chromium from pausing <audio> / video streams or throttling JS playlist transitions.
 */
public class UpBeatWebView extends CapacitorWebView {

    public UpBeatWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        // Always report View.VISIBLE to Chromium's AwContents so background media and timers never pause.
        super.onWindowVisibilityChanged(View.VISIBLE);
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        super.onVisibilityChanged(changedView, View.VISIBLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasWindowFocus) {
        super.onWindowFocusChanged(true);
    }

    @Override
    public void onPause() {
        // Intentionally do not pause WebView media pipeline when Activity goes to background.
    }

    @Override
    public void pauseTimers() {
        // Intentionally keep JS timers active so playlist track transitions continue in background.
    }
}
