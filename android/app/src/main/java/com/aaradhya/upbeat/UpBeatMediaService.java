package com.aaradhya.upbeat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Android Notification Media Controls & Android Auto In-Car Browser Service for UpBeat.
 * Implements MediaBrowserServiceCompat + MediaSessionCompat + MediaStyle notification controls
 * with Spotify-style rich interactive media card (Play/Pause, Prev, Next, Rewind 10s, Forward 10s,
 * real-time elapsed progress bar, dynamic album art, and instant zero-lag track synchronization).
 */
public class UpBeatMediaService extends MediaBrowserServiceCompat {

    public static final String CHANNEL_ID = "upbeat_playback_channel";
    public static final int NOTIFICATION_ID = 1042;
    private static final String PREFS_NAME = "upbeat_car_prefs";
    private static final String KEY_QUEUE = "car_queue_json";
    private static final String KEY_FAVS = "car_favs_json";

    public static final String ACTION_TOGGLE_PLAY = "com.aaradhya.upbeat.ACTION_TOGGLE_PLAY";
    public static final String ACTION_PLAY = "com.aaradhya.upbeat.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.aaradhya.upbeat.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.aaradhya.upbeat.ACTION_NEXT";
    public static final String ACTION_PREV = "com.aaradhya.upbeat.ACTION_PREV";
    public static final String ACTION_REWIND = "com.aaradhya.upbeat.ACTION_REWIND";
    public static final String ACTION_FORWARD = "com.aaradhya.upbeat.ACTION_FORWARD";
    public static final String ACTION_STOP = "com.aaradhya.upbeat.ACTION_STOP";

    public static final String MEDIA_ID_ROOT = "root";
    public static final String MEDIA_ID_QUEUE = "folder_queue";
    public static final String MEDIA_ID_FAVORITES = "folder_favorites";
    public static final String MEDIA_ID_PRESETS = "folder_presets";

    // Android Auto Content Style & Browsing Constants
    public static final String CONTENT_STYLE_BROWSABLE_HINT = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    public static final String CONTENT_STYLE_PLAYABLE_HINT = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    public static final int CONTENT_STYLE_LIST_ITEM = 1;
    public static final int CONTENT_STYLE_GRID_ITEM = 2;
    public static final String SEARCH_SUPPORTED = "android.media.browse.SEARCH_SUPPORTED";

    // Reliable fallback seed tracks for zero-empty browsable trees in Android Auto
    private static final String[][] DEFAULT_CAR_TRACKS = {
        {"Renai Circulation", "Kana Hanazawa", "https://i.ytimg.com/vi/F8xpmTmdf6o/hqdefault.jpg"},
        {"mathemagics", "Marina Inoue", "https://i.ytimg.com/vi/F_Cr9vZ08Ws/hqdefault.jpg"},
        {"Kimi no Shiranai Monogatari", "supercell", "https://i.ytimg.com/vi/0VpGoDp3FCE/hqdefault.jpg"},
        {"Staple Stable", "Chiwa Saito", "https://i.ytimg.com/vi/CXDUXjsU5ao/hqdefault.jpg"},
        {"Veridis Quo", "Daft Punk", "https://i.ytimg.com/vi/TCd6PfxOy0Y/hqdefault.jpg"},
        {"A New Error", "Moderat", "https://i.ytimg.com/vi/QpxFcMYRV08/hqdefault.jpg"},
        {"Duvet", "Bôa", "https://i.ytimg.com/vi/MM8RufZr5lw/hqdefault.jpg"},
        {"Akuma no Ko", "Ai Higuchi", "https://i.ytimg.com/vi/tdzsOODJiX8/hqdefault.jpg"}
    };

