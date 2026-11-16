package com.aaradhya.upbeat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
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
import android.util.LruCache;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * UpBeat v5.3 — Standalone Headless Android Auto Engine & In-Car Music Studio.
 *
 * Key Architecture:
 * 1. 100% Phone-Free Standalone Playback:
 *    Built-in native android.media.MediaPlayer + YouTube InnerTube stream resolver inside
 *    UpBeatMediaService. Works even when the UpBeat phone app is completely closed, swiped
 *    away, or the phone is locked in your pocket. Eliminates "Could not load your selection".
 * 2. Amazon-Music-Style 2-Tab UI ("Home" & "Library"):
 *    - Home Tab:
 *      • "Hot Playlists" Grid (Hindi Latest, Hindi Trendy, English Latest, Japanese Latest,
 *        Fresh Indie, Bollywood Soul Soothers) with branded cover cards.
 *      • "Your Frequent Plays" Grid (1-tap instant play from your favorites/recent tracks).
 *      • "Based on Your Recents" Grid.
 *    - Library Tab:
 *      • "Playlists & Saved" Grid (Liked Songs, My Recent Plays, My Discovery Mix).
 *      • Direct 1-tap Liked Songs list right inside Library.
 */
public class UpBeatMediaService extends MediaBrowserServiceCompat {

    public static final String CHANNEL_ID = "upbeat_playback_channel";
    public static final int NOTIFICATION_ID = 1042;
    private static final String PREFS_NAME = "upbeat_car_prefs";
    private static final String KEY_QUEUE = "car_queue_json";
    private static final String KEY_FAVS = "car_favs_json";
    private static final String KEY_MIXES = "car_mixes_json";
    private static final String KEY_REPEAT_MODE = "car_repeat_mode";

    public static final String ACTION_TOGGLE_PLAY = "com.aaradhya.upbeat.ACTION_TOGGLE_PLAY";
    public static final String ACTION_PLAY = "com.aaradhya.upbeat.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.aaradhya.upbeat.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.aaradhya.upbeat.ACTION_NEXT";
    public static final String ACTION_PREV = "com.aaradhya.upbeat.ACTION_PREV";
    public static final String ACTION_REWIND = "com.aaradhya.upbeat.ACTION_REWIND";
    public static final String ACTION_FORWARD = "com.aaradhya.upbeat.ACTION_FORWARD";
    public static final String ACTION_STOP = "com.aaradhya.upbeat.ACTION_STOP";

    public static final String ACTION_CUSTOM_TOGGLE_LOOP = "com.aaradhya.upbeat.AA_TOGGLE_LOOP";
    public static final String ACTION_CUSTOM_TOGGLE_LIKE = "com.aaradhya.upbeat.AA_TOGGLE_LIKE";
    public static final String ACTION_CUSTOM_SHUFFLE = "com.aaradhya.upbeat.AA_SHUFFLE";
    public static final String ACTION_CUSTOM_AUTOMIX = "com.aaradhya.upbeat.AA_AUTOMIX";

    // Top-level Android Auto hierarchy (4 Tabs matching UpBeat v7.6.0 phone UI)
    public static final String MEDIA_ID_ROOT = "root";
    public static final String MEDIA_ID_TAB_FORYOU = "tab_foryou";
    public static final String MEDIA_ID_TAB_PLAYLISTS = "tab_playlists";
    public static final String MEDIA_ID_TAB_CHARTS = "tab_charts";
    public static final String MEDIA_ID_TAB_LIBRARY = "tab_library";
    public static final String MEDIA_ID_TAB_HOME = MEDIA_ID_TAB_FORYOU;

    // Library folders
    public static final String MEDIA_ID_LIB_FAVS = "lib_favorites";
    public static final String MEDIA_ID_LIB_QUEUE = "lib_queue";

    // Hot Playlist IDs
    public static final String PL_HINDI_LATEST = "pl_hindi_latest";
    public static final String PL_HINDI_TRENDY = "pl_hindi_trendy";
    public static final String PL_ENGLISH_LATEST = "pl_english_latest";
    public static final String PL_JAPANESE_LATEST = "pl_japanese_latest";
    public static final String PL_INDIE_FRESH = "pl_indie_fresh";
    public static final String PL_BOLLYWOOD_SOUL = "pl_bollywood_soul";

    // Android Auto Content Style Constants
    public static final String CONTENT_STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED";
    public static final String CONTENT_STYLE_BROWSABLE_HINT = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    public static final String CONTENT_STYLE_PLAYABLE_HINT = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    public static final String CONTENT_STYLE_GROUP_TITLE_HINT = "android.media.browse.CONTENT_STYLE_GROUP_TITLE_HINT";
    public static final int CONTENT_STYLE_LIST_ITEM = 1;
    public static final int CONTENT_STYLE_GRID_ITEM = 2;
    public static final String SEARCH_SUPPORTED = "android.media.browse.SEARCH_SUPPORTED";

    private static final String YT_ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";

    public static class CarTrack {
        public final String title;
        public final String artist;
        public final String videoId;
        public final String durationText;
        public final String coverUrl;

        public CarTrack(String title, String artist, String videoId) {
            this(title, artist, videoId, "", "");
        }

        public CarTrack(String title, String artist, String videoId, String durationText, String coverUrl) {
            this.title = title != null ? title : "Unknown Track";
            this.artist = artist != null ? artist : "UpBeat";
            this.videoId = videoId != null ? videoId : "";
            this.durationText = durationText != null ? durationText : "";
            this.coverUrl = coverUrl != null ? coverUrl : "";
        }
    }

    public static class HotPlaylistDef {
        public final String id;
        public final String title;
        public final String subtitle;
        public final String badgeTop;
        public final String badgeRibbon;
        public final String badgeColor;
        public final String searchQuery;
        public final String kind;
        public final String coverUrl;
        public final List<CarTrack> tracks = Collections.synchronizedList(new ArrayList<>());

        public HotPlaylistDef(String id, String title, String subtitle, String badgeTop, String badgeRibbon, String badgeColor, String searchQuery, CarTrack[] seedTracks) {
            this(id, title, subtitle, badgeTop, badgeRibbon, badgeColor, searchQuery, "chart", "", seedTracks);
        }

        public HotPlaylistDef(String id, String title, String subtitle, String badgeTop, String badgeRibbon, String badgeColor, String searchQuery, String kind, String coverUrl, CarTrack[] seedTracks) {
            this.id = id;
            this.title = title;
            this.subtitle = subtitle;
            this.badgeTop = badgeTop;
            this.badgeRibbon = badgeRibbon;
            this.badgeColor = badgeColor;
            this.searchQuery = searchQuery != null ? searchQuery : "";
            this.kind = kind != null ? kind : "chart";
            this.coverUrl = coverUrl != null ? coverUrl : "";
            if (seedTracks != null) {
                Collections.addAll(this.tracks, seedTracks);
            }
        }

        public String getHeroVideoId() {
            synchronized (tracks) {
                for (CarTrack t : tracks) {
                    if (t.videoId != null && t.videoId.length() == 11) {
                        return t.videoId;
                    }
                }
            }
            return "";
        }

        public String getHeroCoverUrl() {
            if (coverUrl != null && !coverUrl.isEmpty()) {
                return coverUrl;
            }
            synchronized (tracks) {
                for (CarTrack t : tracks) {
                    if (t.coverUrl != null && !t.coverUrl.isEmpty()) {
                        return t.coverUrl;
                    }
                }
            }
            return "";
        }
    }

    private final Map<String, HotPlaylistDef> mPlaylists = new LinkedHashMap<>();
    // Synced phone collections: Made For You, Daily Top Charts, and User Playlists/Mixes
    private final Map<String, HotPlaylistDef> mForYouMixes = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<String, HotPlaylistDef> mSyncedCharts = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<String, HotPlaylistDef> mUserMixes = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<String, HotPlaylistDef> mMoodPlaylists = Collections.synchronizedMap(new LinkedHashMap<>());
    private final List<CarTrack> mUserFavorites = Collections.synchronizedList(new ArrayList<>());
    private final List<CarTrack> mUserQueue = Collections.synchronizedList(new ArrayList<>());
    private final List<CarTrack> mActiveCarQueue = Collections.synchronizedList(new ArrayList<>());
    private volatile int mActiveCarQueueIndex = 0;
    private volatile String mRepeatMode = "off";
    private String currentVideoId = "";
    private String currentQueueTitle = "UpBeat Queue";

    // Standalone Native MediaPlayer for 100% Phone-Free Car Playback
    private MediaPlayer mStandalonePlayer = null;
    private volatile boolean mUsingStandalonePlayer = false;
    private volatile int mPlaybackGeneration = 0;
    private AudioManager mAudioManager = null;
    private AudioFocusRequest mAudioFocusRequest = null;

    private static class StreamCacheEntry {
        final String url;
        final long durationSec;
        final long timestamp;

        StreamCacheEntry(String url, long durationSec) {
            this.url = url;
            this.durationSec = durationSec;
            this.timestamp = System.currentTimeMillis();
        }
    }

    private final Map<String, StreamCacheEntry> mStreamCache = new ConcurrentHashMap<>();
    private final ExecutorService mNetworkExecutor = Executors.newFixedThreadPool(3);
    private final ExecutorService mImageExecutor = Executors.newFixedThreadPool(2);
    private final Handler mMainHandler = new Handler(Looper.getMainLooper());

    public static volatile UpBeatMediaService sInstance = null;

    private MediaSessionCompat mMediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private volatile boolean isCurrentlyPlaying = false;
    private volatile long lastUserActionTime = 0;
    private volatile boolean lastUserActionWasPause = false;

    private String currentTitle = "UpBeat";
    private String currentArtist = "Tap any playlist or song to start";
    private String currentArtUrl = "";
    private long currentDurationMs = 0;
    private long currentPositionMs = 0;

    private Bitmap cachedArtworkBitmap = null;
    private String cachedArtworkUrl = "";

    private final LruCache<String, Bitmap> mArtworkCache = new LruCache<>(32);
    private final LruCache<String, Bitmap> mDefaultArtworkCache = new LruCache<>(16);

    private final Runnable mProgressTicker = new Runnable() {
        @Override
        public void run() {
            if (mUsingStandalonePlayer && mStandalonePlayer != null) {
                try {
                    if (mStandalonePlayer.isPlaying()) {
                        currentPositionMs = mStandalonePlayer.getCurrentPosition();
                        int dur = mStandalonePlayer.getDuration();
                        if (dur > 0 && Math.abs(currentDurationMs - dur) > 1500) {
                            currentDurationMs = dur;
                            applyMediaMetadata();
                        }
                        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, currentPositionMs, true);
                    }
                } catch (Exception ignored) {}
            }
            if (isCurrentlyPlaying && mUsingStandalonePlayer) {
                mMainHandler.postDelayed(this, 1000);
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        mAudioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createNotificationChannel();
        acquireLocks();

        initCuratedPlaylists();
        initMoodPlaylists();
        loadSavedUserLists();

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
        syncMediaSessionRepeatMode();
        mMediaSession.setActive(true);
        setSessionToken(mMediaSession.getSessionToken());

        // Seed initial active queue so pressing Play on steering wheel works immediately
        synchronized (mActiveCarQueue) {
            if (!mUserFavorites.isEmpty()) {
                mActiveCarQueue.addAll(mUserFavorites);
                currentQueueTitle = "Liked Songs";
            } else if (!mUserQueue.isEmpty()) {
                mActiveCarQueue.addAll(mUserQueue);
                currentQueueTitle = "Up Next Queue";
            } else {
                HotPlaylistDef hindiLatest = mPlaylists.get(PL_HINDI_LATEST);
                if (hindiLatest != null) {
                    mActiveCarQueue.addAll(hindiLatest.tracks);
                    currentQueueTitle = hindiLatest.title;
                }
            }
            if (!mActiveCarQueue.isEmpty()) {
                CarTrack first = mActiveCarQueue.get(0);
                currentTitle = first.title;
                currentArtist = first.artist;
                currentVideoId = first.videoId;
                currentArtUrl = !first.coverUrl.isEmpty()
                    ? first.coverUrl
                    : (!first.videoId.isEmpty() ? "https://i.ytimg.com/vi/" + first.videoId + "/hqdefault.jpg" : "");
                applyMediaMetadata();
            }
            syncActiveCarQueueToMediaSession();
        }

        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED, 0, false);
        ensureForeground(false);

        // Refresh playlists with live YouTube Music tracks in the background
        refreshPlaylistsFromYouTubeAsync();
    }

