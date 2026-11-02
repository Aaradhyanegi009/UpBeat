import React, { useState } from 'react'
import {
  RefreshCw, ExternalLink, X, Heart, RotateCcw, Sliders, DownloadCloud,
  Home, Compass, Sparkles, Disc, Dna, ChevronDown, Palette, Sun, Moon
} from 'lucide-react'

export const PRESET_MODES = [
  {
    id: 'focus',
    label: 'Deep Focus / Terminal',
    character: 'Minimal Synth • Instrumental',
    energy: 60,
    theme: 'emerald',
    prompt: 'Focused instrumental electronic, minimal synth, and atmospheric OSTs for deep programming sessions'
  },
  {
    id: 'ost',
    label: 'Cinematic & Anime OST',
    character: 'Orchestral Rock • Sawano',
    energy: 78,
    theme: 'amber',
    prompt: 'High-impact orchestral rock, Hiroyuki Sawano style soundtracks, and Monogatari / anime openings'
  },
  {
    id: 'velocity',
    label: 'High-Velocity Flow',
    character: 'Liquid DnB • Dark Synth',
    energy: 88,
    theme: 'cyan',
    prompt: 'Fast-paced drum & bass, dark synthwave, and driving electronic rhythm for high-speed execution'
  },
  {
    id: 'nocturne',
    label: 'Late Night / Downtempo',
    character: 'Nocturnal Lo-Fi • Ambient',
    energy: 42,
    theme: 'violet',
    prompt: 'Nocturnal lo-fi, ambient textures, and understated melodic pieces for late-night work'
  },
  {
    id: 'indie',
    label: 'Alt / Math Rock & J-Rock',
    character: 'Intricate Guitar • Melodic',
    energy: 72,
    theme: 'rose',
    prompt: 'Intricate guitar work, math rock, Japanese alternative rock, and crisp melodic arrangements'
  }
]

const MODE_THEMES = {
  emerald: {
    selected: 'bg-emerald-950/30 border-emerald-500/50 text-white shadow-lg shadow-emerald-950/20',
    hover: 'hover:border-emerald-500/30 hover:bg-white/[0.05]',
    tag: 'bg-emerald-500/20 text-emerald-300',
    percent: 'text-emerald-400 font-bold',
    character: 'text-zinc-400',
    barActive: 'bg-gradient-to-r from-emerald-500 to-teal-400',
    barInactive: 'bg-emerald-500/20',
    sliderHex: '#10b981'
  },
  amber: {
    selected: 'bg-amber-950/30 border-amber-500/50 text-white shadow-lg shadow-amber-950/20',
    hover: 'hover:border-amber-500/30 hover:bg-white/[0.05]',
    tag: 'bg-amber-500/20 text-amber-300',
    percent: 'text-amber-400 font-bold',
    character: 'text-zinc-400',
    barActive: 'bg-gradient-to-r from-amber-500 to-orange-400',
    barInactive: 'bg-amber-500/20',
    sliderHex: '#f59e0b'
  },
  cyan: {
    selected: 'bg-cyan-950/30 border-cyan-500/50 text-white shadow-lg shadow-cyan-950/20',
    hover: 'hover:border-cyan-500/30 hover:bg-white/[0.05]',
    tag: 'bg-cyan-500/20 text-cyan-300',
    percent: 'text-cyan-400 font-bold',
    character: 'text-zinc-400',
    barActive: 'bg-gradient-to-r from-cyan-500 to-teal-400',
    barInactive: 'bg-cyan-500/20',
    sliderHex: '#06b6d4'
  },
  violet: {
    selected: 'bg-violet-950/30 border-violet-500/50 text-white shadow-lg shadow-violet-950/20',
    hover: 'hover:border-violet-500/30 hover:bg-white/[0.05]',
    tag: 'bg-violet-500/20 text-violet-300',
    percent: 'text-violet-400 font-bold',
    character: 'text-zinc-400',
    barActive: 'bg-gradient-to-r from-violet-500 to-purple-400',
    barInactive: 'bg-violet-500/20',
    sliderHex: '#a855f7'
  },
  rose: {
    selected: 'bg-rose-950/30 border-rose-500/50 text-white shadow-lg shadow-rose-950/20',
    hover: 'hover:border-rose-500/30 hover:bg-white/[0.05]',
    tag: 'bg-rose-500/20 text-rose-300',
    percent: 'text-rose-400 font-bold',
    character: 'text-zinc-400',
    barActive: 'bg-gradient-to-r from-rose-500 to-pink-400',
    barInactive: 'bg-rose-500/20',
    sliderHex: '#f43f5e'
  }
}

