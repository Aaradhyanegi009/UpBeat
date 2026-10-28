import React, { useState, useEffect } from 'react'
import {
  RefreshCw, Menu, Settings, Sparkles, ChevronDown, Search, Loader2, X, Check, Music, ArrowLeft, ExternalLink, Moon, Sliders, Heart
} from 'lucide-react'
import { getStoredApiKey, setStoredApiKey, getStoredServerUrl, setStoredServerUrl, hasBackend } from '../standaloneApi'
import { GoogleIcon } from './GoogleAuthModal'
import { checkOtaUpdate, getCurrentOtaVersion, applyOtaBundle } from '../otaUpdater'

export default function Navbar({
  themeInfo,
  themePreference = 'auto',
  onCycleTheme,
  models = [],
  selectedModel,
  onSelectModel,
  safariStatus,
  onSyncFavorites,
  favoritesCount = 0,
  onSyncSafari,
  isSyncing,
  setActiveTab,
  onToggleSidebar,
  showKeyModal: controlledShowModal,
  setShowKeyModal: setControlledShowModal,
  prompt = '',
  setPrompt,
  onDirectSearch,
  onGenerate,
  searchMode = 'direct',
  setSearchMode,
  isGenerating = false,
  isSearching = false,
  googleUser,
  onOpenGoogleModal
}) {
  const [internalShowModal, setInternalShowModal] = useState(false)
  const showKeyModal = controlledShowModal !== undefined ? controlledShowModal : internalShowModal
  const setShowKeyModal = setControlledShowModal || setInternalShowModal

  const [apiKeyInput, setApiKeyInput] = useState(() => getStoredApiKey())
  const [serverUrlInput, setServerUrlInput] = useState(() => getStoredServerUrl())
  const [savedBanner, setSavedBanner] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false)
  const [otaVer, setOtaVer] = useState('v5.2.1')
  const [isCheckingOta, setIsCheckingOta] = useState(false)
  const [otaStatusMsg, setOtaStatusMsg] = useState('')

  useEffect(() => {
    getCurrentOtaVersion().then(v => setOtaVer(v))
  }, [showKeyModal])

  const handleManualOtaCheck = async () => {
    setIsCheckingOta(true)
    setOtaStatusMsg('')
    try {
      const res = await checkOtaUpdate({ silent: false, forceCheck: true })
      if (res.updateAvailable && res.downloadUrl) {
        setOtaStatusMsg(`Downloading update ${res.latestTag}...`)
        await applyOtaBundle(res.downloadUrl, res.latestTag, res.checksum, res.fallbackDownloadUrl)
        setOtaStatusMsg(`Update applied! Reloading...`)
      } else if (res.upToDate) {
        setOtaStatusMsg(`UpBeat is up to date (${res.currentVer || otaVer}) ✨`)
      } else if (res.error) {
        setOtaStatusMsg(`Check status: ${res.error}`)
      } else {
        setOtaStatusMsg(`UpBeat is up to date (${res.currentVer || otaVer}) ✨`)
      }
    } catch (e) {
      setOtaStatusMsg('Error checking update: ' + (e?.message || 'Check connection'))
    } finally {
      setIsCheckingOta(false)
    }
  }

  const hasYT = safariStatus?.has_yt
  const hasKeyOrServer = Boolean(getStoredApiKey()) || hasBackend()
  const busy = isGenerating || isSearching

  const handleSaveSettings = (e) => {
    e.preventDefault()
    setStoredApiKey(apiKeyInput)
    setStoredServerUrl(serverUrlInput)
    setSavedBanner(true)
    setTimeout(() => {
      setSavedBanner(false)
      setShowKeyModal(false)
    }, 550)
  }

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault()
    if (!prompt || !prompt.trim() || busy) return
    if (searchMode === 'curator' && onGenerate) {
      onGenerate(prompt)
    } else if (onDirectSearch) {
      onDirectSearch(prompt)
    }
  }

  const isAiMode = searchMode === 'curator'

  return (
    <>
      <header className="pt-safe-top bg-black/40 backdrop-blur-md border-b border-white/10 select-none flex-shrink-0 z-30 sticky top-0 transition-colors">
        {/* Mobile Full-Width Search Header (when search is open on mobile) */}
        {isMobileSearchOpen ? (
          <div className="sm:hidden flex flex-col">
            <div className="h-11 sm:h-14 px-3 flex items-center gap-2.5 w-full">
              <button
                type="button"
                onClick={() => setIsMobileSearchOpen(false)}
                className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                title="Back to navigation"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <form
                onSubmit={handleSearchSubmit}
                className="flex-1 h-10 rounded-full bg-white/[0.08] border border-white/20 flex items-center gap-2 px-3.5 min-w-0"
              >
                <button
                  type="submit"
                  disabled={busy}
                  className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                  title="Search"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="text"
                  autoFocus
                  value={prompt}
                  onChange={(e) => setPrompt && setPrompt(e.target.value)}
                  placeholder={
                    isAiMode
                      ? 'Describe vibe, mood, anime...'
                      : 'Search songs, artists...'
                  }
                  className="w-full bg-transparent text-xs text-white placeholder:text-zinc-400 focus:outline-none min-w-0"
                />

                {Boolean(prompt) && !busy && (
                  <button
                    type="button"
                    onClick={() => setPrompt && setPrompt('')}
                    className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer"
                    title="Clear text"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {setSearchMode && (
                  <button
                    type="button"
                    onClick={() => setSearchMode(isAiMode ? 'direct' : 'curator')}
                    className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all shrink-0 cursor-pointer ${
                      isAiMode
                        ? 'bg-purple-500/25 text-purple-200 border-purple-500/50 shadow-sm'
                        : 'bg-white/[0.06] text-zinc-400 hover:text-white border-white/[0.08]'
                    }`}
                    title={isAiMode ? 'Switch to Regular Search' : 'Enable Gemini AI Curator'}
                  >
                    <Sparkles className={`w-3 h-3 ${isAiMode ? 'text-purple-300' : 'text-zinc-400'}`} />
                    <span>AI</span>
                  </button>
                )}
              </form>
            </div>

            {/* AI Model Sub-Bar on Mobile (Only when AI curate is on) */}
            {isAiMode && models.length > 0 && (
              <div className="px-4 py-1.5 bg-black/60 backdrop-blur-md border-t border-white/[0.06] flex items-center justify-between text-xs animate-in fade-in duration-100">
                <div className="flex items-center gap-1.5 text-purple-300 text-[11px] font-mono">
                  <Sparkles className="w-3 h-3" />
                  <span>Curator Model:</span>
                </div>
                <div className="flex items-center gap-1 bg-purple-950/60 border border-purple-500/30 px-2.5 py-0.5 rounded-full text-[11px] font-mono">
                  <select
                    value={selectedModel}
                    onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
                    className="bg-transparent text-purple-200 focus:outline-none cursor-pointer text-xs"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#141418] text-white">
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-2.5 h-2.5 text-purple-400 pointer-events-none" />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Standard Navbar (Desktop full + Mobile clean icon bar) */
          <div className="h-11 sm:h-14 px-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-4">
            {/* Left: Clean Brand (On mobile, ONLY music note logo; on desktop, logo + UpBeat) */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={onToggleSidebar}
                className="p-2 rounded-full hover:bg-white/[0.08] active:bg-white/[0.12] text-zinc-300 hover:text-white transition-all cursor-pointer"
                title="Taste Controls"
                aria-label="Taste Controls"
              >
                <Sliders className="w-5 h-5 text-white" />
              </button>

              <div
                onClick={() => setActiveTab && setActiveTab('curator')}
                className="flex items-center gap-2 cursor-pointer group"
                title="UpBeat"
              >
                <Music className="w-5 h-5 text-white" />
                {/* Text is hidden on mobile screens, shown on desktop */}
                <span className="hidden sm:inline font-bold text-white text-lg tracking-tight">UpBeat</span>
              </div>

              {/* Day / Night Atmosphere Status Indicator */}
              {themeInfo && (
                <button
                  type="button"
                  onClick={onCycleTheme}
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold tracking-tight transition-all select-none cursor-pointer hover:scale-105 active:scale-95"
                  style={{
                    backgroundColor: `${themeInfo.color}15`,
                    borderColor: `${themeInfo.color}35`,
                    color: themeInfo.color
                  }}
                  title={`Atmosphere: ${themeInfo.label} (${themeInfo.timeSlot}) • Tap to switch theme`}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: themeInfo.color }} />
                  <span>
                    {themePreference === 'auto'
                      ? (themeInfo.type === 'morning' ? 'Crimson Glow' : themeInfo.type === 'afternoon' ? 'Dark' : 'Violet')
                      : (themePreference === 'amoled' ? 'Dark' : themePreference === 'morning' ? 'Crimson Glow' : themePreference === 'night' ? 'Violet' : themeInfo.label)}
                  </span>
                </button>
              )}
            </div>

            {/* Center: Desktop-only Spacious Search Bar */}
            <div className="hidden sm:flex flex-1 max-w-xl lg:max-w-2xl mx-4 lg:mx-6 items-center justify-center min-w-0">
              <form
                onSubmit={handleSearchSubmit}
                className={`w-full h-10 sm:h-11 rounded-full flex items-center gap-2.5 px-3.5 sm:px-4 transition-all ${
                  isSearchFocused
                    ? 'bg-[#18181b] border border-white/30 shadow-lg shadow-black/50 ring-1 ring-white/20'
                    : 'bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08]'
                }`}
              >
                <button
                  type="submit"
                  disabled={busy}
                  className="text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                  title="Search"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt && setPrompt(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  placeholder={
                    isAiMode
                      ? 'Describe mood, anime, soundtrack, or vibe for Gemini...'
                      : 'Search songs, albums, artists, podcasts...'
                  }
                  className="w-full bg-transparent text-xs sm:text-sm text-white placeholder:text-zinc-400 focus:outline-none min-w-0"
                />

                {/* Clear button if text present */}
                {Boolean(prompt) && !busy && (
                  <button
                    type="button"
                    onClick={() => setPrompt && setPrompt('')}
                    className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* AI Curate Toggle Button */}
                {setSearchMode && (
                  <button
                    type="button"
                    onClick={() => setSearchMode(isAiMode ? 'direct' : 'curator')}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all shrink-0 cursor-pointer ${
                      isAiMode
                        ? 'bg-purple-500/25 text-purple-200 border-purple-500/50 shadow-sm'
                        : 'bg-white/[0.06] text-zinc-400 hover:text-white border-white/[0.08] hover:border-white/20'
                    }`}
                    title={isAiMode ? 'Switch to Regular Search' : 'Enable Gemini AI Curator'}
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isAiMode ? 'text-purple-300' : 'text-zinc-400'}`} />
                    <span>AI Curate</span>
                  </button>
                )}

                {/* AI Model Selector: ONLY VISIBLE WHEN AI CURATE IS ACTIVE */}
                {isAiMode && models.length > 0 && (
                  <div className="flex items-center gap-1 bg-purple-950/50 border border-purple-500/30 px-2 py-0.5 rounded-full text-[11px] font-mono shrink-0 animate-in fade-in duration-150">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                    <select
                      value={selectedModel}
                      onChange={(e) => onSelectModel && onSelectModel(e.target.value)}
                      className="bg-transparent text-purple-200 focus:outline-none cursor-pointer max-w-[110px] sm:max-w-[150px] truncate"
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id} className="bg-[#141418] text-white">
                          {m.name || m.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-2.5 h-2.5 text-purple-400 pointer-events-none -ml-0.5" />
                  </div>
                )}
              </form>
            </div>

            {/* Right: Actions (Mobile Search Toggle, Safari Sync, Settings, User Profile) */}
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {/* Mobile Search Toggle Button (Tapping this opens full-width search) */}
              <button
                type="button"
                onClick={() => setIsMobileSearchOpen(true)}
                className="sm:hidden p-2 rounded-full hover:bg-white/[0.08] active:bg-white/[0.12] text-zinc-300 hover:text-white transition-all cursor-pointer"
                title="Search songs, artists, mood"
                aria-label="Open search bar"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Sync Liked Songs Button */}
              {onSyncFavorites && favoritesCount > 0 && (
                <button
                  type="button"
                  onClick={onSyncFavorites}
                  disabled={isSyncing}
                  title="Analyze your Liked songs in Favorites and curate a fresh playlist"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-xs text-rose-200 font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-xs"
                >
                  <Heart className={`w-3.5 h-3.5 fill-rose-400 text-rose-400 ${isSyncing ? 'animate-pulse' : ''}`} />
                  <span>{isSyncing ? 'Curating...' : 'Sync Liked'}</span>
                </button>
              )}

              {/* Settings & Setup Button */}
              <button
                onClick={() => {
                  setApiKeyInput(getStoredApiKey())
                  setServerUrlInput(getStoredServerUrl())
                  setShowKeyModal(true)
                }}
                title="Settings & Setup"
                className={`p-2 rounded-full border text-xs flex items-center justify-center transition-colors cursor-pointer ${
                  !hasKeyOrServer
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/[0.08] text-zinc-400 hover:text-white'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Google Profile Avatar / Sign In */}
              {onOpenGoogleModal && (
                googleUser ? (
                  <button
                    onClick={onOpenGoogleModal}
                    title={`Google Connected: ${googleUser.name || googleUser.email}`}
                    className="relative p-0.5 rounded-full border border-white/20 hover:border-white/50 transition-all cursor-pointer group"
                  >
                    {googleUser.picture ? (
                      <img src={googleUser.picture} alt="" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-rose-500 via-purple-600 to-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                        {(googleUser.name || googleUser.email || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-black" />
                  </button>
                ) : (
                  <>
                    {/* Desktop Sign In Pill */}
                    <button
                      onClick={onOpenGoogleModal}
                      title="Sign In with Google"
                      className="hidden sm:flex px-3.5 py-1.5 rounded-full border border-white/[0.15] bg-white/[0.08] hover:bg-white/[0.15] text-zinc-200 hover:text-white items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <GoogleIcon className="w-3.5 h-3.5" />
                      <span>Sign In</span>
                    </button>

                    {/* Mobile Sign In Icon Button */}
                    <button
                      onClick={onOpenGoogleModal}
                      title="Sign In with Google"
                      className="sm:hidden p-2 rounded-full border border-white/[0.15] bg-white/[0.08] hover:bg-white/[0.15] text-zinc-200 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <GoogleIcon className="w-4 h-4" />
                    </button>
                  </>
                )
              )}
            </div>
          </div>
        )}
      </header>

      {/* Settings Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#101015]/95 border border-white/10 rounded-3xl p-6 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Studio Settings</h3>
                </div>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-white/[0.04] border border-white/10 focus:border-rose-500 rounded-2xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Mac Backend Server URL (Optional)
                </label>
                <input
                  type="text"
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  placeholder="http://192.168.1.4:8000"
                  className="w-full bg-white/[0.04] border border-white/10 focus:border-rose-500 rounded-2xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-colors"
                />
              </div>

              {/* Over-The-Air (OTA) Live Updates */}
              <div className="pt-3 border-t border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-bold text-white tracking-tight">Live Over-The-Air Updates</span>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {otaVer}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleManualOtaCheck}
                    disabled={isCheckingOta}
                    className="flex-1 py-2.5 px-3 rounded-2xl bg-purple-600/25 hover:bg-purple-600/35 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isCheckingOta ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                    )}
                    <span>{isCheckingOta ? 'Checking GitHub...' : 'Check for Live Update'}</span>
                  </button>

                  <a
                    href="https://github.com/AaradhyaNegi009/UpBeat/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="py-2.5 px-3.5 rounded-2xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                  >
                    <span>Releases</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {otaStatusMsg && (
                  <p className="text-xs text-purple-300 mt-2 font-medium bg-purple-950/40 border border-purple-500/30 rounded-xl px-3 py-1.5">
                    {otaStatusMsg}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-white text-black hover:bg-zinc-200 active:scale-95 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-white/10 transition-all"
                >
                  {savedBanner ? <Check className="w-3.5 h-3.5" /> : null}
                  <span>{savedBanner ? 'Saved' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