    private void initMoodPlaylists() {
        mMoodPlaylists.clear();
        mMoodPlaylists.put("mood_energize", new HotPlaylistDef(
            "mood_energize", "Energize", "High Energy Pop & Upbeat Hits", "MOOD", "Energize", "#F59E0B",
            "high energy upbeat pop hits songs", "mood", "", null));
        mMoodPlaylists.put("mood_chill", new HotPlaylistDef(
            "mood_chill", "Chill & Late Night", "Acoustic, Chill & Indie Vibes", "MOOD", "Chill", "#3B82F6",
            "late night chill acoustic hindi english indie songs", "mood", "", null));
        mMoodPlaylists.put("mood_focus", new HotPlaylistDef(
            "mood_focus", "Deep Focus", "Ambient, Instrumental & Study Flow", "MOOD", "Focus", "#10B981",
            "deep focus instrumental ambient study music", "mood", "", null));
        mMoodPlaylists.put("mood_workout", new HotPlaylistDef(
            "mood_workout", "Workout & Pump", "Adrenaline & Gym Anthems", "MOOD", "Workout", "#EF4444",
            "high energy workout gym bollywood punjabi edm songs", "mood", "", null));
        mMoodPlaylists.put("mood_party", new HotPlaylistDef(
            "mood_party", "Party & Dance", "Club Bangers & Party Anthems", "MOOD", "Party", "#EC4899",
            "bollywood punjabi dance party hit songs", "mood", "", null));
        mMoodPlaylists.put("mood_romantic", new HotPlaylistDef(
            "mood_romantic", "Romantic Duets", "Soulful Love Songs & Classics", "MOOD", "Romance", "#F43F5E",
            "romantic hindi love songs arijit singh duets", "mood", "", null));
    }

    private void initCuratedPlaylists() {
        mPlaylists.clear();

        // 1. Hindi Latest Songs
        mPlaylists.put(PL_HINDI_LATEST, new HotPlaylistDef(
            PL_HINDI_LATEST,
            "Hindi Latest Songs",
            "Fresh Bollywood & New Releases",
            "Fresh",
            "Hindi",
            "#F59E0B",
            "new hindi songs 2025 2026 bollywood hits",
            new CarTrack[]{
                new CarTrack("Aaj Ki Raat (Stree 2)", "Sachin-Jigar & Madhubanti Bagchi", "XtZTpxnrHAc"),
                new CarTrack("Tauba Tauba", "Karan Aujla", "N6_EvGT0ZfM"),
                new CarTrack("Sajni (Laapataa Ladies)", "Arijit Singh & Ram Sampath", "Ys6iPqfvmI0"),
                new CarTrack("Aayi Nai (Stree 2)", "Sachin-Jigar & Pawan Singh", "gcYGwcUmjZo"),
                new CarTrack("O Maahi (Dunki)", "Arijit Singh & Pritam", "qnQCd_nZn_g"),
                new CarTrack("Satranga (Animal)", "Arijit Singh", "YCwP7X42wfw"),
                new CarTrack("Teri Baaton Mein Aisa Uljha Jiya", "Raghav & Tanishk Bagchi", "YEp76bA-6rA"),
                new CarTrack("Akhiyaan Gulaab", "Mitraz", "lLM6pPrrAvQ"),
                new CarTrack("Pehle Bhi Main", "Vishal Mishra", "9cHq63r1vHQ"),
                new CarTrack("Chaleya (Jawan)", "Arijit Singh & Shilpa Rao", "V_jp5_VAzXk"),
                new CarTrack("Soulmate", "Badshah & Arijit Singh", "z-PUf6k552I"),
                new CarTrack("Khoobsurat (Stree 2)", "Vishal Mishra & Sachin-Jigar", "eUwS1KJhQAc")
            }
        ));

        // 2. Hindi Trendy Songs
        mPlaylists.put(PL_HINDI_TRENDY, new HotPlaylistDef(
            PL_HINDI_TRENDY,
            "Hindi Trendy Songs",
            "Hot Right Now • Viral Chartbusters",
            "Hot Right Now",
            "Hindi",
            "#F97316",
            "trending hindi songs viral hits",
            new CarTrack[]{
                new CarTrack("Millionaire", "Yo Yo Honey Singh", "yleXPEPJIgI"),
                new CarTrack("Husn", "Anuv Jain", "_deqdZmKzyg"),
                new CarTrack("Illuminati (Aavesham)", "Sushin Shyam & Dabzee", "S1jo8K4kDJc"),
                new CarTrack("Hass Hass", "Diljit Dosanjh & Sia", "OhNCUgJXgK0"),
                new CarTrack("Softly", "Karan Aujla & Ikky", "U4qD41gPQMU"),
                new CarTrack("One Love", "Shubh", "1FdMm_O7it8"),
                new CarTrack("Heeriye", "Jasleen Royal & Arijit Singh", "4VwtfInG-LU"),
                new CarTrack("Tu Hai Kahan", "AUR", "Y5m3FAxatX4"),
                new CarTrack("The Punjaabban Song", "Gippy Grewal & Zahrah S Khan", "8oGgAtB-6vA"),
                new CarTrack("Ainvayi Ainvayi", "Salim Merchant & Sunidhi Chauhan", "14tCx65hmXQ"),
                new CarTrack("Kalaastar", "Yo Yo Honey Singh", "sSdhhkA9gCo"),
                new CarTrack("Winning Speech", "Karan Aujla", "0DS5jYQeiw0")
            }
        ));

        // 3. English Latest Songs
        mPlaylists.put(PL_ENGLISH_LATEST, new HotPlaylistDef(
            PL_ENGLISH_LATEST,
            "English Latest Songs",
            "Global Top Pop & Chart Hits",
            "Hot Right Now",
            "English",
            "#06B6D4",
            "latest english pop songs top hits",
            new CarTrack[]{
                new CarTrack("Die With A Smile", "Lady Gaga & Bruno Mars", "DlFXDl_ROAM"),
                new CarTrack("Espresso", "Sabrina Carpenter", "kIft-LUHHVA"),
                new CarTrack("APT.", "ROSÉ & Bruno Mars", "DiTd771WumE"),
                new CarTrack("BIRDS OF A FEATHER", "Billie Eilish", "WKZO-CWeOVA"),
                new CarTrack("Timeless", "The Weeknd & Playboi Carti", "a4O-abCXsfA"),
                new CarTrack("Lose Control", "Teddy Swims", "AeedWEyMYYo"),
                new CarTrack("Beautiful Things", "Benson Boone", "eLhSxOAaWmg"),
                new CarTrack("Blinding Lights", "The Weeknd", "J7p4bzqLvCw"),
                new CarTrack("Starboy", "The Weeknd & Daft Punk", "3_g2un5M350"),
                new CarTrack("STAY", "The Kid LAROI & Justin Bieber", "XfEMj-z3TtA"),
                new CarTrack("Night Changes", "One Direction", "8BiLurrzFRw"),
                new CarTrack("Story of My Life", "One Direction", "8M3Vlnu_i3c")
            }
        ));

        // 4. Japanese Latest Songs
        mPlaylists.put(PL_JAPANESE_LATEST, new HotPlaylistDef(
            PL_JAPANESE_LATEST,
            "Japanese Latest Songs",
            "J-Pop, Viral & Anime Anthems",
            "Trending",
            "Japanese",
            "#F43F5E",
            "japanese latest songs jpop hits",
            new CarTrack[]{
                new CarTrack("Idol (アイドル)", "YOASOBI", "m9SMT5ipbxk"),
                new CarTrack("Bling-Bang-Bang-Born", "Creepy Nuts", "6gMBmZ28Xg4"),
                new CarTrack("Shinunoga E-Wa", "Fujii Kaze", "3zh9Wb1KuW8"),
                new CarTrack("Yoru ni Kakeru (夜に駆ける)", "YOASOBI", "by4SYYWlhEs"),
                new CarTrack("KICK BACK", "Kenshi Yonezu", "NMA_isZYsYQ"),
                new CarTrack("SPECIALZ", "King Gnu", "5RaU8K8sLTM"),
                new CarTrack("Ao no Sumika", "Tatsuya Kitani", "65xX7zyr-fA"),
                new CarTrack("Suzume (すずめ)", "RADWIMPS", "9LW9DpmhrPE"),
                new CarTrack("Odoriko (踊り子)", "Vaundy", "CnlMTBwsBHs"),
                new CarTrack("Renai Circulation", "Kana Hanazawa", "F8xpmTmdf6o"),
                new CarTrack("Unravel", "TK from Ling tosite sigure", "C0ppulkmXPw"),
                new CarTrack("Gurenge (紅蓮華)", "LiSA", "TqyfmFaZlqw")
            }
        ));

        // 5. Fresh Indie & Acoustic
        mPlaylists.put(PL_INDIE_FRESH, new HotPlaylistDef(
            PL_INDIE_FRESH,
            "Fresh Indie",
            "Anuv Jain, Prateek Kuhad & Indie",
            "Fresh",
            "Indie",
            "#EAB308",
            "indian indie latest songs anuv jain prateek kuhad",
            new CarTrack[]{
                new CarTrack("Jo Tum Mere Ho", "Anuv Jain", "usvVGXFIpTM"),
                new CarTrack("Baarishein", "Anuv Jain", "tYqZK7bq5Bs"),
                new CarTrack("Choo Lo", "The Local Train", "opwZ_PJ-F_E"),
                new CarTrack("Co2", "Prateek Kuhad", "6FewJvQDTmA"),
                new CarTrack("Samjho Na", "Aditya Rikhari", "aaYtQCmn_HQ"),
                new CarTrack("Lamhey", "Anubha Bajaj", "XQPQ6JsLrSE"),
                new CarTrack("Gul", "Anuv Jain", "Kh49Zqa84IE"),
                new CarTrack("Kasoor", "Prateek Kuhad", "iAQcOfKO8CM"),
                new CarTrack("Aaoge Tum Kabhi", "The Local Train", "79Yc9gN3TPM"),
                new CarTrack("Faasle", "Aditya Rikhari", "zP9n2ZAS28Q")
            }
        ));

        // 6. Bollywood Soul Soothers (Based on Recents)
        mPlaylists.put(PL_BOLLYWOOD_SOUL, new HotPlaylistDef(
            PL_BOLLYWOOD_SOUL,
            "Bollywood Soul Soothers",
            "Arijit Singh, Shreya Ghoshal & Classics",
            "Rediscover",
            "Soul",
            "#8B5CF6",
            "bollywood romantic soul songs arijit singh shreya ghoshal",
            new CarTrack[]{
                new CarTrack("Tum Hi Ho", "Arijit Singh", "fsiPzT50ZiM"),
                new CarTrack("Kesariya", "Arijit Singh & Pritam", "NJAv_7lHUIU"),
                new CarTrack("Apna Bana Le", "Arijit Singh & Sachin-Jigar", "YALvuUpY_b0"),
                new CarTrack("Agar Tum Saath Ho", "Alka Yagnik & Arijit Singh", "FOA9iyxsW_A"),
                new CarTrack("Tujh Mein Rab Dikhta Hai", "Roop Kumar Rathod", "3E1NLVzDZ_Y"),
                new CarTrack("Tere Hawaale", "Arijit Singh & Shilpa Rao", "Z0VbANbyH2o"),
                new CarTrack("Raataan Lambiyan", "Jubin Nautiyal & Asees Kaur", "Dm6YRJHy64c"),
                new CarTrack("Shayad", "Arijit Singh & Pritam", "EQxEms7gnqs"),
                new CarTrack("Tum Se Hi", "Mohit Chauhan & Pritam", "I94fhjQ-U30"),
                new CarTrack("Zara Sa", "KK & Pritam", "zv-tbc4F818")
            }
        ));
    }

