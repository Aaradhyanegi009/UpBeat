# UpBeat Changelog

All notable changes to the UpBeat client, backend, and native apps are documented here.

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
