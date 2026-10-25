# 🎵 UpBeat

A minimalist, high-fidelity AI music studio that understands what you actually like.

UpBeat pairs Google Gemini with YouTube Music to sequence harmonic DJ sets, decode your personal musical taste into a **Sonic DNA profile**, and stream music with zero ads, zero trackers, and zero subscription paywalls.

Built as a clean cross-platform project for **Android**, **Android Auto**, **macOS**, and the **Web**.

---

## ✨ Features & Highlights

### 🎨 Atmosphere Themes & Day/Night Engine
- **Dynamic Time-Based Cycling**: Automatically shifts ambient lighting and gradient reflections based on your local time:
  - 🌅 **Crimson Glow** (4:00 AM – 11:59 AM)
  - ⬛ **Dark (AMOLED)** (12:00 PM – 7:59 PM): 100% pure black for afternoon glare reduction and OLED battery savings
  - 🌌 **Violet** (8:00 PM – 3:59 AM)
- **Quick Slide-Down Theme Drawer**: Tap **Themes** in Taste Controls to expand a clean 4-option slider (**Auto**, **Dark**, **Crimson Glow**, **Violet**) to lock in your preferred aesthetic anytime.

### 🚗 Android Auto (Car Display Mode)
- **In-Car Browse & Playback**: Full native Android Auto dashboard support (`AutomotiveApp` via `MediaBrowserServiceCompat`).
- **Direct Car Screen Selection**: Browse and trigger your curated playlists, Liked Songs, and AI mixes directly from your car's touchscreen console with zero latency.
- **Lock Screen & Media Controls**: Complete system notification playback controls with high-res album art and persistent background audio.

### 🧬 Sonic Taste DNA & YouTube Likes Sync
- **Listener Archetype Synthesis**: Gemini analyzes your hearted songs and listening history to classify your acoustic profile (e.g. *High-Impact Sonic Voyager*, *Atmospheric Connoisseur*), tempo range, and genre affinity breakdowns.
- **Sync Liked Songs**: 1-click sync that analyzes your local favorites to refresh seeds and curate tailored mixes with 0 AI token waste.
- **Google & YouTube Integration**: Connect with Google OAuth 2.0 or paste any YouTube Music playlist link to import your authentic likes and listening habits.

### ⚡ Ultra-Fast AI Curation (Argon Priority)
- Direct integration with Google's fastest Gemini models (prioritizing high-speed `argon` / `gemini-2.5-flash`).
- Grounded in real YouTube Music catalog items before generation to ensure 100% authentic, playable songs every time.

### 📥 100% Offline Downloads (Zero Data)
- Save any track to client-side **IndexedDB** storage with one tap.
- Play downloaded tracks completely offline in Airplane Mode with 0 buffering and 0 network usage.
- Export clean `.m4a` audio files directly to your device.

### 🔄 Live Over-The-Air (OTA) Updates
- Powered by `@capgo/capacitor-updater`.
- The Android app checks for and pulls live UI updates and bug fixes directly from GitHub Releases without requiring manual APK reinstallation.

---

## 🏛️ Architecture

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
├── backend/          # Optional Python FastAPI Companion
│   ├── main.py                         # REST API & WebSocket Server
│   ├── curator.py                      # Gemini Musicology Prompt Engine
│   └── youtube_search.py               # YouTube Music & Safari AppleScript Bridge
├── frontend/         # React 19 + Vite Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx              # Search, AI Curate toggle, Model selector
│   │   │   ├── Sidebar.jsx             # Taste Controls & Atmosphere Themes drawer
│   │   │   ├── PlayerBar.jsx           # Global playback controls & queue
│   │   │   ├── SonicDnaView.jsx        # Taste Profile, Favourites & Seeds Library
│   │   │   ├── GoogleAuthModal.jsx     # Google OAuth & YouTube sync modal
│   │   │   └── YouTubeTasteSyncModal.jsx # YouTube Search & Playlist import modal
│   │   ├── utils/themeCycle.js         # Day/Night dynamic theme engine
│   │   ├── offlineStorage.js           # IndexedDB audio binary storage
│   │   ├── otaUpdater.js               # Over-The-Air update manager
│   │   └── standaloneApi.js            # Direct Innertube streaming & Gemini client
└── .github/workflows/
    └── build-android-apk.yml           # Automated CI/CD (APK build & OTA release)
```

### How YouTube Streaming & Downloads Work
1. **Innertube Client Emulation**: UpBeat crafts native mobile/iOS client handshakes directly to YouTube's internal `v1/player` endpoint.
2. **Direct CDN Resolution**: Retrieves direct, unthrottled, unencrypted `.m4a` audio streams (`googlevideo.com`) without browser ads or tracker scripts.
3. **CORS Bypass**: On Android, `CapacitorHttp` routes requests through native Android sockets, bypassing web browser cross-origin blocks.
4. **Local IndexedDB Caching**: Audio stream binaries are saved as `Blob` objects in IndexedDB and served via local memory URIs (`URL.createObjectURL(blob)`).

---

## 🚀 Installation & Quick Start

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

### 3. Local Development (Web / Desktop)
Run the startup script:
```bash
./run.sh
```

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

## 🔑 Configuration (Optional)

UpBeat works out of the box with **Direct Search (0 tokens)**. To unlock Gemini AI curation:
1. Tap the **Settings (⚙️)** icon in the top navigation bar.
2. Enter your free **Gemini API Key** from [Google AI Studio](https://aistudio.google.com).
3. If using an Android device on the same local Wi-Fi as your Mac, enter your Mac's LAN address (`http://192.168.x.x:8000`) to sync live Safari tabs.

---

## 📄 License
MIT License. Created by [Aaradhya Negi](https://github.com/AaradhyaNegi009).
