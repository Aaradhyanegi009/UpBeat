package com.aaradhya.upbeat;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    public static MainActivity sInstance = null;
    private static class CarActionItem {
        final String action;
        final String payload;
        CarActionItem(String action, String payload) {
            this.action = action;
            this.payload = payload;
        }
    }
    private static final java.util.concurrent.ConcurrentLinkedQueue<CarActionItem> sPendingActionsQueue =
        new java.util.concurrent.ConcurrentLinkedQueue<>();
    private final Handler mHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;
        applyDarkSystemBars();

        // Enable execution and media playback when device is locked in car
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(false);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    1001
                );
            }
        }

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView wv = this.bridge.getWebView();
            wv.setBackgroundColor(Color.BLACK);
            wv.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
            wv.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
            wv.getSettings().setSupportMultipleWindows(true);
            wv.getSettings().setDomStorageEnabled(true);
            wv.getSettings().setDatabaseEnabled(true);
            wv.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
            wv.addJavascriptInterface(new UpBeatJsBridge(), "UpBeatNative");
        }

        handleCarIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        applyDarkSystemBars();
    }

    private void applyDarkSystemBars() {
        try {
            Window window = getWindow();
            if (window == null) return;
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false); // Crisp white text/icons on pure AMOLED black
                controller.setAppearanceLightNavigationBars(false); // Crisp white icons on pure black nav bar
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCarIntent(intent);
    }

    private void handleCarIntent(Intent intent) {
        if (intent != null && intent.hasExtra("car_action")) {
            String action = intent.getStringExtra("car_action");
            String payload = intent.getStringExtra("car_payload");
            dispatchCarAction(action, payload != null ? payload : "");
        }
    }

    public synchronized void dispatchCarAction(final String action, final String payload) {
        if (action == null) return;
        if (!"prewarm".equals(action)) {
            sPendingActionsQueue.add(new CarActionItem(action, payload != null ? payload : ""));
        }
        tryDeliverPendingCarAction(0);
    }

    public synchronized void tryDeliverPendingCarAction(final int attempt) {
        if (sPendingActionsQueue.isEmpty()) return;
        if (this.bridge == null || this.bridge.getWebView() == null) {
            if (attempt < 100) {
                mHandler.postDelayed(() -> tryDeliverPendingCarAction(attempt + 1), 300);
            }
            return;
        }

        final WebView wv = this.bridge.getWebView();
        wv.post(() -> {
            if (sPendingActionsQueue.isEmpty()) return;
            final java.util.List<CarActionItem> batch = new java.util.ArrayList<>(sPendingActionsQueue);
            StringBuilder sb = new StringBuilder();
            sb.append("(function() {");
            sb.append("  if (typeof window.onUpBeatCarAction !== 'function') return 'retry';");
            for (CarActionItem item : batch) {
                String safeAction = item.action.replace("'", "\\'");
                String safePayload = item.payload.replace("'", "\\'");
                sb.append("  window.onUpBeatCarAction('").append(safeAction).append("', '").append(safePayload).append("');");
            }
            sb.append("  return 'ok';");
            sb.append("})();");

            wv.evaluateJavascript(sb.toString(), value -> {
                if (value != null && value.contains("ok")) {
                    sPendingActionsQueue.removeAll(batch);
                } else {
                    if (attempt < 100) {
                        mHandler.postDelayed(() -> tryDeliverPendingCarAction(attempt + 1), 350);
                    }
                }
            });
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().onResume();
            this.bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Keep Chromium AwContents alive and streaming even when phone screen is turned off in car
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().onResume();
            this.bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (sInstance == this) {
            sInstance = null;
        }
    }

    public class UpBeatJsBridge {
        @JavascriptInterface
        public void readyForCarActions() {
            mHandler.post(() -> tryDeliverPendingCarAction(0));
        }

        @JavascriptInterface
        public void updatePlayback(boolean isPlaying, String title, String artist) {
            updatePlayback(isPlaying, title, artist, "", 0, 0);
        }

        @JavascriptInterface
        public void updatePlayback(boolean isPlaying, String title, String artist, String artUrl, long durationSec, long positionSec) {
            UpBeatMediaService.updatePlayback(
                MainActivity.this,
                isPlaying,
                title,
                artist,
                artUrl,
                durationSec,
                positionSec
            );
        }

        @JavascriptInterface
        public void syncQueue(String queueJson) {
            UpBeatMediaService.saveQueue(MainActivity.this, queueJson);
        }

        @JavascriptInterface
        public void syncFavorites(String favoritesJson) {
            UpBeatMediaService.saveFavorites(MainActivity.this, favoritesJson);
        }

        @JavascriptInterface
        public void openExternalUrl(String url) {
            if (url == null || url.trim().isEmpty()) return;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                MainActivity.this.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }
}
