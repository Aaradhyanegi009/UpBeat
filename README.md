# 🎵 UpBeat (v7.4.1)

A minimalist, high-fidelity AI music studio that understands what you actually like.

UpBeat pairs Google Gemini with YouTube Music to sequence harmonic DJ sets, decode your personal musical taste into a **Sonic DNA profile**, connect with friends via **Real-Time Friends & Live P2P Jam Sessions**, and stream music with zero ads, zero trackers, and zero subscription paywalls.

Built as a clean cross-platform project for **Windows**, **macOS**, **Android**, **Android Auto**, and the **Web**.

---

##  Features & Highlights

###  Multi-Node (3+ Peers) Jam Stability, Authoritative Pause Sync & Stable Friends Ordering (v7.4.1)
- **Strict Hub-and-Spoke (Star Topology) Multi-Node Jam Engine (`jamEngine.js`)**: Eliminates N-squared broadcast echo loops when 3 or more nodes connect to a Jam room. Guests strictly apply canonical state broadcasts originating from the Host (`_fromRole: 'host'`), while the Host routes guest connections in `hostConnections` (`Map<peerKey, DataConnection>`) with automatic stale-socket pruning and monotonic packet sequence numbers (`seq`).
- **Authoritative Double-Tap Pause Synchronization (`jamEngine.js`, `PlayerBar.jsx`, `App.jsx`)**: Toggling Play/Pause dispatches high-priority `JAM_PLAY_STATE` packets at `0ms` and `120ms` with timestamp protection against in-flight heartbeats, while `window.UpBeatControls.forcePause()` synchronously halts both dual-deck `<audio>` elements (`audioRefA` & `audioRefB`) and suppresses delayed `onPlay` seek-buffer events when paused.
- **Deterministic Friends List Sorting & 35s Presence Hysteresis (`jamEngine.js`, `JamModal.jsx`)**: Online friends are sorted deterministically (**Online status → Alphabetical by Name → Permanent Friend Code**) and never by `lastSeen` ping arrival timestamps, with quiet in-place `lastSeen` heartbeats so 2+ online friends never jump or swap positions.

###  Android Settings Layout Fix, 3-Layer Bidirectional Friend Sync & Voice Dictation (v7.4.0)
- **Android Settings & Modal Zero-Clipping Layout**: Responsive mobile layout (`< 640px`) in `SettingsView`, `GoogleAuthModal`, and `ProfileEditModal` so the **Account (`Edit profile` + `Connect Google`)** buttons and **Gemini API Key / Mac Companion `Save`** buttons never overflow or clip at narrow Android screen edges (`360px–412px`).
- **3-Layer Two-Way Friend Request & Acceptance Synchronization**:
  - **Layer 1 (Multi-Path Instant + Fresh Outbound P2P Dispatch)**: Accepting a friend request dispatches `FRIEND_ACCEPTED` simultaneously across active PeerJS connections, fresh outbound PeerJS connections (`forceOutboundPeer`), Local Backend Relay, Cloud Pub/Sub (`ntfy.sh`), and `BroadcastChannel`, plus follow-up confirmation waves.
  - **Layer 2 (`FRIEND_ACCEPTED` & `FRIEND_SYNC_ACK` Handshake)**: Sender immediately promotes Receiver from `outgoingRequests` to confirmed `friends` (`online: true`) and replies with `FRIEND_SYNC_ACK` so both devices lock in online status and profile details in real time.
  - **Layer 3 (Self-Healing Presence & Pending Reconciliation)**: Public presence summaries include `confirmedFriendCodes`, and `retryOutgoingRequests` probes pending friends with `FRIEND_STATUS_PROBE` so any missed acceptance self-heals automatically on the next presence tick.
- **Cross-Platform Voice Dictation & Windows Desktop App**: Native macOS `SFSpeechRecognizer` + Web Speech API + WAV fallback for voice prompts in Create View, plus official Windows Desktop (`UpBeat-Windows-Setup.exe` & `UpBeat-Windows.zip`) builds.

