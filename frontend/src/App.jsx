import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Heart, Sliders, Disc, Dna, DownloadCloud, Loader2, X, Share } from 'lucide-react'
import Navbar from './components/Navbar'
import Sidebar, { PRESET_MODES } from './components/Sidebar'
import CuratorPrompt from './components/CuratorPrompt'
import PlaylistView from './components/PlaylistView'
import SonicDnaView from './components/SonicDnaView'
import OfflineView from './components/OfflineView'
import PlayerBar from './components/PlayerBar'
import QueueDrawer from './components/QueueDrawer'
import GoogleAuthModal from './components/GoogleAuthModal'
import { getOfflineTracks, getOfflineStorageStats, subscribeOfflineChanges } from './offlineStorage'
import { initOtaUpdater } from './otaUpdater'
import { getDayNightThemeInfo, getThemeInfo, getNextThemePreference } from './utils/themeCycle'
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
  formatDurationSeconds,
  openExternalUrl
} from './standaloneApi'

const DEFAULT_SEEDS = [
  { title: 'Renai Circulation', artist: 'Kana Hanazawa', video_id: 'F8xpmTmdf6o', duration_text: '4:16', thumbnail: 'https://i.ytimg.com/vi/F8xpmTmdf6o/hqdefault.jpg' },
  { title: 'mathemagics', artist: 'Marina Inoue', video_id: 'F_Cr9vZ08Ws', duration_text: '4:05', thumbnail: 'https://i.ytimg.com/vi/F_Cr9vZ08Ws/hqdefault.jpg' },
  { title: 'Kimi no Shiranai Monogatari', artist: 'supercell', video_id: '0VpGoDp3FCE', duration_text: '5:40', thumbnail: 'https://i.ytimg.com/vi/0VpGoDp3FCE/hqdefault.jpg' },
  { title: 'Staple Stable', artist: 'Chiwa Saito', video_id: 'CXDUXjsU5ao', duration_text: '4:36', thumbnail: 'https://i.ytimg.com/vi/CXDUXjsU5ao/hqdefault.jpg' },
  { title: 'Veridis Quo', artist: 'Daft Punk', video_id: 'TCd6PfxOy0Y', duration_text: '5:45', thumbnail: 'https://i.ytimg.com/vi/TCd6PfxOy0Y/hqdefault.jpg' },
  { title: 'A New Error', artist: 'Moderat', video_id: 'QpxFcMYRV08', duration_text: '6:07', thumbnail: 'https://i.ytimg.com/vi/QpxFcMYRV08/hqdefault.jpg' }
]

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export default function App() {
  const [themePreference, setThemePreference] = useState(() => {
    try {
      return localStorage.getItem('upbeat_theme_preference') || 'auto'
    } catch {
      return 'auto'
    }
  })
  const [themeInfo, setThemeInfo] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_theme_preference') || 'auto'
      return getThemeInfo(saved)
    } catch {
      return getThemeInfo('auto')
    }
  })

  useEffect(() => {
    const checkTheme = () => {
      if (themePreference === 'auto') {
        const info = getThemeInfo('auto')
        setThemeInfo((prev) => (prev.id !== info.id ? info : prev))
      }
    }
    const interval = setInterval(checkTheme, 60000)
    return () => clearInterval(interval)
  }, [themePreference])

  const handleSelectThemePreference = (pref) => {
    setThemePreference(pref)
    try {
      localStorage.setItem('upbeat_theme_preference', pref)
    } catch {}
    const info = getThemeInfo(pref)
    setThemeInfo(info)
    const label = pref === 'auto' ? `Auto Time Cycle (${info.label})` : info.label
    showNotify(`Atmosphere: ${label}`, 'info')
  }

  const handleCycleTheme = () => {
    const nextPref = getNextThemePreference(themePreference)
    handleSelectThemePreference(nextPref)
  }

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
    if (hasBackend()) {
      return loadStorage('argon_seeds_v2', DEFAULT_SEEDS)
    }
    const raw = loadStorage('argon_seeds_v2', [])
    const animeIds = new Set(['F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE', 'CXDUXjsU5ao', 'MM8RufZr5lw', '2ZN-zAKIfyQ', 'tdzsOODJiX8'])
    return raw.filter((t) => !animeIds.has(t?.video_id))
  })
  const [favorites, setFavorites] = useState(() => {
    const raw = loadStorage('argon_favs_v2', [])
    if (!hasBackend()) {
      const animeIds = new Set(['F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE', 'CXDUXjsU5ao', 'tdzsOODJiX8'])
      return raw.filter((t) => !animeIds.has(t?.video_id))
    }
    return raw
  })
  const [tasteDna, setTasteDna] = useState(() => {
    const raw = loadStorage('argon_dna_v2', null)
    if (!hasBackend() && raw) {
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
  const [prompt, setPrompt] = useState(() => {
    return hasBackend()
      ? 'High-impact orchestral rock, Hiroyuki Sawano style soundtracks, and Monogatari / anime openings'
      : ''
  })
  const [activePresetId, setActivePresetId] = useState(() => (hasBackend() ? 'ost' : null))
  const [energyLevel, setEnergyLevel] = useState(78) // Matches 'ost' preset default (78%)
  const [trackCount, setTrackCount] = useState(8)
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
  const [offlineTracks, setOfflineTracks] = useState([])
  const [offlineStats, setOfflineStats] = useState({ count: 0, totalBytes: 0, formattedSize: '0 B' })
  const [activePlaybackContext, setActivePlaybackContext] = useState(null)
  const [queue, setQueue] = useState(() => loadStorage('upbeat_playback_queue', []))
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [googleUser, setGoogleUser] = useState(() => {
    const user = loadStorage('upbeat_google_user', null)
    // Clear out any stale test account accidentally stored from previous build
    const legacyEmail = atob('YWFyYWRoeWFuZWdpMDA5QGdtYWlsLmNvbQ==')
    const legacyName = atob('QWFyYWRoeWEgTmVnaQ==')
    if (user && (user.email === legacyEmail || user.name === legacyName)) {
      try {
        localStorage.removeItem('upbeat_google_user')
      } catch {}
      return null
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
  const [isSyncingLikes, setIsSyncingLikes] = useState(false)
  const [otaUpdate, setOtaUpdate] = useState(null)
  const [isApplyingOta, setIsApplyingOta] = useState(false)
  const [showIosInstallPrompt, setShowIosInstallPrompt] = useState(false)

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
      showNotify('Device is offline. Showing downloaded tracks.', 'info')
      setActiveTab('offline')
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

  // Automatic purge of developer anime/J-pop seeds for Android / mobile users (preserves MacBook backend!)
  useEffect(() => {
    if (!hasBackend()) {
      try {
        const cleaned = localStorage.getItem('upbeat_seeds_cleaned_v421')
        if (!cleaned) {
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

          localStorage.setItem('upbeat_seeds_cleaned_v421', 'true')
        }
      } catch (err) {
        console.warn('Seeds cleanup warning:', err)
      }
    }
  }, [])

  // Global shortcut: Cmd+B / Ctrl+B to slide toggle sidebar
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setIsSidebarOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const showNotify = (msg, type = 'info') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 3200)
  }

  // Persist to localStorage
  useEffect(() => {
    try { localStorage.setItem('argon_seeds_v2', JSON.stringify(extractedTracks)) } catch {}
  }, [extractedTracks])

  useEffect(() => {
    try { localStorage.setItem('argon_favs_v2', JSON.stringify(favorites)) } catch {}
    if (window.UpBeatNative && typeof window.UpBeatNative.syncFavorites === 'function') {
      const favsToSync = favorites?.length ? favorites : (extractedTracks?.length ? extractedTracks : DEFAULT_SEEDS)
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
        : (queue?.length ? queue : (extractedTracks?.length ? extractedTracks : DEFAULT_SEEDS))
      if (tracksToSync?.length) {
        try {
          const items = tracksToSync.slice(0, 50).map((t, idx) => ({
            index: idx,
            title: t.title || 'Unknown Title',
            artist: t.artist || 'UpBeat',
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

  // Auto-sync authentic Google avatar from active YouTube Music Safari session
  useEffect(() => {
    if (hasBackend()) {
      fetch(`${getApiBase()}/safari/profile`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.picture) {
            setGoogleUser((prev) => {
              if (!prev) return prev
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
        setFavorites(activeU.importedTracks)
        setExtractedTracks(activeU.importedTracks)
        try { localStorage.setItem('argon_seeds_v2', JSON.stringify(activeU.importedTracks)) } catch {}
        const dna = await analyzeTasteDnaStandalone(activeU.importedTracks)
        if (dna) setTasteDna(dna)
        showNotify(`Imported ${activeU.importedTracks.length} tracks & tailored taste DNA for ${activeU.name}!`, 'success')
        return
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
            })).filter((t) => t.video_id && !t.title.includes('Deleted video') && !t.title.includes('Private video'))

            if (realTracks.length > 0) {
              setFavorites(realTracks)
              setExtractedTracks(realTracks)
              try { localStorage.setItem('argon_seeds_v2', JSON.stringify(realTracks)) } catch {}
              const dna = await analyzeTasteDnaStandalone(realTracks)
              if (dna) setTasteDna(dna)
              showNotify(`Synced ${realTracks.length} authentic liked tracks from ${activeU.name}'s YouTube account!`, 'success')
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
              setFavorites(data.tracks)
              setExtractedTracks(data.tracks)
              try { localStorage.setItem('argon_seeds_v2', JSON.stringify(data.tracks)) } catch {}
              const dna = await analyzeTasteDnaStandalone(data.tracks)
              if (dna) setTasteDna(dna)
              showNotify(`Synced ${data.tracks.length} tracks from YouTube Music`, 'success')
              return
            }
          }
        } catch {}
      }

      // 4. On Android / standalone mobile:
      // If user already has hearted favorites on this device, derive their authentic taste profile from them!
      if (favorites && favorites.length > 0) {
        setExtractedTracks((prev) => {
          const existingIds = new Set(prev.map((t) => t.video_id))
          const newSeeds = favorites.filter((f) => !existingIds.has(f.video_id))
          const updated = [...newSeeds, ...prev]
          try { localStorage.setItem('argon_seeds_v2', JSON.stringify(updated)) } catch {}
          return updated
        })
        const dna = await analyzeTasteDnaStandalone(favorites)
        if (dna) setTasteDna(dna)
        showNotify(`Analyzed ${favorites.length} saved songs into ${activeU.name}'s taste profile!`, 'success')
        return
      }

      // 5. If user has seed tracks in their Library, derive from their seed tracks
      if (extractedTracks && extractedTracks.length > 0) {
        const dna = await analyzeTasteDnaStandalone(extractedTracks)
        if (dna) setTasteDna(dna)
        showNotify(`Generated taste profile for ${activeU.name} from seed tracks!`, 'success')
        return
      }

      // 6. For new users with zero songs, pull real top trending songs (not hardcoded anime)
      const searchRes = await directSearchStandalone('Top Hits 2026', 'songs')
      const starterTracks = (searchRes?.tracks || []).slice(0, 6)
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
          const activeList = playlist?.tracks?.length ? playlist.tracks : (queue?.length ? queue : (extractedTracks?.length ? extractedTracks : DEFAULT_SEEDS))
          if (!isNaN(idx) && activeList?.[idx]) {
            handlePlayTrack(activeList[idx], idx, activeList)
          }
          break
        }
        case 'play_favorite': {
          const idx = parseInt(payload, 10)
          const activeFavs = favorites?.length ? favorites : (extractedTracks?.length ? extractedTracks : DEFAULT_SEEDS)
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
            preset_anime: 'High-impact orchestral rock Hiroyuki Sawano anime openings',
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
            data.is_favorite
              ? `Saved "${track.title}" to Favorites memory`
              : `Removed "${track.title}" from Favorites`,
            'info'
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
      !alreadyLiked
        ? `Saved "${track.title}" to Favorites memory`
        : `Removed "${track.title}" from Favorites`,
      'info'
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
      showNotify('No liked songs in Favourites yet! Heart some tracks to sync & curate.', 'warning')
      return
    }

    setIsSyncing(true)
    showNotify(`Analyzing ${favorites.length} Liked songs & curating playlist...`, 'info')

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
        setPlaylist(curateData)
        if (!currentTrack || !isPlaying) {
          setCurrentTrack(curateData.tracks[0])
          setCurrentTrackIdx(0)
        }
        setActiveTab('curator')
        showNotify(`Synced ${favorites.length} Liked songs & curated "${curateData.playlist_title}"!`, 'success')
      } else {
        setActiveTab('curator')
        showNotify(`Analyzed ${favorites.length} Liked songs & updated Taste DNA!`, 'success')
      }
    } catch (err) {
      showNotify(`Sync error: ${err.message}`, 'error')
    } finally {
      setIsSyncing(false)
    }
  }

  // Generate Curated Playlist (Mac Backend + Standalone Android Fallback)
  const handleGenerate = async (overridePrompt, overrideSeeds, overrideEnergy) => {
    const activePrompt = overridePrompt || prompt
    if (!activePrompt || isGenerating) return

    if (!isConfigured()) {
      setShowKeyModal(true)
      showNotify('Add your Gemini API key or Mac Server IP to curate new playlists', 'info')
      return
    }

    setIsGenerating(true)
    setActiveTab('curator')

    try {
      let data = null
      const curateArgs = {
        mood_prompt: activePrompt,
        energy_level: overrideEnergy ?? energyLevel,
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
            throw new Error(err.detail || `Mac server returned HTTP ${res.status}`)
          }
          data = await res.json()
        } catch (backendErr) {
          // Fall back to client-side engine if Gemini API key is configured
          if (getStoredApiKey()) {
            showNotify('Curating with Gemini AI engine...', 'info')
            data = await curateStandalone(curateArgs)
          } else {
            throw backendErr
          }
        }
      } else {
        data = await curateStandalone(curateArgs)
      }

      setPlaylist(data)
      if (data.tracks && data.tracks.length > 0 && (!currentTrack || !isPlaying)) {
        setCurrentTrack(data.tracks[0])
        setCurrentTrackIdx(0)
      }
      showNotify(`Curated "${data.playlist_title}" (${data.tracks?.length || 0} tracks)`, 'success')
    } catch (e) {
      showNotify(`Generation failed: ${e.message}`, 'error')
    } finally {
      setIsGenerating(false)
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
      const label = data.active_source === 'playlist'
        ? `Loaded playlist "${data.playlist_title}" (${data.tracks?.length || 0} tracks • 0 tokens)`
        : `Found ${data.tracks?.length || 0} tracks for "${q}" (0 tokens)`
      showNotify(label, 'success')
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
        setPlaylist((prev) =>
          prev
            ? {
                ...prev,
                playlist_title: pl.title,
                subtitle: `${pl.subtitle} • 0 AI tokens`,
                vibe_description: `${pl.subtitle} • Prepared playlist`,
                active_source: 'playlist',
                active_browse_id: pl.browse_id,
                tracks
              }
            : prev
        )
        showNotify(`Loaded "${pl.title}" (${tracks.length} tracks • 0 tokens)`, 'info')
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

  const handleSelectDirectSongs = () => {
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
      if (!playlist) {
        if (hasBackend()) {
          if (isConfigured()) {
            handleGenerate(prompt, seeds)
          }
        }
        // Standalone mobile starts clean so new users can search or choose their own vibe
      } else if (playlist.tracks?.length > 0 && !currentTrack) {
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
    const matching = PRESET_MODES.find((p) => p.prompt === val)
    setActivePresetId(matching ? matching.id : null)
  }

  const handlePlayTrack = (track, idxOrList, customList) => {
    if (!track) return

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

    const isMobileDevice = typeof window !== 'undefined' && (
      Boolean(window.Capacitor?.isNativePlatform?.()) ||
      window.innerWidth < 768
    )

    const isSame = currentTrack && (
      (currentTrack.video_id && currentTrack.video_id === track.video_id) ||
      (currentTrack.title === track.title && currentTrack.artist === track.artist)
    )
    if (isSame) {
      setIsPlaying(!isPlaying)
      if (isMobileDevice) {
        setIsNowPlayingOpen(true)
      }
      return
    }
    setCurrentTrack(track)
    setCurrentTrackIdx(actualIdx)
    setIsPlaying(true)
    if (isMobileDevice) {
      setIsNowPlayingOpen(true)
    }

    if (playbackMode === 'safari') {
      handlePushToSafari(track)
    }
  }

  const handleTogglePlay = () => {
    if (!currentTrack && playlist?.tracks?.length > 0) {
      setCurrentTrack(playlist.tracks[0])
      setCurrentTrackIdx(0)
      setIsPlaying(true)
      return
    }
    setIsPlaying((prev) => !prev)
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

  const handleNext = () => {
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

  const handlePlayNext = (track) => {
    if (!track) return
    setQueue((prev) => {
      const filtered = prev.filter((t) => t.video_id !== track.video_id)
      return [track, ...filtered]
    })
    showNotify(`Playing next: "${track.title}"`, 'info')
  }

  const handleAddToQueue = (track) => {
    if (!track) return
    setQueue((prev) => [...prev, track])
    showNotify(`Added "${track.title}" to queue (${queue.length + 1})`, 'info')
  }

  const handleRemoveFromQueue = (idx) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleClearQueue = () => {
    setQueue([])
    showNotify('Playback queue cleared', 'info')
  }

  const handleAddSeedTrack = (track) => {
    if (!track) return
    setExtractedTracks((prev) => {
      const exists = prev.some((t) => t.video_id === track.video_id || (t.title === track.title && t.artist === track.artist))
      if (exists) return prev
      return [track, ...prev]
    })
    showNotify(`Added "${track.title}" to Seeds`, 'success')
  }

  const handleAddMultipleSeedTracks = (newTracks) => {
    if (!newTracks || !newTracks.length) return
    setExtractedTracks((prev) => {
      const existingIds = new Set(prev.map((t) => t.video_id).filter(Boolean))
      const toAdd = newTracks.filter((t) => !existingIds.has(t.video_id))
      return [...toAdd, ...prev]
    })
    showNotify(`Imported ${newTracks.length} seeds from YouTube`, 'success')
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

  const handlePrev = () => {
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

  const lastModelStatus = playlist
    ? {
        isFallback: Boolean(playlist.is_fallback) || (playlist.used_model && playlist.used_model !== selectedModel),
        usedModel: playlist.used_model || selectedModel,
        reason: playlist.fallback_reason || 'Target model busy or rate-limited'
      }
    : null

  return (
    <div className={`h-[100dvh] w-screen ytm-atmosphere ${themeInfo?.id || 'theme-morning'} bg-black text-[#f4f4f5] flex flex-col overflow-hidden`}>
      {/* Subtle Antigravity Status Notification */}
      {notification && (
        <div className="fixed bottom-36 sm:bottom-20 left-4 right-4 sm:left-6 sm:right-auto z-50">
          <div className={`px-3.5 py-2 rounded-lg border text-xs font-mono flex items-center gap-2 shadow-2xl backdrop-blur-md ${
            notification.type === 'error'
              ? 'bg-[#181012] text-[#fca5a5] border-rose-500/40'
              : 'bg-[#131318] text-[#f4f4f5] border-sky-500/40'
          }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              notification.type === 'error' ? 'bg-rose-500' : 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]'
            }`} />
            <span className="truncate">{notification.msg}</span>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <Navbar
        themeInfo={themeInfo}
        themePreference={themePreference}
        onCycleTheme={handleCycleTheme}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        lastModelStatus={lastModelStatus}
        safariStatus={safariStatus}
        onSyncSafari={() => handleSyncSafari(false)}
        onOpenSafari={handleOpenSafari}
        onSyncFavorites={handleSyncFavorites}
        isSyncing={isSyncing}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        extractedCount={extractedTracks.length}
        favoritesCount={favorites.length}
        offlineCount={offlineStats.count}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        showKeyModal={showKeyModal}
        setShowKeyModal={setShowKeyModal}
        prompt={prompt}
        setPrompt={handlePromptChange}
        onDirectSearch={(q) => handleDirectSearch(q, 'auto')}
        onGenerate={(p) => handleGenerate(p)}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        isGenerating={isGenerating}
        isSearching={isSearching}
        googleUser={googleUser}
        onOpenGoogleModal={() => setShowGoogleModal(true)}
      />

      {/* Workspace Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          tasteDna={tasteDna}
          energyLevel={energyLevel}
          setEnergyLevel={setEnergyLevel}
          trackCount={trackCount}
          setTrackCount={setTrackCount}
          activePresetId={activePresetId}
          onSelectPreset={handleSelectPreset}
          onNewSession={() => {
            setPrompt('')
            setActivePresetId(null)
            showNotify('New session ready', 'info')
          }}
          extractedCount={extractedTracks.length}
          favoritesCount={favorites.length}
          offlineCount={offlineStats.count}
          offlineStorageSize={offlineStats.formattedSize}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenFavoritesTab={() => setActiveTab('favorites')}
          onOpenOfflineTab={() => setActiveTab('offline')}
          onSyncFavorites={handleSyncFavorites}
          onSyncSafari={() => handleSyncSafari(false)}
          isSyncing={isSyncing}
          onOpenSafari={handleOpenSafari}
          isOpenDesktop={isSidebarOpen}
          isOpenMobile={isSidebarOpen}
          onCloseMobile={() => setIsSidebarOpen(false)}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          themeInfo={themeInfo}
          themePreference={themePreference}
          onSelectThemePreference={handleSelectThemePreference}
          onCycleTheme={handleCycleTheme}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent">
          {activeTab === 'curator' ? (
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col bg-transparent scroll-smooth">
              <CuratorPrompt
                prompt={prompt}
                setPrompt={handlePromptChange}
                onGenerate={(p) => handleGenerate(p)}
                onDirectSearch={(q) => handleDirectSearch(q, 'auto')}
                searchMode={searchMode}
                setSearchMode={setSearchMode}
                isGenerating={isGenerating}
                isSearching={isSearching}
                selectedModel={selectedModel}
              />
              <PlaylistView
                playlist={playlist}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                selectedModel={selectedModel}
                isResolvingBatch={isResolvingBatch}
                isTrackFavorite={isTrackFavorite}
                onToggleFavorite={handleToggleFavorite}
                onPlayTrack={handlePlayTrack}
                onPushToSafari={handlePushToSafari}
                onPlayNext={handlePlayNext}
                onAddToQueue={handleAddToQueue}
                isGenerating={isGenerating}
                isSearching={isSearching}
                isLoadingPlaylistBrowse={isLoadingPlaylistBrowse}
                onSelectMatchedPlaylist={handleSelectMatchedPlaylist}
                onSelectYoutubeResults={handleSelectYoutubeResults}
                onSelectDirectSongs={handleSelectDirectSongs}
                onGenerateDefault={() => handleDirectSearch('New Hindi Songs', 'auto')}
                onSelectStarter={(q) => {
                  setPrompt(q)
                  handleDirectSearch(q, 'auto')
                }}
                needsSetup={!isConfigured()}
                onOpenSettings={() => setShowKeyModal(true)}
                googleUser={googleUser}
              />
            </div>
          ) : activeTab === 'offline' ? (
            <OfflineView
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onPlayTrack={handlePlayTrack}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onPlayNext={handlePlayNext}
              onAddToQueue={handleAddToQueue}
            />
          ) : (
            <SonicDnaView
              mode={activeTab}
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
                setExtractedTracks([])
                try { localStorage.setItem('argon_seeds_v2', '[]') } catch {}
                showNotify('Seed library cleared', 'info')
              }}
              onResetTasteDna={() => {
                setTasteDna(null)
                try { localStorage.removeItem('argon_dna_v2') } catch {}
                showNotify('Sonic Taste DNA reset', 'info')
              }}
              onCurateSimilar={(track) => {
                const newPrompt = `Tracks with the exact musical style and atmosphere of "${track.title}" by ${track.artist}`
                setPrompt(newPrompt)
                setActivePresetId(null)
                handleGenerate(newPrompt)
              }}
            />
          )}
        </main>
      </div>

      {/* Bottom Transport Bar */}
      <PlayerBar
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
      />

      {/* Playback Queue Drawer */}
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
        upcomingTracks={(playlist?.tracks || []).slice(currentTrackIdx + 1)}
      />

      {/* Google & YouTube Account Auth Modal */}
      <GoogleAuthModal
        isOpen={showGoogleModal}
        onClose={() => setShowGoogleModal(false)}
        googleUser={googleUser}
        onLogin={handleGoogleLogin}
        onLogout={handleGoogleLogout}
        onSyncYouTubeLikes={() => handleSyncGoogleYouTubeLikes()}
        isSyncingLikes={isSyncingLikes}
      />

      {/* Floating Pill Dock Navigation (Mobile & Mac) - Only Symbols Used */}
      <nav className="pb-safe px-3 pt-1 pb-2 bg-gradient-to-t from-black via-black/80 to-transparent flex items-center justify-center shrink-0 z-30 select-none">
        <div className="w-full max-w-sm sm:max-w-md floating-dock rounded-full p-1.5 px-3 flex items-center justify-around shadow-2xl">
          {/* Curator / Home */}
          <button
            onClick={() => { setActiveTab('curator'); setIsSidebarOpen(false) }}
            className={`transition-all cursor-pointer ${
              activeTab === 'curator' && !isSidebarOpen
                ? 'w-11 h-11 rounded-full bg-white text-black shadow-lg shadow-white/20 flex items-center justify-center scale-105'
                : 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white'
            }`}
            title="AI Curator"
            aria-label="AI Curator"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          {/* Favourites */}
          <button
            onClick={() => { setActiveTab('favorites'); setIsSidebarOpen(false) }}
            className={`relative transition-all cursor-pointer ${
              activeTab === 'favorites' && !isSidebarOpen
                ? 'w-11 h-11 rounded-full bg-white text-rose-600 shadow-lg shadow-white/20 flex items-center justify-center scale-105'
                : 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white'
            }`}
            title="Favourites"
            aria-label="Favourites"
          >
            <div className="relative">
              <Heart className={`w-5 h-5 ${favorites.length > 0 ? 'fill-rose-500 text-rose-500' : ''}`} />
              {favorites.length > 0 && activeTab !== 'favorites' && (
                <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#0a0a0e]" />
              )}
            </div>
          </button>

          {/* Offline Downloads */}
          <button
            onClick={() => { setActiveTab('offline'); setIsSidebarOpen(false) }}
            className={`relative transition-all cursor-pointer ${
              activeTab === 'offline' && !isSidebarOpen
                ? 'w-11 h-11 rounded-full bg-white text-emerald-600 shadow-lg shadow-white/20 flex items-center justify-center scale-105'
                : 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white'
            }`}
            title="Offline Downloads"
            aria-label="Offline Downloads"
          >
            <div className="relative">
              <DownloadCloud className={`w-5 h-5 ${offlineStats.count > 0 ? 'text-emerald-500' : ''}`} />
              {offlineStats.count > 0 && activeTab !== 'offline' && (
                <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[#0a0a0e]" />
              )}
            </div>
          </button>

          {/* Seeds Library */}
          <button
            onClick={() => { setActiveTab('library'); setIsSidebarOpen(false) }}
            className={`transition-all cursor-pointer ${
              activeTab === 'library' && !isSidebarOpen
                ? 'w-11 h-11 rounded-full bg-white text-sky-600 shadow-lg shadow-white/20 flex items-center justify-center scale-105'
                : 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white'
            }`}
            title="Seeds Library"
            aria-label="Seeds Library"
          >
            <Disc className="w-5 h-5" />
          </button>

          {/* Taste Profile */}
          <button
            onClick={() => { setActiveTab('dna'); setIsSidebarOpen(false) }}
            className={`transition-all cursor-pointer ${
              activeTab === 'dna' && !isSidebarOpen
                ? 'w-11 h-11 rounded-full bg-white text-emerald-600 shadow-lg shadow-white/20 flex items-center justify-center scale-105'
                : 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white'
            }`}
            title="Sonic Profile"
            aria-label="Sonic Profile"
          >
            <Dna className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Floating iOS Safari PWA Install Banner */}
      {showIosInstallPrompt && (
        <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-6 sm:top-5 z-50 animate-in fade-in slide-in-from-top-4 duration-200 select-none">
          <div className="bg-[#12121a]/95 backdrop-blur-md border border-sky-500/30 rounded-2xl p-3 sm:px-4 sm:py-3 shadow-2xl flex items-center justify-between gap-3 text-white max-w-md mx-auto">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0 text-sky-400">
                <Share className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                  <span>Install UpBeat on iPhone</span>
                </div>
                <div className="text-[11px] text-zinc-400 leading-tight">
                  Tap <span className="text-sky-300 font-medium">Share</span> then <span className="text-sky-300 font-medium">Add to Home Screen</span> for full-screen audio
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowIosInstallPrompt(false)
                try { localStorage.setItem('upbeat_pwa_prompt_dismissed', '1') } catch {}
              }}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Over-The-Air (OTA) Live Update Banner */}
      {otaUpdate && (
        <div className="fixed bottom-20 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-24 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200 select-none">
          <div className="bg-[#12121a]/95 backdrop-blur-md border border-purple-500/40 rounded-2xl p-3 sm:px-4 sm:py-3 shadow-2xl flex items-center justify-between gap-3 text-white max-w-md mx-auto">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 text-purple-400">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                  <span>Live Update Available</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 bg-purple-500/30 text-purple-200 rounded-full">{otaUpdate.latestVersion}</span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate">
                  {isApplyingOta ? 'Downloading & applying live update...' : 'No APK reinstall needed • Tap to update'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={async () => {
                  setIsApplyingOta(true)
                  try {
                    await otaUpdate.autoApply()
                  } catch (e) {
                    setIsApplyingOta(false)
                    showNotify('Update failed: ' + (e?.message || 'Check connection'), 'error')
                  }
                }}
                disabled={isApplyingOta}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold transition-all cursor-pointer shadow-md active:scale-95 flex items-center gap-1.5"
              >
                {isApplyingOta && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isApplyingOta ? 'Updating...' : 'Update'}</span>
              </button>

              <button
                onClick={() => setOtaUpdate(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
