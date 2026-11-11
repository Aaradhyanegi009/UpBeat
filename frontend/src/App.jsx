import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { Sparkles, Loader2, X, Share, Users, Settings, Trash2, Pencil } from 'lucide-react'
import SonicDnaView from './components/SonicDnaView'
import PlayerBar from './components/PlayerBar'
import QueueDrawer from './components/QueueDrawer'
import GoogleAuthModal from './components/GoogleAuthModal'
import JamModal from './components/JamModal'
import JamFloatingBar from './components/JamFloatingBar'
import {
  jamManager,
  evaluateAudioDrift,
  normalizeRoomCode,
  normalizeFriendCode,
  extractDeepLinkParams,
  renderEmoji
} from './jamEngine'
import { getOfflineTracks, getOfflineStorageStats, subscribeOfflineChanges, saveTrackOffline, deleteOfflineTrack, clearAllOfflineTracks } from './offlineStorage'
import { useRoute, navigate, goBack, canGoBack, useMediaQuery } from './ui/router'
import { AppContext, sameTrack } from './ui/AppContext'
import { TabBar, SideNav, TopBar, TABS } from './ui/Shell'
import { RightPanel, AddToPlaylistSheet, NameDialog, Toast } from './ui/Panels'
import { PageHeader, IconButton } from './ui/primitives'
import HomeView from './views/HomeView'
import SearchView from './views/SearchView'
import CreateView from './views/CreateView'
import CollectionView from './views/CollectionView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/SettingsView'
import Onboarding from './views/Onboarding'
import ProfileEditModal from './components/ProfileEditModal'
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
  formatDurationSeconds,
  openExternalUrl,
  fisherYatesShuffle,
  loadBlockTracks,
  isValidMusicTrack
} from './standaloneApi'

const DEFAULT_SEEDS = []