###  30-Minute Calm Refresh, Native macOS Photo Picker & Mobile Settings (v7.3.1)
- **30-Minute Calm Refresh & Rotation Cycle**: Replaced fast 18s/75s shifts with a balanced, pleasant 30-minute interval so homepage mixes and artwork feel constantly refreshed and updated without rapid, distracting shifts while browsing.
- **Native Swift NSOpenPanel Profile Photo Picker (macOS Native App & Web)**: Fixed profile picture uploading in `UpBeat.app` using native `NSOpenPanel` (`level = .modalPanel`, `NSApp.activate`) and WebKit script message handlers with automatic 320×320 JPEG downscaling, plus file picker, drag-and-drop, clipboard paste, and URL on web.
- **Restored Mobile Settings Option**: Brought back the Settings gear icon in the mobile top header on both **Home** and **Library** views, alongside the Profile Avatar and Friends counter, plus a quick link inside the profile editor.

###  High-Res Dynamic Thumbnails, Collapsible Sidebar Slider & Studio Mark (v7.3.0)
- **Original Dark-Squircle UpBeat Music Logo**: Restored the exact original dark squircle icon with the white outlined beamed eighth note (`♫`) across the sidebar, top bar, and native app.
- **High-Resolution & Dynamically Rotating Track Thumbnails**: Upgraded all homepage cards (`Made for you`, `Top charts`, and `FeaturedCard`) to 1280×720 HD (`maxresdefault.jpg`) and 1080×1080 album artwork with automatic multi-stage fallback, plus live rotation every 18 seconds through fresh track thumbnails from each mix and chart.
- **Collapsible Left Sidebar Slider (macOS Native App & Desktop)**: Added an interactive vertical slider rail and quick Hide/Open controls (`⌘B` / `⌘\`) to slide the left navigation sidebar closed or resize it on demand.
- **Native macOS & Web Profile Photo Picker**: Fixed profile picture upload in both the macOS native app (`WKUIDelegate` `NSOpenPanel` + `/api/profile/pick-photo` Finder integration with `sips` HEIC/JPEG conversion) and browsers, plus drag-and-drop, clipboard paste, image URL, and quick preset avatars.

###  Pure Music Guard & Live Moods Engine (v7.2.2)
- **Strict Non-Music & View-Count Elimination**: Purged YouTube view counts (`203k`, `969k`) and non-music videos (vlogs, comedy, gaming, puppets, podcasts) from Safari tab extraction, search, seed lists, and AI mixes.
- **Dynamic Auto-Refreshing Moods & "For You" Feed**: The homepage continuously rotates and updates "For you" picks every 75 seconds, while tapping any mood chip (**Chill**, **Workout**, **Focus**, **Party**, etc.) loads a dynamic stream of curated songs and playlists with instant 1-click **Play mix**, **Shuffle**, and **New picks**.
- **Device Storage Profile Photo & Name Editor**: Upload profile pictures directly from your device storage or phone camera with automatic client-side canvas scaling, change your listener display name, and sync live to friends across P2P jams.
- **Original Black & White Music Symbol Logo**: Restored the classic monochrome studio music badge across the desktop sidebar and app header.
- **Refined Studio Rose Accent (`#F43F5E`)**: Reduced harsh neon orange font colors across the UI in favor of a sleek, sophisticated Crimson Rose accent and crisp neutral typography.

###  Real-Time Friends & Live P2P Jam Social Engine
- **4-Layer Hybrid Transport Engine**: Combines `BroadcastChannel` (0ms same-browser), Local FastAPI Backend Relay (`/api/jam/*`), PeerJS WebRTC DataChannel with public TURN servers, and Cloud Pub/Sub SSE Relay (`ntfy.sh` with 12-hour message retention) so Friend Requests and Jam rooms connect reliably across devices and networks.
- **Direct QR Code & Link Auto-Join**: Friends can scan a QR code with their camera or tap an invite link (`?jam=JAM-XXXX` or `#jam=JAM-XXXX`) to automatically connect and sync audio in real time with zero code typing.
- **1-Click Profile QR & Friend Links**: Share profile links (`?addFriend=UP-XXXXXX`) or show your personal QR code for instant zero-friction friend requests.
- **Movable Floating Jam Widget**: Drag anywhere on screen so it never obstructs audio playback or seek controls; tap to expand the sleek glass room menu or full Jam Hub with quick link sharing.
- **Pure Studio Aesthetic & Zero Emojis**: Fully aligned with UpBeat's minimalist design language, typography, and letter avatars without tacky cartoon emojis.
- **Persistent Friend Code (`UP-XXXXXX`) & Live Activity Feed**: Every user gets a shareable Friend ID with an always-on WebRTC + `BroadcastChannel` presence mesh. Add friends, accept/decline requests, and see when friends are **Online — Listening to *[Song Title] - [Artist]*** (with 1-click **Listen Along**) or **In Studio**.
- **1-Click Jam Invites & Synchronized Listening (`JAM-XXXX`)**: Send instant live Jam invites to online friends with an interactive floating glass Join banner. Features NTP clock calibration and 3-tier acoustic drift compensation (`< 150ms` locked, `150ms–850ms` micro-speed ramping, `>= 850ms` hard seek).

###  v8 Redesign: Navigation, Library & Player
- **Four places, always labelled**: **Home**, **Search**, **Create** and **Library**. Phones get a tab bar fixed to the bottom; laptops, the Mac app and wide browser windows get one workspace (library on the left, content in the middle, the current song / Up next / friends on the right, full player at the bottom).
- **Create (AI mixes)**: describe a moment or mood, start from your likes or the song that's playing, set Energy, Familiar ↔ New and Length. Every mix gets its own page with Save, Download all, Share and Listen together, plus "Tweak" chips (More energy, Calmer, Fewer vocals…) to regenerate it.
- **Search**: one box, grouped results (Songs, Playlists, Videos). "Make a mix from …" is always the first result, so there's no AI toggle.
- **Library**: Playlists (your own + saved mixes and charts), Liked, Downloads, Artists and History, with search inside.
- **Every song has a ⋯ menu**: Play next, Add to queue, Add to playlist, Like, Download, Start radio, Go to artist.
- **Player**: slim mini-player on phones (swipe left/right to skip, up to open), desktop bar with shuffle and repeat, Now Playing coloured by the artwork, sleep timer, lyrics.
- **Listen together**: Friends & Jam hub with your code/QR, requests, who's online, "Listen along", and live Jam rooms.
- **First-run setup**: pick genres and artists (and optionally import YouTube likes) so Home is personal from the start.
- **Dark only**, one ember accent for AI and likes; back button, undo toasts and keyboard shortcuts (Space, ⌘K search, ⌘N create, ⌘B right panel).

###  Dynamic 9-Block Listen Together & Discovery Engine (v5.5)
- **Tier 1 (Regional & Viral Live Charts)**:
  - *US Top Daily Chart*: Live Billboard / US Top 50 hits.
  - *India Top Daily Chart*: Top trending hits across India today.
  - *Japan Top Daily Chart*: J-Pop, Anime, & Tokyo Hot 100 daily chart.
  - *India Trendy Songs*: Viral reels, indie anthems, and Bollywood/Punjabi chartbusters.
- **Tier 2 (Personalized Sonic DNA Blocks)**:
  - *Sonic Archetype Mix*: Adaptive to user's listener archetype & BPM range.
  - *Deep Cut Discovery*: Unheard tracks matching user's top genre affinities.
  - *Recent Vibe Continuation*: Seeded from recently hearted & played tracks.
  - *Late Night / Time-of-Day Personal Mix*: Harmonized with active theme time windows.
  - *Rediscover & Forgotten Gems*: Resurfaced older synced likes and harmonic pairings.
- **Session-Aware Anti-Static Cache**: Dynamic modifier rotation tags with instant **"Refresh Feed"** action to keep discovery fresh on every session.

###  Universal Shuffle & Randomize Controls (v5.5)
- **True Fisher-Yates Queue Shuffle**: Unbiased queue randomization that anchors currently playing track at index `0` and restores original sequence seamlessly when untoggled.
- **Per-Block Shuffle Play & Reroll**: Instant 1-tap shuffle play or dynamic track re-roll on any discovery shelf.

### Android Auto (Car Display Mode)
- **In-Car Browse & Playback**: Full native Android Auto dashboard support (`AutomotiveApp` via `MediaBrowserServiceCompat`).
- **Direct Car Screen Selection**: Browse and trigger your curated playlists, Liked Songs, and AI mixes directly from your car's touchscreen console with zero latency.
- **Your Mixes in the car**: AI mixes and playlists saved on the phone appear under **Your Mixes** on the Home and Library tabs.
- **Lock Screen & Media Controls**: Complete system notification playback controls with high-res album art and persistent background audio.

### Taste DNA & YouTube Likes Sync
- **Listener Archetype Synthesis**: Gemini analyzes your hearted songs and listening history to classify your acoustic profile (e.g. *High-Impact Sonic Voyager*, *Atmospheric Connoisseur*), tempo range, and genre affinity breakdowns.
- **Mix from my likes**: one tap analyzes your liked songs and builds a mix from them (Your taste → Mix from my likes).
- **Google & YouTube Integration**: Connect with Google OAuth 2.0 or paste any YouTube Music playlist link to import your authentic likes and listening habits.

### Ultra-Fast AI Curation (Argon Priority)
- Direct integration with Google's fastest Gemini models (prioritizing high-speed `argon` / `gemini-2.5-flash`).
- Grounded in real YouTube Music catalog items before generation to ensure 100% authentic, playable songs every time.

###  Downloads 
- Save any track to client-side **IndexedDB** storage with one tap.
- Play downloaded tracks completely offline in Airplane Mode with 0 buffering and 0 network usage.
- Export clean `.m4a` audio files directly to your device.

### (OTA) Updates
- Powered by `@capgo/capacitor-updater`.
- The Android app checks for and pulls live UI updates and bug fixes directly from GitHub Releases without requiring manual APK reinstallation.

---

## Architecture

```
UpBeat/
├── android/          # Native Android App
│   ├── app/src/main/java/com/aaradhya/upbeat/
│   │   ├── MainActivity.java           # Capacitor Native Webview Shell
│   │   └── UpBeatMediaService.java     # Android Auto & Background ExoPlayer Service
│   └── app/build.gradle                # Android SDK 34, Keystore & Build Config
├── macos/            # Native macOS App
│   ├── UpBeatApp.swift                 # Native Swift + AppKit + WebKit wrapper
│   └── Info.plist                      # macOS Bundle & App Permissions
├── electron/         # Native Windows Desktop App (Electron)
│   ├── main.cjs                        # Windows Window, System Tray & Media Controls
│   ├── preload.cjs                     # Native IPC Bridge
│   ├── server.cjs                      # Embedded Zero-Config Audio Microserver
│   └── resources/                      # Windows Icons (icon.ico & icon.png)
├── api/              # Vercel Serverless Edge Functions (Web & iOS PWA)
│   ├── innertube.js                    # High-speed Edge CORS proxy for YouTube Music
│   ├── audio.js                        # 302 Redirector directly to Google CDN audio stream
│   ├── audio-info.js                   # JSON metadata & duration resolver
│   └── status.js                       # Edge health & feature status
├── backend/          # Optional Python FastAPI Companion
│   ├── main.py                         # REST API & WebSocket Server
│   ├── curator.py                      # Gemini Musicology Prompt Engine
│   └── youtube_search.py               # YouTube Music & Safari AppleScript Bridge
├── frontend/         # React 19 + Vite Frontend
│   ├── src/
│   │   ├── ui/                         # Shell: router, tab bar, sidebar, right panel, shared building blocks
│   │   ├── views/                      # Home, Search, Create, Collection, Library, Settings, Onboarding
│   │   ├── components/
│   │   │   ├── PlayerBar.jsx           # Audio engine, mini-player & desktop player bar
│   │   │   ├── NowPlayingView.jsx      # Full-screen player, lyrics, share cards
│   │   │   ├── JamModal.jsx            # Friends & Jam hub
│   │   │   ├── SonicDnaView.jsx        # Your taste & taste sources
│   │   │   └── GoogleAuthModal.jsx     # Google sign-in & YouTube import
│   │   ├── jamEngine.js                # Real-time friends presence & synced Jam rooms
│   │   ├── offlineStorage.js           # IndexedDB audio binary storage
│   │   ├── otaUpdater.js               # Over-The-Air update manager
│   │   └── standaloneApi.js            # Direct Innertube streaming & Gemini client
└── .github/workflows/
    └── build-android-apk.yml           # Automated CI/CD (APK build & OTA release)
```

### How YouTube Streaming & Downloads Work
1. **Innertube Client Emulation**: UpBeat crafts native mobile/iOS client handshakes directly to YouTube's internal `v1/player` endpoint.
2. **Direct CDN Resolution**: Retrieves direct, unthrottled, unencrypted `.m4a` audio streams (`googlevideo.com`) without browser ads or tracker scripts.
3. **CORS Bypass**:
   - **Android**: `CapacitorHttp` routes requests through native Android sockets, bypassing web browser cross-origin blocks.
   - **Web & iOS Safari**: Vercel Serverless Edge Functions (`/api/innertube` & `/api/audio`) proxy control packets with global <10ms latency and 302 redirect directly into high-bitrate AAC LC streams.
4. **Local IndexedDB Caching**: Audio stream binaries are saved as `Blob` objects in IndexedDB and served via local memory URIs (`URL.createObjectURL(blob)`), enabling full offline playback on iPhone, Android, and Desktop browsers.

---

##  Installation & Quick Start

### 1. Android
- Download the latest **`UpBeat.apk`** from [GitHub Releases](https://github.com/AaradhyaNegi009/UpBeat/releases).
- Install the APK on your phone (supports Android 8.0 through Android 15).
- Compatible with **Android Auto**: plug into your car display or launch via the Android Auto companion.

### 2. macOS Native App
Download **`UpBeat-macOS.zip`** from [Releases](https://github.com/AaradhyaNegi009/UpBeat/releases), unzip, and drag `UpBeat.app` into `/Applications`.

To compile manually:
```bash
swiftc -O -target arm64-apple-macos12.0 macos/UpBeatApp.swift \
  -o UpBeat.app/Contents/MacOS/UpBeat -framework Cocoa -framework WebKit
cp -R UpBeat.app /Applications/UpBeat.app
open /Applications/UpBeat.app
```

### 3. Windows Desktop App
Download the Windows release from [GitHub Releases](https://github.com/AaradhyaNegi009/UpBeat/releases):
- **`UpBeat-Windows-Setup.exe`**: One-click Windows installer (creates Desktop & Start menu shortcuts).
- **`UpBeat-Windows.zip`**: Standalone portable version (extract and double-click `UpBeat.exe` without installation).

Features:
- Native Windows 10 & 11 taskbar & notification area System Tray with playback controls (`♫`).
- Global hardware/keyboard media keys (`Play/Pause`, `Next`, `Prev`, `Stop`).
- Embedded zero-config audio streaming engine — runs completely standalone without requiring Python, ffmpeg, or external setup.

To package manually on Windows:
```bash
npm run build:win
```

### 4. Web & iPhone / iOS (Safari PWA)
UpBeat can be deployed to **Vercel** with zero configuration:
1. Import this repository into [Vercel](https://vercel.com).
2. The included `vercel.json` and Edge Functions in `api/` automatically configure API routing, Edge proxies, and Vite builds.
3. On your **iPhone or iPad**:
   - Open your deployed URL in **Safari**.
   - Tap the **Share** button (box with upward arrow) at the bottom.
   - Tap **Add to Home Screen**.
   - Launch UpBeat from your Home Screen for a 100% full-screen native app experience with background audio, lock screen playback controls, and offline IndexedDB downloads.

### 4. Local Development (Web / Desktop)
Run the startup script:
```bash
./run.sh
```

For UI work, `npm run dev` (in `frontend/`) also serves the `/api` functions locally, so search and charts work without a backend.

Or build manually:
```bash
# Frontend
cd frontend
npm install
npm run build
cd ..

# Backend
source .venv/bin/activate
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
Open [http://localhost:8000](http://localhost:8000) in your browser.

---

##  Configuration (Optional)

Search, charts and playback work out of the box. To make AI mixes:
1. Open **Settings** (your avatar on phones, the ⚙ button on desktop).
2. Under **AI mixes**, paste your free **Gemini API key** from [Google AI Studio](https://aistudio.google.com).
3. Optional: under **Mac companion**, enter your Mac's address (`http://192.168.x.x:8000`) to use UpBeat running on your Mac from another device on the same Wi-Fi.

---

## License
MIT License. Created by [Aaradhya Negi](https://github.com/AaradhyaNegi009).
