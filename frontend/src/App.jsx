import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { Sparkles, Loader2, X, Share, Users, Settings, Trash2, Pencil } from 'lucide-react'
import PlayerBar from './components/PlayerBar'
import JamFloatingBar from './components/JamFloatingBar'
import { jamManager, normalizeRoomCode, normalizeFriendCode } from './jamEngine'
import { useRoute, navigate, goBack, canGoBack, useMediaQuery } from './ui/router'
import { AppContext, sameTrack } from './ui/AppContext'
import { TabBar, SideNav, TopBar, TABS } from './ui/Shell'
import { RightPanel, AddToPlaylistSheet, NameDialog, Toast } from './ui/Panels'
import { PageHeader, IconButton } from './ui/primitives'
import HomeView from './views/HomeView'
import SearchView from './views/SearchView'
import { initOtaUpdater } from './otaUpdater'
import { getThemeInfo, applyThemeToDocument } from './utils/themeCycle'
import {
  getApiBase,
  curateStandalone,
  directSearchStandalone,
  browsePlaylistStandalone,
  analyzeTasteDnaStandalone,
  hasBackend,
  isNativeApp,
  isConfigured,
  getStoredApiKey,
  getStoredServerUrl,
  fetchRelatedCompanionTracks,
  loadBlockTracks,
  isValidMusicTrack,
  sanitizeLocalMusicLibrary
} from './standaloneApi'
import { useLibraryStorage, slimTrack, saveStorage, loadStorage, hasMacCompanion } from './hooks/useLibraryStorage'
import { useCompanionSync } from './hooks/useCompanionSync'
import { useAudioPlayback } from './hooks/useAudioPlayback'
import { useJamSync } from './hooks/useJamSync'