// Keep stored track snapshots small.
function slimTrack(t) {
  if (!t) return t
  const { title, artist, video_id, duration_text, thumbnail, url } = t
  return { title, artist, video_id, duration_text, thumbnail, url }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

// The Mac app serves this UI from its companion server on :8000; other devices can point at it in Settings.
function hasMacCompanion() {
  try {
    return Boolean(getStoredServerUrl()) || (!isNativeApp() && window.location.port === '8000')
  } catch {
    return false
  }
}

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export default function App() {
  // Dark only. Song-artwork colours are applied by the player separately.
  const themeInfo = getThemeInfo()

  useEffect(() => {
    applyThemeToDocument()
  }, [])

  // Boot music sanitizer: Purge non-music videos (gameplay, vlogs, tutorial) from localStorage
  useEffect(() => {
    try {
      const favKeys = ['argon_favs_v2', 'argon_favorites_v2']
      for (const k of favKeys) {
        const raw = localStorage.getItem(k)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            const clean = parsed.filter(isValidMusicTrack)
            if (clean.length !== parsed.length) {
              localStorage.setItem(k, JSON.stringify(clean))
              if (k === 'argon_favs_v2') setFavorites(clean)
            }
          }
        }
      }

      const seedKeys = ['argon_seeds_v2', 'argon_extracted_v2', 'upbeat_extracted_tracks_v1']
      for (const k of seedKeys) {
        const raw = localStorage.getItem(k)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            const clean = parsed.filter(isValidMusicTrack)
            if (clean.length !== parsed.length) {
              localStorage.setItem(k, JSON.stringify(clean))
              if (k === 'argon_seeds_v2') setExtractedTracks(clean)
            }
          }
        }
      }

      const rawPl = localStorage.getItem('argon_playlist_v2')
      if (rawPl) {
        const parsedPl = JSON.parse(rawPl)
        if (parsedPl?.tracks && Array.isArray(parsedPl.tracks)) {
          const cleanTracks = parsedPl.tracks.filter(isValidMusicTrack)
          if (cleanTracks.length !== parsedPl.tracks.length) {
            parsedPl.tracks = cleanTracks
            localStorage.setItem('argon_playlist_v2', JSON.stringify(parsedPl))
            setPlaylist(parsedPl)
          }
        }
      }
    } catch (e) {
      console.warn('Boot music sanitizer error:', e)
    }
  }, [])

  const [models] = useState([
    { id: 'gemini-4-argon', name: 'Gemini 4 Argon (⚡ 1s Fastest)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Active)' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (2s Fast)' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Active)' },
    { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite Latest' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash Preview' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B MoE' }
  ])
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('argon_selected_model') || 'gemini-4-argon'
  })

  const handleSelectModel = (modelId) => {
    setSelectedModel(modelId)
    try {
      localStorage.setItem('argon_selected_model', modelId)
    } catch {}
  }
  const [safariStatus, setSafariStatus] = useState(null)
  const [safariNowPlaying, setSafariNowPlaying] = useState(null)
  const [extractedTracks, setExtractedTracks] = useState(() => {
    // New users start with no taste sources (onboarding fills them); never the developer's demo seeds
    const raw = loadStorage('argon_seeds_v2', [])
    const animeIds = new Set(['F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE', 'CXDUXjsU5ao', 'MM8RufZr5lw', '2ZN-zAKIfyQ', 'tdzsOODJiX8', 'TCd6PfxOy0Y', 'QpxFcMYRV08'])
    return (raw || []).filter((t) => !animeIds.has(t?.video_id))
  })
  const [favorites, setFavorites] = useState(() => {
    const raw = loadStorage('argon_favs_v2', [])
    const animeIds = new Set(['F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE', 'CXDUXjsU5ao', 'MM8RufZr5lw', '2ZN-zAKIfyQ', 'tdzsOODJiX8', 'TCd6PfxOy0Y', 'QpxFcMYRV08'])
    return (raw || []).filter((t) => !animeIds.has(t?.video_id))
  })
  const [tasteDna, setTasteDna] = useState(() => {
    const raw = loadStorage('argon_dna_v2', null)
    if (raw) {
      const isAnime = /anime|j-pop|j-rock|monogatari|sawano|higuchi/i.test(
        `${raw.archetype || ''} ${raw.summary || ''} ${(raw.primary_genres || []).join(' ')}`
      )
      if (isAnime) return null
    }
    return raw
  })
  const [playlist, setPlaylist] = useState(() => loadStorage('argon_playlist_v2', null))
  const [currentTrack, setCurrentTrack] = useState(null)
  const [currentTrackIdx, setCurrentTrackIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackMode, setPlaybackMode] = useState('app')
  const [prompt, setPrompt] = useState('')
  const [activePresetId, setActivePresetId] = useState(null)
  const [energyLevel, setEnergyLevel] = useState(60)
  const [discoveryLevel, setDiscoveryLevel] = useState(50)
  const [trackCount, setTrackCount] = useState(20)
  const [createSeed, setCreateSeed] = useState(null)
  const [crossfadeSec, setCrossfadeSecState] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_crossfade_sec')
      return saved !== null ? Math.max(0, Math.min(12, parseInt(saved, 10) || 0)) : 5
    } catch {
      return 5
    }
  })
  const setCrossfadeSec = (val) => {
    const clean = Math.max(0, Math.min(12, Math.round(Number(val) || 0)))
    setCrossfadeSecState(clean)
    try {
      localStorage.setItem('upbeat_crossfade_sec', String(clean))
    } catch {}
  }
  const [activeTab, setActiveTab] = useState('curator')
  const [searchMode, setSearchMode] = useState('direct')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingPlaylistBrowse, setIsLoadingPlaylistBrowse] = useState(false)
  const [isResolvingBatch, setIsResolvingBatch] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return true
  })
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [notification, setNotification] = useState(null)
  const notifyTimerRef = useRef(null)
  const showNotify = useCallback((msg, type = 'info', action = null) => {
    setNotification({ msg, type, action, id: Date.now() })
    clearTimeout(notifyTimerRef.current)
    notifyTimerRef.current = setTimeout(() => setNotification(null), action ? 5000 : 3200)
  }, [])
  const [offlineTracks, setOfflineTracks] = useState([])
  const [offlineStats, setOfflineStats] = useState({ count: 0, totalBytes: 0, formattedSize: '0 B' })
  const [activePlaybackContext, setActivePlaybackContext] = useState(null)
  const [queue, setQueue] = useState(() => loadStorage('upbeat_playback_queue', []))
  const [isShuffle, setIsShuffle] = useState(false)
  const originalQueueRef = useRef(null)
  const originalContextRef = useRef(null)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [googleUser, setGoogleUser] = useState(() => {
    const user = loadStorage('upbeat_google_user', null)
    // Clear out any hardcoded personal developer account or stale profile
    if (user) {
      const userEmail = (user.email || '').toLowerCase()
      const userName = (user.name || '').toLowerCase()
      if (userEmail.includes('negi') || userEmail.includes('divyansh') || userName.includes('negi') || userName.includes('divyansh')) {
        try {
          localStorage.removeItem('upbeat_google_user')
          localStorage.removeItem('upbeat_last_google_email')
          localStorage.removeItem('upbeat_last_google_name')
        } catch {}
        return null
      }
    }
    if (user && user.picture && user.picture.includes('yt3.ggpht.com/ZHW03BCR5_1wypqdYcayGib5T')) {
      const sanitized = { ...user, picture: '' }
      try {
        localStorage.setItem('upbeat_google_user', JSON.stringify(sanitized))
      } catch {}
      return sanitized
    }
    return user
  })
  const [showGoogleModal, setShowGoogleModal] = useState(false)
  const [isProfileEditOpen, setIsProfileEditOpen] = useState(false)
  const [isSyncingLikes, setIsSyncingLikes] = useState(false)
  const [otaUpdate, setOtaUpdate] = useState(null)
  const [isApplyingOta, setIsApplyingOta] = useState(false)
  const [showIosInstallPrompt, setShowIosInstallPrompt] = useState(false)

  const handleSaveProfile = (updatedProfile) => {
    const profileWithFlag = {
      ...updatedProfile,
      customPicture: Boolean(updatedProfile.picture)
    }
    setGoogleUser(profileWithFlag)
    try {
      localStorage.setItem('upbeat_google_user', JSON.stringify(profileWithFlag))
      localStorage.setItem(
        'upbeat_jam_profile',
        JSON.stringify({
          name: profileWithFlag.name,
          picture: profileWithFlag.picture,
          avatar: '🎧'
        })
      )
    } catch {}
    if (hasBackend()) {
      fetch(`${getApiBase()}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileWithFlag)
      }).catch(() => {})
    }
    jamManager.refreshProfile(profileWithFlag)
    jamManager.broadcastPresenceStatus()
    showNotify('Profile updated', 'success')
  }

  // ---- v8 shell state -------------------------------------------------
  const route = useRoute()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [leftNavOpen, setLeftNavOpen] = useState(() => loadStorage('upbeat_left_nav_open_v1', true))
  const [leftNavWidth, setLeftNavWidth] = useState(() => {
    const w = Number(loadStorage('upbeat_left_nav_width_v1', 280))
    return w >= 210 && w <= 380 ? w : 280
  })
  const [isDraggingLeftNav, setIsDraggingLeftNav] = useState(false)

  useEffect(() => saveStorage('upbeat_left_nav_open_v1', leftNavOpen), [leftNavOpen])
  useEffect(() => saveStorage('upbeat_left_nav_width_v1', leftNavWidth), [leftNavWidth])

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
      if (!moved) {
        setLeftNavOpen((v) => !v)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [leftNavOpen, leftNavWidth])
  const [searchQuery, setSearchQuery] = useState(() => route.params?.q || '')
  const [searchResults, setSearchResults] = useState(null)
  const [recentSearches, setRecentSearches] = useState(() => loadStorage('upbeat_recent_searches_v1', []))
  const [savedCollections, setSavedCollections] = useState(() => loadStorage('upbeat_library_v1', []))
  const [recentMixes, setRecentMixes] = useState(() => loadStorage('upbeat_mixes_v1', []))
  const [playHistory, setPlayHistory] = useState(() => loadStorage('upbeat_history_v1', []))
  const [recents, setRecents] = useState(() => loadStorage('upbeat_recents_v1', []))
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [playingFrom, setPlayingFrom] = useState(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(() => loadStorage('upbeat_right_panel_v1', true))
  const [rightTab, setRightTab] = useState('next')
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState(null)
  const [nameDialog, setNameDialog] = useState(null) // { mode: 'create' | 'rename', id?, initial?, pendingTrack? }
  const [downloadJobs, setDownloadJobs] = useState({}) // collectionId -> { busy, done, total }
  const [sideLibFilter, setSideLibFilter] = useState('all')
  const collectionTokenRef = useRef(0)
  const lastTabRef = useRef('home')
  const scrollRef = useRef(null)
  const scrollMemoryRef = useRef({})
  const searchInputRef = useRef(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      if (localStorage.getItem('upbeat_onboarded_v1') && localStorage.getItem('upbeat_chart_prefs_v1')) return false
      // If user hasn't set chart & taste preferences, show onboarding prior to anything
      if (!localStorage.getItem('upbeat_chart_prefs_v1') && !localStorage.getItem('upbeat_taste_prefs_v1')) return true
      return false
    } catch {
      return false
    }
  })
  const [onboardingBusy, setOnboardingBusy] = useState(false)

  // Live Jam & Friends Social State & Refs
  const [jamState, setJamState] = useState(() => jamManager.state)
  const [isJamModalOpen, setIsJamModalOpen] = useState(false)
  const [initialJamCode, setInitialJamCode] = useState('')
  const [initialFriendCode, setInitialFriendCode] = useState('')
  const [initialJamSection, setInitialJamSection] = useState('')
  const [jamReactions, setJamReactions] = useState([])
  const currentTrackRef = useRef(currentTrack)
  const isPlayingRef = useRef(isPlaying)
  const queueRef = useRef(queue)
  const remoteJamGuardRef = useRef(false)
  const remoteJamGuardTimerRef = useRef(null)
  const handleNextRef = useRef(null)
  const handlePrevRef = useRef(null)

  const activateRemoteJamGuard = useCallback((durationMs = 350) => {
    remoteJamGuardRef.current = true
    if (remoteJamGuardTimerRef.current) {
      clearTimeout(remoteJamGuardTimerRef.current)
    }
    remoteJamGuardTimerRef.current = setTimeout(() => {
      remoteJamGuardRef.current = false
      remoteJamGuardTimerRef.current = null
    }, durationMs)
  }, [])

  currentTrackRef.current = currentTrack
  isPlayingRef.current = isPlaying
  queueRef.current = queue

  // Direct Join & Social Invite Deep-Link handler
  const handleDeepLinkUrl = useCallback(async (rawUrl = '') => {
    const { jamCode, friendCode } = extractDeepLinkParams(rawUrl)

    if (jamCode && jamCode.length >= 6) {
      try {
        const cleanUrl = window.location.pathname
        window.history.replaceState({}, document.title, cleanUrl)
      } catch {}

      setInitialJamCode(jamCode)
      showNotify(`Connecting to Live Jam (${jamCode})...`, 'info')
      const ok = await jamManager.joinJam(jamCode, googleUser)
      if (ok) {
        showNotify(`Connected to Jam ${jamCode}! Audio syncing.`, 'success')
      }
    } else if (friendCode && friendCode.length >= 7) {
      try {
        const cleanUrl = window.location.pathname
        window.history.replaceState({}, document.title, cleanUrl)
      } catch {}

      setInitialFriendCode(friendCode)
      setInitialJamSection('friends')
      setIsJamModalOpen(true)
    }
  }, [googleUser, showNotify])

  // Subscribe to Jam Engine state & reactively handle deep links
  useEffect(() => {
    const unsub = jamManager.subscribe((nextState) => {
      setJamState(nextState)
    })

    // Auto-join or add friend immediately on initial load
    handleDeepLinkUrl()

    // Listen to browser navigation, hash changes, and macOS deep-link events
    const onPop = () => handleDeepLinkUrl()
    const onHash = () => handleDeepLinkUrl()
    const onCustomDeepLink = (e) => {
      if (e?.detail) handleDeepLinkUrl(e.detail)
    }
    const onPostMsg = (e) => {
      if (e?.data?.type === 'UPBEAT_DEEP_LINK' && e.data.url) {
        handleDeepLinkUrl(e.data.url)
      }
    }

    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('upbeat-deep-link', onCustomDeepLink)
    window.addEventListener('message', onPostMsg)

    return () => {
      unsub()
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('upbeat-deep-link', onCustomDeepLink)
      window.removeEventListener('message', onPostMsg)
    }
  }, [handleDeepLinkUrl])

  // Bind Jam Engine synchronization & control handlers
  useEffect(() => {
    jamManager.setHandlers({
      getHostPlaybackSnapshot: () => ({
        track: currentTrackRef.current,
        isPlaying: isPlayingRef.current,
        currentTime: window.UpBeatControls?.getCurrentTime?.() || 0,
        queue: queueRef.current || []
      }),
      onRemoteSync: (data, clockOffsetMs) => {
        if (!data) return
        activateRemoteJamGuard(350)
        try {
          if (data.track?.video_id && data.track.video_id !== currentTrackRef.current?.video_id) {
            currentTrackRef.current = data.track
            setCurrentTrack(data.track)
          }
          if (Array.isArray(data.queue)) {
            queueRef.current = data.queue
            setQueue(data.queue)
          }

          // Authoritative Pause Enforcement: immediately halt both audio decks & skip drift ramping
          if (data.isPlaying === false) {
            isPlayingRef.current = false
            setIsPlaying(false)
            window.UpBeatControls?.forcePause?.(
              typeof data.currentTime === 'number' ? data.currentTime : undefined
            )
            jamManager.reportDriftStatus(0, 'LOCKED')
            return
          }

          if (data.isPlaying === true) {
            if (!isPlayingRef.current || data.forcePlayState) {
              isPlayingRef.current = true
              setIsPlaying(true)
              window.UpBeatControls?.forcePlay?.()
            }
          }

          if (data.track?.video_id || currentTrackRef.current?.video_id) {
            const localTime = window.UpBeatControls?.getCurrentTime?.() || 0
            const drift = evaluateAudioDrift(
              localTime,
              Number(data.currentTime) || 0,
              Number(data.hostTimestamp) || Date.now(),
              clockOffsetMs || 0,
              Boolean(data.isPlaying)
            )
            if (drift.action === 'SEEK') {
              window.UpBeatControls?.seekTo?.(drift.targetTime, true)
              window.UpBeatControls?.setPlaybackRate?.(1.0)
            } else if (drift.action === 'RAMP') {
              window.UpBeatControls?.setPlaybackRate?.(drift.playbackRate)
            } else {
              window.UpBeatControls?.setPlaybackRate?.(1.0)
            }
            jamManager.reportDriftStatus(drift.driftMs, drift.syncTier)
          }
        } catch {}
      },
      onRemoteControl: (data) => {
        if (!data || !data.action) return
        activateRemoteJamGuard(350)
        try {
          if (data.action === 'SELECT_TRACK' && data.track) {
            currentTrackRef.current = data.track
            setCurrentTrack(data.track)
            isPlayingRef.current = true
            setIsPlaying(true)
            window.UpBeatControls?.seekTo?.(0, true)
            window.UpBeatControls?.forcePlay?.(0)
          } else if (data.action === 'PLAY') {
            isPlayingRef.current = true
            setIsPlaying(true)
            window.UpBeatControls?.forcePlay?.(
              typeof data.currentTime === 'number' ? data.currentTime : undefined
            )
          } else if (data.action === 'PAUSE') {
            isPlayingRef.current = false
            setIsPlaying(false)
            window.UpBeatControls?.forcePause?.(
              typeof data.currentTime === 'number' ? data.currentTime : undefined
            )
          } else if (data.action === 'SEEK' && typeof data.currentTime === 'number') {
            window.UpBeatControls?.seekTo?.(data.currentTime, true)
          } else if (data.action === 'NEXT') {
            handleNextRef.current?.(true)
          } else if (data.action === 'PREV') {
            handlePrevRef.current?.(true)
          }

          if (jamManager.state.active && jamManager.state.isHost) {
            setTimeout(() => jamManager.broadcastHostSync(), 60)
          }
        } catch {}
      },
      onRemoteQueueAdd: (track, addedBy) => {
        if (!track) return
        setQueue((prev) => {
          const nextQ = [...prev, track]
          if (jamManager.state.active && jamManager.state.isHost) {
            setTimeout(() => jamManager.broadcastHostSync({ queue: nextQ }), 50)
          }
          return nextQ
        })
        showNotify(
          `${addedBy?.name || 'Friend'} added "${track.title}" to Jam queue`,
          'info'
        )
      },
      onReaction: (packet) => {
        if (!packet?.emoji) return
        const id = packet.id || `${Date.now()}_${Math.random()}`
        const xOffset = 18 + Math.floor(Math.random() * 64)
        const cleanEmoji = renderEmoji(packet.emoji, '🔥')
        const cleanAvatar = renderEmoji(packet.senderAvatar, '🎧')
        setJamReactions((prev) => [
          ...prev.slice(-14),
          {
            id,
            emoji: cleanEmoji,
            senderName: packet.senderName || 'Listener',
            senderAvatar: cleanAvatar,
            xOffset
          }
        ])
        setTimeout(() => {
          setJamReactions((prev) => prev.filter((r) => r.id !== id))
        }, 2650)
      },
      onNotify: (msg, type) => {
        showNotify(msg, type || 'info')
      }
    })
  }, [])

  // Automatically broadcast Host playback state changes to Jam room & Friends presence feed
  useEffect(() => {
    jamManager.broadcastPresenceStatus()
    if (!jamState.active || !jamState.isHost || remoteJamGuardRef.current) return
    jamManager.broadcastHostSync({
      track: currentTrack,
      isPlaying,
      currentTime: window.UpBeatControls?.getCurrentTime?.() || 0,
      queue
    })
  }, [currentTrack?.video_id, isPlaying, queue.length, jamState.active, jamState.isHost])

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

  // Universal offline storage subscription & connection listener
  useEffect(() => {
    let active = true
    const loadOffline = async () => {
      try {
        const list = await getOfflineTracks()
        const st = await getOfflineStorageStats()
        if (active) {
          setOfflineTracks(list)
          setOfflineStats(st)
        }
      } catch (err) {
        console.error('Offline loader error:', err)
      }
    }
    loadOffline()
    const unsub = subscribeOfflineChanges(() => loadOffline())

    const handleOnline = () => showNotify('Internet connection restored', 'info')
    const handleOffline = () => {
      showNotify("You're offline. Downloaded songs still play.", 'info', {
        label: 'Downloads',
        onClick: () => navigate('/downloads')
      })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      active = false
      unsub()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const initialBootRef = useRef(false)

  // Automatic purge of developer anime/J-pop seeds and hardcoded accounts across all platforms (Android/Mac/Web)
  useEffect(() => {
    try {
      const animeIds = new Set([
        'F8xpmTmdf6o', // Renai Circulation
        'F_Cr9vZ08Ws', // mathemagics
        '0VpGoDp3FCE', // Kimi no Shiranai Monogatari
        'CXDUXjsU5ao', // Staple Stable
        'MM8RufZr5lw', // Duvet
        '2ZN-zAKIfyQ', // Kiri
        'tdzsOODJiX8', // Akuma no Ko
        'TCd6PfxOy0Y', // Veridis Quo
        'QpxFcMYRV08'  // A New Error
      ])

      const lastEmail = localStorage.getItem('upbeat_last_google_email') || ''
      const lastName = localStorage.getItem('upbeat_last_google_name') || ''
      if (/divyansh|negi/i.test(lastEmail)) localStorage.removeItem('upbeat_last_google_email')
      if (/divyansh|negi/i.test(lastName)) localStorage.removeItem('upbeat_last_google_name')

      const storedUser = loadStorage('upbeat_google_user', null)
      if (storedUser) {
        const uEmail = (storedUser.email || '').toLowerCase()
        const uName = (storedUser.name || '').toLowerCase()
        if (uEmail.includes('negi') || uEmail.includes('divyansh') || uName.includes('negi') || uName.includes('divyansh')) {
          localStorage.removeItem('upbeat_google_user')
          setGoogleUser(null)
        }
      }

      setExtractedTracks((prev) => {
        const filtered = (prev || []).filter((t) => !animeIds.has(t?.video_id))
        try { localStorage.setItem('argon_seeds_v2', JSON.stringify(filtered)) } catch {}
        return filtered
      })

      setFavorites((prev) => {
        const filtered = (prev || []).filter((t) => !animeIds.has(t?.video_id))
        try { localStorage.setItem('argon_favs_v2', JSON.stringify(filtered)) } catch {}
        return filtered
      })

      const storedDna = loadStorage('argon_dna_v2', null)
      if (storedDna) {
        const isAnime = /anime|j-pop|j-rock|monogatari|sawano|higuchi/i.test(
          `${storedDna.archetype || ''} ${storedDna.summary || ''} ${(storedDna.primary_genres || []).join(' ')}`
        )
        if (isAnime) {
          setTasteDna(null)
          try { localStorage.removeItem('argon_dna_v2') } catch {}
        }
      }
    } catch (err) {
      console.warn('Seeds and profile cleanup warning:', err)
    }
  }, [])

  // Global shortcut: Cmd+B / Ctrl+B to slide toggle sidebar
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setRightPanelOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])


  // Persist to localStorage
  useEffect(() => {
    try { localStorage.setItem('argon_seeds_v2', JSON.stringify(extractedTracks)) } catch {}
  }, [extractedTracks])

  useEffect(() => {
    try { localStorage.setItem('argon_favs_v2', JSON.stringify(favorites)) } catch {}
    if (window.UpBeatNative && typeof window.UpBeatNative.syncFavorites === 'function') {
      const favsToSync = favorites?.length ? favorites : (extractedTracks?.length ? extractedTracks : [])
      try {
        const items = favsToSync.slice(0, 50).map((f, idx) => ({
          index: idx,
          title: f.title || 'Unknown Title',
          artist: f.artist || 'UpBeat',
          video_id: f.video_id || '',
          thumbnail: f.thumbnail || (f.video_id ? `https://i.ytimg.com/vi/${f.video_id}/hqdefault.jpg` : '')
        }))
        window.UpBeatNative.syncFavorites(JSON.stringify(items))
      } catch {}
    }
  }, [favorites, extractedTracks])

  useEffect(() => {
    if (tasteDna) {
      try { localStorage.setItem('argon_dna_v2', JSON.stringify(tasteDna)) } catch {}
    }
  }, [tasteDna])

  useEffect(() => {
    if (playlist) {
      try { localStorage.setItem('argon_playlist_v2', JSON.stringify(playlist)) } catch {}
    }
    if (window.UpBeatNative && typeof window.UpBeatNative.syncQueue === 'function') {
      const tracksToSync = playlist?.tracks?.length
        ? playlist.tracks
        : (queue?.length ? queue : (extractedTracks?.length ? extractedTracks : []))
      if (tracksToSync?.length) {
        try {
          const items = tracksToSync.slice(0, 50).map((t, idx) => ({
            index: idx,
            title: t.title || 'Unknown Title',
            artist: t.artist || 'UpBeat',
            video_id: t.video_id || '',
            thumbnail: t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
          }))
          window.UpBeatNative.syncQueue(JSON.stringify(items))
        } catch {}
      }
    }
  }, [playlist, queue, extractedTracks])

  useEffect(() => {
    try { localStorage.setItem('upbeat_playback_queue', JSON.stringify(queue)) } catch {}
  }, [queue])

  useEffect(() => {
    try {
      if (googleUser) {
        localStorage.setItem('upbeat_google_user', JSON.stringify(googleUser))
      } else {
        localStorage.removeItem('upbeat_google_user')
      }
    } catch {}
  }, [googleUser])

  // Sync offline tracks & stats from client IndexedDB
  useEffect(() => {
    let mounted = true
    const reloadOffline = async () => {
      try {
        const tracks = await getOfflineTracks()
        const stats = await getOfflineStorageStats()
        if (mounted) {
          setOfflineTracks(tracks || [])
          setOfflineStats(stats || { count: 0, totalBytes: 0, formattedSize: '0 B' })
        }
      } catch (err) {
        console.error('Error loading offline tracks in App:', err)
      }
    }
    reloadOffline()
    const unsubscribe = subscribeOfflineChanges(() => {
      reloadOffline()
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  // Auto-sync saved local profile or authentic Google avatar from active YouTube Music Safari session
  useEffect(() => {
    if (hasBackend()) {
      fetch(`${getApiBase()}/profile`)
        .then((r) => (r.ok ? r.json() : null))
        .then((saved) => {
          if (saved && (saved.name || saved.picture)) {
            setGoogleUser((prev) => {
              if (prev?.picture && (prev.customPicture || prev.picture.startsWith('data:'))) return prev
              return { ...(prev || {}), ...saved }
            })
          }
        })
        .catch(() => {})

      fetch(`${getApiBase()}/safari/profile`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.picture) {
            setGoogleUser((prev) => {
              if (!prev) return prev
              // Never overwrite a custom user-uploaded avatar
              if (prev.customPicture || prev.picture?.startsWith('data:')) return prev
              if (prev.picture !== data.picture) {
                return { ...prev, picture: data.picture }
              }
              return prev
            })
          }
        })
        .catch(() => {})
    }
  }, [])

  const handleGoogleLogin = (user) => {
    setGoogleUser(user)
    showNotify(`Connected Google Account: ${user.name}`, 'success')
    handleSyncGoogleYouTubeLikes(user)
  }

  const handleGoogleLogout = () => {
    setGoogleUser(null)
    showNotify('Disconnected Google account', 'info')
  }

  const handleSyncGoogleYouTubeLikes = async (overrideUser) => {
    const activeU = overrideUser || googleUser
    if (!activeU) {
      setShowGoogleModal(true)
      return
    }
    setIsSyncingLikes(true)
    showNotify(`Syncing ${activeU.name}'s YouTube Music profile...`, 'info')
    try {
      // 1. Direct imported tracks from playlist link
      if (activeU.importedTracks && activeU.importedTracks.length > 0) {
        const clean = activeU.importedTracks.filter(isValidMusicTrack)
        if (clean.length > 0) {
          setFavorites(clean)
          setExtractedTracks(clean)
          try { localStorage.setItem('argon_seeds_v2', JSON.stringify(clean)) } catch {}
          const dna = await analyzeTasteDnaStandalone(clean)
          if (dna) setTasteDna(dna)
          showNotify(`Imported ${clean.length} songs & tailored taste DNA for ${activeU.name}!`, 'success')
          return
        }
      }

      // 2. Real Google OAuth 2.0: Fetch authentic YouTube Liked Videos (playlist ID 'LL')
      if (activeU.accessToken) {
        try {
          const ytRes = await fetch(
            'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=LL&maxResults=50',
            { headers: { Authorization: `Bearer ${activeU.accessToken}` } }
          )
          if (ytRes.ok) {
            const data = await ytRes.json()
            const realTracks = (data.items || []).map((item) => ({
              title: item.snippet?.title || 'Unknown Title',
              artist: item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube Artist',
              video_id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
              thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
              vibe: 'YouTube Liked',
              liked_at: Date.now()
            })).filter((t) => t.video_id && !t.title.includes('Deleted video') && !t.title.includes('Private video') && isValidMusicTrack(t))

            if (realTracks.length > 0) {
              setFavorites(realTracks)
              setExtractedTracks(realTracks)
              try { localStorage.setItem('argon_seeds_v2', JSON.stringify(realTracks)) } catch {}
              const dna = await analyzeTasteDnaStandalone(realTracks)
              if (dna) setTasteDna(dna)
              showNotify(`Synced ${realTracks.length} authentic liked songs from ${activeU.name}'s YouTube account!`, 'success')
              return
            }
          } else {
            const errJson = await ytRes.json().catch(() => ({}))
            const errMsg = errJson?.error?.message || `Status ${ytRes.status}`
            console.warn('YouTube API Liked Videos returned error:', errMsg)
            showNotify(`YouTube API notice: ${errMsg}`, 'info')
          }
        } catch (oauthErr) {
          console.warn('YouTube API Liked Videos error, trying fallback:', oauthErr)
        }
      }

      // 3. On MacBook with local backend, sync authentic liked songs from active Safari session
      if (hasBackend()) {
        try {
          const res = await fetch(`${getApiBase()}/safari/liked`)
          if (res.ok) {
            const data = await res.json()
            if (data.tracks && data.tracks.length) {
              const clean = data.tracks.filter(isValidMusicTrack)
              if (clean.length > 0) {
                setFavorites(clean)
                setExtractedTracks(clean)
                try { localStorage.setItem('argon_seeds_v2', JSON.stringify(clean)) } catch {}
                const dna = await analyzeTasteDnaStandalone(clean)
                if (dna) setTasteDna(dna)
                showNotify(`Synced ${clean.length} songs from YouTube Music`, 'success')
                return
              }
            }
          }
        } catch {}
      }

      // 4. On Android / standalone mobile:
      // If user already has hearted favorites on this device, derive their authentic taste profile from them!
      if (favorites && favorites.length > 0) {
        const cleanFavs = favorites.filter(isValidMusicTrack)
        setExtractedTracks((prev) => {
          const cleanPrev = prev.filter(isValidMusicTrack)
          const existingIds = new Set(cleanPrev.map((t) => t.video_id))
          const newSeeds = cleanFavs.filter((f) => !existingIds.has(f.video_id))
          const updated = [...newSeeds, ...cleanPrev]
          try { localStorage.setItem('argon_seeds_v2', JSON.stringify(updated)) } catch {}
          return updated
        })
        const dna = await analyzeTasteDnaStandalone(cleanFavs)
        if (dna) setTasteDna(dna)
        showNotify(`Analyzed ${cleanFavs.length} saved songs into ${activeU.name}'s taste profile!`, 'success')
        return
      }

      // 5. If user has seed tracks in their Library, derive from their seed tracks
      if (extractedTracks && extractedTracks.length > 0) {
        const cleanSeeds = extractedTracks.filter(isValidMusicTrack)
        const dna = await analyzeTasteDnaStandalone(cleanSeeds)
        if (dna) setTasteDna(dna)
        showNotify(`Generated taste profile for ${activeU.name} from seed tracks!`, 'success')
        return
      }

      // 6. For new users with zero songs, pull real top trending songs (not hardcoded anime or non-music)
      const searchRes = await directSearchStandalone('Top Hits 2026', 'songs')
      const starterTracks = (searchRes?.tracks || []).filter(isValidMusicTrack).slice(0, 6)
      if (starterTracks.length > 0) {
        setExtractedTracks(starterTracks)
        try { localStorage.setItem('argon_seeds_v2', JSON.stringify(starterTracks)) } catch {}
        const dna = await analyzeTasteDnaStandalone(starterTracks)
        if (dna) setTasteDna(dna)
        showNotify(`Synced starter music feed for ${activeU.name}!`, 'success')
      } else {
        showNotify(`Connected ${activeU.name}! Search or heart songs to build your profile.`, 'success')
      }
    } catch (err) {
      showNotify(`Sync error: ${err.message}`, 'error')
    } finally {
      setIsSyncingLikes(false)
    }
  }

  // Handle in-car controls from Android Auto & car head units
  useEffect(() => {
    window.onUpBeatCarAction = (action, payload) => {
      switch (action) {
        case 'play':
          setIsPlaying(true)
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing'
          }
          document.querySelectorAll('audio').forEach((el) => {
            if (el.src) try { el.play().catch(() => {}) } catch {}
          })
          break
        case 'pause':
          setIsPlaying(false)
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused'
          }
          document.querySelectorAll('audio').forEach((el) => {
            try { el.pause() } catch {}
          })
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
        default:
          break
      }
    }

    // Flush any pending car actions queued during cold start
    if (window.UpBeatNative && typeof window.UpBeatNative.readyForCarActions === 'function') {
      try {
        window.UpBeatNative.readyForCarActions()
      } catch {}
    }

    return () => {
      delete window.onUpBeatCarAction
    }
  }, [playlist, favorites, queue, extractedTracks, currentTrackIdx])

  // Load persistent favorites from disk on mount (only when Mac backend is configured)
  useEffect(() => {
    if (!hasBackend()) return
    fetch(`${getApiBase()}/favorites`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.favorites) setFavorites(data.favorites)
      })
      .catch(() => {})
  }, [])

  // Check if a track is in favorites
  const isTrackFavorite = (track) => {
    if (!track || !favorites.length) return false
    const tVid = (track.video_id || '').trim()
    const tTitle = (track.title || '').trim().toLowerCase()
    const tArtist = (track.artist || '').trim().toLowerCase()

    return favorites.some((f) => {
      if (tVid && f.video_id && f.video_id === tVid) return true
      return (
        (f.title || '').trim().toLowerCase() === tTitle &&
        (f.artist || '').trim().toLowerCase() === tArtist
      )
    })
  }

  // Toggle favorite on backend + local state (with standalone mobile fallback)
  const handleToggleFavorite = async (track) => {
    if (!track) return
    if (hasBackend()) {
      try {
        const res = await fetch(`${getApiBase()}/favorites/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track })
        })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json()
          setFavorites(data.favorites || [])
          showNotify(
            data.is_favorite ? 'Added to liked songs' : 'Removed from liked songs',
            'info',
            data.is_favorite ? null : { label: 'Undo', onClick: () => handleToggleFavorite(track) }
          )
          return
        }
      } catch {}
    }

    // Standalone mobile fallback using localStorage
    const alreadyLiked = isTrackFavorite(track)
    const nextFavs = alreadyLiked
      ? favorites.filter(
          (f) =>
            !(
              (track.video_id && f.video_id === track.video_id) ||
              ((f.title || '').toLowerCase() === (track.title || '').toLowerCase() &&
                (f.artist || '').toLowerCase() === (track.artist || '').toLowerCase())
            )
        )
      : [{ ...track, liked_at: Math.floor(Date.now() / 1000) }, ...favorites]
    setFavorites(nextFavs)
    showNotify(
      !alreadyLiked ? 'Added to liked songs' : 'Removed from liked songs',
      'info',
      alreadyLiked ? { label: 'Undo', onClick: () => setFavorites((cur) => (cur.some((f) => sameTrack(f, track)) ? cur : [track, ...cur])) } : null
    )
  }

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

    setIsResolvingBatch(true)
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
      .finally(() => setIsResolvingBatch(false))
  }, [playlist?.playlist_title])

  const checkSafari = async () => {
    if (!hasBackend()) return null
    try {
      const res = await fetch(`${getApiBase()}/safari/tabs`)
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json()
        setSafariStatus(data)
        return data
      }
    } catch {}
    return null
  }

  const checkNowPlaying = async () => {
    if (!hasBackend()) return
    try {
      const res = await fetch(`${getApiBase()}/safari/now-playing`)
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json()
        setSafariNowPlaying(data.now_playing)
      }
    } catch {}
  }

  // Sync from Safari
  const handleSyncSafari = async (silent = false) => {
    if (!hasBackend()) {
      if (!silent) showNotify('Safari sync requires a Mac server connection', 'info')
      return []
    }
    setIsSyncing(true)
    if (!silent) showNotify('Syncing tracks from Safari...', 'info')
    try {
      const extractRes = await fetch(`${getApiBase()}/safari/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (!extractRes.ok) {
        if (!silent) {
          const err = await extractRes.json().catch(() => ({}))
          showNotify(err.detail || 'No YouTube tab found in Safari', 'error')
        }
        setIsSyncing(false)
        return []
      }

      const extractData = await extractRes.json()
      const newTracks = extractData.tracks || []

      if (newTracks.length > 0) {
        setExtractedTracks(newTracks)
        if (!silent) showNotify(`Synced ${newTracks.length} tracks from Safari`, 'success')

        fetch(`${getApiBase()}/taste-dna`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: newTracks, model_name: selectedModel })
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((dna) => {
            if (dna) setTasteDna(dna)
          })
          .catch(() => {})

        return newTracks
      } else {
        if (!silent) showNotify('Safari tab open, but 0 video items found on page', 'warning')
        return []
      }
    } catch (e) {
      if (!silent) showNotify(`Sync failed: ${e.message}`, 'error')
      return []
    } finally {
      setIsSyncing(false)
    }
  }

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
        try {
          const res = await fetch(`${getApiBase()}/curate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            throw new Error(err.detail || `Mac companion returned HTTP ${res.status}`)
          }
          data = await res.json()
        } catch (backendErr) {
          if (hasKey) {
            data = await curateStandalone(curateArgs)
          } else {
            throw new Error('Add a Gemini key in Settings to make mixes')
          }
        }
      } else {
        data = await curateStandalone(curateArgs)
      }

      if (token !== collectionTokenRef.current) return
      const tracks = (data?.tracks || []).filter((t) => t && (t.video_id || t.title))
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
    setActiveTab('curator')

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
          handlePlayTrack(data.tracks[0], 0)
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

  const handleSelectMatchedPlaylist = async (pl) => {
    if (!pl?.browse_id || isLoadingPlaylistBrowse) return
    setIsLoadingPlaylistBrowse(true)
    try {
      let tracks = []
      if (hasBackend()) {
        try {
          const res = await fetch(
            `${getApiBase()}/playlist-browse?browse_id=${encodeURIComponent(pl.browse_id)}&title=${encodeURIComponent(pl.title || '')}&subtitle=${encodeURIComponent(pl.subtitle || '')}`
          )
          const ct = res.headers.get('content-type') || ''
          if (res.ok && ct.includes('application/json')) {
            const d = await res.json()
            tracks = d.tracks || []
          }
        } catch {}
      }
      if (!tracks.length) {
        tracks = await browsePlaylistStandalone(pl.browse_id, pl.title, pl.subtitle)
      }

      if (tracks.length > 0) {
        setPlaylist((prev) => ({
          ...(prev || {
            is_direct_search: true,
            search_query: pl.title,
            matched_playlists: [pl],
            youtube_results: [],
            song_results: []
          }),
          playlist_title: pl.title,
          subtitle: `${pl.subtitle} • 0 AI tokens`,
          vibe_description: `${pl.subtitle} • Prepared playlist`,
          active_source: 'playlist',
          active_browse_id: pl.browse_id,
          tracks
        }))
        if (!currentTrack) {
          setCurrentTrack(tracks[0])
          setCurrentTrackIdx(0)
        }
        showNotify(`Loaded "${pl.title}" (${tracks.length} tracks • 0 tokens)`, 'info')
      } else if (pl.query) {
        setPrompt(pl.query)
        handleDirectSearch(pl.query, 'auto')
      } else {
        showNotify('Could not load tracks from that playlist', 'warning')
      }
    } finally {
      setIsLoadingPlaylistBrowse(false)
    }
  }

  const handleSelectYoutubeResults = () => {
    setPlaylist((prev) => {
      if (!prev || !prev.youtube_results?.length) return prev
      const q = prev.search_query || prompt
      const count = prev.youtube_results.length
      return {
        ...prev,
        playlist_title: `"${q}"`,
        subtitle: `YouTube results : ${count} videos`,
        vibe_description: `YouTube results : ${count} videos`,
        active_source: 'youtube',
        active_browse_id: '',
        tracks: prev.youtube_results
      }
    })
  }

  const handleSelectDirectSongs = (directTracks, title, subtitle) => {
    if (Array.isArray(directTracks) && directTracks.length > 0) {
      const plTitle = title || 'Rediscover Favorites Mix'
      const plSubtitle = subtitle || `${directTracks.length} tracks`
      setPlaylist({
        playlist_title: plTitle,
        subtitle: plSubtitle,
        vibe_description: plSubtitle,
        active_source: 'songs',
        active_browse_id: '',
        tracks: directTracks
      })
      handlePlayTrack(directTracks[0], 0, directTracks)
      return
    }
    setPlaylist((prev) => {
      if (!prev || !prev.song_results?.length) return prev
      const q = prev.search_query || prompt
      const count = prev.song_results.length
      return {
        ...prev,
        playlist_title: `"${q}"`,
        subtitle: `YouTube results : ${count} videos`,
        vibe_description: `YouTube results : ${count} videos`,
        active_source: 'songs',
        active_browse_id: '',
        tracks: prev.song_results
      }
    })
  }

  // Initial boot: check Safari, auto-sync if YT tab is open, and ensure a playlist exists
  useEffect(() => {
    if (initialBootRef.current) return
    initialBootRef.current = true

    ;(async () => {
      const status = await checkSafari()
      let seeds = extractedTracks
      if (status?.has_yt) {
        const synced = await handleSyncSafari(true)
        if (synced.length > 0) seeds = synced
      }
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

  const handleOpenSafari = async (destination = 'yt_liked') => {
    try {
      await fetch(`${getApiBase()}/safari/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination })
      })
      showNotify('Opened YouTube in Safari', 'info')
      setTimeout(checkSafari, 1500)
    } catch (e) {
      showNotify(`Safari error: ${e.message}`, 'error')
    }
  }

  const handleSelectPreset = (preset) => {
    setActivePresetId(preset.id)
    setPrompt(preset.prompt)
    setEnergyLevel(preset.energy)
    handleGenerate(preset.prompt, undefined, preset.energy)
  }

  const handlePromptChange = (val) => {
    setPrompt(val)
  }

  const handlePlayTrack = (track, idxOrList, customList) => {
    if (!track) return

    if (jamManager.state.active && !jamManager.state.isHost && jamManager.state.djMode === 'host_only' && !remoteJamGuardRef.current) {
      jamManager.emitQueueAdd(track)
      setQueue((prev) => [...prev, track])
      showNotify(`Host Only DJ mode: Added "${track.title}" to shared Jam queue`, 'info')
      return
    }

    let listToUse = null
    let actualIdx = 0

    if (Array.isArray(idxOrList)) {
      listToUse = idxOrList
      const found = listToUse.findIndex(
        (t) => (t.video_id && track.video_id && t.video_id === track.video_id) ||
               (t.title === track.title && t.artist === track.artist)
      )
      actualIdx = found >= 0 ? found : 0
    } else if (typeof idxOrList === 'number') {
      actualIdx = idxOrList
      if (Array.isArray(customList) && customList.length > 0) {
        listToUse = customList
      }
    }

    if (listToUse && listToUse.length > 0) {
      setActivePlaybackContext(listToUse)
    } else {
      if (activeTab === 'library') setActivePlaybackContext(extractedTracks)
      else if (activeTab === 'favorites') setActivePlaybackContext(favorites)
      else if (activeTab === 'offline') setActivePlaybackContext(offlineTracks)
      else setActivePlaybackContext(playlist?.tracks || [])
    }

    const isSame = currentTrack && (
      (currentTrack.video_id && currentTrack.video_id === track.video_id) ||
      (currentTrack.title === track.title && currentTrack.artist === track.artist)
    )
    if (isSame) {
      const nextPlay = !isPlayingRef.current
      isPlayingRef.current = nextPlay
      setIsPlaying(nextPlay)
      const curTime = window.UpBeatControls?.getCurrentTime?.() || 0
      if (!nextPlay) {
        window.UpBeatControls?.forcePause?.(curTime)
      } else {
        window.UpBeatControls?.forcePlay?.()
      }
      if (jamManager.state.active && !remoteJamGuardRef.current) {
        jamManager.broadcastPlayState(nextPlay, curTime, currentTrackRef.current || track)
      }
      return
    }
    currentTrackRef.current = track
    isPlayingRef.current = true
    setCurrentTrack(track)
    setCurrentTrackIdx(actualIdx)
    setIsPlaying(true)
    if (jamManager.state.active && !jamManager.state.isHost && !remoteJamGuardRef.current) {
      jamManager.emitPlaybackControl('SELECT_TRACK', { track, currentTime: 0 })
    }
    if (playbackMode === 'safari') {
      handlePushToSafari(track)
    }
  }

  const handleTogglePlay = () => {
    if (jamManager.state.active && !jamManager.state.isHost && jamManager.state.djMode === 'host_only' && !remoteJamGuardRef.current) {
      showNotify('Host Only DJ mode is active — ask the host to enable Open Party mode', 'info')
      return
    }
    if (!currentTrack && playlist?.tracks?.length > 0) {
      const firstTrack = playlist.tracks[0]
      currentTrackRef.current = firstTrack
      isPlayingRef.current = true
      setCurrentTrack(firstTrack)
      setCurrentTrackIdx(0)
      setIsPlaying(true)
      if (jamManager.state.active && !remoteJamGuardRef.current) {
        jamManager.broadcastPlayState(true, 0, firstTrack)
      }
      return
    }
    const next = !isPlayingRef.current
    isPlayingRef.current = next
    setIsPlaying(next)
    const curTime = window.UpBeatControls?.getCurrentTime?.() || 0
    if (!next) {
      window.UpBeatControls?.forcePause?.(curTime)
    } else {
      window.UpBeatControls?.forcePlay?.()
    }
    if (jamManager.state.active && !remoteJamGuardRef.current) {
      jamManager.broadcastPlayState(next, curTime, currentTrackRef.current)
    }
  }

  const getActiveTrackList = () => {
    if (activePlaybackContext && activePlaybackContext.length > 0) {
      return activePlaybackContext
    }
    if (activeTab === 'library') return extractedTracks
    if (activeTab === 'favorites') return favorites
    if (activeTab === 'offline') return offlineTracks
    return playlist?.tracks || []
  }

  const handleNext = (fromRemote = false) => {
    if (jamManager.state.active && !jamManager.state.isHost && !fromRemote && !remoteJamGuardRef.current) {
      if (jamManager.state.djMode === 'host_only') {
        showNotify('Host Only DJ mode is active', 'info')
        return
      }
      jamManager.emitPlaybackControl('NEXT', {})
    }

    // 1. Prioritize queued tracks
    if (queue.length > 0) {
      const nextTrack = queue[0]
      setQueue((prev) => prev.slice(1))
      setCurrentTrack(nextTrack)
      setIsPlaying(true)
      if (playbackMode === 'safari') {
        handlePushToSafari(nextTrack)
      }
      return
    }

    // 2. Sequential playlist fallback
    const list = getActiveTrackList()
    if (!list || list.length === 0) return

    let curIdx = typeof currentTrackIdx === 'number' ? currentTrackIdx : 0
    if (currentTrack && (curIdx < 0 || curIdx >= list.length ||
        (list[curIdx]?.video_id !== currentTrack.video_id && list[curIdx]?.title !== currentTrack.title))) {
      const found = list.findIndex(
        (t) => (t.video_id && currentTrack.video_id && t.video_id === currentTrack.video_id) ||
               (t.title === currentTrack.title && t.artist === currentTrack.artist)
      )
      if (found >= 0) curIdx = found
    }

    const nextIdx = (curIdx + 1) % list.length
    const nextTrack = list[nextIdx]
    if (!nextTrack) return
    setCurrentTrack(nextTrack)
    setCurrentTrackIdx(nextIdx)
    setIsPlaying(true)
    if (playbackMode === 'safari') {
      handlePushToSafari(nextTrack)
    }
  }
  handleNextRef.current = handleNext

  const handlePlayNext = (track) => {
    if (!track) return
    setQueue((prev) => {
      const filtered = prev.filter((t) => t.video_id !== track.video_id)
      return [track, ...filtered]
    })
    if (jamManager.state.active && !jamManager.state.isHost) {
      jamManager.emitQueueAdd(track)
    }
    showNotify(`"${track.title}" plays next`, 'info')
  }

  const handleAddToQueue = (track) => {
    if (!track) return
    setQueue((prev) => [...prev, track])
    if (jamManager.state.active && !jamManager.state.isHost) {
      jamManager.emitQueueAdd(track)
    }
    showNotify('Added to queue', 'info', { label: 'Undo', onClick: () => setQueue((q) => { const i = q.lastIndexOf(track); return i >= 0 ? q.filter((_, j) => j !== i) : q }) })
  }

  const handleRemoveFromQueue = (idx) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleClearQueue = () => {
    setQueue([])
    showNotify('Playback queue cleared', 'info')
  }

  const handleToggleShuffle = () => {
    setIsShuffle((prev) => {
      const nextState = !prev
      if (nextState) {
        originalQueueRef.current = [...queue]
        originalContextRef.current = activePlaybackContext ? [...activePlaybackContext] : null
        if (queue.length > 0) {
          setQueue(fisherYatesShuffle(queue))
        }
        if (activePlaybackContext && activePlaybackContext.length > 1) {
          const remaining = activePlaybackContext.filter(
            (t) => (t.video_id && currentTrack?.video_id ? t.video_id !== currentTrack.video_id : t.title !== currentTrack?.title)
          )
          const shuffled = fisherYatesShuffle(remaining)
          const newContext = currentTrack ? [currentTrack, ...shuffled] : shuffled
          setActivePlaybackContext(newContext)
          setCurrentTrackIdx(0)
        }
        showNotify('Shuffle on', 'info')
      } else {
        if (originalQueueRef.current) {
          setQueue(originalQueueRef.current)
          originalQueueRef.current = null
        }
        if (originalContextRef.current) {
          setActivePlaybackContext(originalContextRef.current)
          if (currentTrack) {
            const idx = originalContextRef.current.findIndex(
              (t) => (t.video_id && currentTrack.video_id ? t.video_id === currentTrack.video_id : t.title === currentTrack.title)
            )
            if (idx >= 0) setCurrentTrackIdx(idx)
          }
          originalContextRef.current = null
        }
        showNotify('Shuffle off', 'info')
      }
      return nextState
    })
  }

  const handleShufflePlayBlock = async (block) => {
    if (!block) return

    try {
      const rawTracks = await loadBlockTracks(block)
      if (!rawTracks || rawTracks.length === 0) {
        showNotify('Unable to load tracks for this station', 'error')
        return
      }
      const shuffled = fisherYatesShuffle(rawTracks)
      originalContextRef.current = [...rawTracks]
      setActivePlaybackContext(shuffled)
      setCurrentTrack(shuffled[0])
      setCurrentTrackIdx(0)
      setQueue(shuffled.slice(1))
      setIsShuffle(true)
      setIsPlaying(true)
      if (playbackMode === 'safari') handlePushToSafari(shuffled[0])

    } catch (e) {
      showNotify('Error shuffling station: ' + (e?.message || 'Try again'), 'error')
    }
  }

  const handleShufflePlayAll = (customTracks) => {
    const target = customTracks || playlist?.tracks || []
    if (!target || target.length === 0) return
    const shuffled = fisherYatesShuffle(target)
    originalContextRef.current = [...target]
    setActivePlaybackContext(shuffled)
    setCurrentTrack(shuffled[0])
    setCurrentTrackIdx(0)
    setQueue(shuffled.slice(1))
    setIsShuffle(true)
    setIsPlaying(true)
    if (playbackMode === 'safari') handlePushToSafari(shuffled[0])

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

  const handlePrev = (fromRemote = false) => {
    if (jamManager.state.active && !jamManager.state.isHost && !fromRemote && !remoteJamGuardRef.current) {
      if (jamManager.state.djMode === 'host_only') {
        showNotify('Host Only DJ mode is active', 'info')
        return
      }
      jamManager.emitPlaybackControl('PREV', {})
    }

    const list = getActiveTrackList()
    if (!list || list.length === 0) return

    let curIdx = typeof currentTrackIdx === 'number' ? currentTrackIdx : 0
    if (currentTrack && (curIdx < 0 || curIdx >= list.length ||
        (list[curIdx]?.video_id !== currentTrack.video_id && list[curIdx]?.title !== currentTrack.title))) {
      const found = list.findIndex(
        (t) => (t.video_id && currentTrack.video_id && t.video_id === currentTrack.video_id) ||
               (t.title === currentTrack.title && t.artist === currentTrack.artist)
      )
      if (found >= 0) curIdx = found
    }

    const prevIdx = (curIdx - 1 + list.length) % list.length
    const prevTrack = list[prevIdx]
    if (!prevTrack) return
    setCurrentTrack(prevTrack)
    setCurrentTrackIdx(prevIdx)
    setIsPlaying(true)
    if (playbackMode === 'safari') {
      handlePushToSafari(prevTrack)
    }
  }
  handlePrevRef.current = handlePrev

  const handleUserSeek = (targetSec) => {
    if (!jamManager.state.active || remoteJamGuardRef.current) return
    if (jamManager.state.isHost) {
      jamManager.broadcastHostSync({ currentTime: targetSec })
    } else if (jamManager.state.djMode !== 'host_only') {
      jamManager.emitPlaybackControl('SEEK', { currentTime: targetSec })
    }
  }

  const handleTrackResolved = (track, resolvedData) => {
    if (!track || !resolvedData) return
    const badDurs = new Set(['3:42', '3:30', '--:--', '3:00', '8:29', '8:08'])
    let resolvedDurText = ''
    if (resolvedData.duration && resolvedData.duration > 0) {
      resolvedDurText = formatDurationSeconds(resolvedData.duration)
    } else if (resolvedData.duration_text && !badDurs.has(resolvedData.duration_text)) {
      resolvedDurText = resolvedData.duration_text
    }

    setPlaylist((prev) => {
      if (!prev || !prev.tracks) return prev
      let changed = false
      const nextTracks = prev.tracks.map((t) => {
        const isMatch =
          (t.video_id && t.video_id === (resolvedData.video_id || track.video_id)) ||
          (t.title === track.title && t.artist === track.artist)
        if (!isMatch) return t
        const finalDur = resolvedDurText || (badDurs.has(t.duration_text) ? '' : t.duration_text)
        const newVid = resolvedData.video_id || t.video_id
        if (t.video_id === newVid && t.duration_text === finalDur && t.thumbnail) {
          return t
        }
        changed = true
        return {
          ...t,
          video_id: newVid,
          fallback_ids: resolvedData.fallback_ids?.length ? resolvedData.fallback_ids : t.fallback_ids,
          thumbnail: resolvedData.thumbnail || t.thumbnail,
          duration_text: finalDur
        }
      })
      return changed ? { ...prev, tracks: nextTracks } : prev
    })
    setCurrentTrack((cur) => {
      if (!cur) return cur
      const isMatch =
        (cur.video_id && cur.video_id === (resolvedData.video_id || track.video_id)) ||
        (cur.title === track.title && cur.artist === track.artist)
      if (!isMatch) return cur
      const finalDur = resolvedDurText || (badDurs.has(cur.duration_text) ? '' : cur.duration_text)
      const newVid = resolvedData.video_id || cur.video_id
      if (cur.video_id === newVid && cur.duration_text === finalDur && cur.thumbnail) {
        return cur
      }
      return {
        ...cur,
        video_id: newVid,
        fallback_ids: resolvedData.fallback_ids?.length ? resolvedData.fallback_ids : cur.fallback_ids,
        thumbnail: resolvedData.thumbnail || cur.thumbnail,
        duration_text: finalDur
      }
    })
  }

  const handlePushToSafari = async (track) => {
    if (!track) return
    const targetUrl = track.url || (track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : (currentTrack?.video_id ? `https://www.youtube.com/watch?v=${currentTrack.video_id}` : ''))
    if (!targetUrl) return

    if (!hasBackend() || isNativeApp()) {
      openExternalUrl(targetUrl)
      showNotify(`Opening in browser...`, 'info')
      return
    }

    try {
      await fetch(`${getApiBase()}/safari/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'custom', custom_url: targetUrl })
      })
      showNotify(`Opened "${track.title}" in Safari`, 'info')
    } catch (e) {
      openExternalUrl(targetUrl)
      showNotify(`Opened in browser`, 'info')
    }
  }

  const handleSafariControl = async (action) => {
    try {
      const res = await fetch(`${getApiBase()}/safari/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json()
      if (data.status !== 'success') {
        showNotify(data.message || 'Safari control unavailable', 'warning')
      }
      setTimeout(checkNowPlaying, 400)
    } catch (e) {
      showNotify(`Safari error: ${e.message}`, 'error')
    }
  }

  // =====================================================================
  // v8: library, history, collections, search, downloads
  // =====================================================================
  const downloadedIds = useMemo(() => new Set(offlineTracks.map((t) => t.video_id).filter(Boolean)), [offlineTracks])

  useEffect(() => saveStorage('upbeat_library_v1', savedCollections), [savedCollections])
  useEffect(() => saveStorage('upbeat_mixes_v1', recentMixes), [recentMixes])
  useEffect(() => saveStorage('upbeat_history_v1', playHistory), [playHistory])
  useEffect(() => saveStorage('upbeat_recents_v1', recents), [recents])
  useEffect(() => saveStorage('upbeat_recent_searches_v1', recentSearches), [recentSearches])
  useEffect(() => saveStorage('upbeat_right_panel_v1', rightPanelOpen), [rightPanelOpen])

  // Android Auto: send saved collections and recent AI mixes to the car service ("Your Mixes")
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.UpBeatNative : null
    if (!bridge || typeof bridge.syncMixes !== 'function') return
    const seen = new Set()
    const list = [...savedCollections, ...recentMixes]
      .filter((c) => c?.tracks?.length && !seen.has(c.id) && seen.add(c.id))
      .slice(0, 12)
      .map((c) => ({
        title: c.title,
        subtitle: c.kind === 'mix' ? 'AI mix' : `${c.tracks.length} songs`,
        kind: c.kind,
        tracks: c.tracks.slice(0, 50).map((t) => ({ title: t.title, artist: t.artist, video_id: t.video_id, thumbnail: t.thumbnail }))
      }))
    try {
      bridge.syncMixes(JSON.stringify(list))
    } catch {}
  }, [savedCollections, recentMixes])

  // Remember what was actually played (for History and Jump back in)
  useEffect(() => {
    if (!isPlaying || !currentTrack || (!currentTrack.video_id && !currentTrack.title)) return
    setPlayHistory((prev) => [slimTrack(currentTrack), ...prev.filter((t) => !sameTrack(t, currentTrack))].slice(0, 100))
  }, [currentTrack?.video_id, currentTrack?.title, isPlaying])

  const snapshot = (c) => ({
    id: c.id,
    kind: c.kind,
    title: c.title,
    subtitle: c.subtitle || '',
    prompt: c.prompt || '',
    cover: c.cover || '',
    tracks: (c.tracks || []).slice(0, 200).map(slimTrack),
    createdAt: c.createdAt || Date.now()
  })

  const recordMix = (mix) => {
    setRecentMixes((prev) => [snapshot(mix), ...prev.filter((m) => m.id !== mix.id)].slice(0, 20))
  }

  const recordRecent = (c) => {
    if (!c?.id || c.id.startsWith('mix_pending')) return
    const entry =
      c.kind === 'liked'
        ? { key: 'liked', kind: 'liked', title: 'Liked songs' }
        : {
            key: c.id,
            kind: c.kind,
            title: c.title,
            cover: c.cover || '',
            tracks: (c.tracks || []).slice(0, 4).map(slimTrack),
            track: c.tracks?.[0] ? slimTrack(c.tracks[0]) : null,
            collection: { ...snapshot(c), tracks: (c.tracks || []).slice(0, 80).map(slimTrack) }
          }
    setRecents((prev) => [entry, ...prev.filter((r) => r.key !== entry.key)].slice(0, 12))
  }

  // Show a collection that is already loaded
  const showCollection = (c, { record = true } = {}) => {
    collectionTokenRef.current++
    setCollectionLoading(false)
    setPlaylist(c)
    if (record) recordRecent(c)
    navigate('/collection')
  }

  // Open a collection page right away and fill it when its songs arrive
  const loadCollection = async (base, loader) => {
    const token = ++collectionTokenRef.current
    setPlaylist({ ...base, tracks: [] })
    setCollectionLoading(true)
    navigate('/collection')
    try {
      const raw = await loader()
      if (token !== collectionTokenRef.current) return
      const tracks = (raw || []).filter(isValidMusicTrack)
      const full = { ...base, tracks }
      setPlaylist(full)
      if (tracks.length) recordRecent(full)
    } catch (e) {
      if (token === collectionTokenRef.current) showNotify(`Couldn't load "${base.title}"`, 'error')
    } finally {
      if (token === collectionTokenRef.current) setCollectionLoading(false)
    }
  }

  const playList = (tracks, { shuffle = false, from = null } = {}) => {
    const list = (tracks || []).filter(Boolean)
    if (!list.length) return
    if (shuffle) {
      const shuffled = fisherYatesShuffle(list)
      originalContextRef.current = [...list]
      setActivePlaybackContext(shuffled)
      setIsShuffle(true)
      setCurrentTrack(shuffled[0])
      setCurrentTrackIdx(0)
      setIsPlaying(true)
      if (playbackMode === 'safari') handlePushToSafari(shuffled[0])
    } else {
      setIsShuffle(false)
      originalContextRef.current = null
      if (sameTrack(currentTrack, list[0])) {
        setActivePlaybackContext(list)
        setCurrentTrackIdx(0)
        setIsPlaying(true)
      } else {
        handlePlayTrack(list[0], 0, list)
      }
    }
    setPlayingFrom(from)
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

  // ---- library ---------------------------------------------------------
  const isSavedId = (id) => savedCollections.some((c) => c.id === id)

  const toggleSave = (c) => {
    if (!c?.id || c.id.startsWith('mix_pending')) return
    if (isSavedId(c.id)) {
      const before = savedCollections
      setSavedCollections((list) => list.filter((x) => x.id !== c.id))
      showNotify('Removed from your library', 'info', { label: 'Undo', onClick: () => setSavedCollections(before) })
    } else {
      setSavedCollections((list) => [{ ...snapshot(c), savedAt: Date.now() }, ...list])
      showNotify('Saved to your library', 'success')
    }
  }

  const createPlaylist = (name, pendingTrack) => {
    const item = { id: `user_${Date.now()}`, kind: 'user', title: name, subtitle: '', tracks: pendingTrack ? [slimTrack(pendingTrack)] : [], createdAt: Date.now() }
    setSavedCollections((list) => [item, ...list])
    if (pendingTrack) showNotify(`Added to ${name}`, 'success')
    else showCollection(item, { record: false })
  }

  const addTrackToPlaylist = (pl, track) => {
    if (!pl || !track) return
    setSavedCollections((list) => list.map((c) => (c.id === pl.id ? { ...c, tracks: [...(c.tracks || []), slimTrack(track)] } : c)))
    showNotify(`Added to ${pl.title}`, 'success')
  }

  const removeFromPlaylist = (id, index) => {
    setSavedCollections((list) => list.map((c) => (c.id === id ? { ...c, tracks: c.tracks.filter((_, i) => i !== index) } : c)))
  }

  const deletePlaylist = (c) => {
    const before = savedCollections
    setSavedCollections((list) => list.filter((x) => x.id !== c.id))
    goBack('/library')
    showNotify(`Deleted "${c.title}"`, 'info', { label: 'Undo', onClick: () => setSavedCollections(before) })
  }

  // ---- downloads ---------------------------------------------------------
  const downloadTrack = async (track) => {
    if (!track?.video_id) return
    if (downloadedIds.has(track.video_id)) return showNotify('Already downloaded', 'info')
    showNotify(`Downloading "${track.title}"…`, 'info')
    try {
      await saveTrackOffline(track)
      showNotify(`"${track.title}" is ready offline`, 'success')
    } catch (e) {
      showNotify(`Download failed: ${e?.message || 'try again'}`, 'error')
    }
  }

  const downloadAll = async (c) => {
    const todo = (c?.tracks || []).filter((t) => t.video_id && !downloadedIds.has(t.video_id))
    if (!todo.length) return
    setDownloadJobs((j) => ({ ...j, [c.id]: { busy: true, done: 0, total: todo.length } }))
    let done = 0
    let failed = 0
    for (const t of todo) {
      try {
        await saveTrackOffline(t)
      } catch {
        failed++
      }
      done++
      setDownloadJobs((j) => ({ ...j, [c.id]: { busy: true, done, total: todo.length } }))
    }
    setDownloadJobs((j) => ({ ...j, [c.id]: { busy: false, done, total: todo.length } }))
    showNotify(failed ? `Downloaded ${done - failed} of ${todo.length} songs` : `"${c.title}" is ready offline`, failed ? 'error' : 'success')
  }

  const deleteDownload = async (track) => {
    try {
      await deleteOfflineTrack(track.video_id)
      showNotify('Download removed', 'info')
    } catch {}
  }

  const clearDownloads = async () => {
    try {
      await clearAllOfflineTracks()
      showNotify('All downloads deleted', 'info')
    } catch {}
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

  // ---- friends / jam -------------------------------------------------------
  const openFriends = () => {
    setInitialJamSection('friends')
    setIsJamModalOpen(true)
  }

  const listenAlong = async (friend) => {
    if (!friend) return
    if (friend.activeJamCode) {
      const ok = await jamManager.joinJam(friend.activeJamCode, googleUser)
      if (ok) showNotify(`Listening along with ${friend.name}`, 'success')
    } else if (friend.currentTrack) {
      handlePlayTrack(friend.currentTrack, 0, [friend.currentTrack])
      setPlayingFrom({ id: null, title: `${friend.name}'s pick` })
    }
  }

  const startJamWith = (c) => {
    playList(c.tracks, { from: { id: c.id, title: c.title } })
    setInitialJamSection('')
    setIsJamModalOpen(true)
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

  const upNext = useMemo(() => {
    const ctx = activePlaybackContext || []
    const idx = ctx.findIndex((t) => sameTrack(t, currentTrack))
    const rest = idx >= 0 ? ctx.slice(idx + 1) : []
    return [...queue, ...rest].slice(0, 60)
  }, [activePlaybackContext, currentTrack, queue])

  const appCtx = {
    currentTrack,
    isPlaying,
    isFav: isTrackFavorite,
    downloadedIds,
    playTrack: ctxPlayTrack,
    toggleFav: handleToggleFavorite,
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
  useEffect(() => {
    window.UpBeatHandleBack = () => {
      if (closeTopLayer()) return true
      if (route.path !== '/') {
        if (canGoBack()) window.history.back()
        else navigate('/', { replace: true })
        return true
      }
      return false
    }
  })

  // Desktop keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
  const finishOnboarding = async ({ genres = [], artists = [], chartPrefs = [] } = {}, { connect = false } = {}) => {
    setOnboardingBusy(true)
    try {
      saveStorage('upbeat_taste_prefs_v1', { genres, artists, at: Date.now() })
      if (Array.isArray(chartPrefs) && chartPrefs.length) {
        saveStorage('upbeat_chart_prefs_v1', chartPrefs)
      } else {
        saveStorage('upbeat_chart_prefs_v1', ['india', 'india_trendy', 'global50', 'us_billboard'])
      }
      try {
        sessionStorage.removeItem('upbeat_discovery_feed_cache_v7')
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
      navigate('/', { replace: true })
      if (connect) setShowGoogleModal(true)
    }
  }

  const skipOnboarding = () => {
    try {
      localStorage.setItem('upbeat_onboarded_v1', '1')
      if (!localStorage.getItem('upbeat_chart_prefs_v1')) {
        localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['india', 'india_trendy', 'global50', 'us_billboard']))
      }
    } catch {}
    setShowOnboarding(false)
  }

  const lastModelStatus = playlist
    ? {
        isFallback: Boolean(playlist.is_fallback) || (playlist.used_model && playlist.used_model !== selectedModel),
        usedModel: playlist.used_model || selectedModel,
        reason: playlist.fallback_reason || 'Target model busy or rate-limited'
      }
    : null

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
              {renderView()}
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
              {renderView()}
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

        <QueueDrawer
          isOpen={isQueueOpen}
          onClose={() => setIsQueueOpen(false)}
          queue={queue}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onPlayTrack={(track, queueIdx) => {
            if (typeof queueIdx === 'number') {
              setQueue((prev) => prev.filter((_, i) => i !== queueIdx))
            }
            handlePlayTrack(track, 0)
          }}
          onRemoveFromQueue={handleRemoveFromQueue}
          onClearQueue={handleClearQueue}
          onAddToQueue={handleAddToQueue}
          upcomingTracks={upNext.slice(queue.length)}
        />

        <GoogleAuthModal
          isOpen={showGoogleModal}
          onClose={() => setShowGoogleModal(false)}
          googleUser={googleUser}
          onLogin={handleGoogleLogin}
          onLogout={handleGoogleLogout}
          onSyncYouTubeLikes={() => handleSyncGoogleYouTubeLikes()}
          isSyncingLikes={isSyncingLikes}
        />

        <ProfileEditModal
          isOpen={isProfileEditOpen}
          onClose={() => setIsProfileEditOpen(false)}
          user={googleUser}
          onSave={handleSaveProfile}
          onNotify={showNotify}
        />

        {showOnboarding && (
          <Onboarding
            busy={onboardingBusy}
            onSkip={skipOnboarding}
            onFinish={(picks) => finishOnboarding(picks)}
            onConnect={(picks) => finishOnboarding(picks, { connect: true })}
          />
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