    private void loadSavedUserLists() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            mRepeatMode = normalizeRepeatMode(prefs.getString(KEY_REPEAT_MODE, "off"));
            parseJsonToTrackList(prefs.getString(KEY_FAVS, "[]"), mUserFavorites);
            parseJsonToTrackList(prefs.getString(KEY_QUEUE, "[]"), mUserQueue);
            parseMixes(prefs.getString(KEY_MIXES, "[]"));
        } catch (Exception ignored) {}
    }

    private static String normalizeRepeatMode(String mode) {
        if ("one".equalsIgnoreCase(mode)) return "one";
        if ("all".equalsIgnoreCase(mode)) return "all";
        return "off";
    }

    /** Looks up a built-in chart, mood, For You card, synced chart, or user playlist/mix. */
    private HotPlaylistDef findPlaylist(String id) {
        if (id == null) return null;
        HotPlaylistDef pl = mForYouMixes.get(id);
        if (pl != null) return pl;
        pl = mSyncedCharts.get(id);
        if (pl != null) return pl;
        pl = mUserMixes.get(id);
        if (pl != null) return pl;
        pl = mPlaylists.get(id);
        if (pl != null) return pl;
        return mMoodPlaylists.get(id);
    }

    private List<HotPlaylistDef> getForYouMixes() {
        synchronized (mForYouMixes) {
            return new ArrayList<>(mForYouMixes.values());
        }
    }

    private List<HotPlaylistDef> getSyncedCharts() {
        synchronized (mSyncedCharts) {
            return new ArrayList<>(mSyncedCharts.values());
        }
    }

    private List<HotPlaylistDef> getUserMixes() {
        synchronized (mUserMixes) {
            return new ArrayList<>(mUserMixes.values());
        }
    }

    /** JSON: [{ id, title, subtitle, kind, query, cover, tracks: [{ title, artist, video_id, thumbnail, duration_text }] }] */
    private void parseMixes(String json) {
        Map<String, HotPlaylistDef> nextForYou = new LinkedHashMap<>();
        Map<String, HotPlaylistDef> nextCharts = new LinkedHashMap<>();
        Map<String, HotPlaylistDef> nextUser = new LinkedHashMap<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length() && i < 36; i++) {
                JSONObject obj = arr.getJSONObject(i);
                String title = obj.optString("title", "").trim();
                if (title.isEmpty()) continue;
                String kind = obj.optString("kind", "mix").trim().toLowerCase();
                String query = obj.optString("query", "").trim();
                String cover = obj.optString("cover", "").trim();
                JSONArray trackArr = obj.optJSONArray("tracks");
                List<CarTrack> tracks = new ArrayList<>();
                parseJsonToTrackList(trackArr != null ? trackArr.toString() : "[]", tracks);

                if (tracks.isEmpty() && query.isEmpty()) continue;

                String subtitle = obj.optString("subtitle", tracks.isEmpty() ? "Curated Mix" : (tracks.size() + " songs")).trim();
                if ("foryou".equals(kind)) {
                    String id = "fy_" + i;
                    nextForYou.put(id, new HotPlaylistDef(
                        id, title, subtitle, "FOR YOU", "Curated", "#F43F5E",
                        query.isEmpty() ? title : query, "foryou", cover, tracks.toArray(new CarTrack[0])
                    ));
                } else if ("chart".equals(kind)) {
                    String id = "ch_" + i;
                    nextCharts.put(id, new HotPlaylistDef(
                        id, title, subtitle, "DAILY CHART", "Top Chart", "#E11D48",
                        query.isEmpty() ? title : query, "chart", cover, tracks.toArray(new CarTrack[0])
                    ));
                } else {
                    boolean isAi = "mix".equals(kind);
                    String id = "umix_" + i;
                    nextUser.put(id, new HotPlaylistDef(
                        id, title, subtitle, isAi ? "AI MIX" : "PLAYLIST",
                        tracks.size() + " songs", isAi ? "#F43F5E" : "#3F3F46",
                        query, kind, cover, tracks.toArray(new CarTrack[0])
                    ));
                }
            }
        } catch (Exception ignored) {}
        synchronized (mForYouMixes) {
            mForYouMixes.clear();
            mForYouMixes.putAll(nextForYou);
        }
        synchronized (mSyncedCharts) {
            mSyncedCharts.clear();
            mSyncedCharts.putAll(nextCharts);
        }
        synchronized (mUserMixes) {
            mUserMixes.clear();
            mUserMixes.putAll(nextUser);
        }
    }

    private void parseJsonToTrackList(String json, List<CarTrack> target) {
        synchronized (target) {
            target.clear();
            try {
                JSONArray arr = new JSONArray(json);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.getJSONObject(i);
                    String title = obj.optString("title", "").trim();
                    String artist = obj.optString("artist", "UpBeat").trim();
                    String vid = obj.optString("video_id", "").trim();
                    String thumb = obj.optString("thumbnail", "").trim();
                    String durText = obj.optString("duration_text", "").trim();
                    if (vid.isEmpty()) {
                        int viIdx = thumb.indexOf("/vi/");
                        if (viIdx >= 0 && thumb.length() >= viIdx + 15) {
                            vid = thumb.substring(viIdx + 4, viIdx + 15);
                        }
                    }
                    if (!title.isEmpty()) {
                        target.add(new CarTrack(title, artist, vid, durText, thumb));
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    /**
     * Background enrichment: queries YouTube Music InnerTube for fresh tracks and appends
     * new releases to the curated playlists without blocking initial 0ms browse response.
     */
    private void refreshPlaylistsFromYouTubeAsync() {
        mNetworkExecutor.submit(() -> {
            for (HotPlaylistDef pl : mPlaylists.values()) {
                try {
                    List<CarTrack> fresh = searchYouTubeMusicTracksNative(pl.searchQuery, 8);
                    if (!fresh.isEmpty()) {
                        boolean changed = false;
                        synchronized (pl.tracks) {
                            for (CarTrack ft : fresh) {
                                boolean exists = false;
                                for (CarTrack existing : pl.tracks) {
                                    if (existing.videoId.equals(ft.videoId)
                                        || existing.title.equalsIgnoreCase(ft.title)) {
                                        exists = true;
                                        break;
                                    }
                                }
                                if (!exists && pl.tracks.size() < 22) {
                                    pl.tracks.add(ft);
                                    changed = true;
                                }
                            }
                        }
                        if (changed) {
                            notifyChildrenChanged(pl.id);
                        }
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    // =========================================================================
    // Native Standalone Audio Engine (Works with Phone App Closed / Locked)
    // =========================================================================

    private boolean requestAudioFocus() {
        if (mAudioManager == null) return true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (mAudioFocusRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                    mAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener(focusChange -> {
                            if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                                pauseStandaloneOrApp();
                            }
                        })
                        .build();
                }
                int res = mAudioManager.requestAudioFocus(mAudioFocusRequest);
                return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            } else {
                int res = mAudioManager.requestAudioFocus(
                    focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            pauseStandaloneOrApp();
                        }
                    },
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                );
                return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
        } catch (Exception e) {
            return true;
        }
    }

    private void playQueueAtIndex(List<CarTrack> sourceList, int startIndex) {
        playQueueAtIndex(sourceList, startIndex, "UpBeat Queue");
    }

    private void playQueueAtIndex(List<CarTrack> sourceList, int startIndex, String queueTitle) {
        synchronized (mActiveCarQueue) {
            mActiveCarQueue.clear();
            if (sourceList != null && !sourceList.isEmpty()) {
                mActiveCarQueue.addAll(sourceList);
            }
            if (mActiveCarQueue.isEmpty()) {
                HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
                if (def != null) mActiveCarQueue.addAll(def.tracks);
            }
            if (mActiveCarQueue.isEmpty()) return;

            if (queueTitle != null && !queueTitle.trim().isEmpty()) {
                currentQueueTitle = queueTitle.trim();
            }
            mActiveCarQueueIndex = Math.max(0, Math.min(startIndex, mActiveCarQueue.size() - 1));
            syncActiveCarQueueToMediaSession();
            CarTrack track = mActiveCarQueue.get(mActiveCarQueueIndex);
            playCarTrackStandalone(track);
            prefetchNextTrackAsync();
        }
    }

    private void syncActiveCarQueueToMediaSession() {
        if (mMediaSession == null) return;
        List<MediaSessionCompat.QueueItem> qItems = new ArrayList<>();
        synchronized (mActiveCarQueue) {
            int limit = Math.min(40, mActiveCarQueue.size());
            for (int i = 0; i < limit; i++) {
                CarTrack t = mActiveCarQueue.get(i);
                MediaDescriptionCompat.Builder desc = new MediaDescriptionCompat.Builder()
                    .setMediaId(!t.videoId.isEmpty() ? t.videoId : ("q_" + i))
                    .setTitle(t.title)
                    .setSubtitle(t.artist)
                    .setIconUri(UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl));
                qItems.add(new MediaSessionCompat.QueueItem(desc.build(), (long) i));
            }
        }
        mMediaSession.setQueue(qItems);
        mMediaSession.setQueueTitle(currentQueueTitle);
    }

    private void syncMediaSessionRepeatMode() {
        if (mMediaSession == null) return;
        if ("one".equals(mRepeatMode)) {
            mMediaSession.setRepeatMode(PlaybackStateCompat.REPEAT_MODE_ONE);
        } else if ("all".equals(mRepeatMode)) {
            mMediaSession.setRepeatMode(PlaybackStateCompat.REPEAT_MODE_ALL);
        } else {
            mMediaSession.setRepeatMode(PlaybackStateCompat.REPEAT_MODE_NONE);
        }
    }

    private void toggleLoopOneFromCar() {
        String next = "one".equals(mRepeatMode) ? "off" : "one";
        mRepeatMode = next;
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_REPEAT_MODE, next).apply();
        syncMediaSessionRepeatMode();
        updatePlaybackState(
            isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
            currentPositionMs,
            isCurrentlyPlaying
        );
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("toggle_loop", next);
        }
    }

    private boolean isCurrentTrackLiked() {
        synchronized (mUserFavorites) {
            for (CarTrack t : mUserFavorites) {
                if (currentVideoId != null && !currentVideoId.isEmpty() && currentVideoId.equals(t.videoId)) {
                    return true;
                }
                if (currentTitle != null && !currentTitle.isEmpty() && currentTitle.equalsIgnoreCase(t.title)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void toggleLikeCurrentTrack() {
        if (currentTitle == null || currentTitle.isEmpty() || "UpBeat".equals(currentTitle)) return;
        synchronized (mUserFavorites) {
            int foundIdx = -1;
            for (int i = 0; i < mUserFavorites.size(); i++) {
                CarTrack t = mUserFavorites.get(i);
                if ((currentVideoId != null && !currentVideoId.isEmpty() && currentVideoId.equals(t.videoId))
                    || currentTitle.equalsIgnoreCase(t.title)) {
                    foundIdx = i;
                    break;
                }
            }
            if (foundIdx >= 0) {
                mUserFavorites.remove(foundIdx);
            } else {
                mUserFavorites.add(0, new CarTrack(currentTitle, currentArtist, currentVideoId, "", currentArtUrl));
            }
            try {
                JSONArray arr = new JSONArray();
                for (CarTrack t : mUserFavorites) {
                    JSONObject o = new JSONObject();
                    o.put("title", t.title);
                    o.put("artist", t.artist);
                    o.put("video_id", t.videoId);
                    o.put("thumbnail", t.coverUrl);
                    o.put("duration_text", t.durationText);
                    arr.put(o);
                }
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(KEY_FAVS, arr.toString()).apply();
            } catch (Exception ignored) {}
        }
        notifyAllBrowserTabs();
        updatePlaybackState(
            isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
            currentPositionMs,
            isCurrentlyPlaying
        );
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("toggle_like", currentVideoId != null ? currentVideoId : "");
        }
    }

    private void shuffleCurrentQueueFromCar() {
        synchronized (mActiveCarQueue) {
            if (mActiveCarQueue.size() <= 1) return;
            CarTrack curr = (mActiveCarQueueIndex >= 0 && mActiveCarQueueIndex < mActiveCarQueue.size())
                ? mActiveCarQueue.get(mActiveCarQueueIndex)
                : null;
            List<CarTrack> rest = new ArrayList<>();
            for (int i = 0; i < mActiveCarQueue.size(); i++) {
                if (curr == null || i != mActiveCarQueueIndex) {
                    rest.add(mActiveCarQueue.get(i));
                }
            }
            Collections.shuffle(rest);
            mActiveCarQueue.clear();
            if (curr != null) {
                mActiveCarQueue.add(curr);
            }
            mActiveCarQueue.addAll(rest);
            mActiveCarQueueIndex = 0;
            syncActiveCarQueueToMediaSession();
        }
        prefetchNextTrackAsync();
    }

    private void startRadioAutomixFromCar(final boolean playImmediately) {
        final String baseTitle = (currentTitle != null && !"UpBeat".equals(currentTitle)) ? currentTitle : "";
        final String baseArtist = currentArtist != null ? currentArtist : "";
        final String query = (!baseTitle.isEmpty())
            ? (baseTitle + " " + baseArtist + " mix")
            : "latest hindi english hit songs mix";
        final CarTrack anchorTrack;
        synchronized (mActiveCarQueue) {
            anchorTrack = (!mActiveCarQueue.isEmpty() && mActiveCarQueueIndex < mActiveCarQueue.size())
                ? mActiveCarQueue.get(mActiveCarQueueIndex)
                : null;
        }
        mNetworkExecutor.submit(() -> {
            List<CarTrack> found = searchYouTubeMusicTracksNative(query, 15);
            if (found.isEmpty()) return;
            mMainHandler.post(() -> {
                if (playImmediately) {
                    playQueueAtIndex(found, 0, "Automix Radio");
                    return;
                }
                synchronized (mActiveCarQueue) {
                    List<CarTrack> nextList = new ArrayList<>();
                    if (anchorTrack != null) nextList.add(anchorTrack);
                    for (CarTrack cand : found) {
                        if (anchorTrack != null && cand.videoId.equals(anchorTrack.videoId)) continue;
                        nextList.add(cand);
                    }
                    mActiveCarQueue.clear();
                    mActiveCarQueue.addAll(nextList);
                    mActiveCarQueueIndex = 0;
                    currentQueueTitle = "Automix Radio";
                    syncActiveCarQueueToMediaSession();
                    if (!isCurrentlyPlaying) {
                        playCarTrackStandalone(mActiveCarQueue.get(0));
                    }
                }
                prefetchNextTrackAsync();
            });
        });
    }

    private void playNextInCarQueue(boolean forward) {
        synchronized (mActiveCarQueue) {
            if (mActiveCarQueue.isEmpty()) {
                if (!mUserFavorites.isEmpty()) {
                    mActiveCarQueue.addAll(mUserFavorites);
                } else {
                    HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
                    if (def != null) mActiveCarQueue.addAll(def.tracks);
                }
            }
            if (mActiveCarQueue.isEmpty()) return;

            if (forward) {
                mActiveCarQueueIndex = (mActiveCarQueueIndex + 1) % mActiveCarQueue.size();
            } else {
                mActiveCarQueueIndex = (mActiveCarQueueIndex - 1 + mActiveCarQueue.size()) % mActiveCarQueue.size();
            }
            CarTrack nextTrack = mActiveCarQueue.get(mActiveCarQueueIndex);
            playCarTrackStandalone(nextTrack);
            prefetchNextTrackAsync();
        }
    }

    private void prefetchNextTrackAsync() {
        final CarTrack nextTrack;
        synchronized (mActiveCarQueue) {
            if (mActiveCarQueue.size() <= 1) return;
            int nextIdx = (mActiveCarQueueIndex + 1) % mActiveCarQueue.size();
            nextTrack = mActiveCarQueue.get(nextIdx);
        }
        if (nextTrack == null) return;
        mNetworkExecutor.submit(() -> {
            try {
                resolveStreamEntryNative(nextTrack);
            } catch (Exception ignored) {}
        });
    }

    /**
     * Resolves and plays a CarTrack directly inside UpBeatMediaService using Android's
     * hardware MediaPlayer. Works 100% independently of MainActivity / WebView.
     */
    private void playCarTrackStandalone(final CarTrack track) {
        if (track == null) return;
        final int gen = ++mPlaybackGeneration;
        mUsingStandalonePlayer = true;
        isCurrentlyPlaying = true;
        lastUserActionTime = SystemClock.elapsedRealtime();
        lastUserActionWasPause = false;

        // If MainActivity happens to be open, pause its WebView <audio> so there is never double audio
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("pause", "");
        }

        // Immediate optimistic UI update on car screen
        currentTitle = track.title;
        currentArtist = track.artist;
        currentVideoId = track.videoId != null ? track.videoId : "";
        currentArtUrl = !track.coverUrl.isEmpty()
            ? track.coverUrl
            : (!currentVideoId.isEmpty() ? "https://i.ytimg.com/vi/" + currentVideoId + "/hqdefault.jpg" : "");
        currentPositionMs = 0;
        cachedArtworkBitmap = createDefaultArtwork(currentTitle);
        if (!currentArtUrl.isEmpty()) {
            loadArtworkBitmapAsync(currentArtUrl);
        }

        mMediaSession.setActive(true);
        applyMediaMetadata();
        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING, 0, true);
        ensureForeground(true);
        notifyNotification();

        mNetworkExecutor.submit(() -> {
            StreamCacheEntry entry = resolveStreamEntryNative(track);
            if (gen != mPlaybackGeneration) return;

            if (entry == null || entry.url == null || entry.url.isEmpty()) {
                // Automatic fallback to next track in queue so car screen never errors out
                mMainHandler.post(() -> {
                    if (gen == mPlaybackGeneration) {
                        playNextInCarQueue(true);
                    }
                });
                return;
            }

            mMainHandler.post(() -> {
                if (gen != mPlaybackGeneration) return;
                startNativeMediaPlayer(entry.url, entry.durationSec, gen);
            });
        });
    }

    private void startNativeMediaPlayer(String streamUrl, long durationSec, final int gen) {
        try {
            releaseStandalonePlayer();
            requestAudioFocus();

            MediaPlayer mp = new MediaPlayer();
            mStandalonePlayer = mp;

            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            mp.setAudioAttributes(attrs);
            mp.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);

            Map<String, String> headers = new HashMap<>();
            headers.put("User-Agent", YT_ANDROID_UA);
            mp.setDataSource(getApplicationContext(), Uri.parse(streamUrl), headers);

            if (durationSec > 0) {
                currentDurationMs = durationSec * 1000;
                applyMediaMetadata();
            }

            mp.setOnPreparedListener(player -> {
                if (gen != mPlaybackGeneration) return;
                int durMs = player.getDuration();
                if (durMs > 0) {
                    currentDurationMs = durMs;
                }
                player.start();
                isCurrentlyPlaying = true;
                currentPositionMs = 0;
                applyMediaMetadata();
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, 0, true);
                notifyNotification();
                mMainHandler.removeCallbacks(mProgressTicker);
                mMainHandler.postDelayed(mProgressTicker, 1000);
            });

            mp.setOnCompletionListener(player -> {
                if (gen != mPlaybackGeneration) return;
                if ("one".equals(mRepeatMode)) {
                    try {
                        player.seekTo(0);
                        player.start();
                        currentPositionMs = 0;
                        isCurrentlyPlaying = true;
                        applyMediaMetadata();
                        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, 0, true);
                        notifyNotification();
                        return;
                    } catch (Exception ignored) {}
                    synchronized (mActiveCarQueue) {
                        if (!mActiveCarQueue.isEmpty() && mActiveCarQueueIndex < mActiveCarQueue.size()) {
                            playCarTrackStandalone(mActiveCarQueue.get(mActiveCarQueueIndex));
                            return;
                        }
                    }
                }
                playNextInCarQueue(true);
            });

            mp.setOnErrorListener((player, what, extra) -> {
                if (gen == mPlaybackGeneration) {
                    playNextInCarQueue(true);
                }
                return true;
            });

            mp.prepareAsync();
        } catch (Exception e) {
            if (gen == mPlaybackGeneration) {
                playNextInCarQueue(true);
            }
        }
    }

    private void releaseStandalonePlayer() {
        mMainHandler.removeCallbacks(mProgressTicker);
        if (mStandalonePlayer != null) {
            try {
                if (mStandalonePlayer.isPlaying()) {
                    mStandalonePlayer.stop();
                }
            } catch (Exception ignored) {}
            try {
                mStandalonePlayer.reset();
                mStandalonePlayer.release();
            } catch (Exception ignored) {}
            mStandalonePlayer = null;
        }
    }

    private void resumeStandaloneOrApp() {
        isCurrentlyPlaying = true;
        lastUserActionTime = SystemClock.elapsedRealtime();
        lastUserActionWasPause = false;

        if (mUsingStandalonePlayer && mStandalonePlayer != null) {
            try {
                requestAudioFocus();
                mStandalonePlayer.start();
                currentPositionMs = mStandalonePlayer.getCurrentPosition();
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, currentPositionMs, true);
                notifyNotification();
                mMainHandler.removeCallbacks(mProgressTicker);
                mMainHandler.postDelayed(mProgressTicker, 1000);
                return;
            } catch (Exception ignored) {}
        }

        // If no track is loaded yet in standalone player, start playing active queue at index
        if (MainActivity.sInstance == null || mUsingStandalonePlayer) {
            synchronized (mActiveCarQueue) {
                if (!mActiveCarQueue.isEmpty()) {
                    playCarTrackStandalone(mActiveCarQueue.get(mActiveCarQueueIndex));
                    return;
                }
            }
        }

        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING, currentPositionMs, true);
        notifyNotification();
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("play", "");
        }
    }

    private void pauseStandaloneOrApp() {
        isCurrentlyPlaying = false;
        lastUserActionTime = SystemClock.elapsedRealtime();
        lastUserActionWasPause = true;
        mMainHandler.removeCallbacks(mProgressTicker);

        if (mStandalonePlayer != null) {
            try {
                if (mStandalonePlayer.isPlaying()) {
                    currentPositionMs = mStandalonePlayer.getCurrentPosition();
                    mStandalonePlayer.pause();
                }
            } catch (Exception ignored) {}
        }

        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED, currentPositionMs, false);
        notifyNotification();
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("pause", "");
        }
    }

    private void seekStandaloneOrApp(long posMs) {
        currentPositionMs = Math.max(0, posMs);
        if (mUsingStandalonePlayer && mStandalonePlayer != null) {
            try {
                mStandalonePlayer.seekTo((int) currentPositionMs);
                updatePlaybackState(
                    isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    currentPositionMs,
                    isCurrentlyPlaying
                );
                return;
            } catch (Exception ignored) {}
        }
        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING, currentPositionMs, isCurrentlyPlaying);
        if (MainActivity.sInstance != null) {
            MainActivity.sInstance.dispatchCarAction("seek", String.valueOf(currentPositionMs / 1000));
        }
    }

    // =========================================================================
    // Native YouTube InnerTube Stream Resolver & Search (Zero WebView Needed)
    // =========================================================================

    private StreamCacheEntry resolveStreamEntryNative(CarTrack track) {
        if (track == null) return null;
        String vid = track.videoId;

        if (vid == null || vid.length() != 11) {
            List<CarTrack> found = searchYouTubeMusicTracksNative(track.title + " " + track.artist, 2);
            if (!found.isEmpty()) {
                vid = found.get(0).videoId;
            }
        }
        if (vid == null || vid.isEmpty()) return null;

        StreamCacheEntry cached = mStreamCache.get(vid);
        if (cached != null && (System.currentTimeMillis() - cached.timestamp) < 20 * 60 * 1000L) {
            return cached;
        }

        StreamCacheEntry resolved = fetchAndroidPlayerStream(vid);
        if (resolved != null) {
            mStreamCache.put(vid, resolved);
            return resolved;
        }

        // Fallback: search official audio track on YouTube Music
        List<CarTrack> altTracks = searchYouTubeMusicTracksNative(track.title + " " + track.artist + " audio", 3);
        for (CarTrack alt : altTracks) {
            if (!alt.videoId.equals(vid)) {
                StreamCacheEntry altResolved = fetchAndroidPlayerStream(alt.videoId);
                if (altResolved != null) {
                    mStreamCache.put(vid, altResolved);
                    return altResolved;
                }
            }
        }
        return null;
    }

    private StreamCacheEntry fetchAndroidPlayerStream(String videoId) {
        try {
            URL url = new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", YT_ANDROID_UA);

            JSONObject client = new JSONObject();
            client.put("clientName", "ANDROID");
            client.put("clientVersion", "20.10.38");
            client.put("osName", "Android");
            client.put("osVersion", "14");
            client.put("androidSdkVersion", 34);
            client.put("hl", "en");
            client.put("gl", "IN");

            JSONObject context = new JSONObject();
            context.put("client", client);

            JSONObject payload = new JSONObject();
            payload.put("context", context);
            payload.put("videoId", videoId);
            payload.put("contentCheckOk", true);
            payload.put("racyCheckOk", true);

            byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bodyBytes);
            }

            if (conn.getResponseCode() != 200) return null;
            String respStr = readStreamToString(conn.getInputStream());
            JSONObject data = new JSONObject(respStr);

            JSONObject playability = data.optJSONObject("playabilityStatus");
            if (playability == null || !"OK".equalsIgnoreCase(playability.optString("status"))) {
                return null;
            }

            long durationSec = 0;
            JSONObject videoDetails = data.optJSONObject("videoDetails");
            if (videoDetails != null) {
                durationSec = videoDetails.optLong("lengthSeconds", 0);
            }

            JSONObject streamingData = data.optJSONObject("streamingData");
            if (streamingData == null) return null;

            // Prefer progressive formats (itag 18) which play natively with HTTP 200 without poToken/Range issues
            JSONArray formats = streamingData.optJSONArray("formats");
            if (formats != null) {
                for (int i = 0; i < formats.length(); i++) {
                    JSONObject fmt = formats.optJSONObject(i);
                    if (fmt != null) {
                        String streamUrl = fmt.optString("url", "");
                        if (!streamUrl.isEmpty()) {
                            if (durationSec <= 0) {
                                durationSec = fmt.optLong("approxDurationMs", 0) / 1000;
                            }
                            return new StreamCacheEntry(streamUrl, durationSec);
                        }
                    }
                }
            }

            JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
            if (adaptive != null) {
                for (int i = 0; i < adaptive.length(); i++) {
                    JSONObject fmt = adaptive.optJSONObject(i);
                    if (fmt != null && fmt.optString("mimeType", "").startsWith("audio/mp4")) {
                        String streamUrl = fmt.optString("url", "");
                        if (!streamUrl.isEmpty()) {
                            return new StreamCacheEntry(streamUrl, durationSec);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private List<CarTrack> searchYouTubeMusicTracksNative(String query, int maxResults) {
        List<CarTrack> out = new ArrayList<>();
        if (query == null || query.trim().isEmpty()) return out;
        try {
            URL url = new URL("https://music.youtube.com/youtubei/v1/search?prettyPrint=false");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14)");

            JSONObject client = new JSONObject();
            client.put("clientName", "WEB_REMIX");
            client.put("clientVersion", "1.20260918.01.00");
            client.put("hl", "en");
            client.put("gl", "IN");

            JSONObject context = new JSONObject();
            context.put("client", client);

            JSONObject body = new JSONObject();
            body.put("context", context);
            body.put("query", query.trim());
            body.put("params", "EgWKAQIIAWoKEAkQBRAKEAMQBA=="); // Songs filter

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            if (conn.getResponseCode() != 200) return out;
            String resp = readStreamToString(conn.getInputStream());
            JSONObject root = new JSONObject(resp);
            extractMusicRenderersRecursive(root, out, maxResults);
        } catch (Exception ignored) {}
        return out;
    }

    private void extractMusicRenderersRecursive(Object node, List<CarTrack> out, int maxResults) {
        if (node == null || out.size() >= maxResults) return;
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            if (obj.has("musicResponsiveListItemRenderer")) {
                JSONObject item = obj.optJSONObject("musicResponsiveListItemRenderer");
                if (item != null) {
                    JSONObject pid = item.optJSONObject("playlistItemData");
                    String vid = pid != null ? pid.optString("videoId", "") : "";
                    if (vid.length() == 11) {
                        JSONArray flexCols = item.optJSONArray("flexColumns");
                        if (flexCols != null && flexCols.length() > 0) {
                            String title = extractRunsText(flexCols.optJSONObject(0));
                            String meta = flexCols.length() > 1 ? extractRunsText(flexCols.optJSONObject(1)) : "UpBeat";
                            String artist = meta;
                            if (meta.contains("•")) {
                                String[] parts = meta.split("•");
                                for (String p : parts) {
                                    String trimmed = p.trim();
                                    if (!trimmed.equalsIgnoreCase("Song") && !trimmed.equalsIgnoreCase("Video") && !trimmed.isEmpty()) {
                                        artist = trimmed;
                                        break;
                                    }
                                }
                            }
                            if (!title.isEmpty()) {
                                out.add(new CarTrack(title, artist, vid));
                            }
                        }
                    }
                }
            }
            JSONArray names = obj.names();
            if (names != null) {
                for (int i = 0; i < names.length() && out.size() < maxResults; i++) {
                    String key = names.optString(i);
                    extractMusicRenderersRecursive(obj.opt(key), out, maxResults);
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length() && out.size() < maxResults; i++) {
                extractMusicRenderersRecursive(arr.opt(i), out, maxResults);
            }
        }
    }

    private String extractRunsText(JSONObject colWrapper) {
        if (colWrapper == null) return "";
        JSONObject renderer = colWrapper.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
        if (renderer == null) return "";
        JSONObject textObj = renderer.optJSONObject("text");
        if (textObj == null) return "";
        JSONArray runs = textObj.optJSONArray("runs");
        if (runs == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < runs.length(); i++) {
            JSONObject r = runs.optJSONObject(i);
            if (r != null) sb.append(r.optString("text", ""));
        }
        return sb.toString().trim();
    }

    private String readStreamToString(InputStream is) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        is.close();
        return baos.toString("UTF-8");
    }

    // =========================================================================
    // MediaSession Callbacks (Car Screen & Steering Wheel Controls)
    // =========================================================================

    private class MediaSessionCallback extends MediaSessionCompat.Callback {
        @Override
        public void onPlay() {
            resumeStandaloneOrApp();
        }

        @Override
        public void onPause() {
            pauseStandaloneOrApp();
        }

        @Override
        public void onSkipToNext() {
            playNextInCarQueue(true);
        }

        @Override
        public void onSkipToPrevious() {
            playNextInCarQueue(false);
        }

        @Override
        public void onFastForward() {
            seekStandaloneOrApp(currentPositionMs + 10000);
        }

        @Override
        public void onRewind() {
            seekStandaloneOrApp(Math.max(0, currentPositionMs - 10000));
        }

        @Override
        public void onSeekTo(long pos) {
            seekStandaloneOrApp(pos);
        }

        @Override
        public void onSkipToQueueItem(long id) {
            synchronized (mActiveCarQueue) {
                int idx = (int) id;
                if (idx >= 0 && idx < mActiveCarQueue.size()) {
                    playQueueAtIndex(new ArrayList<>(mActiveCarQueue), idx, currentQueueTitle);
                }
            }
        }

        @Override
        public void onSetRepeatMode(int repeatMode) {
            String next = "off";
            if (repeatMode == PlaybackStateCompat.REPEAT_MODE_ONE) next = "one";
            else if (repeatMode == PlaybackStateCompat.REPEAT_MODE_ALL || repeatMode == PlaybackStateCompat.REPEAT_MODE_GROUP) next = "all";
            mRepeatMode = next;
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(KEY_REPEAT_MODE, next).apply();
            syncMediaSessionRepeatMode();
            updatePlaybackState(
                isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                isCurrentlyPlaying
            );
            if (MainActivity.sInstance != null) {
                MainActivity.sInstance.dispatchCarAction("toggle_loop", next);
            }
        }

        @Override
        public void onCustomAction(String action, Bundle extras) {
            if (ACTION_CUSTOM_TOGGLE_LOOP.equals(action)) {
                toggleLoopOneFromCar();
            } else if (ACTION_CUSTOM_TOGGLE_LIKE.equals(action)) {
                toggleLikeCurrentTrack();
            } else if (ACTION_CUSTOM_SHUFFLE.equals(action)) {
                shuffleCurrentQueueFromCar();
            } else if (ACTION_CUSTOM_AUTOMIX.equals(action)) {
                startRadioAutomixFromCar(false);
            }
        }

        @Override
        public void onPrepare() {
            resumeStandaloneOrApp();
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

            if ("play_automix".equals(mediaId)) {
                startRadioAutomixFromCar(true);
                return;
            }

            // 1. Shuffle Play button inside a playlist ("shuffleall_<id>") or Play All ("playall_<id>")
            boolean isShuffleAll = mediaId.startsWith("shuffleall_");
            if (isShuffleAll || mediaId.startsWith("playall_")) {
                String prefix = isShuffleAll ? "shuffleall_" : "playall_";
                String targetId = mediaId.substring(prefix.length());
                List<CarTrack> targetTracks = null;
                String qTitle = "UpBeat Queue";
                if (MEDIA_ID_LIB_FAVS.equals(targetId)) {
                    targetTracks = getEffectiveFavorites();
                    qTitle = "Liked Songs";
                } else if (MEDIA_ID_LIB_QUEUE.equals(targetId)) {
                    targetTracks = getEffectiveQueue();
                    qTitle = "Recent Plays";
                } else {
                    final HotPlaylistDef pl = findPlaylist(targetId);
                    if (pl != null) {
                        if (pl.tracks.isEmpty() && !pl.searchQuery.isEmpty()) {
                            mNetworkExecutor.submit(() -> {
                                List<CarTrack> fetched = searchYouTubeMusicTracksNative(pl.searchQuery, 15);
                                if (!fetched.isEmpty()) {
                                    synchronized (pl.tracks) {
                                        pl.tracks.clear();
                                        pl.tracks.addAll(fetched);
                                    }
                                    List<CarTrack> copy = new ArrayList<>(fetched);
                                    if (isShuffleAll) Collections.shuffle(copy);
                                    mMainHandler.post(() -> playQueueAtIndex(copy, 0, pl.title));
                                }
                            });
                            return;
                        }
                        targetTracks = new ArrayList<>(pl.tracks);
                        qTitle = pl.title;
                    }
                }
                if (targetTracks != null && !targetTracks.isEmpty()) {
                    if (isShuffleAll) Collections.shuffle(targetTracks);
                    playQueueAtIndex(targetTracks, 0, qTitle);
                    return;
                }
            }

            // 2. Specific track inside a Playlist ("pltrack__<plId>__<idx>")
            if (mediaId.startsWith("pltrack__")) {
                String[] parts = mediaId.split("__");
                if (parts.length >= 3) {
                    String plId = parts[1];
                    int idx = parseIntSafe(parts[2], 0);
                    HotPlaylistDef pl = findPlaylist(plId);
                    if (pl != null) {
                        playQueueAtIndex(pl.tracks, idx, pl.title);
                        return;
                    }
                }
            }

            // 3. Direct Playlist ID tapped
            HotPlaylistDef directPl = findPlaylist(mediaId);
            if (directPl != null) {
                playQueueAtIndex(directPl.tracks, 0, directPl.title);
                return;
            }

            // 4. Frequent Plays / Liked Song item ("fav_2" or "freq_2")
            if (mediaId.startsWith("fav_") || mediaId.startsWith("freq_")) {
                int idx = parseIntSafe(mediaId.substring(mediaId.indexOf('_') + 1), 0);
                playQueueAtIndex(getEffectiveFavorites(), idx, "Liked Songs");
                return;
            }

            // 5. Recent Queue item ("queue_1")
            if (mediaId.startsWith("queue_")) {
                int idx = parseIntSafe(mediaId.substring("queue_".length()), 0);
                playQueueAtIndex(getEffectiveQueue(), idx, "Recent Plays");
                return;
            }

            // 6. Search result item ("search__videoId__Title__Artist")
            if (mediaId.startsWith("search__")) {
                String[] parts = mediaId.split("__", 4);
                if (parts.length >= 4) {
                    CarTrack st = new CarTrack(parts[2], parts[3], parts[1]);
                    List<CarTrack> singleAndMore = new ArrayList<>();
                    singleAndMore.add(st);
                    singleAndMore.addAll(getEffectiveFavorites());
                    playQueueAtIndex(singleAndMore, 0, "Search Results");
                    return;
                }
            }

            // Fallback: play Hindi Latest
            HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
            if (def != null) {
                playQueueAtIndex(def.tracks, 0, def.title);
            }
        }

        @Override
        public void onPlayFromSearch(final String query, Bundle extras) {
            if (query == null || query.trim().isEmpty()) {
                resumeStandaloneOrApp();
                return;
            }
            final String q = query.trim();
            currentTitle = q;
            currentArtist = "Searching UpBeat...";
            applyMediaMetadata();
            updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING, 0, true);
            notifyNotification();

            mNetworkExecutor.submit(() -> {
                List<CarTrack> results = searchYouTubeMusicTracksNative(q, 15);
                if (!results.isEmpty()) {
                    mMainHandler.post(() -> playQueueAtIndex(results, 0));
                } else {
                    mMainHandler.post(() -> {
                        HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
                        if (def != null) playQueueAtIndex(def.tracks, 0);
                    });
                }
            });
        }
    }

    // =========================================================================
    // Android Auto MediaBrowser Hierarchy (Home & Library Tabs + Grid Cards)
    // =========================================================================

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        Bundle extras = new Bundle();
        extras.putBoolean(CONTENT_STYLE_SUPPORTED, true);
        extras.putBoolean(SEARCH_SUPPORTED, true);
        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, CONTENT_STYLE_GRID_ITEM);
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_LIST_ITEM);
        return new BrowserRoot(MEDIA_ID_ROOT, extras);
    }

    @Override
    public void onLoadChildren(@NonNull String parentMediaId, @NonNull final Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();

        // 1. ROOT -> 4 Top Navigation Tabs matching UpBeat v7.6.0 UI: "For You", "Playlists", "Top Charts", "Library"
        if (MEDIA_ID_ROOT.equals(parentMediaId)) {
            items.add(createTabItem(MEDIA_ID_TAB_FORYOU, "For You", R.drawable.ic_aa_foryou, CONTENT_STYLE_GRID_ITEM, CONTENT_STYLE_GRID_ITEM));
            items.add(createTabItem(MEDIA_ID_TAB_PLAYLISTS, "Playlists", R.drawable.ic_aa_playlists, CONTENT_STYLE_GRID_ITEM, CONTENT_STYLE_LIST_ITEM));
            items.add(createTabItem(MEDIA_ID_TAB_CHARTS, "Top Charts", R.drawable.ic_aa_charts, CONTENT_STYLE_GRID_ITEM, CONTENT_STYLE_LIST_ITEM));
            items.add(createTabItem(MEDIA_ID_TAB_LIBRARY, "Library", R.drawable.ic_aa_library, CONTENT_STYLE_GRID_ITEM, CONTENT_STYLE_LIST_ITEM));
            result.sendResult(items);
            return;
        }

        // 2. FOR YOU TAB -> Jump Back In, Synced Made For You, Moods, Quick Pick Songs
        if (MEDIA_ID_TAB_FORYOU.equals(parentMediaId) || "tab_home".equals(parentMediaId)) {
            List<CarTrack> favs = getEffectiveFavorites();
            List<CarTrack> queue = getEffectiveQueue();

            String jumpGroup = "Jump Back In";
            items.add(createBrowsableGridCard(
                MEDIA_ID_LIB_FAVS,
                "Liked Songs",
                favs.size() + " tracks • Rediscover",
                UpBeatArtProvider.buildCardUri("card_liked_home", "FAVORITES", "Liked Songs", "#F43F5E", getHeroVidFromList(favs)),
                jumpGroup
            ));
            items.add(createBrowsableGridCard(
                MEDIA_ID_LIB_QUEUE,
                "Recent Session",
                queue.size() + " tracks • Resume",
                UpBeatArtProvider.buildCardUri("card_recent_home", "RESUME", "Up Next", "#27272A", getHeroVidFromList(queue)),
                jumpGroup
            ));
            items.add(createPlayableGridCard(
                "play_automix",
                "Start Automix",
                "Endless vibe-matched radio",
                UpBeatArtProvider.buildCardUri("card_automix", "RADIO", "Automix", "#F43F5E", getHeroVidFromList(favs)),
                jumpGroup
            ));

            String forYouGroup = "Made For You";
            List<HotPlaylistDef> syncedForYou = getForYouMixes();
            for (int i = 0; i < syncedForYou.size() && i < 8; i++) {
                addPlaylistCardToGroup(items, syncedForYou.get(i).id, forYouGroup);
            }
            if (syncedForYou.isEmpty()) {
                addPlaylistCardToGroup(items, PL_BOLLYWOOD_SOUL, forYouGroup);
                addPlaylistCardToGroup(items, PL_INDIE_FRESH, forYouGroup);
                addPlaylistCardToGroup(items, PL_HINDI_TRENDY, forYouGroup);
            }

            String moodGroup = "Browse by Mood";
            synchronized (mMoodPlaylists) {
                for (HotPlaylistDef mood : mMoodPlaylists.values()) {
                    addPlaylistCardToGroup(items, mood.id, moodGroup);
                }
            }

            String quickGroup = "Quick Pick Songs";
            int freqCount = Math.min(6, favs.size());
            for (int i = 0; i < freqCount; i++) {
                CarTrack t = favs.get(i);
                Uri artUri = UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl);
                items.add(createPlayableGridCard("freq_" + i, t.title, t.artist, artUri, quickGroup));
            }

            result.sendResult(items);
            return;
        }

        // 3. PLAYLISTS TAB -> User Saved Playlists + AI Mixes + Curated Mixes
        if (MEDIA_ID_TAB_PLAYLISTS.equals(parentMediaId)) {
            List<CarTrack> favs = getEffectiveFavorites();
            List<HotPlaylistDef> mixes = getUserMixes();
            String userGroup = "Your Playlists & Saved Mixes";
            items.add(createBrowsableGridCard(
                MEDIA_ID_LIB_FAVS,
                "Liked Songs",
                favs.size() + " tracks",
                UpBeatArtProvider.buildCardUri("pl_liked", "COLLECTION", "Liked Songs", "#F43F5E", getHeroVidFromList(favs)),
                userGroup
            ));
            for (HotPlaylistDef mix : mixes) {
                addPlaylistCardToGroup(items, mix.id, userGroup);
            }

            String curatedGroup = "UpBeat Curated Mixes";
            addPlaylistCardToGroup(items, PL_INDIE_FRESH, curatedGroup);
            addPlaylistCardToGroup(items, PL_BOLLYWOOD_SOUL, curatedGroup);
            addPlaylistCardToGroup(items, PL_HINDI_LATEST, curatedGroup);
            result.sendResult(items);
            return;
        }

        // 4. TOP CHARTS TAB -> Synced Daily Top Charts + Built-in Chart Fallbacks
        if (MEDIA_ID_TAB_CHARTS.equals(parentMediaId)) {
            String chartGroup = "Daily Top Charts";
            List<HotPlaylistDef> syncedCharts = getSyncedCharts();
            java.util.Set<String> addedTitles = new java.util.HashSet<>();
            for (HotPlaylistDef ch : syncedCharts) {
                addPlaylistCardToGroup(items, ch.id, chartGroup);
                addedTitles.add(ch.title.toLowerCase());
            }
            for (HotPlaylistDef def : mPlaylists.values()) {
                if (!addedTitles.contains(def.title.toLowerCase())) {
                    addPlaylistCardToGroup(items, def.id, chartGroup);
                }
            }
            result.sendResult(items);
            return;
        }

        // 5. LIBRARY TAB -> Saved Collections + Direct Liked Songs List
        if (MEDIA_ID_TAB_LIBRARY.equals(parentMediaId)) {
            List<CarTrack> favs = getEffectiveFavorites();
            List<CarTrack> queue = getEffectiveQueue();

            String plGroup = "Your Collection";
            items.add(createBrowsableGridCard(
                MEDIA_ID_LIB_FAVS,
                "Liked Songs",
                favs.size() + " saved tracks",
                UpBeatArtProvider.buildCardUri("lib_liked", "COLLECTION", "Liked Songs", "#F43F5E", getHeroVidFromList(favs)),
                plGroup
            ));
            items.add(createBrowsableGridCard(
                MEDIA_ID_LIB_QUEUE,
                "Up Next & Recents",
                queue.size() + " tracks",
                UpBeatArtProvider.buildCardUri("lib_recent", "QUEUE", "Recent Plays", "#27272A", getHeroVidFromList(queue)),
                plGroup
            ));
            for (HotPlaylistDef mix : getUserMixes()) {
                addPlaylistCardToGroup(items, mix.id, "Saved Playlists");
            }

            String songsGroup = "Liked Songs (" + favs.size() + ")";
            for (int i = 0; i < favs.size(); i++) {
                CarTrack t = favs.get(i);
                Uri thumbUri = UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl);
                items.add(createPlayableListItem("fav_" + i, t.title, formatTrackSubtitle(t), thumbUri, songsGroup));
            }

            result.sendResult(items);
            return;
        }

        // 6. INSIDE ANY PLAYLIST / FOR YOU / CHART / MOOD
        final HotPlaylistDef pl = findPlaylist(parentMediaId);
        if (pl != null) {
            if (!pl.tracks.isEmpty()) {
                result.sendResult(buildPlaylistDetailItems(pl));
                return;
            }
            if (!pl.searchQuery.isEmpty()) {
                result.detach();
                mNetworkExecutor.submit(() -> {
                    List<CarTrack> fetched = searchYouTubeMusicTracksNative(pl.searchQuery, 15);
                    synchronized (pl.tracks) {
                        if (pl.tracks.isEmpty()) {
                            if (!fetched.isEmpty()) {
                                pl.tracks.addAll(fetched);
                            } else {
                                HotPlaylistDef fallback = mPlaylists.get(PL_HINDI_LATEST);
                                if (fallback != null) pl.tracks.addAll(fallback.tracks);
                            }
                        }
                    }
                    result.sendResult(buildPlaylistDetailItems(pl));
                });
                return;
            }
        }

        // 7. INSIDE LIBRARY -> LIKED SONGS FOLDER
        if (MEDIA_ID_LIB_FAVS.equals(parentMediaId)) {
            List<CarTrack> favs = getEffectiveFavorites();
            items.add(createPlayableListItem(
                "playall_" + MEDIA_ID_LIB_FAVS,
                "▶ Play All Liked Songs",
                favs.size() + " songs • In Order",
                UpBeatArtProvider.buildCardUri("playall_favs", "PLAY ALL", "Liked Songs", "#F43F5E", getHeroVidFromList(favs)),
                "Controls"
            ));
            items.add(createPlayableListItem(
                "shuffleall_" + MEDIA_ID_LIB_FAVS,
                "🔀 Shuffle Liked Songs",
                favs.size() + " songs • Shuffled",
                UpBeatArtProvider.buildCardUri("shuf_favs", "SHUFFLE", "Liked Songs", "#27272A", getHeroVidFromList(favs)),
                "Controls"
            ));
            for (int i = 0; i < favs.size(); i++) {
                CarTrack t = favs.get(i);
                items.add(createPlayableListItem(
                    "fav_" + i,
                    t.title,
                    formatTrackSubtitle(t),
                    UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl),
                    "Liked Songs"
                ));
            }
            result.sendResult(items);
            return;
        }

        // 8. INSIDE LIBRARY -> RECENT PLAYS & QUEUE FOLDER
        if (MEDIA_ID_LIB_QUEUE.equals(parentMediaId)) {
            List<CarTrack> queue = getEffectiveQueue();
            items.add(createPlayableListItem(
                "playall_" + MEDIA_ID_LIB_QUEUE,
                "▶ Resume Recent Plays",
                queue.size() + " tracks in queue",
                UpBeatArtProvider.buildCardUri("playall_queue", "RESUME", "Recent Plays", "#F43F5E", getHeroVidFromList(queue)),
                "Controls"
            ));
            items.add(createPlayableListItem(
                "shuffleall_" + MEDIA_ID_LIB_QUEUE,
                "🔀 Shuffle Recent Queue",
                queue.size() + " tracks • Shuffled",
                UpBeatArtProvider.buildCardUri("shuf_queue", "SHUFFLE", "Recent Plays", "#27272A", getHeroVidFromList(queue)),
                "Controls"
            ));
            for (int i = 0; i < queue.size(); i++) {
                CarTrack t = queue.get(i);
                items.add(createPlayableListItem(
                    "queue_" + i,
                    t.title,
                    formatTrackSubtitle(t),
                    UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl),
                    "Recent Plays"
                ));
            }
            result.sendResult(items);
            return;
        }

        // Fallback: never return an empty list so Android Auto never shows "Could not load your selection"
        HotPlaylistDef fallbackPl = mPlaylists.get(PL_HINDI_LATEST);
        if (fallbackPl != null) {
            result.sendResult(buildPlaylistDetailItems(fallbackPl));
            return;
        }
        result.sendResult(items);
    }

    private List<MediaBrowserCompat.MediaItem> buildPlaylistDetailItems(HotPlaylistDef pl) {
        List<MediaBrowserCompat.MediaItem> list = new ArrayList<>();
        String heroVid = pl.getHeroVideoId();
        String heroCover = pl.getHeroCoverUrl();
        int count;
        synchronized (pl.tracks) {
            count = pl.tracks.size();
        }
        list.add(createPlayableListItem(
            "playall_" + pl.id,
            "▶ Play All — " + pl.title,
            count + " songs • Continuous Playback",
            UpBeatArtProvider.buildCardUri("playall_" + pl.id, "PLAY ALL", pl.badgeRibbon, pl.badgeColor, heroVid, heroCover),
            "Quick Actions"
        ));
        list.add(createPlayableListItem(
            "shuffleall_" + pl.id,
            "🔀 Shuffle Play — " + pl.title,
            count + " songs • Shuffled Order",
            UpBeatArtProvider.buildCardUri("shuf_" + pl.id, "SHUFFLE", pl.badgeRibbon, "#27272A", heroVid, heroCover),
            "Quick Actions"
        ));
        synchronized (pl.tracks) {
            for (int i = 0; i < pl.tracks.size(); i++) {
                CarTrack t = pl.tracks.get(i);
                list.add(createPlayableListItem(
                    "pltrack__" + pl.id + "__" + i,
                    t.title,
                    formatTrackSubtitle(t),
                    UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title, t.coverUrl),
                    pl.title
                ));
            }
        }
        return list;
    }

    private String formatTrackSubtitle(CarTrack t) {
        if (t.durationText != null && !t.durationText.isEmpty()) {
            return t.durationText + " • " + t.artist;
        }
        return t.artist;
    }

    @Override
    public void onSearch(@NonNull final String query, Bundle extras, @NonNull final Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.detach();
        mNetworkExecutor.submit(() -> {
            List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
            List<CarTrack> found = searchYouTubeMusicTracksNative(query, 15);
            for (CarTrack t : found) {
                String safeTitle = t.title.replace("__", " ");
                String safeArtist = t.artist.replace("__", " ");
                items.add(createPlayableListItem(
                    "search__" + t.videoId + "__" + safeTitle + "__" + safeArtist,
                    t.title,
                    t.artist,
                    UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title),
                    "Search Results"
                ));
            }
            if (items.isEmpty()) {
                HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
                if (def != null) {
                    synchronized (def.tracks) {
                        for (int i = 0; i < Math.min(6, def.tracks.size()); i++) {
                            CarTrack t = def.tracks.get(i);
                            items.add(createPlayableListItem(
                                "pltrack__" + def.id + "__" + i,
                                t.title,
                                t.artist,
                                UpBeatArtProvider.buildYtThumbUri(t.videoId, t.title),
                                "Suggested Tracks"
                            ));
                        }
                    }
                }
            }
            result.sendResult(items);
        });
    }

    private List<CarTrack> getEffectiveFavorites() {
        synchronized (mUserFavorites) {
            if (!mUserFavorites.isEmpty()) {
                return new ArrayList<>(mUserFavorites);
            }
        }
        synchronized (mUserQueue) {
            if (!mUserQueue.isEmpty()) {
                return new ArrayList<>(mUserQueue);
            }
        }
        HotPlaylistDef def = mPlaylists.get(PL_HINDI_LATEST);
        return def != null ? new ArrayList<>(def.tracks) : new ArrayList<>();
    }

    private List<CarTrack> getEffectiveQueue() {
        synchronized (mUserQueue) {
            if (!mUserQueue.isEmpty()) {
                return new ArrayList<>(mUserQueue);
            }
        }
        return getEffectiveFavorites();
    }

    private String getHeroVidFromList(List<CarTrack> list) {
        if (list != null) {
            for (CarTrack t : list) {
                if (t.videoId != null && t.videoId.length() == 11) {
                    return t.videoId;
                }
            }
        }
        return "XtZTpxnrHAc";
    }

    private void addPlaylistCardToGroup(List<MediaBrowserCompat.MediaItem> items, String plId, String groupTitle) {
        HotPlaylistDef pl = findPlaylist(plId);
        if (pl == null) return;
        Uri cardArtUri = UpBeatArtProvider.buildCardUri(
            pl.id,
            pl.badgeTop,
            pl.badgeRibbon,
            pl.badgeColor,
            pl.getHeroVideoId(),
            pl.getHeroCoverUrl()
        );
        items.add(createBrowsableGridCard(pl.id, pl.title, pl.subtitle, cardArtUri, groupTitle));
    }

    private MediaBrowserCompat.MediaItem createTabItem(String id, String title, int drawableResId, int browsableStyle, int playableStyle) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, browsableStyle);
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, playableStyle);

        Uri iconUri = new Uri.Builder()
            .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
            .authority(getPackageName())
            .appendPath(String.valueOf(drawableResId))
            .build();

        MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setIconUri(iconUri)
            .setExtras(extras)
            .build();
        return new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem createBrowsableGridCard(String id, String title, String subtitle, Uri iconUri, String groupTitle) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_BROWSABLE_HINT, CONTENT_STYLE_GRID_ITEM);
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_LIST_ITEM);
        if (groupTitle != null && !groupTitle.isEmpty()) {
            extras.putString(CONTENT_STYLE_GROUP_TITLE_HINT, groupTitle);
        }

        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setExtras(extras);
        if (iconUri != null) {
            builder.setIconUri(iconUri);
        }
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem createPlayableGridCard(String id, String title, String subtitle, Uri iconUri, String groupTitle) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_GRID_ITEM);
        if (groupTitle != null && !groupTitle.isEmpty()) {
            extras.putString(CONTENT_STYLE_GROUP_TITLE_HINT, groupTitle);
        }

        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setExtras(extras);
        if (iconUri != null) {
            builder.setIconUri(iconUri);
        }
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private MediaBrowserCompat.MediaItem createPlayableListItem(String id, String title, String subtitle, Uri iconUri, String groupTitle) {
        Bundle extras = new Bundle();
        extras.putInt(CONTENT_STYLE_PLAYABLE_HINT, CONTENT_STYLE_LIST_ITEM);
        if (groupTitle != null && !groupTitle.isEmpty()) {
            extras.putString(CONTENT_STYLE_GROUP_TITLE_HINT, groupTitle);
        }

        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setExtras(extras);
        if (iconUri != null) {
            builder.setIconUri(iconUri);
        }
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private int parseIntSafe(String s, int fallback) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    // =========================================================================
    // Notification & Phone UI Sync
    // =========================================================================

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(mMediaSession, intent);

        if (intent != null && intent.getAction() != null) {
            String act = intent.getAction();
            if (ACTION_TOGGLE_PLAY.equals(act)) {
                if (isCurrentlyPlaying) {
                    pauseStandaloneOrApp();
                } else {
                    resumeStandaloneOrApp();
                }
                return START_STICKY;
            } else if (ACTION_PLAY.equals(act)) {
                resumeStandaloneOrApp();
                return START_STICKY;
            } else if (ACTION_PAUSE.equals(act)) {
                pauseStandaloneOrApp();
                return START_STICKY;
            } else if (ACTION_NEXT.equals(act)) {
                playNextInCarQueue(true);
                return START_STICKY;
            } else if (ACTION_PREV.equals(act)) {
                playNextInCarQueue(false);
                return START_STICKY;
            } else if (ACTION_REWIND.equals(act)) {
                seekStandaloneOrApp(Math.max(0, currentPositionMs - 10000));
                return START_STICKY;
            } else if (ACTION_FORWARD.equals(act)) {
                seekStandaloneOrApp(currentPositionMs + 10000);
                return START_STICKY;
            } else if (ACTION_STOP.equals(act)) {
                isCurrentlyPlaying = false;
                releaseStandalonePlayer();
                updatePlaybackState(PlaybackStateCompat.STATE_STOPPED, 0, false);
                if (MainActivity.sInstance != null) {
                    MainActivity.sInstance.dispatchCarAction("pause", "");
                }
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

        ensureForeground(isCurrentlyPlaying);
        acquireLocks();
        return START_STICKY;
    }

    private void ensureForeground(boolean isPlaying) {
        try {
            Notification notification = buildNotification(currentTitle, currentArtist, isPlaying);
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
    }

    /**
     * Called when the phone WebView UI plays or updates a track.
     * If the phone WebView starts playing a song, we release the standalone player so they never overlap.
     */
    public synchronized void handlePlaybackUpdate(boolean isPlaying, String title, String artist, String artUrl, long durationSec, long positionSec) {
        if (isPlaying && mUsingStandalonePlayer) {
            mUsingStandalonePlayer = false;
            releaseStandalonePlayer();
        } else if (!isPlaying && mUsingStandalonePlayer && mStandalonePlayer != null && mStandalonePlayer.isPlaying()) {
            // Ignore paused telemetry from background WebView while standalone car player is actively playing
            return;
        }

        String cleanTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "UpBeat";
        String cleanArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "";
        String cleanArt = (artUrl != null) ? artUrl.trim() : "";

        boolean trackChanged = !cleanTitle.equals(currentTitle)
            || !cleanArtist.equals(currentArtist)
            || (!cleanArt.isEmpty() && !cleanArt.equals(currentArtUrl));
        boolean playStateChanged = (isCurrentlyPlaying != isPlaying);
        boolean durationChanged = (durationSec > 0 && Math.abs(currentDurationMs - (durationSec * 1000)) > 1500);

        long timeSinceUserAction = SystemClock.elapsedRealtime() - lastUserActionTime;
        if (timeSinceUserAction < 2500) {
            if (lastUserActionWasPause && isPlaying) {
                isPlaying = false;
            } else if (!lastUserActionWasPause && !isPlaying) {
                isPlaying = true;
            } else {
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
        int viIdx = cleanArt.indexOf("/vi/");
        if (viIdx >= 0 && cleanArt.length() >= viIdx + 15) {
            currentVideoId = cleanArt.substring(viIdx + 4, viIdx + 15);
        }

        if (trackChanged || durationChanged) {
            if (trackChanged) {
                cachedArtworkBitmap = createDefaultArtwork(currentTitle);
                cachedArtworkUrl = "";
                currentArtUrl = cleanArt;

                if (!cleanArt.isEmpty()) {
                    loadArtworkBitmapAsync(cleanArt);
                }
            }

            mMediaSession.setActive(true);
            applyMediaMetadata();
            notifyNotification();
        } else if (playStateChanged) {
            notifyNotification();
        }

        updatePlaybackState(
            isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
            currentPositionMs,
            isCurrentlyPlaying
        );
    }

    private void updatePlaybackState(int state, long positionMs, boolean isPlaying) {
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM
            | PlaybackStateCompat.ACTION_SET_REPEAT_MODE
            | PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE
            | PlaybackStateCompat.ACTION_SEEK_TO
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_FAST_FORWARD
            | PlaybackStateCompat.ACTION_REWIND
            | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
            | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
            | PlaybackStateCompat.ACTION_PREPARE
            | PlaybackStateCompat.ACTION_PREPARE_FROM_MEDIA_ID
            | PlaybackStateCompat.ACTION_PREPARE_FROM_SEARCH;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setActiveQueueItemId(Math.max(0, mActiveCarQueueIndex))
            .setState(state, positionMs, isPlaying ? 1.0f : 0.0f, SystemClock.elapsedRealtime());

        boolean loopOne = "one".equals(mRepeatMode);
        stateBuilder.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
            ACTION_CUSTOM_TOGGLE_LOOP,
            loopOne ? "Looping Song" : "Loop Song",
            loopOne ? R.drawable.ic_aa_loop_one : R.drawable.ic_aa_loop_off
        ).build());

        boolean liked = isCurrentTrackLiked();
        stateBuilder.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
            ACTION_CUSTOM_TOGGLE_LIKE,
            liked ? "Liked" : "Like",
            liked ? R.drawable.ic_aa_heart_filled : R.drawable.ic_aa_heart_outline
        ).build());

        stateBuilder.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
            ACTION_CUSTOM_SHUFFLE,
            "Shuffle",
            R.drawable.ic_aa_shuffle
        ).build());

        stateBuilder.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
            ACTION_CUSTOM_AUTOMIX,
            "Automix",
            R.drawable.ic_aa_foryou
        ).build());

        mMediaSession.setPlaybackState(stateBuilder.build());
    }

    private void applyMediaMetadata() {
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentQueueTitle != null ? currentQueueTitle : "UpBeat")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs);
        if (currentVideoId != null && !currentVideoId.isEmpty()) {
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, currentVideoId);
        }

        Bitmap artToUse = cachedArtworkBitmap != null ? cachedArtworkBitmap : createDefaultArtwork(currentTitle);
        if (artToUse != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artToUse);
        }
        if (currentArtUrl != null && !currentArtUrl.isEmpty()) {
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, currentArtUrl);
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, currentArtUrl);
        }

        mMediaSession.setMetadata(metaBuilder.build());
    }

    private Bitmap createDefaultArtwork(String title) {
        String key = (title != null && !title.trim().isEmpty())
            ? title.trim().substring(0, 1).toUpperCase()
            : "♫";

        Bitmap cached = mDefaultArtworkCache.get(key);
        if (cached != null) {
            return cached;
        }

        try {
            int size = 256;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            Shader gradient = new LinearGradient(
                0, 0, size, size,
                new int[]{Color.parseColor("#0A0A0B"), Color.parseColor("#16161D"), Color.parseColor("#101015")},
                new float[]{0f, 0.55f, 1f},
                Shader.TileMode.CLAMP
            );
            bgPaint.setShader(gradient);
            canvas.drawRect(0, 0, size, size, bgPaint);

            Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ringPaint.setStyle(Paint.Style.STROKE);
            ringPaint.setStrokeWidth(2f);
            ringPaint.setColor(Color.argb(55, 244, 63, 94));
            canvas.drawCircle(size / 2f, size / 2f, size * 0.42f, ringPaint);
            canvas.drawCircle(size / 2f, size / 2f, size * 0.30f, ringPaint);
            canvas.drawCircle(size / 2f, size / 2f, size * 0.18f, ringPaint);

            Paint centerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            centerPaint.setColor(Color.parseColor("#F43F5E"));
            canvas.drawCircle(size / 2f, size / 2f, size * 0.14f, centerPaint);

            Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setColor(Color.WHITE);
            textPaint.setTextSize(size * 0.14f);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setFakeBoldText(true);

            float yPos = (size / 2f) - ((textPaint.descent() + textPaint.ascent()) / 2f);
            canvas.drawText(key, size / 2f, yPos, textPaint);

            mDefaultArtworkCache.put(key, bitmap);
            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private void loadArtworkBitmapAsync(final String urlString) {
        if (urlString == null || urlString.isEmpty()) return;

        Bitmap cached = mArtworkCache.get(urlString);
        if (cached != null) {
            cachedArtworkBitmap = cached;
            cachedArtworkUrl = urlString;
            applyMediaMetadata();
            notifyNotification();
            return;
        }

        final String targetTitle = currentTitle;
        mImageExecutor.submit(() -> {
            Bitmap bmp = null;
            try {
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) UpBeatAuto/5.3");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.connect();
                if (conn.getResponseCode() == 200) {
                    InputStream input = conn.getInputStream();
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inSampleSize = 2;
                    opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                    bmp = BitmapFactory.decodeStream(input, null, opts);
                    input.close();
                }
            } catch (Exception ignored) {
                bmp = null;
            }

            final Bitmap finalBmp = bmp;
            mMainHandler.post(() -> {
                if (currentTitle.equals(targetTitle) && finalBmp != null) {
                    mArtworkCache.put(urlString, finalBmp);
                    cachedArtworkBitmap = finalBmp;
                    cachedArtworkUrl = urlString;
                    applyMediaMetadata();
                    notifyNotification();
                }
            });
        });
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
            .setColor(Color.parseColor("#F43F5E"))
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT);

        Bitmap artToUse = cachedArtworkBitmap != null ? cachedArtworkBitmap : createDefaultArtwork(title);
        if (artToUse != null) {
            builder.setLargeIcon(artToUse);
        }

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

    private void notifyAllBrowserTabs() {
        notifyChildrenChanged(MEDIA_ID_ROOT);
        notifyChildrenChanged(MEDIA_ID_TAB_FORYOU);
        notifyChildrenChanged(MEDIA_ID_TAB_PLAYLISTS);
        notifyChildrenChanged(MEDIA_ID_TAB_CHARTS);
        notifyChildrenChanged(MEDIA_ID_TAB_LIBRARY);
        notifyChildrenChanged(MEDIA_ID_LIB_FAVS);
        notifyChildrenChanged(MEDIA_ID_LIB_QUEUE);
    }

    public static void setRepeatMode(Context context, String mode) {
        if (context == null) return;
        String norm = normalizeRepeatMode(mode);
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_REPEAT_MODE, norm).apply();
        if (sInstance != null) {
            sInstance.mRepeatMode = norm;
            sInstance.mMainHandler.post(() -> {
                if (sInstance != null) {
                    sInstance.syncMediaSessionRepeatMode();
                    sInstance.updatePlaybackState(
                        sInstance.isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        sInstance.currentPositionMs,
                        sInstance.isCurrentlyPlaying
                    );
                }
            });
        }
    }

    public static void saveQueue(Context context, String queueJson) {
        if (context == null || queueJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QUEUE, queueJson).apply();
        if (sInstance != null) {
            sInstance.parseJsonToTrackList(queueJson, sInstance.mUserQueue);
            sInstance.notifyAllBrowserTabs();
        }
    }

    public static void saveMixes(Context context, String mixesJson) {
        if (context == null || mixesJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_MIXES, mixesJson).apply();
        if (sInstance != null) {
            sInstance.parseMixes(mixesJson);
            sInstance.notifyAllBrowserTabs();
        }
    }

    public static void saveFavorites(Context context, String favsJson) {
        if (context == null || favsJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_FAVS, favsJson).apply();
        if (sInstance != null) {
            sInstance.parseJsonToTrackList(favsJson, sInstance.mUserFavorites);
            sInstance.notifyAllBrowserTabs();
            sInstance.updatePlaybackState(
                sInstance.isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                sInstance.currentPositionMs,
                sInstance.isCurrentlyPlaying
            );
        }
    }

    public static void updatePlayback(Context context, boolean isPlaying, String title, String artist, String artUrl, long durationSec, long positionSec) {
        if (context == null) return;

        if (sInstance != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                if (sInstance != null) {
                    sInstance.handlePlaybackUpdate(isPlaying, title, artist, artUrl, durationSec, positionSec);
                }
            });
            return;
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
        releaseStandalonePlayer();
        if (mMediaSession != null) {
            mMediaSession.setActive(false);
            mMediaSession.release();
        }
        releaseLocks();
        try {
            mNetworkExecutor.shutdownNow();
            mImageExecutor.shutdownNow();
        } catch (Exception ignored) {}
        sInstance = null;
    }
}
