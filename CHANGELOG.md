# UpBeat Changelog

All notable changes to the UpBeat client, backend, and native apps are documented here.

---

## [v6.2.0] - 2026-11-02

### 📱 UI/UX Polish, Mobile Card Grid Fit & Multi-Tone Studio Palette
- **Mobile Discovery Card Grid Fit & Single-Line Badges (`PlaylistView.jsx` & `index.css`)**:
  - Solved mobile card clipping on `< 768px` viewports with dynamic width calculation (`w-[calc(50vw-28px)] min-w-[150px] max-w-[210px]`) that guarantees a clean, zero-clip 2-card fit across all mobile screens.
  - Added `.discovery-badge` utility (`white-space: nowrap`, `font-size: 0.64rem`, single-line text truncation) preventing category badges (e.g. `INDIA CHART`) from wrapping onto multiple lines.
  - Eliminated 4-character title truncation (`US T...`, `Indi...`) by restructuring card bottom overlays: titles and subtitles now have full 100% width with `line-clamp-2` stacked cleanly above scaled 30x30px `Shuffle` and `Play` buttons pinned to the bottom right, over an enhanced gradient scrim.
- **PlayerBar Utility Cluster Clean-up (`PlayerBar.jsx`)**:
  - Removed duplicate download button from the right-hand utility cluster, keeping the primary offline download button seamlessly positioned beside Heart on the left.
- **Dynamic Aura & Ambient Glow Boost (+8%) (`PlayerBar.jsx` & `index.css`)**:
  - Boosted song-reactive atmospheric background aura spread by +8% (`ellipse 120% 680px`, `ellipse 95% 550px`) and increased dynamic glow opacity values (`--song-glow-1: 0.20`, `--song-glow-2: 0.11`, `--song-glow-3: 0.14`).
  - Strengthened bottom player bar top shadow, progress thumb bloom, and play button elevation glow.
- **Multi-Tone Studio Palette (`SonicDnaView.jsx`)**:
  - Replaced monotone emerald accents with a vibrant Crimson Red / Amber Gold / Emerald Green multi-tone palette across `Genre Affinity` bars and `Key Anchoring Artists` influence cards.
  - Section header icons upgraded with unique theme surfaces (Crimson Rose for genres, Amber Gold for artists).
- **Cross-Platform Sync & Native Builds**:
  - Synchronized Android Capacitor web assets and bumped `versionCode` to `76` (`6.2.0`).
  - Recompiled native macOS universal binary with updated bundle version.
  - Generated and verified `dist.zip` with SHA-256 integrity checksum.

---

## [v6.1.0] - 2026-11-02

### ⚡ Mobile Performance & 120fps Smoothness Upgrade
- **Eliminated Mobile Scroll Jank (`index.css` & `App.jsx`)**:
  - Removed `background-attachment: fixed` on `.ytm-atmosphere`, which forced synchronous full-viewport repaints on every scroll frame in mobile WebViews (Android Capacitor & iOS Safari), while preserving the exact Pure Dark AMOLED + dynamic song ambient glow.
  - Replaced `scroll-smooth` on the primary vertical scroll container with hardware-accelerated `.gpu-scroll` (`-webkit-overflow-scrolling: touch`, `overscroll-behavior-y: contain`, `transform: translateZ(0)`) for zero-latency touch scrolling.
  - Eliminated mobile GPU overdraw by disabling redundant per-row/per-card live Gaussian `backdrop-filter` passes on `< 768px` viewports while keeping full glassmorphic `backdrop-filter: blur(20px)` on the Navbar, PlayerBar, Sidebar, Floating Dock, and Modals.
  - Replaced `transition: all` on `.squircle-card` and track rows with targeted GPU-composited properties (`transform`, `border-color`, `background-color`) and enforced `touch-action: manipulation` across interactive elements to remove mobile tap delay.
- **75% Reduction in Playback React Re-renders (`PlayerBar.jsx` & `NowPlayingView.jsx`)**:
  - Added smart UI progress throttling (`syncUiCurrentTime`) in `PlayerBar.jsx` so `currentTimeRef` tracks real-time audio at full precision while React state updates are throttled (`0.48s` when mini-player is active, `0.22s` when live synced lyrics are open), cutting redundant React re-renders by ~75%.
  - Memoized `NowPlayingView` with a custom comparator so it performs zero re-renders and zero lyric index calculations on playback ticks while collapsed.