    // Pre-curated tracks for each Android Auto playlist preset for instant offline browsing
    private static final String[][][] PRESET_TRACKS = {
        // 0: preset_late_night
        {
            {"Veridis Quo", "Daft Punk", "https://i.ytimg.com/vi/TCd6PfxOy0Y/hqdefault.jpg"},
            {"A New Error", "Moderat", "https://i.ytimg.com/vi/QpxFcMYRV08/hqdefault.jpg"},
            {"Duvet", "Bôa", "https://i.ytimg.com/vi/MM8RufZr5lw/hqdefault.jpg"},
            {"Midnight City", "M83", "https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg"},
            {"Resonance", "HOME", "https://i.ytimg.com/vi/8GW6sLrK40k/hqdefault.jpg"}
        },
        // 1: preset_focus
        {
            {"Weightless", "Marconi Union", "https://i.ytimg.com/vi/8GW6sLrK40k/hqdefault.jpg"},
            {"Intro", "The xx", "https://i.ytimg.com/vi/TCd6PfxOy0Y/hqdefault.jpg"},
            {"Sunset Lover", "Petit Biscuit", "https://i.ytimg.com/vi/QpxFcMYRV08/hqdefault.jpg"},
            {"Daylight", "David Kushnir", "https://i.ytimg.com/vi/MM8RufZr5lw/hqdefault.jpg"}
        },
        // 2: preset_energy
        {
            {"Can't Hold Us", "Macklemore", "https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg"},
            {"Till I Collapse", "Eminem", "https://i.ytimg.com/vi/TCd6PfxOy0Y/hqdefault.jpg"},
            {"Believer", "Imagine Dragons", "https://i.ytimg.com/vi/0VpGoDp3FCE/hqdefault.jpg"},
            {"Stronger", "Kanye West", "https://i.ytimg.com/vi/F8xpmTmdf6o/hqdefault.jpg"}
        },
        // 3: preset_anime
        {
            {"Renai Circulation", "Kana Hanazawa", "https://i.ytimg.com/vi/F8xpmTmdf6o/hqdefault.jpg"},
            {"mathemagics", "Marina Inoue", "https://i.ytimg.com/vi/F_Cr9vZ08Ws/hqdefault.jpg"},
            {"Kimi no Shiranai Monogatari", "supercell", "https://i.ytimg.com/vi/0VpGoDp3FCE/hqdefault.jpg"},
            {"Staple Stable", "Chiwa Saito", "https://i.ytimg.com/vi/CXDUXjsU5ao/hqdefault.jpg"},
            {"Akuma no Ko", "Ai Higuchi", "https://i.ytimg.com/vi/tdzsOODJiX8/hqdefault.jpg"}
        },
        // 4: preset_hindi
        {
            {"Tum Hi Ho", "Arijit Singh", "https://i.ytimg.com/vi/MM8RufZr5lw/hqdefault.jpg"},
            {"Kesariya", "Arijit Singh", "https://i.ytimg.com/vi/tdzsOODJiX8/hqdefault.jpg"},
            {"Apna Bana Le", "Arijit Singh", "https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg"},
            {"Chaleya", "Anirudh Ravichander", "https://i.ytimg.com/vi/F8xpmTmdf6o/hqdefault.jpg"}
        }
    };

    public static volatile UpBeatMediaService sInstance = null;

    private MediaSessionCompat mMediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private volatile boolean isCurrentlyPlaying = false;
    private volatile long lastUserActionTime = 0;
    private volatile boolean lastUserActionWasPause = false;

    private String currentTitle = "UpBeat";
    private String currentArtist = "Curated Stream";
    private String currentArtUrl = "";
    private long currentDurationMs = 0;
    private long currentPositionMs = 0;

    private Bitmap cachedArtworkBitmap = null;
    private String cachedArtworkUrl = "";

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        createNotificationChannel();
        acquireLocks();

        // Initialize MediaSessionCompat with interactive transport flags
        mMediaSession = new MediaSessionCompat(this, "UpBeatMediaSession");
        mMediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setClass(this, MediaButtonReceiver.class);
        int pFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent mbPendingIntent = PendingIntent.getBroadcast(this, 0, mediaButtonIntent, pFlags);
        mMediaSession.setMediaButtonReceiver(mbPendingIntent);

        mMediaSession.setCallback(new MediaSessionCallback());
        mMediaSession.setActive(true);
        setSessionToken(mMediaSession.getSessionToken());

