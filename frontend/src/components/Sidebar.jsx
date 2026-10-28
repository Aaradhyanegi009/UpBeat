import React, { useState } from 'react'
import {
  RefreshCw, ExternalLink, X, Heart, RotateCcw, Sliders, DownloadCloud,
  Home, Compass, Sparkles, Disc, Dna, ChevronDown, Palette
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
  onCycleTheme
}) {
  const activePreset = PRESET_MODES.find((p) => p.id === activePresetId)
  const isPresetCustomized = activePreset && energyLevel !== activePreset.energy
  const [isThemeOpen, setIsThemeOpen] = useState(false)

  // 1. YouTube Music Slim Vertical Left Rail (Icon + Text Stack)
  const slimRail = (
    <nav className="w-18 bg-black/40 backdrop-blur-md border-r border-white/10 flex flex-col items-center py-3 select-none h-full shrink-0">
      <div className="flex flex-col items-center gap-2 w-full px-2">
        {/* Home / Curator */}
        <button
          onClick={() => setActiveTab && setActiveTab('curator')}
          className={`w-full py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            activeTab === 'curator'
              ? 'bg-white/15 text-white font-bold shadow-md shadow-white/5'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
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
              ? 'bg-rose-500/20 text-rose-300 font-bold shadow-md'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
          }`}
          title="Liked Songs"
        >
          <div className="relative">
            <Heart className={`w-5 h-5 ${favoritesCount > 0 ? 'fill-rose-500/40 text-rose-400' : ''}`} />
            {favoritesCount > 0 && (
              <span className="absolute -top-1.5 -right-2 text-[9px] font-semibold px-1 rounded-full bg-rose-500/30 text-rose-300 border border-rose-500/40">
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
              ? 'bg-emerald-500/20 text-emerald-300 font-bold shadow-md'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
          }`}
          title="Offline Downloads"
        >
          <div className="relative">
            <DownloadCloud className={`w-5 h-5 ${offlineCount > 0 ? 'text-emerald-400' : ''}`} />
            {offlineCount > 0 && (
              <span className="absolute -top-1.5 -right-2 text-[9px] font-semibold px-1 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-500/40">
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
              ? 'bg-sky-500/20 text-sky-300 font-bold shadow-md'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
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
              ? 'bg-emerald-500/20 text-emerald-300 font-bold shadow-md'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
          }`}
          title="Sonic Taste Profile"
        >
          <Dna className="w-5 h-5" />
          <span className="text-[10px] tracking-tight font-semibold">Profile</span>
        </button>

        {/* Controls Drawer Toggle */}
        <button
          onClick={onToggleSidebar}
          className="w-full py-3 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer text-zinc-400 hover:text-white hover:bg-white/[0.08] mt-auto"
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
    <aside className="w-80 bg-black/75 backdrop-blur-2xl border-r border-white/10 flex-shrink-0 flex flex-col justify-between overflow-y-auto select-none h-full relative">
      {/* Sticky Translucent Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-white tracking-tight">Taste Controls</span>
        </div>
        <button
          onClick={isOpenMobile ? onCloseMobile : onToggleSidebar}
          className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          title="Collapse Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">

        {/* Themes Drawer (Small Collapsible Slider) */}
        <div className="rounded-2xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-sm overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => setIsThemeOpen((prev) => !prev)}
            className="w-full p-3.5 flex items-center justify-between text-left transition-colors hover:bg-white/[0.04] cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Palette className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-xs font-bold text-white tracking-tight">Themes</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold px-2.5 py-0.5 rounded-full border transition-all"
                style={{
                  backgroundColor: `${themeInfo?.color || '#ef4444'}15`,
                  borderColor: `${themeInfo?.color || '#ef4444'}35`,
                  color: themeInfo?.color || '#ef4444'
                }}
              >
                {themePreference === 'auto'
                  ? 'Auto'
                  : themePreference === 'amoled'
                  ? 'Dark'
                  : themePreference === 'morning'
                  ? 'Crimson Glow'
                  : 'Violet'}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                  isThemeOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </div>
          </button>

          {/* 4 Options Slide Down */}
          {isThemeOpen && (
            <div className="px-2 pb-2.5 pt-0.5 flex flex-col gap-1 border-t border-white/[0.06] animate-in fade-in slide-in-from-top-1 duration-150">
              {[
                { id: 'auto', label: 'Auto', color: '#10b981' },
                { id: 'amoled', label: 'Dark', color: '#71717a' },
                { id: 'morning', label: 'Crimson Glow', color: '#ef4444' },
                { id: 'night', label: 'Violet', color: '#8b5cf6' }
              ].map((th) => {
                const isSelected = themePreference === th.id
                return (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => {
                      if (onSelectThemePreference) onSelectThemePreference(th.id)
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between active:scale-[0.99] ${
                      isSelected
                        ? 'bg-white/10 text-white font-bold border border-white/15'
                        : 'text-zinc-300 hover:text-white hover:bg-white/[0.05] border border-transparent font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: th.color }}
                      />
                      <span className="text-xs tracking-tight">{th.label}</span>
                    </div>
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0 shadow-xs" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* AI Curation Model Section (Argon priority) */}
        {models && models.length > 0 && (
          <div className="p-4 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-sm relative overflow-hidden flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>AI Curation Model</span>
              </span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                Argon Priority
              </span>
            </div>

            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
                className="w-full py-2.5 px-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/10 hover:border-purple-500/40 rounded-2xl text-xs text-purple-200 font-medium transition-all cursor-pointer appearance-none focus:outline-none focus:border-purple-400 pr-8"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#121216] text-white">
                    {m.name || m.id}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-purple-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        )}

        {/* Taste Memory Section */}
        <div className="p-4 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-sm relative overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              <span>Taste Memory</span>
            </span>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <button
                onClick={onOpenFavoritesTab}
                title="View your hearted Favorites memory"
                className="px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1 cursor-pointer font-semibold"
              >
                <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                <span>{favoritesCount}</span>
              </button>
              <span className="text-zinc-600">•</span>
              <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/10 font-semibold" title="Tracks extracted from Safari">
                {extractedCount} seeds
              </span>
            </div>
          </div>

          <button
            onClick={onSyncFavorites}
            disabled={isSyncing}
            title="Analyze your Liked songs in Favorites and curate a fresh playlist"
            className="w-full py-2.5 px-3 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 hover:border-rose-500/40 rounded-full text-xs text-white font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-98"
          >
            <Heart className={`w-3.5 h-3.5 fill-rose-500 text-rose-500 ${isSyncing ? 'animate-pulse' : ''}`} />
            <span>{isSyncing ? 'Analyzing & Curating...' : 'Sync Liked Songs'}</span>
          </button>
        </div>

        {/* Offline Storage Section */}
        <div className="p-4 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-sm relative overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>Offline Storage</span>
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              {offlineCount} {offlineCount === 1 ? 'song' : 'songs'}
            </span>
          </div>

          <button
            onClick={() => {
              if (onOpenOfflineTab) onOpenOfflineTab()
              if (isOpenMobile && onCloseMobile) onCloseMobile()
            }}
            title="Open Offline Downloads library"
            className="w-full py-2.5 px-3.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-emerald-500/30 rounded-2xl text-xs text-white font-semibold flex items-center justify-between transition-all cursor-pointer group shadow-sm active:scale-98"
          >
            <div className="flex items-center gap-2">
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span>Offline Library</span>
            </div>
            <span className="text-xs text-emerald-300 font-bold">{offlineStorageSize}</span>
          </button>
        </div>

        {/* Global Controls: Track Count & Energy Slider */}
        <div className="p-4 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] flex flex-col gap-3.5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-white tracking-tight">
                Curated Track Count
              </span>
              <span className="text-xs font-bold text-white">{trackCount} songs</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[4, 8, 12, 16, 24].map((count) => (
                <button
                  key={count}
                  onClick={() => setTrackCount(count)}
                  className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                    trackCount === count
                      ? 'bg-white text-black border-white shadow-md shadow-white/10'
                      : 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[1px] bg-white/10" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white tracking-tight">
                  Energy Bias
                </span>
                {energyLevel !== (activePreset ? activePreset.energy : 70) && (
                  <button
                    onClick={() => setEnergyLevel(activePreset ? activePreset.energy : 70)}
                    title="Reset energy to default"
                    className="text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <span className="text-xs font-bold text-emerald-400">
                {energyLevel}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={energyLevel}
              onChange={(e) => setEnergyLevel(parseInt(e.target.value, 10))}
              className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-white/10 rounded-full appearance-none"
            />
          </div>
        </div>

        {/* App Info */}
        <div className="pt-2 text-xs font-semibold text-zinc-400 border-t border-white/10 flex items-center justify-between">
          <span className="text-zinc-400">UpBeat Music</span>
          <span className="text-emerald-400/80">v5.1.3</span>
        </div>
      </div>

      {/* Bottom Profile Snapshot */}
      {tasteDna && (
        <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
              <Dna className="w-3.5 h-3.5" />
              <span>Profile Snapshot</span>
            </span>
            <span className="text-[11px] font-semibold text-zinc-400 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10">
              {tasteDna.sonic_attributes?.tempo || '120-140 BPM'}
            </span>
          </div>
          <div className="text-xs font-bold text-white truncate tracking-tight">
            {tasteDna.archetype || 'Listener Profile'}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(tasteDna.primary_genres || []).slice(0, 3).map((g, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 font-medium"
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