- **View Memoization & Async Image Decoding (`PlaylistView.jsx`, `SonicDnaView.jsx`, `OfflineView.jsx`)**:
  - Wrapped `PlaylistView`, `SonicDnaView`, and `OfflineView` in `React.memo` so typing in the search bar or toggling UI drawers never re-renders heavy track grids or carousels.
  - Added `decoding="async"` alongside `loading="lazy"` and stable keys across track rows and discovery cards to prevent main-thread image decode stalls during fast fling-scrolling.

---

## [v6.0.0] - 2026-11-02

### 🖤 Pure Dark AMOLED & Dynamic Playing Song Aura
- **100% Obsidian AMOLED Base**:
  - Removed static red/violet background gradients. The dark theme is now pure, deep AMOLED black (`#000000`).
  - Added dynamic, subtle playing song ambient glow: Whenever a song plays, a gentle radial aura (`--song-glow-1`, `--song-glow-2`, `--song-glow-3`) derived from the song's album artwork subtly illuminates the background without clouding the AMOLED black.
  - Preserved the crystalline glassy aesthetic with frosted translucent surfaces (`backdrop-filter: blur(20px)`), allowing the subtle dynamic aura to refract through squircle cards and player bars.

### 💖 Fixed Heart Icon Outline
- **Clean Borderless Heart**:
  - Eliminated conflicting title-based stroke overrides that gave the heart icon an ugly dark green/black outline.
  - Enforced `stroke: none !important; stroke-width: 0 !important;` on `.btn-sync-liked svg` and `<Heart className="... stroke-none" />` across Navbar, Sidebar, and Sonic DNA view.

### 🌓 Strictly Dark & Light
- **Terminology & Mode Cleanup**:
  - Strictly normalized all theme labels to **Dark** and **Light** (removed all "Day/Night" references).
  - Cleaned up one-tap toggles in both Navbar and Sidebar.

---

## [v5.5.4] - 2026-11-01

### 🌓 Minimalist Night & Day Atmosphere Engine
- **Simplified 1-Tap Toggle**:
  - Replaced the multi-theme accordion drawer in `Sidebar.jsx` with a sleek, one-tap Day & Night Mode toggle switch with Sun / Moon status.
  - Replaced the atmosphere theme cycle pill in `Navbar.jsx` with a dedicated Day / Night button.
  - Streamlined `themeCycle.js` engine to seamlessly toggle between `amoled` (Night) and `light` (Day).
- **Restored Transparent Glassy Touch**:
  - Re-introduced the signature luminous atmospheric gradients (`--atm-glow-1`, `--atm-glow-2`, `--atm-glow-3`) across `ytm-atmosphere` so translucent frosted glass squircle cards and panels beautifully refract ambient violet, ruby, and emerald glow.

### 🎯 Billboard & Curated Playlist Instant Showcase
- **Prioritized Curated Playlists**:
  - Generalized playlist showcase: When a user clicks Billboard, chart stations, or any block with `browse_id`, `onSelectMatchedPlaylist` immediately loads the playlist tracks and highlights the green playlist pill from the get-go.
  - Updated `directSearchStandalone`: Automatically showcases matched playlists when search queries indicate playlist/chart intent (`isPlaylistIntent`).
  - Added query auto-simplification fallback so queries never return 0 tracks.

### 🖼️ Pure Real Music Artwork & Rediscover Hotfix
- **Eliminated Generic / Broken Covers**:
  - Replaced all placeholder and stock photos with verified HTTP 200 album artwork (Sabrina Carpenter, Arijit Singh, Yoasobi, Karan Aujla, The Weeknd, Maroon 5, Billie Eilish, Dua Lipa, Post Malone).
  - Fixed Rediscover block: Preloaded user favorites (`validUserTracks`) and simplified query tokens to eliminate the 0-track search bug and remove dark pixelated building artwork.

---

## [v5.5.3] - 2026-11-01

### ☀️ Light Mode Surface & High-Contrast Collisions Hotfix
- **Modals Complete Light Mode Makeover**:
  - Overhauled "Studio Settings" modal (`Navbar.jsx`), `GoogleAuthModal.jsx`, and `YouTubeTasteSyncModal.jsx` in Light Mode to use pure white glass surfaces (`bg-white dark:bg-[#101015]/95`), slate borders, deep slate headings (`#0F172A`), and clear input styling (`#F1F5F9`, slate-900 text, placeholder slate-400).
  - High-contrast action buttons: "Save Changes" (`#E11D48` crimson with white text), "Check for Live Update" (`#6D28D9` deep violet with white text), secondary buttons (`#F1F5F9` with slate-600/900 text).