        updatePlaybackState(PlaybackStateCompat.STATE_NONE, 0, false);
    }

    private class MediaSessionCallback extends MediaSessionCompat.Callback {
        @Override
        public void onPlay() {
            isCurrentlyPlaying = true;
            lastUserActionTime = SystemClock.elapsedRealtime();
            lastUserActionWasPause = false;
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, currentPositionMs, true);
            notifyNotification();
            dispatchToApp("play", "");
        }

        @Override
        public void onPause() {
            isCurrentlyPlaying = false;
            lastUserActionTime = SystemClock.elapsedRealtime();
            lastUserActionWasPause = true;
            updatePlaybackState(PlaybackStateCompat.STATE_PAUSED, currentPositionMs, false);
            notifyNotification();
            dispatchToApp("pause", "");
        }

        @Override
        public void onSkipToNext() {
            updatePlaybackState(PlaybackStateCompat.STATE_SKIPPING_TO_NEXT, 0, true);
            dispatchToApp("next", "");
        }

        @Override
        public void onSkipToPrevious() {
            updatePlaybackState(PlaybackStateCompat.STATE_SKIPPING_TO_PREVIOUS, 0, true);
            dispatchToApp("prev", "");
        }

        @Override
        public void onFastForward() {
            long targetSec = (currentPositionMs / 1000) + 10;
            dispatchToApp("seek", String.valueOf(targetSec));
        }

        @Override
        public void onRewind() {
            long targetSec = Math.max(0, (currentPositionMs / 1000) - 10);
            dispatchToApp("seek", String.valueOf(targetSec));
        }

        @Override
        public void onSeekTo(long pos) {
            updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING, pos, isCurrentlyPlaying);
            dispatchToApp("seek", String.valueOf(pos / 1000));
        }

        @Override
        public void onPrepare() {
            onPlay();
        }

        @Override
        public void onPrepareFromMediaId(String mediaId, Bundle extras) {
            onPlayFromMediaId(mediaId, extras);
        }

        @Override
        public void onPrepareFromSearch(String query, Bundle extras) {
            onPlayFromSearch(query, extras);
        }

        @Override
        public void onPlayFromMediaId(String mediaId, Bundle extras) {
            if (mediaId == null) return;

            optimisticUpdateMetadata(mediaId);
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, 0, true);

            if (MEDIA_ID_QUEUE.equals(mediaId) || MEDIA_ID_ROOT.equals(mediaId)) {
                dispatchToApp("play_index", "0");
            } else if (MEDIA_ID_FAVORITES.equals(mediaId)) {
                dispatchToApp("play_favorite", "0");
            } else if (MEDIA_ID_PRESETS.equals(mediaId)) {
                dispatchToApp("play_preset", "preset_late_night");
            } else if (mediaId.startsWith("track_preset_")) {
                handlePlayPresetTrack(mediaId);
            } else if (mediaId.startsWith("track_")) {
                dispatchToApp("play_index", mediaId.substring(6));
            } else if (mediaId.startsWith("fav_")) {
                dispatchToApp("play_favorite", mediaId.substring(4));
            } else if (mediaId.startsWith("preset_")) {
                dispatchToApp("play_preset", mediaId);
            }
        }

        @Override
        public void onPlayFromSearch(String query, Bundle extras) {
            if (query != null && !query.trim().isEmpty()) {
                currentTitle = query.trim();
                currentArtist = "Search";
                applyMediaMetadata();
                notifyNotification();
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, 0, true);
                dispatchToApp("search_play", query.trim());
            }
        }
    }

    private void handlePlayPresetTrack(String mediaId) {
        try {
            int lastUnderscore = mediaId.lastIndexOf('_');
            if (lastUnderscore > 0) {
                int trackIdx = Integer.parseInt(mediaId.substring(lastUnderscore + 1));
                String presetId = mediaId.substring(6, lastUnderscore); // e.g. preset_late_night
                int pIdx = -1;
                if ("preset_late_night".equals(presetId)) pIdx = 0;
                else if ("preset_focus".equals(presetId)) pIdx = 1;
                else if ("preset_energy".equals(presetId)) pIdx = 2;
                else if ("preset_anime".equals(presetId)) pIdx = 3;
                else if ("preset_hindi".equals(presetId)) pIdx = 4;

                if (pIdx >= 0 && trackIdx >= 0 && trackIdx < PRESET_TRACKS[pIdx].length) {
                    String title = PRESET_TRACKS[pIdx][trackIdx][0];
                    String artist = PRESET_TRACKS[pIdx][trackIdx][1];
                    currentTitle = title;
                    currentArtist = artist;
                    currentArtUrl = PRESET_TRACKS[pIdx][trackIdx][2];
                    applyMediaMetadata();
                    notifyNotification();
                    dispatchToApp("play_title_artist", title + "___" + artist);
                    return;
                }
            }
        } catch (Exception ignored) {}
        dispatchToApp("play_preset", "preset_late_night");
    }

    private void populatePresetTracks(List<MediaBrowserCompat.MediaItem> items, int presetIdx, String presetPrefix) {
        if (presetIdx < 0 || presetIdx >= PRESET_TRACKS.length) return;
        String[][] tracks = PRESET_TRACKS[presetIdx];
        for (int i = 0; i < tracks.length; i++) {
            items.add(createPlayable("track_" + presetPrefix + "_" + i, tracks[i][0], tracks[i][1], tracks[i][2]));
        }
    }

    private void optimisticUpdateMetadata(String mediaId) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (mediaId.startsWith("track_preset_")) {
                int lastUnderscore = mediaId.lastIndexOf('_');
                if (lastUnderscore > 0) {
                    int trackIdx = Integer.parseInt(mediaId.substring(lastUnderscore + 1));
                    String presetId = mediaId.substring(6, lastUnderscore);
                    int pIdx = -1;
                    if ("preset_late_night".equals(presetId)) pIdx = 0;
                    else if ("preset_focus".equals(presetId)) pIdx = 1;
                    else if ("preset_energy".equals(presetId)) pIdx = 2;
                    else if ("preset_anime".equals(presetId)) pIdx = 3;
                    else if ("preset_hindi".equals(presetId)) pIdx = 4;

                    if (pIdx >= 0 && trackIdx >= 0 && trackIdx < PRESET_TRACKS[pIdx].length) {
                        currentTitle = PRESET_TRACKS[pIdx][trackIdx][0];
                        currentArtist = PRESET_TRACKS[pIdx][trackIdx][1];
                        currentArtUrl = PRESET_TRACKS[pIdx][trackIdx][2];
                        applyMediaMetadata();
                        notifyNotification();
                        return;
                    }
                }
            } else if (mediaId.startsWith("track_")) {
                int idx = Integer.parseInt(mediaId.substring(6));
                String queueJson = prefs.getString(KEY_QUEUE, "[]");
                JSONArray arr = new JSONArray(queueJson);
                if (idx >= 0 && idx < arr.length()) {
                    JSONObject obj = arr.getJSONObject(idx);
                    currentTitle = obj.optString("title", "Track " + (idx + 1));
                    currentArtist = obj.optString("artist", "UpBeat");
                    currentArtUrl = obj.optString("thumbnail", "");
                    applyMediaMetadata();
                    notifyNotification();
                    return;
                } else if (idx >= 0 && idx < DEFAULT_CAR_TRACKS.length) {
                    currentTitle = DEFAULT_CAR_TRACKS[idx][0];
                    currentArtist = DEFAULT_CAR_TRACKS[idx][1];
                    currentArtUrl = DEFAULT_CAR_TRACKS[idx][2];
                    applyMediaMetadata();
                    notifyNotification();
                    return;
                }
            } else if (mediaId.startsWith("fav_")) {
                int idx = Integer.parseInt(mediaId.substring(4));
                String favsJson = prefs.getString(KEY_FAVS, "[]");
                JSONArray arr = new JSONArray(favsJson);
                if (idx >= 0 && idx < arr.length()) {
                    JSONObject obj = arr.getJSONObject(idx);
                    currentTitle = obj.optString("title", "Track " + (idx + 1));
                    currentArtist = obj.optString("artist", "UpBeat");
                    currentArtUrl = obj.optString("thumbnail", "");
                    applyMediaMetadata();
                    notifyNotification();
                    return;
                } else if (idx >= 0 && idx < DEFAULT_CAR_TRACKS.length) {
                    currentTitle = DEFAULT_CAR_TRACKS[idx][0];
                    currentArtist = DEFAULT_CAR_TRACKS[idx][1];
                    currentArtUrl = DEFAULT_CAR_TRACKS[idx][2];
                    applyMediaMetadata();
                    notifyNotification();
                    return;
                }
            } else if (mediaId.startsWith("preset_")) {
                String name = "Curated Mix";
                if (mediaId.equals("preset_late_night")) name = "Late Night Drive";
                else if (mediaId.equals("preset_focus")) name = "Deep Focus Ambient";
                else if (mediaId.equals("preset_energy")) name = "High Energy Workout";
                else if (mediaId.equals("preset_anime")) name = "Anime Openings";
                else if (mediaId.equals("preset_hindi")) name = "New Hindi Songs";
                currentTitle = name;
                currentArtist = "UpBeat Radio";
                applyMediaMetadata();
                notifyNotification();
            } else if (MEDIA_ID_QUEUE.equals(mediaId)) {
                currentTitle = "Current Queue";
                currentArtist = "UpBeat";
                applyMediaMetadata();
                notifyNotification();
            } else if (MEDIA_ID_FAVORITES.equals(mediaId)) {
                currentTitle = "Liked Songs";
                currentArtist = "UpBeat";
                applyMediaMetadata();
                notifyNotification();
            }
        } catch (Exception ignored) {}
    }

    private void dispatchToApp(String action, String payload) {
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction(action, payload);
        } else {
            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launchIntent.putExtra("car_action", action);
            launchIntent.putExtra("car_payload", payload);
            startActivity(launchIntent);
        }
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        Bundle extras = new Bundle();
        extras.putBoolean(SEARCH_SUPPORTED, true);
        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, CONTENT_STYLE_GRID_ITEM);
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_LIST_ITEM);
        return new BrowserRoot(MEDIA_ID_ROOT, extras);
    }

    @Override
    public void onLoadChildren(@NonNull String parentMediaId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        if (MEDIA_ID_ROOT.equals(parentMediaId)) {
            items.add(createFolder(MEDIA_ID_QUEUE, "Current Queue", "Active playlist tracks"));
            items.add(createFolder(MEDIA_ID_FAVORITES, "Liked Songs", "Your saved favorites"));
            items.add(createFolder(MEDIA_ID_PRESETS, "Curated Vibes", "Quick mood & genre mixes"));
            result.sendResult(items);
            return;
        }

        if (MEDIA_ID_QUEUE.equals(parentMediaId)) {
            String queueJson = prefs.getString(KEY_QUEUE, "[]");
            populateFromJsonArray(items, queueJson, "track_");
            // If empty, supply high-quality seeds so Android Auto never encounters an empty browsable folder
            if (items.isEmpty()) {
                for (int i = 0; i < DEFAULT_CAR_TRACKS.length; i++) {
                    items.add(createPlayable("track_" + i, DEFAULT_CAR_TRACKS[i][0], DEFAULT_CAR_TRACKS[i][1], DEFAULT_CAR_TRACKS[i][2]));
                }
            }
            result.sendResult(items);
            return;
        }

        if (MEDIA_ID_FAVORITES.equals(parentMediaId)) {
            String favsJson = prefs.getString(KEY_FAVS, "[]");
            populateFromJsonArray(items, favsJson, "fav_");
            // If empty, supply starter seeds so Android Auto Liked Songs folder loads cleanly without error
            if (items.isEmpty()) {
                for (int i = 0; i < DEFAULT_CAR_TRACKS.length; i++) {
                    items.add(createPlayable("fav_" + i, DEFAULT_CAR_TRACKS[i][0], DEFAULT_CAR_TRACKS[i][1], DEFAULT_CAR_TRACKS[i][2]));
                }
            }
            result.sendResult(items);
            return;
        }

        if (MEDIA_ID_PRESETS.equals(parentMediaId)) {
            items.add(createFolder("preset_late_night", "Late Night Drive", "Atmospheric Hip-Hop & Lofi"));
            items.add(createFolder("preset_focus", "Deep Focus Ambient", "Instrumental Electronic Beats"));
            items.add(createFolder("preset_energy", "High Energy Workout", "Gym Motivation & Fast BPM"));
            items.add(createFolder("preset_anime", "Anime Openings", "Hiroyuki Sawano & J-Rock"));
            items.add(createFolder("preset_hindi", "New Hindi Songs", "Latest Releases & Top Hits"));
            result.sendResult(items);
            return;
        }

        if ("preset_late_night".equals(parentMediaId)) {
            populatePresetTracks(items, 0, "preset_late_night");
            result.sendResult(items);
            return;
        }
        if ("preset_focus".equals(parentMediaId)) {
            populatePresetTracks(items, 1, "preset_focus");
            result.sendResult(items);
            return;
        }
        if ("preset_energy".equals(parentMediaId)) {
            populatePresetTracks(items, 2, "preset_energy");
            result.sendResult(items);
            return;
        }
        if ("preset_anime".equals(parentMediaId)) {
            populatePresetTracks(items, 3, "preset_anime");
            result.sendResult(items);
            return;
        }
        if ("preset_hindi".equals(parentMediaId)) {
            populatePresetTracks(items, 4, "preset_hindi");
            result.sendResult(items);
            return;
        }

        // Safe fallback: populate seeds so Android Auto never encounters an empty browsable folder error
        for (int i = 0; i < DEFAULT_CAR_TRACKS.length; i++) {
            items.add(createPlayable("track_" + i, DEFAULT_CAR_TRACKS[i][0], DEFAULT_CAR_TRACKS[i][1], DEFAULT_CAR_TRACKS[i][2]));
        }
        result.sendResult(items);
    }

    @Override
    public void onSearch(@NonNull String query, Bundle extras, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        String q = query != null ? query.toLowerCase().trim() : "";
        for (int i = 0; i < DEFAULT_CAR_TRACKS.length; i++) {
            String title = DEFAULT_CAR_TRACKS[i][0].toLowerCase();
            String artist = DEFAULT_CAR_TRACKS[i][1].toLowerCase();
            if (q.isEmpty() || title.contains(q) || artist.contains(q)) {
                items.add(createPlayable("track_" + i, DEFAULT_CAR_TRACKS[i][0], DEFAULT_CAR_TRACKS[i][1], DEFAULT_CAR_TRACKS[i][2]));
            }
        }
        if (items.isEmpty()) {
            for (int i = 0; i < Math.min(4, DEFAULT_CAR_TRACKS.length); i++) {
                items.add(createPlayable("track_" + i, DEFAULT_CAR_TRACKS[i][0], DEFAULT_CAR_TRACKS[i][1], DEFAULT_CAR_TRACKS[i][2]));
            }
        }
        result.sendResult(items);
    }

    private MediaBrowserCompat.MediaItem createFolder(String id, String title, String subtitle) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, CONTENT_STYLE_GRID_ITEM);
        MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setExtras(extras)
            .build();
        return new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem createPlayable(String id, String title, String subtitle, String iconUri) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_LIST_ITEM);
        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setExtras(extras);
        if (iconUri != null && !iconUri.isEmpty()) {
            builder.setIconUri(Uri.parse(iconUri));
        }
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private void populateFromJsonArray(List<MediaBrowserCompat.MediaItem> items, String json, String idPrefix) {
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                String title = obj.optString("title", "Track " + (i + 1));
                String artist = obj.optString("artist", "UpBeat");
                String thumb = obj.optString("thumbnail", "");
                int idx = obj.optInt("index", i);
                items.add(createPlayable(idPrefix + idx, title, artist, thumb));
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(mMediaSession, intent);

        if (intent != null && intent.getAction() != null) {
            String act = intent.getAction();
            if (ACTION_TOGGLE_PLAY.equals(act)) {
                boolean nextPlaying = !isCurrentlyPlaying;
                isCurrentlyPlaying = nextPlaying;
                lastUserActionTime = SystemClock.elapsedRealtime();
                lastUserActionWasPause = !nextPlaying;
                updatePlaybackState(
                    nextPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    currentPositionMs,
                    nextPlaying
                );
                notifyNotification();
                dispatchToApp(nextPlaying ? "play" : "pause", "");
                return START_STICKY;
            } else if (ACTION_PLAY.equals(act)) {
                isCurrentlyPlaying = true;
                lastUserActionTime = SystemClock.elapsedRealtime();
                lastUserActionWasPause = false;
                updatePlaybackState(
                    PlaybackStateCompat.STATE_PLAYING,
                    currentPositionMs,
                    true
                );
                notifyNotification();
                dispatchToApp("play", "");
                return START_STICKY;
            } else if (ACTION_PAUSE.equals(act)) {
                isCurrentlyPlaying = false;
                lastUserActionTime = SystemClock.elapsedRealtime();
                lastUserActionWasPause = true;
                updatePlaybackState(
                    PlaybackStateCompat.STATE_PAUSED,
                    currentPositionMs,
                    false
                );
                notifyNotification();
                dispatchToApp("pause", "");
                return START_STICKY;
            } else if (ACTION_NEXT.equals(act)) {
                updatePlaybackState(PlaybackStateCompat.STATE_SKIPPING_TO_NEXT, 0, true);
                dispatchToApp("next", "");
                return START_STICKY;
            } else if (ACTION_PREV.equals(act)) {
                updatePlaybackState(PlaybackStateCompat.STATE_SKIPPING_TO_PREVIOUS, 0, true);
                dispatchToApp("prev", "");
                return START_STICKY;
            } else if (ACTION_REWIND.equals(act)) {
                long targetSec = Math.max(0, (currentPositionMs / 1000) - 10);
                dispatchToApp("seek", String.valueOf(targetSec));
                return START_STICKY;
            } else if (ACTION_FORWARD.equals(act)) {
                long targetSec = (currentPositionMs / 1000) + 10;
                dispatchToApp("seek", String.valueOf(targetSec));
                return START_STICKY;
            } else if (ACTION_STOP.equals(act)) {
                isCurrentlyPlaying = false;
                updatePlaybackState(PlaybackStateCompat.STATE_STOPPED, 0, false);
                dispatchToApp("pause", "");
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (intent != null && intent.hasExtra("title")) {
            String t = intent.getStringExtra("title");
            String a = intent.getStringExtra("artist");
            String art = intent.getStringExtra("artUrl");
            long dur = intent.getLongExtra("durationSec", 0);
            long pos = intent.getLongExtra("positionSec", 0);
            boolean playing = intent.getBooleanExtra("isPlaying", false);
            handlePlaybackUpdate(playing, t, a, art, dur, pos);
        }

        Notification notification = buildNotification(currentTitle, currentArtist, isCurrentlyPlaying);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {}

        notifyNotification();
        acquireLocks();
        return START_STICKY;
    }

    /**
     * Direct zero-latency handler called whenever song or playback state changes.
     * Instantly purges old track artwork, updates MediaSession metadata, animates the progress bar,
     * and forces an immediate NotificationManager.notify() update in the Android status bar.
     */
    public synchronized void handlePlaybackUpdate(boolean isPlaying, String title, String artist, String artUrl, long durationSec, long positionSec) {
        String cleanTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "UpBeat";
        String cleanArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "";
        String cleanArt = (artUrl != null) ? artUrl.trim() : "";

        boolean trackChanged = !cleanTitle.equals(currentTitle)
            || (!cleanArt.isEmpty() && !cleanArt.equals(currentArtUrl));

        long timeSinceUserAction = SystemClock.elapsedRealtime() - lastUserActionTime;
        if (timeSinceUserAction < 2500) {
            if (lastUserActionWasPause && isPlaying) {
                // User explicitly pressed pause in notification controls within last 2.5s.
                // Do NOT allow a delayed in-flight progress report from JS to revert back to playing!
                isPlaying = false;
            } else if (!lastUserActionWasPause && !isPlaying) {
                // User explicitly pressed play in notification controls within last 2.5s.
                // Do NOT allow a delayed in-flight pause report from JS to revert back to paused!
                isPlaying = true;
            } else {
                // Desired state confirmed by JS, clear override
                lastUserActionTime = 0;
            }
        }

        currentTitle = cleanTitle;
        currentArtist = cleanArtist;
        isCurrentlyPlaying = isPlaying;
        currentPositionMs = Math.max(0, positionSec * 1000);
        if (durationSec > 0) {
            currentDurationMs = durationSec * 1000;
        }

        if (trackChanged) {
            // ZERO-LATENCY PURGE: Immediately destroy previous track's artwork
            // so track A NEVER lingers when track B starts playing!
            cachedArtworkBitmap = createDefaultArtwork(currentTitle);
            cachedArtworkUrl = "";
            currentArtUrl = cleanArt;

            if (!cleanArt.isEmpty()) {
                loadArtworkBitmapAsync(cleanArt);
            }
        }

        mMediaSession.setActive(true);
        applyMediaMetadata();
        updatePlaybackState(
            isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
            currentPositionMs,
            isCurrentlyPlaying
        );

        notifyNotification();
    }

    private void updatePlaybackState(int state, long positionMs, boolean isPlaying) {
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_FAST_FORWARD
            | PlaybackStateCompat.ACTION_REWIND
            | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
            | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
            | PlaybackStateCompat.ACTION_PREPARE
            | PlaybackStateCompat.ACTION_PREPARE_FROM_MEDIA_ID
            | PlaybackStateCompat.ACTION_PREPARE_FROM_SEARCH;

        // Passing SystemClock.elapsedRealtime() enables Android OS to smoothly animate
        // the notification scrubber and live playback timer in real time (Spotify style)
        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, positionMs, isPlaying ? 1.0f : 0.0f, SystemClock.elapsedRealtime());

        mMediaSession.setPlaybackState(stateBuilder.build());
    }

    private void applyMediaMetadata() {
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "UpBeat")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs);

        Bitmap artToUse = cachedArtworkBitmap != null ? cachedArtworkBitmap : createDefaultArtwork(currentTitle);
        if (artToUse != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artToUse);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artToUse);
        }
        if (currentArtUrl != null && !currentArtUrl.isEmpty()) {
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, currentArtUrl);
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, currentArtUrl);
        }

        mMediaSession.setMetadata(metaBuilder.build());
    }

    /**
     * Generates a sleek, modern Spotify-style dark indigo gradient album art tile
     * with vinyl concentric rings and the track's capitalized initial for zero-latency instant display.
     */
    private Bitmap createDefaultArtwork(String title) {
        try {
            int size = 512;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            // Deep modern dark-indigo gradient
            Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            Shader gradient = new LinearGradient(
                0, 0, size, size,
                new int[]{Color.parseColor("#141522"), Color.parseColor("#262844"), Color.parseColor("#0e0f18")},
                new float[]{0f, 0.6f, 1f},
                Shader.TileMode.CLAMP
            );
            bgPaint.setShader(gradient);
            canvas.drawRect(0, 0, size, size, bgPaint);

            // Vinyl concentric rings
            Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ringPaint.setStyle(Paint.Style.STROKE);
            ringPaint.setStrokeWidth(3f);
            ringPaint.setColor(Color.argb(35, 99, 102, 241));
            canvas.drawCircle(size / 2f, size / 2f, size * 0.42f, ringPaint);
            canvas.drawCircle(size / 2f, size / 2f, size * 0.30f, ringPaint);
            canvas.drawCircle(size / 2f, size / 2f, size * 0.18f, ringPaint);

            // Central disc
            Paint centerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            centerPaint.setColor(Color.parseColor("#4F46E5"));
            centerPaint.setShadowLayer(16f, 0, 4f, Color.argb(120, 0, 0, 0));
            canvas.drawCircle(size / 2f, size / 2f, size * 0.14f, centerPaint);

            // Central initial/symbol
            Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setColor(Color.WHITE);
            textPaint.setTextSize(size * 0.14f);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setFakeBoldText(true);

            String initial = (title != null && !title.trim().isEmpty())
                ? title.trim().substring(0, 1).toUpperCase()
                : "♫";
            float yPos = (size / 2f) - ((textPaint.descent() + textPaint.ascent()) / 2f);
            canvas.drawText(initial, size / 2f, yPos, textPaint);

            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private void loadArtworkBitmapAsync(final String urlString) {
        if (urlString == null || urlString.isEmpty()) {
            return;
        }

        final String targetTitle = currentTitle;
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 UpBeat/2.10");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.connect();
                if (conn.getResponseCode() == 200) {
                    InputStream input = conn.getInputStream();
                    bmp = BitmapFactory.decodeStream(input);
                    input.close();
                }
            } catch (Exception ignored) {
                bmp = null;
            }

            final Bitmap finalBmp = bmp;
            new Handler(Looper.getMainLooper()).post(() -> {
                // Confirm the user hasn't switched songs while the image was downloading
                if (currentTitle.equals(targetTitle)) {
                    if (finalBmp != null) {
                        cachedArtworkBitmap = finalBmp;
                        cachedArtworkUrl = urlString;
                        applyMediaMetadata();
                        notifyNotification();
                    }
                }
            });
        }).start();
    }

    private void notifyNotification() {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(currentTitle, currentArtist, isCurrentlyPlaying));
            }
        } catch (Exception ignored) {}
    }

    private PendingIntent createActionIntent(String action) {
        Intent intent = new Intent(this, UpBeatMediaService.class);
        intent.setAction(action);
        int pFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getService(this, action.hashCode(), intent, pFlags);
    }

    /**
     * Builds a Spotify-style rich media card for Android notification shade & Quick Settings.
     * Uses vector icons, accent coloring, real-time scrubber metadata, and 5-action expanded layout
     * (Previous, Rewind 10s, Play/Pause, Forward 10s, Next), with compact mode displaying (Prev, Play/Pause, Next).
     */
    private Notification buildNotification(String title, String artist, boolean isPlaying) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText("UpBeat")
            .setSmallIcon(R.drawable.ic_upbeat_status)
            .setContentIntent(contentIntent)
            .setOngoing(isPlaying)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setColor(Color.parseColor("#6366F1"))
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT);

        Bitmap artToUse = cachedArtworkBitmap != null ? cachedArtworkBitmap : createDefaultArtwork(title);
        if (artToUse != null) {
            builder.setLargeIcon(artToUse);
        }

        // Spotify-style 5 action transport layout
        builder
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_skip_previous, "Previous", createActionIntent(ACTION_PREV)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_fast_rewind_10, "Rewind 10s", createActionIntent(ACTION_REWIND)))
            .addAction(new NotificationCompat.Action(
                isPlaying ? R.drawable.ic_pause : R.drawable.ic_play_arrow,
                isPlaying ? "Pause" : "Play",
                createActionIntent(ACTION_TOGGLE_PLAY)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_fast_forward_10, "Forward 10s", createActionIntent(ACTION_FORWARD)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_skip_next, "Next", createActionIntent(ACTION_NEXT)))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mMediaSession.getSessionToken())
                // Compact view shows action 0 (Previous), action 2 (Play/Pause), action 4 (Next)
                .setShowActionsInCompactView(0, 2, 4)
                .setShowCancelButton(true)
                .setCancelButtonIntent(createActionIntent(ACTION_STOP)));

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "UpBeat Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows interactive music player controls in notification bar");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static void saveQueue(Context context, String queueJson) {
        if (context == null || queueJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QUEUE, queueJson).apply();
        if (sInstance != null) {
            sInstance.notifyChildrenChanged(MEDIA_ID_QUEUE);
        }
    }

    public static void saveFavorites(Context context, String favsJson) {
        if (context == null || favsJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_FAVS, favsJson).apply();
        if (sInstance != null) {
            sInstance.notifyChildrenChanged(MEDIA_ID_FAVORITES);
        }
    }

    public static void updatePlayback(Context context, boolean isPlaying, String title, String artist, String artUrl, long durationSec, long positionSec) {
        if (context == null) return;

        // If the service instance is active in memory, immediately dispatch on the main looper
        // for instant 0ms latency in updating the top notification bar without waiting for intent queues!
        if (sInstance != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                if (sInstance != null) {
                    sInstance.handlePlaybackUpdate(isPlaying, title, artist, artUrl, durationSec, positionSec);
                }
            });
        }

        try {
            Intent serviceIntent = new Intent(context, UpBeatMediaService.class);
            serviceIntent.putExtra("isPlaying", isPlaying);
            serviceIntent.putExtra("title", title != null ? title : "UpBeat");
            serviceIntent.putExtra("artist", artist != null ? artist : "");
            serviceIntent.putExtra("artUrl", artUrl != null ? artUrl : "");
            serviceIntent.putExtra("durationSec", durationSec);
            serviceIntent.putExtra("positionSec", positionSec);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                androidx.core.content.ContextCompat.startForegroundService(context, serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception ignored) {}
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UpBeat::MediaWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
            }
        } catch (Exception ignored) {}

        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int lockType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(lockType, "UpBeat::MediaWifiLock");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (mMediaSession != null) {
            mMediaSession.setActive(false);
            mMediaSession.release();
        }
        releaseLocks();
        sInstance = null;
    }
}