const SonicDnaView = lazy(() => import('./components/SonicDnaView'))
const QueueDrawer = lazy(() => import('./components/QueueDrawer'))
const GoogleAuthModal = lazy(() => import('./components/GoogleAuthModal'))
const JamModal = lazy(() => import('./components/JamModal'))
const ProfileEditModal = lazy(() => import('./components/ProfileEditModal'))
const CreateView = lazy(() => import('./views/CreateView'))
const CollectionView = lazy(() => import('./views/CollectionView'))
const LibraryView = lazy(() => import('./views/LibraryView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const Onboarding = lazy(() => import('./views/Onboarding'))

// Immediately run library sanitizer to purge non-music, standup, and devotional pollution
sanitizeLocalMusicLibrary()

export default function App() {
  // Dark only. Song-artwork colours are applied by the player separately.
  const themeInfo = getThemeInfo()

  useEffect(() => {
    applyThemeToDocument()
  }, [])

  const route = useRoute()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [notification, setNotification] = useState(null)
  const notifyTimerRef = useRef(null)
  const showNotify = useCallback((msg, type = 'info', action = null) => {
    setNotification({ msg, type, action, id: Date.now() })
    clearTimeout(notifyTimerRef.current)
    notifyTimerRef.current = setTimeout(() => setNotification(null), action ? 5000 : 3200)
  }, [])
  const remoteJamGuardRef = useRef(false)
  const initialBootRef = useRef(false)

  const [models] = useState([
    { id: 'gemini-4-argon', name: 'Gemini 4 Argon (Fastest · 2.5 Flash Lite)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite Latest' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
  ])
  const [selectedModel, setSelectedModel] = useState(() => {
    const validIds = new Set(['gemini-4-argon', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash'])
    try {
      const saved = localStorage.getItem('argon_selected_model')
      return saved && validIds.has(saved) ? saved : 'gemini-4-argon'
    } catch {
      return 'gemini-4-argon'
    }
  })
  const handleSelectModel = (modelId) => {
    setSelectedModel(modelId)
    try { localStorage.setItem('argon_selected_model', modelId) } catch {}
  }

  const [prompt, setPrompt] = useState('')
  const [activePresetId, setActivePresetId] = useState(null)
  const [energyLevel, setEnergyLevel] = useState(60)
  const [discoveryLevel, setDiscoveryLevel] = useState(50)
  const [trackCount, setTrackCount] = useState(20)
  const [createSeed, setCreateSeed] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false)
  const [isProfileEditOpen, setIsProfileEditOpen] = useState(false)
  const [otaUpdate, setOtaUpdate] = useState(null)
  const [isApplyingOta, setIsApplyingOta] = useState(false)
  const [showIosInstallPrompt, setShowIosInstallPrompt] = useState(false)
  const [leftNavOpen, setLeftNavOpen] = useState(() => loadStorage('upbeat_left_nav_open_v1', true))
  const [leftNavWidth, setLeftNavWidth] = useState(() => {
    const w = Number(loadStorage('upbeat_left_nav_width_v1', 280))
    return w >= 210 && w <= 380 ? w : 280
  })
  const [isDraggingLeftNav, setIsDraggingLeftNav] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(() => loadStorage('upbeat_right_panel_v1', true))
  const [rightTab, setRightTab] = useState('next')
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null)
  const [nameDialog, setNameDialog] = useState(null)
  const [sideLibFilter, setSideLibFilter] = useState('all')
  const lastTabRef = useRef('home')
  const scrollRef = useRef(null)
  const scrollMemoryRef = useRef({})
  const searchInputRef = useRef(null)
  const companionCurrentTrackRef = useRef(null)
  const [onboardingVersion, setOnboardingVersion] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      if (localStorage.getItem('upbeat_onboarded_v1') && localStorage.getItem('upbeat_chart_prefs_v1')) return false
      if (!localStorage.getItem('upbeat_chart_prefs_v1') && !localStorage.getItem('upbeat_taste_prefs_v1')) return true
      return false
    } catch {
      return false
    }
  })
  const [onboardingBusy, setOnboardingBusy] = useState(false)

  useEffect(() => saveStorage('upbeat_left_nav_open_v1', leftNavOpen), [leftNavOpen])
  useEffect(() => saveStorage('upbeat_left_nav_width_v1', leftNavWidth), [leftNavWidth])
  useEffect(() => saveStorage('upbeat_right_panel_v1', rightPanelOpen), [rightPanelOpen])

  const handleStartLeftNavSlider = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startOpen = leftNavOpen
    const startW = startOpen ? leftNavWidth : 0
    let moved = false
    setIsDraggingLeftNav(true)

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX
      if (Math.abs(dx) > 4) moved = true
      if (!moved) return
      const nextW = startW + dx
      if (nextW < 135) {
        setLeftNavOpen(false)
      } else {
        setLeftNavOpen(true)
        setLeftNavWidth(Math.max(210, Math.min(380, Math.round(nextW))))
      }
    }

    const onUp = () => {
      setIsDraggingLeftNav(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!moved) setLeftNavOpen((v) => !v)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [leftNavOpen, leftNavWidth])

  // Domain hooks (library persistence, companion sync, audio playback, and live Jam sync)
  const {
    extractedTracks, setExtractedTracks,
    favorites, setFavorites,
    tasteDna, setTasteDna,
    playlist, setPlaylist,
    queue, setQueue,
    offlineTracks, offlineStats, downloadedIds,
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    recentSearches, setRecentSearches,
    savedCollections, setSavedCollections,
    recentMixes, playHistory, recents,
    collectionLoading, setCollectionLoading, playingFrom, setPlayingFrom, downloadJobs, collectionTokenRef,
    recordMix, recordRecent, recordHistoryTrack, showCollection, loadCollection,
    isSavedId, toggleSave, createPlaylist, addTrackToPlaylist, removeFromPlaylist, deletePlaylist,
    downloadTrack, downloadAll, deleteDownload, clearDownloads
  } = useLibraryStorage({ showNotify, navigate, goBack, initialSearchQuery: route.params?.q || '' })

  const {
    safariStatus, safariNowPlaying, isSyncing, setIsSyncing,
    googleUser, showGoogleModal, setShowGoogleModal, isSyncingLikes,
    checkSafari, checkNowPlaying, handleSaveProfile, handleSyncSafari,
    handleOpenSafari, handlePushToSafari, handleSafariControl,
    handleGoogleLogin, handleGoogleLogout, handleSyncGoogleYouTubeLikes
  } = useCompanionSync({
    favorites,
    setFavorites,
    extractedTracks,
    setExtractedTracks,
    setTasteDna,
    selectedModel,
    currentTrackRef: companionCurrentTrackRef,
    showNotify
  })

  const {
    currentTrack, setCurrentTrack, currentTrackIdx, setCurrentTrackIdx,
    isPlaying, setIsPlaying, playbackMode, setPlaybackMode, activePlaybackContext,
    isShuffle, setIsShuffle, repeatMode, setRepeatMode, crossfadeSec, setCrossfadeSec,
    currentTrackRef, isPlayingRef, queueRef, handleNextRef, handlePrevRef,
    upNext, isTrackFavorite, handleToggleFavorite, handlePlayTrack, handleTogglePlay,
    handleNext, handlePlayNext, handleAddToQueue, handleRemoveFromQueue, handleClearQueue,
    handleToggleShuffle, cycleRepeatMode, toggleLoopSong, handlePrev, handleUserSeek, handleTrackResolved, playList
  } = useAudioPlayback({
    playlist,
    setPlaylist,
    favorites,
    setFavorites,
    extractedTracks,
    offlineTracks,
    queue,
    setQueue,
    activeTab: 'curator',
    setPlayingFrom,
    remoteJamGuardRef,
    onPushToSafari: handlePushToSafari,
    showNotify
  })
  companionCurrentTrackRef.current = currentTrack

  const {
    jamState, isJamModalOpen, setIsJamModalOpen,
    initialJamCode, setInitialJamCode, initialFriendCode, setInitialFriendCode,
    initialJamSection, setInitialJamSection, jamReactions,
    openFriends, listenAlong, startJamWith
  } = useJamSync({
    currentTrack,
    isPlaying,
    queue,
    setCurrentTrack,
    setIsPlaying,
    setQueue,
    currentTrackRef,
    isPlayingRef,
    queueRef,
    handleNextRef,
    handlePrevRef,
    remoteJamGuardRef,
    handlePlayTrack,
    playList,
    setPlayingFrom,
    googleUser,
    showNotify
  })

  useEffect(() => {
    if (isPlaying && currentTrack) recordHistoryTrack(currentTrack)
  }, [currentTrack?.video_id, currentTrack?.title, isPlaying, recordHistoryTrack])

  // Detect iOS Safari (browser mode) to guide users toward adding to Home Screen
  useEffect(() => {
    try {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
      const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches)
      const dismissed = localStorage.getItem('upbeat_pwa_prompt_dismissed') === '1'
      if (isIos && !isStandalone && !isNativeApp() && !dismissed) {
        setShowIosInstallPrompt(true)
      }
    } catch {}
  }, [])

  // Initialize Over-The-Air (OTA) live updater on startup
  useEffect(() => {
    initOtaUpdater((updateInfo) => {
      setOtaUpdate(updateInfo)
    })
  }, [])

  // Handle in-car controls from Android Auto & car head units (ref-backed so closures never go stale)
  const carActionRef = useRef(null)
  carActionRef.current = (action, payload) => {
    switch (action) {
      case 'play':
        if (window.UpBeatControls?.forcePlay) {
          window.UpBeatControls.forcePlay()
        } else {
          setIsPlaying(true)
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing'
          }
        }
        break
      case 'pause':
        if (window.UpBeatControls?.forcePause) {
          window.UpBeatControls.forcePause()
        } else {
          setIsPlaying(false)
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused'
          }
        }
        break
      case 'next':
        handleNext()
        break
      case 'prev':
        handlePrev()
        break
      case 'seek':
        window.dispatchEvent(new CustomEvent('upbeat-car-seek', { detail: Number(payload) || 0 }))
        break
      case 'play_title_artist': {
        const parts = (payload || '').split('___')
        const tTitle = parts[0]?.trim()
        const tArtist = parts[1]?.trim()
        if (tTitle) {
          const query = `${tTitle} ${tArtist || ''}`.trim()
          handleDirectSearch(query, 'auto', true)
        }
        break
      }
      case 'play_index': {
        const idx = parseInt(payload, 10)
        const activeList = playlist?.tracks?.length ? playlist.tracks : (queue?.length ? queue : (extractedTracks?.length ? extractedTracks : []))
        if (!isNaN(idx) && activeList?.[idx]) {
          handlePlayTrack(activeList[idx], idx, activeList)
        }
        break
      }
      case 'play_favorite': {
        const idx = parseInt(payload, 10)
        const activeFavs = favorites?.length ? favorites : (extractedTracks?.length ? extractedTracks : [])
        if (!isNaN(idx) && activeFavs?.[idx]) {
          handlePlayTrack(activeFavs[idx], idx, activeFavs)
        }
        break
      }
      case 'play_preset': {
        const presetMap = {
          preset_late_night: 'Atmospheric late night drive lofi hip hop mix',
          preset_focus: 'Deep focus instrumental ambient electronic beats',
          preset_energy: 'High energy fast BPM workout motivation tracks',
          preset_anime: 'Cinematic orchestral soundtracks and epic film scores',
          preset_hindi: 'New Hindi songs latest releases'
        }
        const promptText = presetMap[payload] || 'Curated music mix'
        setPrompt(promptText)
        handleDirectSearch(promptText, 'auto', true)
        break
      }
      case 'search_play': {
        if (payload) {
          setPrompt(payload)
          handleDirectSearch(payload, 'auto', true)
        }
        break
      }
      case 'toggle_loop': {
        if (payload === 'one') setRepeatMode('one')
        else if (payload === 'off') setRepeatMode('off')
        else toggleLoopSong()
        break
      }
      case 'toggle_like': {
        if (currentTrackRef.current) handleToggleFavorite(currentTrackRef.current)
        break
      }
      default:
        break
    }
  }

  useEffect(() => {
    window.onUpBeatCarAction = (action, payload) => carActionRef.current?.(action, payload)

    // Flush any pending car actions queued during cold start
    if (window.UpBeatNative && typeof window.UpBeatNative.readyForCarActions === 'function') {
      try {
        window.UpBeatNative.readyForCarActions()
      } catch {}
    }

    return () => {
      delete window.onUpBeatCarAction
    }
  }, [])
  // Auto-heal any cached playlist tracks missing thumbnails or real durations
  useEffect(() => {
    if (!hasBackend() || !playlist?.tracks?.length) return
    const needsResolve = playlist.tracks.some(
      (t) =>
        !t.video_id ||
        !t.thumbnail ||
        !t.duration_text ||
        t.duration_text === '--:--' ||
        t.duration_text === '3:30' ||
        t.duration_text === '3:42' ||
        t.duration_text === '3:00' ||
        t.duration_text === '8:29' ||
        t.duration_text === '8:08'
    )
    if (!needsResolve) return

    fetch(`${getApiBase()}/resolve-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: playlist.tracks })
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.tracks) {
          setPlaylist((prev) => (prev ? { ...prev, tracks: data.tracks } : prev))
          if (currentTrack) {
            const updatedCur = data.tracks.find((t) => t.title === currentTrack.title)
            if (updatedCur) setCurrentTrack(updatedCur)
          }
        }
      })
      .catch(() => {})
  }, [playlist?.playlist_title])
  // Sync Liked Songs: Analyzes favorites to update Sonic Taste DNA and curates fresh songs
  const handleSyncFavorites = async () => {
    if (!favorites || favorites.length === 0) {
      showNotify('Like a few songs first, then make a mix from them.', 'info')
      return
    }

    setIsSyncing(true)
    showNotify(`Making a mix from your ${favorites.length} liked songs…`, 'info')

    try {
      // 1. Deep Taste DNA Analysis on user's Liked favorites
      let dna = null
      if (hasBackend()) {
        try {
          const res = await fetch(`${getApiBase()}/taste-dna`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: favorites, model_name: selectedModel })
          })
          if (res.ok) dna = await res.json()
        } catch {}
      }
      if (!dna) {
        dna = await analyzeTasteDnaStandalone(favorites)
      }
      if (dna) {
        setTasteDna(dna)
        try { localStorage.setItem('argon_dna_v2', JSON.stringify(dna)) } catch {}
      }

      // 2. Curate fresh tracks directly from Liked favorites
      const favNames = favorites.slice(0, 5).map((f) => `"${f.title}" by ${f.artist}`).join(', ')
      const curatePrompt = `Songs directly matching the sound, mood, and musical style of my Liked favorites: ${favNames}`
      setPrompt(curatePrompt)
      setActivePresetId(null)

      let curateData = null
      const curateArgs = {
        mood_prompt: curatePrompt,
        energy_level: energyLevel,
        count: trackCount,
        model_name: selectedModel,
        favorites
      }

      if (hasBackend()) {
        try {
          const res = await fetch(`${getApiBase()}/curate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seed_tracks: favorites,
              mood_prompt: curatePrompt,
              energy_level: energyLevel,
              count: trackCount,
              model_name: selectedModel
            })
          })
          const ct = res.headers.get('content-type') || ''
          if (res.ok && ct.includes('application/json')) {
            curateData = await res.json()
          }
        } catch {}
      }

      if (!curateData) {
        curateData = await curateStandalone(curateArgs)
      }

      if (curateData && curateData.tracks && curateData.tracks.length > 0) {
        const mix = {
          id: `mix_${Date.now()}`,
          kind: 'mix',
          title: curateData.playlist_title || 'From your likes',
          subtitle: curateData.subtitle || '',
          prompt: 'Mix from my liked songs',
          tracks: curateData.tracks,
          createdAt: Date.now()
        }
        setPlaylist(mix)
        recordMix(mix)
        recordRecent(mix)
        navigate('/collection')
        if (!currentTrack || !isPlaying) {
          setCurrentTrack(mix.tracks[0])
          setCurrentTrackIdx(0)
        }
      } else {
        showNotify('Updated your taste profile', 'success')
      }
    } catch (err) {
      showNotify(`Sync error: ${err.message}`, 'error')
    } finally {
      setIsSyncing(false)
    }
  }

  // Generate an AI mix (Mac companion first when configured, Gemini directly otherwise)
  const handleGenerate = async (overridePrompt, overrideSeeds, overrideEnergy, opts = {}) => {
    const activePrompt = (overridePrompt || prompt || '').trim()
    if (!activePrompt || isGenerating) return

    const hasKey = Boolean(getStoredApiKey())
    const hasCompanion = hasMacCompanion()
    if (!hasKey && !hasCompanion) {
      showNotify('Add a Gemini key to make mixes', 'info', { label: 'Add key', onClick: () => navigate('/settings', { params: { section: 'ai' } }) })
      return
    }

    const displayPrompt = opts.displayPrompt || activePrompt
    const token = ++collectionTokenRef.current
    setIsGenerating(true)
    setCollectionLoading(true)
    setPlaylist({ id: `mix_pending_${token}`, kind: 'mix', title: 'Making your mix…', prompt: displayPrompt, tracks: [] })
    if (route.path !== '/collection') navigate('/collection')

    try {
      let data = null
      const curateArgs = {
        mood_prompt: activePrompt,
        energy_level: overrideEnergy ?? energyLevel,
        count: trackCount,
        model_name: selectedModel,
        favorites
      }

      if (hasCompanion) {
        const companionController = new AbortController()
        const companionTimer = setTimeout(() => companionController.abort(), hasKey ? 8000 : 30000)
        try {
          const res = await fetch(`${getApiBase()}/curate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: companionController.signal,
            body: JSON.stringify({
              seed_tracks: overrideSeeds || extractedTracks,
              mood_prompt: activePrompt,
              energy_level: overrideEnergy ?? energyLevel,
              count: trackCount,
              model_name: selectedModel
            })
          })
          const ct = res.headers.get('content-type') || ''
          if (!res.ok || !ct.includes('application/json')) {
            const err = ct.includes('application/json') ? await res.json().catch(() => ({})) : {}
            const backendErr = new Error(err.detail || `Mac companion returned HTTP ${res.status}`)
            backendErr.hasBackendDetail = Boolean(err.detail)
            throw backendErr
          }
          data = await res.json()
        } catch (backendErr) {
          if (hasKey) {
            data = await curateStandalone(curateArgs)
          } else if (backendErr?.hasBackendDetail) {
            throw backendErr
          } else {
            throw new Error('Add a Gemini key in Settings to make mixes')
          }
        } finally {
          clearTimeout(companionTimer)
        }
      } else {
        data = await curateStandalone(curateArgs)
      }

      if (token !== collectionTokenRef.current) return
      const tracks = (data?.tracks || []).filter((t) => t && (t.video_id || t.title))
      if (!tracks.length) {
        throw new Error('No matching songs were returned for that prompt')
      }
      const mix = {
        id: `mix_${Date.now()}`,
        kind: 'mix',
        title: data?.playlist_title || 'Your mix',
        subtitle: data?.subtitle || data?.vibe_description || '',
        prompt: displayPrompt,
        tracks,
        createdAt: Date.now()
      }
      setPlaylist(mix)
      recordMix(mix)
      recordRecent(mix)
      if (tracks.length && (!currentTrack || !isPlaying)) {
        setCurrentTrack(tracks[0])
        setCurrentTrackIdx(0)
      }
    } catch (e) {
      if (token !== collectionTokenRef.current) return
      setPlaylist(null)
      showNotify(`Couldn't make that mix: ${e.message}`, 'error', hasKey ? null : { label: 'Settings', onClick: () => navigate('/settings', { params: { section: 'ai' } }) })
      goBack('/create')
    } finally {
      if (token === collectionTokenRef.current) {
        setIsGenerating(false)
        setCollectionLoading(false)
      } else {
        setIsGenerating(false)
      }
    }
  }

  // Zero-Token Direct YouTube Music Search (Prepared Playlists + Songs)
  const handleDirectSearch = async (overrideQuery, mode = 'auto', autoPlay = false) => {
    const q = (overrideQuery ?? prompt ?? '').trim()
    if (!q || isSearching || isGenerating) return

    setIsSearching(true)

    try {
      let data = null
      if (hasBackend()) {
        try {
          const res = await fetch(
            `${getApiBase()}/direct-search?q=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}`
          )
          const ct = res.headers.get('content-type') || ''
          if (res.ok && ct.includes('application/json')) {
            data = await res.json()
          }
        } catch {}
      }

      if (!data) {
        data = await directSearchStandalone(q, mode)
      }

      setPlaylist(data)
      if (data.tracks && data.tracks.length > 0) {
        if (autoPlay) {
          handlePlayTrack(data.tracks[0], 0, data.tracks)
        } else if (!currentTrack || !isPlaying) {
          setCurrentTrack(data.tracks[0])
          setCurrentTrackIdx(0)
        }
      }
      if (!autoPlay) showNotify(`Found ${data.tracks?.length || 0} songs for "${q}"`, 'info')
    } catch (e) {
      showNotify(`Search failed: ${e.message}`, 'error')
    } finally {
      setIsSearching(false)
    }
  }

  // Initial boot: check Safari and now playing status without auto-pulling tabs into library
  useEffect(() => {
    if (initialBootRef.current) return
    initialBootRef.current = true

    ;(async () => {
      await checkSafari()
      if (playlist?.tracks?.length > 0 && !currentTrack) {
        setCurrentTrack(playlist.tracks[0])
        setCurrentTrackIdx(0)
      }
    })()

    const timer = setInterval(() => {
      if (hasBackend()) {
        checkSafari()
        checkNowPlaying()
      }
    }, 7000)
    return () => clearInterval(timer)
  }, [])

  const handlePromptChange = (val) => {
    setPrompt(val)
  }
  const handleAddSeedTrack = (track) => {
    if (!track || !isValidMusicTrack(track)) {
      showNotify('Only music songs can be added to Seeds', 'warning')
      return
    }
    setExtractedTracks((prev) => {
      const cleanPrev = prev.filter(isValidMusicTrack)
      const exists = cleanPrev.some((t) => t.video_id === track.video_id || (t.title === track.title && t.artist === track.artist))
      if (exists) return cleanPrev
      return [track, ...cleanPrev]
    })
    showNotify(`Added "${track.title}" to Seeds`, 'success')
  }

  const handleAddMultipleSeedTracks = (newTracks) => {
    if (!newTracks || !newTracks.length) return
    const valid = newTracks.filter(isValidMusicTrack)
    if (!valid.length) {
      showNotify('No valid music songs found to import', 'warning')
      return
    }
    setExtractedTracks((prev) => {
      const cleanPrev = prev.filter(isValidMusicTrack)
      const existingIds = new Set(cleanPrev.map((t) => t.video_id).filter(Boolean))
      const toAdd = valid.filter((t) => !existingIds.has(t.video_id))
      return [...toAdd, ...cleanPrev]
    })
    showNotify(`Imported ${valid.length} seed songs from YouTube`, 'success')
  }

  const handleAnalyzeTaste = async () => {
    const list = extractedTracks.length > 0 ? extractedTracks : favorites
    if (!list.length) {
      showNotify('Add some seeds or like songs first to generate a taste profile', 'warning')
      return
    }
    showNotify('Analyzing YouTube musical taste profile...', 'info')
    try {
      let dna = null
      if (hasBackend()) {
        try {
          const res = await fetch(`${getApiBase()}/taste-dna`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: list, model_name: selectedModel })
          })
          if (res.ok) dna = await res.json()
        } catch {}
      }
      if (!dna) {
        dna = await analyzeTasteDnaStandalone(list)
      }
      if (dna) {
        setTasteDna(dna)
        showNotify(`Generated Taste Profile: ${dna.archetype || 'Complete'}`, 'success')
      }
    } catch (err) {
      showNotify(`Analysis failed: ${err.message}`, 'error')
    }
  }
  const blockBase = (block) => ({
    id: `block_${block.id}`,
    kind: block.tier === 1 ? 'chart' : 'foryou',
    title: block.title,
    subtitle: block.subtitle,
    cover: block.thumbnail || ''
  })

  const openBlock = (block) => loadCollection(blockBase(block), () => loadBlockTracks(block))

  const playBlock = async (block, shuffle = false) => {
    try {
      const tracks = ((await loadBlockTracks(block)) || []).filter(isValidMusicTrack)
      if (!tracks.length) return showNotify(`Couldn't load "${block.title}"`, 'error')
      const c = { ...blockBase(block), tracks }
      recordRecent(c)
      playList(tracks, { shuffle, from: { id: c.id, title: c.title } })
    } catch {
      showNotify(`Couldn't load "${block.title}"`, 'error')
    }
  }

  const openSearchPlaylist = (pl) =>
    loadCollection(
      { id: `pl_${pl.browse_id}`, kind: 'playlist', title: pl.title, subtitle: pl.subtitle || '', cover: pl.thumbnail || '' },
      () => browsePlaylistStandalone(pl.browse_id, pl.title, pl.subtitle)
    )

  const openMood = (m) =>
    loadCollection({ id: `mood_${m.id}`, kind: 'playlist', title: m.label, subtitle: 'Mood' }, async () => {
      const res = await directSearchStandalone(m.query, 'playlists')
      return res?.tracks || []
    })

  const startRadio = (track) => {
    if (!track) return
    loadCollection(
      {
        id: `radio_${track.video_id || track.title}`,
        kind: 'radio',
        title: `${track.title} radio`,
        subtitle: `Songs like ${track.title}${track.artist ? ` by ${track.artist}` : ''}`,
        cover: track.thumbnail || ''
      },
      async () => {
        let related = []
        try {
          related = await fetchRelatedCompanionTracks([track], 25)
        } catch {}
        if (related.length < 5) {
          try {
            const r = await directSearchStandalone(`${track.artist || ''} ${track.title} radio`.trim(), 'songs')
            related = [...related, ...(r?.song_results || r?.tracks || [])]
          } catch {}
        }
        return [track, ...related.filter((t) => !sameTrack(t, track))]
      }
    )
  }

  const goToArtist = (name) => {
    if (!name) return
    setIsNowPlayingOpen(false)
    setSearchQuery(name)
    navigate('/search', { params: { q: name } })
  }

  const openRecent = (item) => {
    if (item.kind === 'liked') return navigate('/liked')
    const saved = savedCollections.find((c) => c.id === item.key)
    if (saved) return showCollection(saved)
    if (item.collection) return showCollection(item.collection)
  }

  // ---- search ----------------------------------------------------------
  const searchSeqRef = useRef(0)
  const runSearch = async (raw) => {
    const q = (raw || '').trim()
    if (!q) return
    const seq = ++searchSeqRef.current
    setIsSearching(true)
    try {
      const data = await directSearchStandalone(q, 'songs')
      if (seq === searchSeqRef.current) setSearchResults(data)
    } catch (e) {
      if (seq === searchSeqRef.current) showNotify(`Search failed: ${e.message}`, 'error')
    } finally {
      if (seq === searchSeqRef.current) setIsSearching(false)
    }
  }

  const rememberSearch = (q) => {
    const query = (q || '').trim()
    if (!query) return
    setRecentSearches((prev) => [query, ...prev.filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, 10))
  }

  useEffect(() => {
    if (route.path !== '/search') return
    const q = searchQuery.trim()
    if (!q) return
    const t = setTimeout(() => runSearch(q), 450)
    return () => clearTimeout(t)
  }, [searchQuery, route.path])

  // Keep ?q= in the URL so Back returns to the same results
  useEffect(() => {
    if (route.path !== '/search') return
    if ((route.params.q || '') === searchQuery) return
    const t = setTimeout(() => navigate('/search', { replace: true, params: { q: searchQuery } }), 500)
    return () => clearTimeout(t)
  }, [searchQuery, route.path])

  useEffect(() => {
    if (route.path === '/search' && route.params.q && route.params.q !== searchQuery) setSearchQuery(route.params.q)
  }, [route.path, route.params.q])

  const submitSearch = (q) => {
    const query = (q ?? searchQuery).trim()
    if (!query) return
    rememberSearch(query)
    if (route.path !== '/search') navigate('/search', { params: { q: query } })
    runSearch(query)
  }

  const makeMixFromQuery = (q) => {
    rememberSearch(q)
    handleGenerate(`A mix of songs with the sound and style of: ${q}`, undefined, undefined, { displayPrompt: q })
  }

  // ---- create ------------------------------------------------------------
  const makeFromCreate = () => {
    const p = prompt.trim()
    const parts = []
    if (p) parts.push(p)
    if (createSeed?.type === 'track') parts.push(`Start from the sound of "${createSeed.track.title}" by ${createSeed.track.artist}.`)
    if (createSeed?.type === 'likes' && favorites.length) {
      parts.push(`Inspired by my liked songs: ${favorites.slice(0, 8).map((f) => `"${f.title}" by ${f.artist}`).join(', ')}.`)
    }
    if (discoveryLevel >= 70) parts.push('Favor lesser-known songs and deep cuts I probably have not heard.')
    else if (discoveryLevel <= 30) parts.push('Favor well-known, familiar songs.')
    const display = p || (createSeed?.type === 'likes' ? 'From my liked songs' : createSeed?.track ? `Like ${createSeed.track.title}` : '')
    if (!parts.length) return
    handleGenerate(parts.join(' '), createSeed?.type === 'likes' ? favorites : undefined, energyLevel, { displayPrompt: display })
  }

  const tweakMix = (tweak) => {
    const c = shownCollectionRef.current
    const base = (c?.prompt || '').split(' · ')[0] || c?.title || ''
    if (!base) return
    const energy = tweak === 'More energy' ? Math.min(100, energyLevel + 20) : tweak === 'Calmer' ? Math.max(0, energyLevel - 25) : energyLevel
    handleGenerate(`${base}. Variation: ${tweak.toLowerCase()}.`, undefined, energy, { displayPrompt: `${base} · ${tweak.toLowerCase()}` })
  }
  const shareCollection = async (c) => {
    const lines = (c.tracks || []).slice(0, 15).map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`)
    const text = `${c.title}${c.prompt ? ` (“${c.prompt}”)` : ''}\n\n${lines.join('\n')}\n\nMade with UpBeat`
    try {
      if (navigator.share) {
        await navigator.share({ title: c.title, text })
        return
      }
    } catch {
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showNotify('Tracklist copied', 'success')
    } catch {
      showNotify("Couldn't share right now", 'error')
    }
  }
  // ---- what the collection page shows ---------------------------------------
  const shownCollection = useMemo(() => {
    if (route.path === '/liked') return { id: 'liked', kind: 'liked', title: 'Liked songs', tracks: favorites }
    if (route.path === '/downloads') return { id: 'downloads', kind: 'downloads', title: 'Downloads', tracks: offlineTracks }
    if (!playlist) return null
    const savedUser = savedCollections.find((c) => c.id === playlist.id && c.kind === 'user')
    if (savedUser) return savedUser
    return {
      ...playlist,
      id: playlist.id || `legacy_${playlist.playlist_title || 'playlist'}`,
      kind: playlist.kind || (playlist.is_direct_search ? 'songs' : 'mix'),
      title: playlist.title || playlist.playlist_title || 'Playlist'
    }
  }, [route.path, favorites, offlineTracks, playlist, savedCollections])
  const shownCollectionRef = useRef(null)
  shownCollectionRef.current = shownCollection

  useEffect(() => {
    if (route.path === '/liked' && favorites.length) recordRecent({ id: 'liked', kind: 'liked', title: 'Liked songs' })
  }, [route.path])

  // ---- playback from any screen ---------------------------------------------
  const ctxPlayTrack = (track, list) => {
    const l = Array.isArray(list) && list.length ? list : [track]
    handlePlayTrack(track, l)
    const c = shownCollectionRef.current
    if (['/collection', '/liked', '/downloads'].includes(route.path) && c && l === c.tracks) setPlayingFrom({ id: c.id, title: c.title })
    else if (route.path === '/search') {
      rememberSearch(searchQuery)
      setPlayingFrom({ id: null, title: `Search: ${searchQuery}` })
    } else if (route.path === '/library') setPlayingFrom({ id: null, title: 'Your library' })
    else setPlayingFrom(null)
  }

  const appCtx = {
    currentTrack,
    isPlaying,
    repeatMode,
    isFav: isTrackFavorite,
    downloadedIds,
    playTrack: ctxPlayTrack,
    toggleFav: handleToggleFavorite,
    toggleLoopSong,
    playNext: handlePlayNext,
    addToQueue: handleAddToQueue,
    openAddToPlaylist: (t) => setAddToPlaylistTrack(t),
    download: downloadTrack,
    startRadio: (t) => {
      setIsNowPlayingOpen(false)
      startRadio(t)
    },
    goToArtist
  }

  // ---- navigation helpers -----------------------------------------------------
  const TAB_FOR_PATH = { '/': 'home', '/search': 'search', '/create': 'create', '/library': 'library' }
  const activeTabId = TAB_FOR_PATH[route.path] || lastTabRef.current
  if (TAB_FOR_PATH[route.path]) lastTabRef.current = TAB_FOR_PATH[route.path]

  const selectTab = (tab) => {
    if (route.path === tab.path) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      if (tab.id === 'search') searchInputRef.current?.focus()
      return
    }
    navigate(tab.path, tab.id === 'search' && searchQuery ? { params: { q: searchQuery } } : undefined)
  }

  // Close the topmost layer first; used by Android back
  const closeTopLayer = () => {
    if (nameDialog) {
      setNameDialog(null)
      return true
    }
    if (addToPlaylistTrack) {
      setAddToPlaylistTrack(null)
      return true
    }
    if (isJamModalOpen) {
      setIsJamModalOpen(false)
      return true
    }
    if (showGoogleModal) {
      setShowGoogleModal(false)
      return true
    }
    if (isQueueOpen) {
      setIsQueueOpen(false)
      return true
    }
    if (isNowPlayingOpen) {
      setIsNowPlayingOpen(false)
      return true
    }
    return false
  }

  // Android hardware back: MainActivity calls this before leaving the app
  const backHandlerRef = useRef(null)
  backHandlerRef.current = () => {
    if (closeTopLayer()) return true
    if (route.path !== '/') {
      if (canGoBack()) window.history.back()
      else navigate('/', { replace: true })
      return true
    }
    return false
  }
  useEffect(() => {
    window.UpBeatHandleBack = () => backHandlerRef.current?.() ?? false
    return () => {
      delete window.UpBeatHandleBack
    }
  }, [])

  // Desktop keyboard shortcuts (consolidated: Cmd/Ctrl+B toggles left nav only)
  const keyHandlerRef = useRef(null)
  keyHandlerRef.current = (e) => {
    const tag = (e.target?.tagName || '').toLowerCase()
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (route.path !== '/search') navigate('/search', searchQuery ? { params: { q: searchQuery } } : undefined)
      setTimeout(() => searchInputRef.current?.focus(), 30)
    } else if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      navigate('/create')
    } else if (mod && (e.key.toLowerCase() === 'b' || e.key === '\\')) {
      e.preventDefault()
      setLeftNavOpen((v) => !v)
    } else if (e.key === 'Escape' && !typing) {
      if (isNowPlayingOpen) setIsNowPlayingOpen(false)
      else if (isQueueOpen) setIsQueueOpen(false)
    } else if (e.code === 'Space' && !typing && tag !== 'button' && tag !== 'a' && !mod) {
      e.preventDefault()
      handleTogglePlay()
    } else if (!mod && !typing && tag !== 'button' && tag !== 'a' && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      toggleLoopSong()
    }
  }
  useEffect(() => {
    const onKey = (e) => keyHandlerRef.current?.(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Scroll memory per screen
  const routeKey = `${route.path}?${new URLSearchParams(route.params).toString()}`
  const routeKeyRef = useRef(routeKey)
  useLayoutEffect(() => {
    routeKeyRef.current = routeKey
    const el = scrollRef.current
    if (el) el.scrollTop = scrollMemoryRef.current[routeKey] || 0
  }, [routeKey, isDesktop])
  const onMainScroll = (e) => {
    scrollMemoryRef.current[routeKeyRef.current] = e.currentTarget.scrollTop
  }

  useEffect(() => {
    setIsQueueOpen(false)
  }, [route.path])

  const userTracksForFeed = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const t of [...favorites, ...offlineTracks, ...extractedTracks]) {
      if (!t || !isValidMusicTrack(t)) continue
      const key = t.video_id || `${t.title}::${t.artist}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
    return out
  }, [favorites, offlineTracks, extractedTracks])

  const userPlaylists = savedCollections.filter((c) => c.kind === 'user')
  const friends = jamState?.friends || []

  // ---- first-run setup -------------------------------------------------------
  const DEFAULT_CHART_IDS = ['block_india_top_daily', 'block_india_trendy', 'block_global_top_daily', 'block_us_top_daily']

  const finishOnboarding = async ({ genres = [], artists = [], chartPrefs = [] } = {}, { connect = false } = {}) => {
    setOnboardingBusy(true)
    try {
      saveStorage('upbeat_taste_prefs_v1', { genres, artists, at: Date.now() })
      if (Array.isArray(chartPrefs) && chartPrefs.length) {
        saveStorage('upbeat_chart_prefs_v1', chartPrefs)
      } else {
        saveStorage('upbeat_chart_prefs_v1', DEFAULT_CHART_IDS)
      }
      try {
        sessionStorage.removeItem('upbeat_discovery_feed_cache_v7')
        sessionStorage.removeItem('upbeat_discovery_blocks_v632')
      } catch {}
      const picks = artists.slice(0, 8)
      const results = await Promise.all(
        picks.map((a) =>
          directSearchStandalone(a, 'songs')
            .then((r) => (r?.song_results?.length ? r.song_results : r?.tracks || []).filter(isValidMusicTrack).slice(0, 3))
            .catch(() => [])
        )
      )
      const seeds = results.flat()
      if (seeds.length) {
        setExtractedTracks((prev) => {
          const seen = new Set(prev.map((t) => t.video_id))
          return [...seeds.filter((t) => t.video_id && !seen.has(t.video_id)), ...prev]
        })
      }
      showNotify(seeds.length ? 'Home & charts are tuned to your picks' : 'You’re all set', 'success')
    } finally {
      try {
        localStorage.setItem('upbeat_onboarded_v1', '1')
      } catch {}
      setOnboardingBusy(false)
      setShowOnboarding(false)
      setOnboardingVersion((v) => v + 1)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('upbeat-onboarding-finished'))
      }
      navigate('/', { replace: true })
      if (connect) setShowGoogleModal(true)
    }
  }

  const skipOnboarding = () => {
    try {
      localStorage.setItem('upbeat_onboarded_v1', '1')
      if (!localStorage.getItem('upbeat_chart_prefs_v1')) {
        localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(DEFAULT_CHART_IDS))
      }
      sessionStorage.removeItem('upbeat_discovery_feed_cache_v7')
      sessionStorage.removeItem('upbeat_discovery_blocks_v632')
    } catch {}
    setShowOnboarding(false)
    setOnboardingVersion((v) => v + 1)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('upbeat-onboarding-finished'))
    }
  }

  // ---- screens ------------------------------------------------------------
  const renderView = () => {
    switch (route.path) {
      case '/search':
        return (
          <SearchView
            isDesktop={isDesktop}
            query={searchQuery}
            setQuery={setSearchQuery}
            results={searchResults}
            searching={isSearching}
            recentSearches={recentSearches}
            onClearRecent={() => setRecentSearches([])}
            onSubmit={submitSearch}
            onMakeMix={makeMixFromQuery}
            onOpenPlaylist={openSearchPlaylist}
            onMood={openMood}
          />
        )
      case '/create':
        return (
          <CreateView
            isDesktop={isDesktop}
            prompt={prompt}
            setPrompt={handlePromptChange}
            energy={energyLevel}
            setEnergy={setEnergyLevel}
            discovery={discoveryLevel}
            setDiscovery={setDiscoveryLevel}
            length={trackCount}
            setLength={setTrackCount}
            seed={createSeed}
            setSeed={setCreateSeed}
            currentTrack={currentTrack}
            likesCount={favorites.length}
            needsKey={!getStoredApiKey() && !hasMacCompanion()}
            busy={isGenerating}
            recentMixes={recentMixes}
            onMake={makeFromCreate}
            onOpenMix={(m) => showCollection(savedCollections.find((c) => c.id === m.id) || m)}
            onOpenSettings={() => navigate('/settings', { params: { section: 'ai' } })}
          />
        )
      case '/library':
        return (
          <LibraryView
            isDesktop={isDesktop}
            filter={route.params.f || 'playlists'}
            setFilter={(f) => navigate('/library', { replace: true, params: { f } })}
            favorites={favorites}
            offlineTracks={offlineTracks}
            offlineStats={offlineStats}
            saved={savedCollections}
            history={playHistory}
            downloadedIds={downloadedIds}
            onOpenSaved={(c) => showCollection(c)}
            onOpenLiked={() => navigate('/liked')}
            onOpenDownloads={() => navigate('/downloads')}
            onNewPlaylist={() => setNameDialog({ mode: 'create' })}
            onDeleteDownload={deleteDownload}
            onGoToArtist={goToArtist}
          />
        )
      case '/collection':
      case '/liked':
      case '/downloads': {
        const c = shownCollection
        const isUser = c?.kind === 'user'
        const isMix = c?.kind === 'mix'
        const job = c ? downloadJobs[c.id] : null
        const allDone = Boolean(c?.tracks?.length) && c.tracks.every((t) => t.video_id && downloadedIds.has(t.video_id))
        return (
          <CollectionView
            collection={c}
            loading={collectionLoading && route.path === '/collection'}
            loadingLabel={isMix ? 'Picking songs that fit…' : 'Loading songs…'}
            isDesktop={isDesktop}
            isSaved={c ? isSavedId(c.id) : false}
            canSave={Boolean(c) && !['liked', 'downloads', 'user'].includes(c.kind)}
            onToggleSave={() => toggleSave(c)}
            onPlay={(shuffle) => playList(c?.tracks, { shuffle, from: c ? { id: c.id, title: c.title } : null })}
            onDownloadAll={c?.kind === 'downloads' ? null : () => downloadAll(c)}
            downloadState={{ busy: job?.busy, done: job?.done, total: job?.total, allDone }}
            onShare={() => shareCollection(c)}
            onStartJam={() => startJamWith(c)}
            onTweak={isMix ? tweakMix : null}
            onEditPrompt={
              isMix
                ? () => {
                    setPrompt((c.prompt || '').split(' · ')[0])
                    navigate('/create')
                  }
                : null
            }
            onBack={() => goBack(lastTabRef.current === 'home' ? '/' : `/${lastTabRef.current}`)}
            moreItems={
              isUser
                ? [
                    { label: 'Rename', icon: Pencil, onClick: () => setNameDialog({ mode: 'rename', id: c.id, initial: c.title }) },
                    { label: 'Delete playlist', icon: Trash2, danger: true, onClick: () => deletePlaylist(c) }
                  ]
                : []
            }
            trackMenuExtra={isUser ? (t, i) => [{ label: 'Remove from this playlist', icon: Trash2, danger: true, onClick: () => removeFromPlaylist(c.id, i) }] : null}
          />
        )
      }
      case '/settings':
        return (
          <SettingsView
            isDesktop={isDesktop}
            onBack={() => goBack('/')}
            crossfade={crossfadeSec}
            setCrossfade={setCrossfadeSec}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            googleUser={googleUser}
            onOpenGoogle={() => setShowGoogleModal(true)}
            onLogout={handleGoogleLogout}
            onOpenProfileEdit={() => setIsProfileEditOpen(true)}
            offlineStats={offlineStats}
            onClearDownloads={clearDownloads}
            playbackMode={playbackMode}
            setPlaybackMode={hasBackend() && !isNativeApp() ? setPlaybackMode : null}
            onRedoSetup={() => setShowOnboarding(true)}
            notify={showNotify}
          />
        )
      case '/you':
      case '/you/sources':
        return (
          <div className={`w-full ${isDesktop ? 'ub-under-topbar' : ''}`}>
            {!isDesktop && (
              <PageHeader
                title=""
                onBack={() => goBack('/')}
                actions={
                  <>
                    <IconButton label="Friends" variant="filled" size={40} onClick={openFriends}>
                      <Users className="w-5 h-5" />
                    </IconButton>
                    <IconButton label="Settings" variant="filled" size={40} onClick={() => navigate('/settings')}>
                      <Settings className="w-5 h-5" />
                    </IconButton>
                  </>
                }
              />
            )}
            <SonicDnaView
              mode={route.path === '/you/sources' ? 'library' : 'dna'}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              tasteDna={tasteDna}
              extractedTracks={extractedTracks}
              favorites={favorites}
              isTrackFavorite={isTrackFavorite}
              onToggleFavorite={handleToggleFavorite}
              onSyncFavorites={handleSyncFavorites}
              onCurateFromFavorites={handleSyncFavorites}
              onSyncSafari={() => handleSyncSafari(false)}
              isSyncing={isSyncing}
              onPlayTrack={handlePlayTrack}
              onPushToSafari={handlePushToSafari}
              onPlayNext={handlePlayNext}
              onAddToQueue={handleAddToQueue}
              onAddSeedTrack={handleAddSeedTrack}
              onAddMultipleSeedTracks={handleAddMultipleSeedTracks}
              onAnalyzeTaste={handleAnalyzeTaste}
              hasBackend={hasBackend()}
              googleUser={googleUser}
              onOpenGoogleModal={() => setShowGoogleModal(true)}
              onSyncYouTubeLikes={() => handleSyncGoogleYouTubeLikes()}
              isSyncingLikes={isSyncingLikes}
              onClearSeeds={() => {
                const before = extractedTracks
                setExtractedTracks([])
                showNotify('Taste sources cleared', 'info', { label: 'Undo', onClick: () => setExtractedTracks(before) })
              }}
              onResetTasteDna={() => {
                setTasteDna(null)
                try {
                  localStorage.removeItem('argon_dna_v2')
                } catch {}
                showNotify('Taste profile reset', 'info')
              }}
              onCurateSimilar={(track) => startRadio(track)}
            />
          </div>
        )
      default:
        return (
          <HomeView
            isDesktop={isDesktop}
            user={googleUser}
            userTracks={userTracksForFeed}
            tasteDna={tasteDna}
            timeInfo={themeInfo}
            recents={recents}
            friends={friends}
            incomingCount={jamState?.incomingRequests?.length || 0}
            jamActive={Boolean(jamState?.active)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onboardingVersion={onboardingVersion}
            onOpenProfile={() => setIsProfileEditOpen(true)}
            onOpenFriends={openFriends}
            onOpenSettings={() => navigate('/settings')}
            onOpenRecent={openRecent}
            onOpenBlock={openBlock}
            onPlayBlock={playBlock}
            onMood={openMood}
            onPlayTrack={handlePlayTrack}
            onListenAlong={listenAlong}
          />
        )
    }
  }

  const hasTrack = Boolean(currentTrack)
  const toastBottom = isDesktop ? 104 : `calc(${hasTrack ? 140 : 76}px + var(--sab))`
  const topInset = isNativeApp() ? 'max(var(--sat), 26px)' : 'var(--sat)'

  return (
    <AppContext.Provider value={appCtx}>
      <div className="h-[100dvh] w-screen bg-bg text-t1 flex flex-col overflow-hidden">
        {isDesktop ? (
          <div className="flex-1 min-h-0 flex p-2 pb-0 bg-black relative">
            {/* Collapsible Left SideNav with smooth slide transition */}
            <div
              className={`shrink-0 flex flex-col min-h-0 overflow-hidden ${
                isDraggingLeftNav ? '' : 'transition-all duration-300 ease-out'
              } ${leftNavOpen ? 'opacity-100' : 'w-0 opacity-0 pointer-events-none'}`}
              style={{ width: leftNavOpen ? leftNavWidth : 0 }}
            >
              <SideNav
                activeTab={activeTabId}
                onSelect={selectTab}
                saved={savedCollections}
                favoritesCount={favorites.length}
                downloadsCount={offlineStats.count}
                activeCollectionId={['/collection', '/liked', '/downloads'].includes(route.path) ? shownCollection?.id : null}
                playingCollectionId={playingFrom?.id}
                onOpenSaved={(c) => showCollection(c)}
                onOpenLiked={() => navigate('/liked')}
                onOpenDownloads={() => navigate('/downloads')}
                onNewPlaylist={() => setNameDialog({ mode: 'create' })}
                libFilter={sideLibFilter}
                setLibFilter={setSideLibFilter}
                onCollapseSidebar={() => setLeftNavOpen(false)}
              />
            </div>

            {/* Interactive Vertical Slider Handle (Drag to resize/close or click to slide open/shut) */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={leftNavOpen ? 'Slide or click to close sidebar' : 'Slide or click to open sidebar'}
              title={leftNavOpen ? 'Drag or click slider to close sidebar (⌘B)' : 'Drag or click slider to open sidebar (⌘B)'}
              onMouseDown={handleStartLeftNavSlider}
              className={`shrink-0 z-30 flex items-center justify-center group select-none cursor-col-resize ${
                leftNavOpen ? 'w-3 mx-0.5' : 'w-3.5 mr-1'
              }`}
            >
              <div
                className={` rounded-full transition-all duration-200 flex items-center justify-center ${
                  isDraggingLeftNav
                    ? 'w-1.5 h-24 bg-accent shadow-[0_0_12px_rgba(56,189,248,0.6)]'
                    : leftNavOpen
                      ? 'w-1.5 h-14 bg-white/15 group-hover:bg-accent group-hover:h-20'
                      : 'w-1.5 h-20 bg-white/30 group-hover:bg-accent group-hover:h-24 shadow-md'
                }`}
              />
            </div>

            <main ref={scrollRef} onScroll={onMainScroll} className="flex-1 min-w-0 rounded-[14px] bg-bg ub-ambient-surface overflow-y-auto overflow-x-hidden">
              <div
                className="sticky top-0 z-20 backdrop-blur-md transition-colors duration-700"
                style={{
                  background: currentTrack
                    ? 'color-mix(in srgb, var(--song-primary, #0A0A0B) 5%, rgba(10,10,11,0.92))'
                    : 'rgba(10,10,11,0.94)',
                }}
              >
                <TopBar
                  query={searchQuery}
                  setQuery={(v) => {
                    setSearchQuery(v)
                    if (route.path !== '/search' && v.trim()) navigate('/search', { params: { q: v } })
                  }}
                  onSearchFocus={() => {
                    if (route.path !== '/search') navigate('/search', searchQuery ? { params: { q: searchQuery } } : undefined)
                  }}
                  onSearchSubmit={submitSearch}
                  searchInputRef={searchInputRef}
                  user={googleUser}
                  onOpenProfile={() => setIsProfileEditOpen(true)}
                  onOpenSettings={() => navigate('/settings')}
                  friends={friends}
                  incomingCount={jamState?.incomingRequests?.length || 0}
                  jamActive={Boolean(jamState?.active)}
                  onOpenFriends={openFriends}
                  sidebarOpen={leftNavOpen}
                  onToggleSidebar={() => setLeftNavOpen((v) => !v)}
                />
              </div>
              <Suspense fallback={<div className="p-8 text-t2 text-sm">Loading…</div>}>
                {renderView()}
              </Suspense>
            </main>
            {rightPanelOpen && (currentTrack || friends.length > 0) && (
              <RightPanel
                track={currentTrack}
                contextTitle={playingFrom?.title}
                upNext={upNext}
                queueCount={queue.length}
                friends={friends}
                tab={rightTab}
                setTab={setRightTab}
                isFav={currentTrack ? isTrackFavorite(currentTrack) : false}
                onToggleFav={() => currentTrack && handleToggleFavorite(currentTrack)}
                onClose={() => setRightPanelOpen(false)}
                onOpenLyrics={() => window.dispatchEvent(new Event('upbeat-open-lyrics'))}
                onListenAlong={listenAlong}
                onOpenFriends={openFriends}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col" style={{ paddingTop: topInset }}>
            <main ref={scrollRef} onScroll={onMainScroll} className="flex-1 min-h-0 ub-ambient-surface overflow-y-auto overflow-x-hidden overscroll-contain">
              <Suspense fallback={<div className="p-8 text-t2 text-sm">Loading…</div>}>
                {renderView()}
              </Suspense>
            </main>
          </div>
        )}

        {/* No z-index here: the full-screen player inside must be able to cover the tab bar */}
        <div className="relative shrink-0">
          {!isDesktop && jamState?.active && (
            <button
              type="button"
              onClick={() => setIsJamModalOpen(true)}
              className="absolute left-3.5 -top-9 h-7 pl-2.5 pr-3 rounded-full bg-live text-[#04130D] text-[13px] font-bold flex items-center gap-1.5 shadow-lg cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              Jam · {jamState.participants?.length || 1} listening
            </button>
          )}
          <PlayerBar
            isDesktop={isDesktop}
            upNextTrack={upNext[0] || null}
            playingFromTitle={playingFrom?.title}
            rightPanelOpen={rightPanelOpen}
            onToggleRightPanel={() => {
              setRightTab('next')
              setRightPanelOpen((o) => !o || rightTab !== 'next')
            }}
            jamActive={Boolean(jamState?.active)}
            onOpenJam={() => setIsJamModalOpen(true)}
            onGoToArtist={goToArtist}
            onStartRadio={(t) => {
              setIsNowPlayingOpen(false)
              startRadio(t)
            }}
            onAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            onTogglePlay={handleTogglePlay}
            onNext={handleNext}
            onPrev={handlePrev}
            playbackMode={playbackMode}
            setPlaybackMode={setPlaybackMode}
            onPushToSafari={handlePushToSafari}
            safariNowPlaying={safariNowPlaying}
            onSafariControl={handleSafariControl}
            onTrackResolved={handleTrackResolved}
            isTrackFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavorite}
            onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
            queueCount={queue.length}
            isQueueOpen={isQueueOpen}
            isNowPlayingOpen={isNowPlayingOpen}
            setIsNowPlayingOpen={setIsNowPlayingOpen}
            crossfadeSec={crossfadeSec}
            setCrossfadeSec={setCrossfadeSec}
            isShuffle={isShuffle}
            setIsShuffle={setIsShuffle}
            onToggleShuffle={handleToggleShuffle}
            repeatMode={repeatMode}
            setRepeatMode={setRepeatMode}
            onCycleRepeat={cycleRepeatMode}
            onToggleLoopSong={toggleLoopSong}
            onUserSeek={handleUserSeek}
          />
        </div>

        {!isDesktop && <TabBar activeTab={activeTabId} onSelect={selectTab} />}

        <Toast
          notification={notification}
          bottomOffset={toastBottom}
          onAction={() => {
            notification?.action?.onClick?.()
            setNotification(null)
          }}
        />

        {/* Jam invite banner (the old draggable widget is replaced by the Jam pill / player button) */}
        <JamFloatingBar
          jamState={jamState}
          reactions={jamReactions}
          googleUser={googleUser}
          onOpenJamModal={() => setIsJamModalOpen(true)}
          hideWidget
        />

        {isJamModalOpen && (
          <Suspense fallback={null}>
            <JamModal
          isOpen={isJamModalOpen}
          onClose={() => {
            setIsJamModalOpen(false)
            setInitialJamCode('')
            setInitialFriendCode('')
            setInitialJamSection('')
          }}
          jamState={jamState}
          googleUser={googleUser}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          initialJoinCode={initialJamCode}
          initialFriendCode={initialFriendCode}
          initialSection={initialJamSection}
          onPlayTrack={handlePlayTrack}
          onNotify={(msg, type) => showNotify(msg, type || 'info')}
            />
          </Suspense>
        )}

        {isQueueOpen && (
          <Suspense fallback={null}>
            <QueueDrawer
          isOpen={isQueueOpen}
          onClose={() => setIsQueueOpen(false)}
          queue={queue}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onPlayTrack={(track, queueIdx) => {
            const ctxList = activePlaybackContext?.length
              ? activePlaybackContext
              : (playlist?.tracks?.length ? playlist.tracks : [track])
            if (typeof queueIdx === 'number') {
              setQueue((prev) => prev.filter((_, i) => i !== queueIdx))
              const idxInCtx = ctxList.findIndex((t) => sameTrack(t, track))
              handlePlayTrack(track, idxInCtx >= 0 ? idxInCtx : currentTrackIdx, ctxList)
              return
            }
            const idxInCtx = ctxList.findIndex((t) => sameTrack(t, track))
            handlePlayTrack(track, idxInCtx >= 0 ? idxInCtx : 0, ctxList)
          }}
          onRemoveFromQueue={handleRemoveFromQueue}
          onClearQueue={handleClearQueue}
          onAddToQueue={handleAddToQueue}
          upcomingTracks={upNext.slice(queue.length)}
            />
          </Suspense>
        )}

        {showGoogleModal && (
          <Suspense fallback={null}>
            <GoogleAuthModal
          isOpen={showGoogleModal}
          onClose={() => setShowGoogleModal(false)}
          googleUser={googleUser}
          onLogin={handleGoogleLogin}
          onLogout={handleGoogleLogout}
          onSyncYouTubeLikes={() => handleSyncGoogleYouTubeLikes()}
          isSyncingLikes={isSyncingLikes}
            />
          </Suspense>
        )}

        {isProfileEditOpen && (
          <Suspense fallback={null}>
            <ProfileEditModal
          isOpen={isProfileEditOpen}
          onClose={() => setIsProfileEditOpen(false)}
          user={googleUser}
          onSave={handleSaveProfile}
          onNotify={showNotify}
            />
          </Suspense>
        )}

        {showOnboarding && (
          <Suspense fallback={null}>
            <Onboarding
            busy={onboardingBusy}
            onSkip={skipOnboarding}
            onFinish={(picks) => finishOnboarding(picks)}
            onConnect={(picks) => finishOnboarding(picks, { connect: true })}
            />
          </Suspense>
        )}

        <AddToPlaylistSheet
          open={Boolean(addToPlaylistTrack)}
          track={addToPlaylistTrack}
          playlists={userPlaylists}
          onClose={() => setAddToPlaylistTrack(null)}
          onPick={(pl) => {
            addTrackToPlaylist(pl, addToPlaylistTrack)
            setAddToPlaylistTrack(null)
          }}
          onCreate={() => {
            setNameDialog({ mode: 'create', pendingTrack: addToPlaylistTrack })
            setAddToPlaylistTrack(null)
          }}
        />

        <NameDialog
          open={Boolean(nameDialog)}
          title={nameDialog?.mode === 'rename' ? 'Rename playlist' : 'New playlist'}
          confirmLabel={nameDialog?.mode === 'rename' ? 'Save' : 'Create'}
          initial={nameDialog?.initial || ''}
          onClose={() => setNameDialog(null)}
          onConfirm={(name) => {
            if (nameDialog?.mode === 'rename') {
              setSavedCollections((list) => list.map((c) => (c.id === nameDialog.id ? { ...c, title: name } : c)))
            } else {
              createPlaylist(name, nameDialog?.pendingTrack)
            }
            setNameDialog(null)
          }}
        />

        {showIosInstallPrompt && (
          <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-6 sm:top-5 z-50">
            <div className="bg-s2 ring-1 ring-white/10 rounded-2xl p-3 shadow-2xl flex items-center justify-between gap-3 max-w-md mx-auto">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-s3 flex items-center justify-center shrink-0">
                  <Share className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold">Install UpBeat</div>
                  <div className="text-[13px] text-t2 leading-snug">Tap Share, then “Add to Home Screen” for full-screen playback.</div>
                </div>
              </div>
              <IconButton
                label="Dismiss"
                size={36}
                onClick={() => {
                  setShowIosInstallPrompt(false)
                  try {
                    localStorage.setItem('upbeat_pwa_prompt_dismissed', '1')
                  } catch {}
                }}
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          </div>
        )}

        {otaUpdate && (
          <div className="fixed left-3 right-3 sm:left-auto sm:right-6 z-50" style={{ bottom: isDesktop ? 104 : `calc(${hasTrack ? 148 : 84}px + var(--sab))` }}>
            <div className="bg-s2 ring-1 ring-white/10 rounded-2xl p-3 shadow-2xl flex items-center justify-between gap-3 max-w-md mx-auto">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-accent text-on-accent flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold">Update ready · {otaUpdate.latestVersion}</div>
                  <div className="text-[13px] text-t2 truncate">{isApplyingOta ? 'Installing…' : 'Takes a few seconds. No reinstall.'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    setIsApplyingOta(true)
                    try {
                      await otaUpdate.autoApply()
                    } catch (e) {
                      setIsApplyingOta(false)
                      showNotify('Update failed: ' + (e?.message || 'check your connection'), 'error')
                    }
                  }}
                  disabled={isApplyingOta}
                  className="h-9 px-4 rounded-full bg-t1 text-[#0A0A0B] text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isApplyingOta && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isApplyingOta ? 'Updating' : 'Update'}
                </button>
                <IconButton label="Later" size={36} onClick={() => setOtaUpdate(null)}>
                  <X className="w-4 h-4" />
                </IconButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppContext.Provider>
  )
}