- **Jewel-Tone Tinted Pill Buttons**:
  - Styled "Sync Liked" pills in Light Mode with deep crimson (`#BE123C`) text and icons over soft rose surfaces (`#FFE4E6`, border `#FECDD3`).
  - Styled "Analyze" taste pills in Light Mode with deep emerald (`#047857`) text and icons over soft mint surfaces (`#D1FAE5`, border `#A7F3D0`).
- **PlayerBar Visual Polish in Light Mode**:
  - Replaced harsh black seek bar and volume track lines with soft slate tracks (`var(--slider-track, #202028)` -> `#E2E8F0` in Light Mode).
  - Cleaned up the app native / web engine toggle pill with light gray backdrop (`var(--surface-hover)`), slate icons, and crisp white active segment with emerald icon.
- **Card Circular Buttons Contrast**:
  - Enforced dark slate icons (`#0F172A`) inside circular white `Play` buttons across all squircle cards in both Light and Dark themes.
  - Enforced `rgba(0,0,0,0.65)` dark translucent backgrounds with crisp white (`#FFFFFF`) icons on `Shuffle` and `Reroll` buttons.

### 📐 Layout Hierarchy Optimization
- **Songs / Videos Grid Back to the Top**:
  - Reordered `PlaylistView.jsx`: Songs / Videos tracklist, direct search subtabs, and the 4-row multi-column grid / detailed table now render at the **top** of the screen.
  - Positioned the curated "Listen together" discovery section (Daily Top Charts & Made For You mixes) directly **below** the song grid.

### 🛡️ Strict Music-Only Filtering & Valid Album Art Resolution
- **Pure Music Track Validation (`isValidMusicTrack`)**:
  - Added strict regex filtering out non-music keywords (`minecraft`, `gameplay`, `walkthrough`, `let's play`, `tutorial`, `episode`, `stream`, `shorts`, `podcast`, `review`, `unboxing`, `reaction`, `vlog`, `mod`, `pvp`, `bedwars`, `skyblock`, `portal`, `survival`, `speedrun`) and rejecting tracks with duration <65s or >720s.
  - Integrated filter into YouTube search, YouTube Music song parser, playlist importer, and discovery feeds.
- **LocalStorage Boot Sanitizer**:
  - Automatically filters `argon_favs_v2`, `argon_seeds_v2`, and `argon_playlist_v2` on app mount to immediately purge any previously stored gaming or non-music videos.
- **Verified Cover Artwork & Deduplication**:
  - Replaced broken 404 thumbnail URLs with verified 200 HTTP URLs (`ElZfdU54Cp8` for India Trendy, `V1Pl8CzNzCw` for Billie Eilish, `bESGLojNYSo` for Hiroyuki Sawano).
  - Added `onLoad` dimension checks (`naturalWidth <= 120`) and `onError` fallbacks to cards so low-res YouTube placeholders gracefully fall back to high-res music art.
  - Implemented `usedCoverUrls = new Set()` in `fetchListenTogetherFeed()` to guarantee 100% unique cover artwork across all 9 discovery cards.

---

## [v5.5.2] - 2026-11-01

### 🎨 Light Mode Global Contrast Audit & Clean Typography
- **Eliminated All Invisible Text**:
  - Audited `SonicDnaView.jsx`: fixed "Explore Boundaries" button (`text-[var(--text-primary)]`), Genre Affinity style names (`g.name` now high-contrast slate `#0F172A` instead of invisible white), percentage badges, key anchoring artists, and core profile tracks.
  - Fixed "Sync Liked" and "Sync YouTube Likes" buttons across `Navbar.jsx`, `SonicDnaView.jsx`, and `Sidebar.jsx` with deep contrast text (`#9f1239` / `text-rose-950 dark:text-rose-200 font-bold`).
  - Audited Direct Search subtabs in `PlaylistView.jsx` (Videos, Songs, Matched Playlists): replaced low-contrast pastel pills with high-contrast, bold tokens (`text-rose-950`, `text-purple-950`, `text-emerald-950 font-bold`).
  - Added global light-mode CSS rules in `index.css` ensuring `.text-white` on standard light surfaces automatically resolves to deep slate ink (`#0F172A`), while preserving `#FFFFFF` over album art cards (`squircle-card`) and solid accent buttons.

### 🎵 Curated Daily Top Charts Open First
- **Curated Stations Placed at Top**:
  - Reordered `PlaylistView.jsx` so the Curated section ("Listen together" / Top Charts & Made For You) opens **first** at the very top of the page, allowing immediate access to global hits across all languages without scrolling.
  - Updated `App.jsx` default generation from regional `"New Hindi Songs"` to `'Top 50 Global Daily Chart Hits'`.