export default function Sidebar({
  tasteDna,
  energyLevel,
  setEnergyLevel,
  trackCount,
  setTrackCount,
  activePresetId,
  onSelectPreset,
  onNewSession,
  extractedCount = 0,
  favoritesCount = 0,
  offlineCount = 0,
  offlineStorageSize = '0 B',
  activeTab = 'curator',
  setActiveTab,
  onOpenFavoritesTab,
  onOpenOfflineTab,
  onSyncFavorites,
  onSyncSafari,
  isSyncing,
  onOpenSafari,
  isOpenDesktop = true,
  isOpenMobile,
  onCloseMobile,
  onToggleSidebar,
  models = [],
  selectedModel,
  onSelectModel,
  themeInfo,
  themePreference = 'auto',
  onSelectThemePreference,
  onCycleTheme,
  crossfadeSec = 5,
  setCrossfadeSec
}) {
  const activePreset = PRESET_MODES.find((p) => p.id === activePresetId)
  const isPresetCustomized = activePreset && energyLevel !== activePreset.energy

  // 1. YouTube Music Slim Vertical Left Rail (Icon + Text Stack)
  const slimRail = (
    <nav className="w-18 bg-[var(--bg-glass)] backdrop-blur-md border-r border-[var(--border-subtle)] flex flex-col items-center py-3 select-none h-full shrink-0">
      <div className="flex flex-col items-center gap-2 w-full px-2">
        {/* Home / Curator */}
        <button
          onClick={() => setActiveTab && setActiveTab('curator')}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'curator'
              ? 'bg-[var(--surface-hover)] text-[var(--text-primary)] font-bold shadow-xs'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
          title="Home / Quick picks"
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] tracking-tight font-semibold">Home</span>
        </button>

        {/* Liked Favorites */}
        <button
          onClick={() => {
            if (onOpenFavoritesTab) onOpenFavoritesTab()
            else if (setActiveTab) setActiveTab('favorites')
          }}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer relative ${
            activeTab === 'favorites'
              ? 'bg-rose-500/20 text-rose-500 dark:text-rose-300 font-bold shadow-md'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
          title="Liked Songs"
        >
          <div className="relative">
            <Heart className={`w-5 h-5 ${favoritesCount > 0 ? 'fill-rose-500/40 text-rose-400' : ''}`} />
            {favoritesCount > 0 && (
              <span className="absolute -top-1.5 -right-2 text-[9px] font-bold px-1 rounded-full bg-rose-500/20 text-slate-900 dark:text-rose-200 border border-rose-500/30">
                {favoritesCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight font-semibold">Liked</span>
        </button>

        {/* Offline Downloads */}
        <button
          onClick={() => {
            if (onOpenOfflineTab) onOpenOfflineTab()
            else if (setActiveTab) setActiveTab('offline')
          }}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer relative ${
            activeTab === 'offline'
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold shadow-md'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
          title="Offline Downloads"
        >
          <div className="relative">
            <DownloadCloud className={`w-5 h-5 ${offlineCount > 0 ? 'text-emerald-500' : ''}`} />
            {offlineCount > 0 && (
              <span className="absolute -top-1.5 -right-2 text-[9px] font-semibold px-1 rounded-full bg-emerald-500/30 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40">
                {offlineCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight font-semibold">Offline</span>
        </button>

        {/* Seeds Library */}
        <button
          onClick={() => setActiveTab && setActiveTab('library')}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer relative ${
            activeTab === 'library'
              ? 'bg-sky-500/20 text-sky-600 dark:text-sky-300 font-bold shadow-md'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
          title="Seed Library"
        >
          <Disc className="w-5 h-5" />
          <span className="text-[10px] tracking-tight font-semibold">Seeds</span>
        </button>

        {/* Taste Profile */}
        <button
          onClick={() => setActiveTab && setActiveTab('dna')}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer relative ${
            activeTab === 'dna'
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold shadow-md'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
          title="Sonic Taste Profile"
        >
          <Dna className="w-5 h-5" />
          <span className="text-[10px] tracking-tight font-semibold">Profile</span>
        </button>

        {/* Controls Drawer Toggle */}
        <button
          onClick={onToggleSidebar}
          className="w-full py-3 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] mt-auto"
          title="Toggle Taste Controls"
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[10px] tracking-tight font-semibold">Controls</span>
        </button>
      </div>
    </nav>
  )

  // 2. Full Expanded Drawer with Preset Sliders & Diagnostics
  const sidebarContent = (
    <aside className="w-80 bg-[var(--bg-glass-heavy)] backdrop-blur-2xl border-r border-[var(--border-subtle)] text-[var(--text-primary)] flex-shrink-0 flex flex-col justify-between overflow-y-auto select-none h-full relative">
      {/* Sticky Translucent Header */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-md sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">Taste Controls</span>
        </div>
        <button
          onClick={isOpenMobile ? onCloseMobile : onToggleSidebar}
          className="p-1.5 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title="Collapse Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">

        {/* Simple Dark & Light Toggle Control */}
        <div className="p-2.5 rounded-2xl bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2 pl-1.5">
            {themePreference === 'light' ? (
              <Sun className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-400 shrink-0" />
            )}
            <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
              {themePreference === 'light' ? 'Light Theme' : 'Dark AMOLED'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onSelectThemePreference) {
                onSelectThemePreference(themePreference === 'light' ? 'dark' : 'light')
              }
            }}
            className="px-3 py-1.5 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
            title={themePreference === 'light' ? 'Switch to Dark' : 'Switch to Light'}
          >
            {themePreference === 'light' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-500" />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Light</span>
              </>
            )}
          </button>
        </div>

        {/* AI Curation Model Section (Argon priority) */}
        {models && models.length > 0 && (
          <div className="p-4 rounded-3xl bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-xs relative overflow-hidden flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span>AI Curation Model</span>
              </span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                Argon Priority
              </span>
            </div>

            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
                className="w-full py-2.5 px-3 bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] hover:border-purple-500/40 rounded-2xl text-xs text-[var(--text-primary)] font-medium transition-all cursor-pointer appearance-none focus:outline-none focus:border-purple-400 pr-8"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                    {m.name || m.id}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-purple-500 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        )}

        {/* Taste Memory Section */}
        <div className="p-4 rounded-3xl bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-xs relative overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-rose-500" />
              <span>Taste Memory</span>
            </span>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <button
                onClick={onOpenFavoritesTab}
                title="View your hearted Favorites memory"
                className="px-2.5 py-0.5 rounded-full bg-rose-500/15 text-slate-900 dark:text-rose-200 border border-rose-500/30 flex items-center gap-1 cursor-pointer font-bold"
              >
                <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                <span>{favoritesCount}</span>
              </button>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)] font-semibold" title="Tracks extracted from Safari">
                {extractedCount} seeds
              </span>
            </div>
          </div>

          <button
            onClick={onSyncFavorites}
            disabled={isSyncing}
            title="Sync Liked Songs"
            className="w-full py-2.5 px-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 rounded-full text-xs text-rose-600 dark:text-rose-200 font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-98 shadow-xs btn-sync-liked"
          >
            <Heart className={`w-3.5 h-3.5 fill-rose-500 text-rose-500 stroke-none ${isSyncing ? 'animate-pulse' : ''}`} />
            <span>{isSyncing ? 'Analyzing & Curating...' : 'Sync Liked Songs'}</span>
          </button>
        </div>

        {/* Offline Storage Section */}
        <div className="p-4 rounded-3xl bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] shadow-xs relative overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-1.5">
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-500" />
              <span>Offline Storage</span>
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
              {offlineCount} {offlineCount === 1 ? 'song' : 'songs'}
            </span>
          </div>

          <button
            onClick={() => {
              if (onOpenOfflineTab) onOpenOfflineTab()
              if (isOpenMobile && onCloseMobile) onCloseMobile()
            }}
            title="Open Offline Downloads library"
            className="w-full py-2.5 px-3.5 bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] hover:border-emerald-500/30 rounded-2xl text-xs text-[var(--text-primary)] font-semibold flex items-center justify-between transition-all cursor-pointer group shadow-xs active:scale-98"
          >
            <div className="flex items-center gap-2">
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-500 group-hover:scale-110 transition-transform" />
              <span>Offline Library</span>
            </div>
            <span className="text-xs text-emerald-600 dark:text-emerald-300 font-bold">{offlineStorageSize}</span>
          </button>
        </div>

        {/* Global Controls: Track Count & Energy Slider */}
        <div className="p-4 rounded-3xl bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-subtle)] flex flex-col gap-3.5 shadow-xs">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
                Curated Track Count
              </span>
              <span className="text-xs font-bold text-[var(--text-primary)]">{trackCount} songs</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[4, 8, 12, 16, 24].map((count) => (
                <button
                  key={count}
                  onClick={() => setTrackCount(count)}
                  className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                    trackCount === count
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] border-[var(--text-primary)] shadow-md'
                      : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[1px] bg-[var(--border-subtle)]" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
                  Energy Bias
                </span>
                {energyLevel !== (activePreset ? activePreset.energy : 70) && (
                  <button
                    onClick={() => setEnergyLevel(activePreset ? activePreset.energy : 70)}
                    title="Reset energy to default"
                    className="text-[var(--text-muted)] hover:text-emerald-500 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <span className="text-xs font-bold text-emerald-500">
                {energyLevel}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={energyLevel}
              onChange={(e) => setEnergyLevel(parseInt(e.target.value, 10))}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-[var(--border-subtle)] rounded-full appearance-none"
            />
          </div>

          {typeof setCrossfadeSec === 'function' && (
            <>
              <div className="h-[1px] bg-[var(--border-subtle)]" />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
                    Crossfade
                  </span>
                  <span className="text-xs font-bold text-emerald-500">
                    {crossfadeSec > 0 ? `${crossfadeSec}s` : 'Off'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="12"
                  step="1"
                  value={crossfadeSec}
                  onChange={(e) => setCrossfadeSec(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-[var(--border-subtle)] rounded-full appearance-none"
                />
              </div>
            </>
          )}
        </div>

        {/* App Info */}
        <div className="pt-2 text-xs font-semibold text-[var(--text-muted)] border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span>UpBeat Music</span>
          <span className="text-emerald-500 font-bold">v6.2</span>
        </div>
      </div>

      {/* Bottom Profile Snapshot */}
      {tasteDna && (
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-md">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1.5">
              <Dna className="w-3.5 h-3.5" />
              <span>Profile Snapshot</span>
            </span>
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] px-2 py-0.5 rounded-full bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
              {tasteDna.sonic_attributes?.tempo || '120-140 BPM'}
            </span>
          </div>
          <div className="text-xs font-bold text-[var(--text-primary)] truncate tracking-tight">
            {tasteDna.archetype || 'Listener Profile'}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(tasteDna.primary_genres || []).slice(0, 3).map((g, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 font-medium"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  )

  return (
    <>
      {/* Desktop View: Expanded = Full Drawer, Collapsed = null (Navigation handled via bottom symbols dock) */}
      <div className="hidden lg:flex h-full select-none">
        {isOpenDesktop ? sidebarContent : null}
      </div>

      {/* Mobile Overlay Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