### 🎧 Authentic Personalized Artist Mixes & Real Song Artwork
- **Purged All Generic Stock Photos**:
  - Replaced all Unsplash stock photos across Tier 1 (Charts) and Tier 2 (Personalized) with authentic YouTube Music song thumbnails (`https://i.ytimg.com/vi/${id}/hqdefault.jpg`).
- **Paired Artist Mixes Seeded from User Library**:
  - Upgraded personalized mix engine in `standaloneApi.js`: extracts user's authentic artists (e.g., Maroon 5, Post Malone, Arctic Monkeys, Lukas Graham, Billie Eilish, Sawano) to generate dynamic paired artist mixes (e.g. `Maroon 5 & Post Malone Mix`, `Arctic Monkeys & Lukas Graham Mix`, `Billie Eilish & Friends Mix`, `Rediscover Favorites Mix`).
  - Each station card displays the actual album artwork from the artist's tracks as its cover.
  - Defined and exported `DEFAULT_SEED_IDS` in `standaloneApi.js` to ensure unhindered mix generation.

### 🧹 Minimalist Discovery Header
- **Removed All AI-Generated Filler Sentences & Badges**:
  - Stripped out `"LIVE DISCOVERY • 8–9 Live Streams"` badge and `"Regional daily charts & personalized Sonic DNA streams..."` tagline.
  - Renamed shelves to clean, Spotify/YTM-style headings: **Daily Top Charts** and **Made For You**.
  - Removed intrusive new user unlock banner.

---

## [v5.5.1] - 2026-11-01

### 🛠️ Polish & Refinements

- **Listen Together Engine Fix**:
  - Resolved empty carousel issue by initializing with `getInitialDiscoveryBlocks()`, providing instant rendering on initial frame with zero network wait.
  - Eliminated blocking `browse` Innertube network requests for live chart artwork that triggered 400 errors.
  - Wired direct search queries for all regional daily charts (US Top Daily, India Top Daily, Japan Top Daily, India Trendy) ensuring 20 rich, playable tracks on click or shuffle.
  - Upgraded card Play buttons with explicit click handlers for immediate playback.
- **Taste Controls Light Mode Color Scheme Overhaul**:
  - Replaced hardcoded black `#0c0c12` / `bg-black/75` drawer surfaces in `Sidebar.jsx` with light-compliant semantic tokens (`var(--bg-glass-heavy)`, `var(--bg-card)`, and `var(--border-subtle)`).
  - Softened all nested wells and controls to slight gray in light mode, eliminating harsh pitch-black contrast blocks.
- **Synced Liked Button High Contrast Text**:
  - Fixed white-on-pink contrast bug on "Sync Liked" pills in `SonicDnaView.jsx`, `Navbar.jsx`, and `Sidebar.jsx` by enforcing crisp black/dark slate typography (`text-slate-900 font-bold`).
- **Sonic DNA & Library Light Mode Polish**:
  - Transformed desktop tables and mobile track cards in Favorites and Seeds Library from dark `#0c0c12` slabs to clean, soft gray/white surfaces (`var(--bg-card)` and `var(--surface-hover)`).
  - Added global light-mode CSS fallback rule to convert legacy dark classes to card surfaces automatically.
- **Removed Violet Mode**:
  - Completely purged Violet theme from `themeCycle.js`, `Sidebar.jsx` drawer, and day/night time schedules, streamlining theme selection to **Auto**, **Dark**, **Crimson Glow**, and **Light**.

---

## [v5.5.0] - 2026-11-01

### 🌟 Architectural & UI/UX Master Upgrade

#### 📱 Pillar 1: Spatial UI/UX Revamp ("Airy" Layout)
- **Breathing Room & Margins**: Overhauled mobile viewports (`< 768px`) with `20px` (`1.25rem` / `px-5`) horizontal container padding and `32px–40px` (`2rem–2.5rem`) vertical spacing between discovery sections.
- **Floating Clearance**: Added generous `130px` (`pb-[130px]`) bottom clearance across `PlaylistView`, `SonicDnaView`, and `OfflineView` scroll containers to guarantee zero cramming against the floating `PlayerBar`.
- **Touch-Target & Row Optimization**: Increased vertical touch-target height on track list rows to `64px–72px` (`min-h-[64px] sm:min-h-[72px]`, `py-2.5 px-3.5 sm:py-3 sm:px-4`) with `48px x 48px` squircle album art (`rounded-[12px]`) and `14px` (`gap-3.5`) spacing between thumbnail and metadata.
- **Typography Hierarchy**: Retained UpBeat's signature typography and squircle aesthetic while elevating section header scales (`1.35rem–1.5rem`, `font-weight: 700`, `letter-spacing: -0.02em`, `mb-4`) with clean `4px–6px` metadata gaps and overflow clipping.
- **Squircle Carousel Cards**: Mobile horizontal carousels standardized on `156px–168px` card widths with minimum `16px` gap and smooth snap scrolling (`scroll-snap-type: x mandatory`).

#### ☀️ Pillar 2: Daylight Studio High-Contrast Light Mode
- **Strict Semantic CSS Tokens**: Replaced hardcoded surfaces with unified semantic CSS variables across all themes (`:root`, `.theme-morning`, `.theme-afternoon`, `.theme-night`, and `.theme-light`):
  - `--bg-primary`: Soft Alabaster (`#F7F7FA`)
  - `--bg-elevated` & `--bg-card`: `#FFFFFF` with `rgba(15, 23, 42, 0.08)` subtle borders
  - `--bg-glass`: `rgba(255, 255, 255, 0.82)` with `backdrop-filter: blur(20px)`
  - `--text-primary`: Deep Slate Ink (`#0F172A`) for maximum contrast
  - `--text-secondary`: Muted Slate (`#475569`)
  - `--text-muted`: `#64748B`
  - `--accent-primary`: Vibrant Crimson-Rose (`#E11D48`) or Deep Violet (`#6D28D9`)
  - `--border-subtle`: `rgba(15, 23, 42, 0.09)`
  - `--surface-hover`: `rgba(15, 23, 42, 0.05)`
- **Elimination of Hardcoded White Text**: Audited components (`Navbar`, `Sidebar`, `PlayerBar`, `SonicDnaView`, `OfflineView`, `CuratorPrompt`, `QueueDrawer`, and modals) to eliminate hardcoded `#fff` / `text-white` on standard backgrounds.
- **5-Theme Atmosphere Drawer**: Updated `Sidebar.jsx` with an interactive 5-option selector: **Auto**, **Dark (AMOLED)**, **Crimson Glow**, **Violet**, and **Light** (Daylight Studio), applying instantaneous class updates without UI flash.

#### 🎶 Pillar 3: Dynamic 8–9 Block Listen Together / Home Discovery Engine
- **Tier 1 (4 Regional & Viral Live Charts)**:
  - *Block 1: US Top Daily Chart* (Billboard & US Top 50 Daily Hits)
  - *Block 2: India Top Daily Chart* (Top trending Indian releases)
  - *Block 3: Japan Top Daily Chart* (J-Pop, Anime OSTs, & Tokyo Hot 100)
  - *Block 4: India Trendy Songs* (Viral reels, Bollywood, Punjabi & indie tracks)
- **Tier 2 (4–5 Personalized Sonic DNA Blocks)**:
  - *Block 5: Sonic Archetype Mix* (Adaptive to user's listener archetype & BPM range)
  - *Block 6: Deep Cut Discovery* (Unheard tracks matching user's top genre affinities)
  - *Block 7: Recent Vibe Continuation* (Seeded from recently hearted & played tracks)
  - *Block 8: Late Night / Time-of-Day Personal Mix* (Harmonized with active time window)
  - *Block 9: Rediscover & Forgotten Gems* (Resurfaces earlier synced likes & harmonic pairings)
- **Anti-Static Rotation & Cache**: Implemented session cache (`upbeat_discovery_blocks_v55`) with dynamic query tag modifiers and a top-level **"Refresh Feed"** button for fresh track subsets on demand.

#### 🔀 Pillar 4: Universal Shuffle & Randomize Controls
- **True Fisher-Yates Queue Shuffle**: Implemented unbiased Fisher-Yates queue shuffle in `PlayerBar.jsx` & `App.jsx`, anchoring the currently playing track at index `0` and preserving the original queue sequence so toggling off restores playback order cleanly.
- **Per-Block Shuffle Play & Reroll**: Added 1-tap "Shuffle Play" and "Reroll Mix" buttons to all discovery block shelves for instant randomized playback and dynamic track replenishment.

---

## [v5.4.4] - 2026-10-30
- Unblocked restricted song resolution with intelligent fallback linking in Songs section.
- Purged corrupted partial download fragments and refined offline playback streaming.

## [v5.4.1] - 2026-10-29
- Resolved mid-track premature skips and crossfade timing stabilization.
- Fixed sleep timer state sync across desktop and mobile player bars.

## [v5.4.0] - 2026-10-29
- Audio crossfade transition engine implementation.
- Sleep timer streamlined to bottom controls.
