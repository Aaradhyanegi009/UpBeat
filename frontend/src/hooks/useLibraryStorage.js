/**
 * Persistent music library, collections, favorites, play history, and offline download management hook.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  getOfflineTracks,
  getOfflineStorageStats,
  subscribeOfflineChanges,
  saveTrackOffline,
  deleteOfflineTrack,
  clearAllOfflineTracks,
  isOfflineModeActive,
  setOfflineModeActive
} from '../offlineStorage'
import { sameTrack } from '../ui/AppContext'
import {
  getStoredServerUrl,
  isNativeApp,
  isValidMusicTrack
} from '../standaloneApi'

export const DEFAULT_SEEDS = []

const LEGACY_ANIME_SEED_IDS = new Set([
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

export function slimTrack(t) {
  if (!t) return null
  const rawThumb = typeof t.thumbnail === 'string' ? t.thumbnail : ''
  const thumb = rawThumb && !rawThumb.startsWith('data:')
    ? rawThumb
    : (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
  return {
    video_id: t.video_id || '',
    title: t.title || '',
    artist: t.artist || '',
    thumbnail: thumb,
    duration_text: t.duration_text || ''
  }
}

export function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {}
  return fallback
}

export function hasMacCompanion() {
  try {
    return Boolean(getStoredServerUrl()) || (!isNativeApp() && window.location.port === '8000')
  } catch {
    return false
  }
}

export function snapshotCollection(c) {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    subtitle: c.subtitle || '',
    prompt: c.prompt || '',
    cover: c.cover || '',
    tracks: (c.tracks || []).slice(0, 200).map(slimTrack),
    createdAt: c.createdAt || Date.now()
  }
}

export function useLibraryStorage({ showNotify, navigate, goBack, initialSearchQuery = '' }) {
  const [extractedTracks, setExtractedTracks] = useState(() => {
    const raw = loadStorage('argon_seeds_v2', [])
    return (raw || []).filter((t) => !LEGACY_ANIME_SEED_IDS.has(t?.video_id))
  })
  const [favorites, setFavorites] = useState(() => {
    const raw = loadStorage('argon_favs_v2', [])
    return (raw || []).filter((t) => !LEGACY_ANIME_SEED_IDS.has(t?.video_id))
  })
  const [tasteDna, setTasteDna] = useState(() => loadStorage('argon_dna_v2', null))
  const [playlist, setPlaylist] = useState(() => loadStorage('argon_playlist_v2', null))
  const [queue, setQueue] = useState(() => loadStorage('upbeat_playback_queue', []))
  const [offlineTracks, setOfflineTracks] = useState([])
  const [offlineStats, setOfflineStats] = useState({ count: 0, totalBytes: 0, formattedSize: '0 B' })
  const [offlineLoaded, setOfflineLoaded] = useState(false)
  const [offlineMode, setOfflineModeState] = useState(() => Boolean(isOfflineModeActive()))
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [searchResults, setSearchResults] = useState(null)
  const [recentSearches, setRecentSearches] = useState(() => loadStorage('upbeat_recent_searches_v1', []))
  const [savedCollections, setSavedCollections] = useState(() => loadStorage('upbeat_library_v1', []))
  const [recentMixes, setRecentMixes] = useState(() => loadStorage('upbeat_mixes_v1', []))
  const [playHistory, setPlayHistory] = useState(() => loadStorage('upbeat_history_v1', []))
  const [recents, setRecents] = useState(() => loadStorage('upbeat_recents_v1', []))
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [playingFrom, setPlayingFrom] = useState(null)
  const [downloadJobs, setDownloadJobs] = useState({})
  const [downloadProgress, setDownloadProgress] = useState({})
  const collectionTokenRef = useRef(0)
  const downloadControllersRef = useRef(new Map())
  const offlineModeRef = useRef(offlineMode)
  offlineModeRef.current = offlineMode

  // Boot sanitizer: purge non-music tracks & legacy seeds from persisted storage
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

  // Clean legacy seed IDs on first mount
  useEffect(() => {
    try {
      setExtractedTracks((prev) => {
        const filtered = (prev || []).filter((t) => !LEGACY_ANIME_SEED_IDS.has(t?.video_id))
        saveStorage('argon_seeds_v2', filtered)
        return filtered
      })

      setFavorites((prev) => {
        const filtered = (prev || []).filter((t) => !LEGACY_ANIME_SEED_IDS.has(t?.video_id))
        saveStorage('argon_favs_v2', filtered)
        return filtered
      })
    } catch {}
  }, [])

  // Persist core library state & bridge Android Auto native queues
  useEffect(() => {
    saveStorage('argon_seeds_v2', extractedTracks)
  }, [extractedTracks])

  useEffect(() => {
    saveStorage('argon_favs_v2', favorites)
    if (typeof window !== 'undefined' && window.UpBeatNative && typeof window.UpBeatNative.syncFavorites === 'function') {
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
    if (tasteDna) saveStorage('argon_dna_v2', tasteDna)
  }, [tasteDna])

  useEffect(() => {
    if (playlist) saveStorage('argon_playlist_v2', playlist)
    if (typeof window !== 'undefined' && window.UpBeatNative && typeof window.UpBeatNative.syncQueue === 'function') {
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

  useEffect(() => saveStorage('upbeat_playback_queue', queue), [queue])
  useEffect(() => saveStorage('upbeat_library_v1', savedCollections), [savedCollections])
  useEffect(() => saveStorage('upbeat_mixes_v1', recentMixes), [recentMixes])
  useEffect(() => saveStorage('upbeat_history_v1', playHistory), [playHistory])
  useEffect(() => saveStorage('upbeat_recents_v1', recents), [recents])
  useEffect(() => saveStorage('upbeat_recent_searches_v1', recentSearches), [recentSearches])

  useEffect(() => {
    const syncToCar = () => {
      const bridge = typeof window !== 'undefined' ? window.UpBeatNative : null
      if (!bridge || typeof bridge.syncMixes !== 'function') return
      const seen = new Set()
      const mapTrack = (t) => ({
        title: t?.title || '',
        artist: t?.artist || '',
        video_id: t?.video_id || '',
        thumbnail: t?.thumbnail || '',
        duration_text: t?.duration_text || ''
      })
      const entries = []
      const pushEntry = (item, kind, subtitle, fallbackCover = '') => {
        const key = `${kind}:${item?.id || item?.title || ''}`
        if (!item?.title || seen.has(key)) return
        seen.add(key)
        const tracks = Array.isArray(item.tracks) ? item.tracks.filter((t) => t?.video_id).slice(0, 50).map(mapTrack) : []
        entries.push({
          id: String(item.id || `${kind}_${entries.length}`),
          title: item.title,
          subtitle: subtitle || item.subtitle || (tracks.length ? `${tracks.length} songs` : 'Curated mix'),
          kind,
          query: item.query || '',
          cover: item.cover || tracks[0]?.thumbnail || fallbackCover || '',
          tracks
        })
      }

      for (const c of savedCollections) {
        if (!c?.tracks?.length) continue
        pushEntry(c, c.kind || 'user', c.kind === 'mix' ? 'Saved mix' : `${c.tracks.length} songs`)
      }
      for (const m of recentMixes) {
        if (!m?.tracks?.length) continue
        pushEntry(m, 'mix', 'AI mix')
      }

      try {
        const rawBlocks = localStorage.getItem('upbeat_aa_discovery_blocks_v1')
        const blocks = rawBlocks ? JSON.parse(rawBlocks) : []
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b?.tier === 2) {
              pushEntry(b, 'foryou', b.subtitle || 'Made For You', b.cover)
            }
          }
          for (const b of blocks) {
            if (b?.tier === 1) {
              pushEntry(b, 'chart', b.subtitle || 'Daily Top Chart', b.cover)
            }
          }
        }
      } catch {}

      try {
        bridge.syncMixes(JSON.stringify(entries.slice(0, 32)))
      } catch {}
    }

    syncToCar()
    if (typeof window !== 'undefined') {
      window.addEventListener('upbeat-discovery-blocks-updated', syncToCar)
      return () => window.removeEventListener('upbeat-discovery-blocks-updated', syncToCar)
    }
  }, [savedCollections, recentMixes])

  // Offline storage subscription & online/offline event listeners
  useEffect(() => {
    let mounted = true
    const reloadOffline = async () => {
      try {
        const tracks = await getOfflineTracks()
        const stats = await getOfflineStorageStats()
        if (mounted) {
          setOfflineTracks(tracks || [])
          setOfflineStats(stats || { count: 0, totalBytes: 0, formattedSize: '0 B' })
          setOfflineLoaded(true)
          const activeOffline = Boolean(isOfflineModeActive())
          offlineModeRef.current = activeOffline
          setOfflineModeState(activeOffline)
        }
      } catch (err) {
        console.error('Error loading offline tracks:', err)
      }
    }
    reloadOffline()
    const unsub = subscribeOfflineChanges(() => reloadOffline())
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
      mounted = false
      unsub()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [navigate, showNotify])

  // Sync offline tracks to Android Auto native bridge
  useEffect(() => {
    if (!offlineLoaded) return
    try {
      window.UpBeatNative?.syncDownloads?.(JSON.stringify(offlineTracks.map(slimTrack)))
    } catch {}
  }, [offlineTracks, offlineLoaded])

  // Abort active download jobs on unmount
  useEffect(() => {
    return () => {
      for (const ctrl of downloadControllersRef.current.values()) {
        try { ctrl.abort() } catch {}
      }
      downloadControllersRef.current.clear()
    }
  }, [])

  const setOfflineMode = useCallback((valOrFn) => {
    const prev = offlineModeRef.current
    const raw = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn
    const next = Boolean(raw)
    offlineModeRef.current = next
    setOfflineModeState(next)
    setOfflineModeActive(next)
  }, [])

  const toggleOfflineMode = useCallback(() => {
    const next = !offlineModeRef.current
    setOfflineMode(next)
    showNotify?.(next ? 'Offline mode enabled' : 'Offline mode disabled', 'info')
  }, [setOfflineMode, showNotify])

  const downloadedIds = useMemo(
    () => new Set(offlineTracks.map((t) => t.video_id).filter(Boolean)),
    [offlineTracks]
  )

  const recordMix = useCallback((mix) => {
    setRecentMixes((prev) => [snapshotCollection(mix), ...prev.filter((m) => m.id !== mix.id)].slice(0, 20))
  }, [])

  const recordRecent = useCallback((c) => {
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
            collection: { ...snapshotCollection(c), tracks: (c.tracks || []).slice(0, 80).map(slimTrack) }
          }
    setRecents((prev) => [entry, ...prev.filter((r) => r.key !== entry.key)].slice(0, 12))
  }, [])

  const recordHistoryTrack = useCallback((track) => {
    if (!track || (!track.video_id && !track.title)) return
    setPlayHistory((prev) => [slimTrack(track), ...prev.filter((t) => !sameTrack(t, track))].slice(0, 100))
  }, [])

  const showCollection = useCallback((c, { record = true } = {}) => {
    collectionTokenRef.current++
    setCollectionLoading(false)
    setPlaylist(c)
    if (record) recordRecent(c)
    navigate('/collection')
  }, [navigate, recordRecent])

  const loadCollection = useCallback(async (base, loader) => {
    const token = ++collectionTokenRef.current
    setPlaylist({ ...base, tracks: [] })
    setCollectionLoading(true)
    navigate('/collection')
    try {
      const raw = await loader()
      if (token !== collectionTokenRef.current) return
      const tracks = (raw || []).filter(isValidMusicTrack)
      const leadCover = tracks[0]?.video_id
        ? `https://i.ytimg.com/vi/${tracks[0].video_id}/maxresdefault.jpg`
        : (tracks[0]?.thumbnail || base.cover || '')
      const full = { ...base, tracks, cover: leadCover || base.cover || '' }
      setPlaylist(full)
      if (tracks.length) recordRecent(full)
    } catch {
      if (token === collectionTokenRef.current) showNotify(`Couldn't load "${base.title}"`, 'error')
    } finally {
      if (token === collectionTokenRef.current) setCollectionLoading(false)
    }
  }, [navigate, recordRecent, showNotify])

  const isSavedId = useCallback((id) => savedCollections.some((c) => c.id === id), [savedCollections])

  const toggleSave = useCallback((c) => {
    if (!c?.id || c.id.startsWith('mix_pending')) return
    if (savedCollections.some((x) => x.id === c.id)) {
      const before = savedCollections
      setSavedCollections((list) => list.filter((x) => x.id !== c.id))
      showNotify('Removed from your library', 'info', { label: 'Undo', onClick: () => setSavedCollections(before) })
    } else {
      setSavedCollections((list) => [{ ...snapshotCollection(c), savedAt: Date.now() }, ...list])
      showNotify('Saved to your library', 'success')
    }
  }, [savedCollections, showNotify])

  const createPlaylist = useCallback((name, pendingTrack) => {
    const item = {
      id: `user_${Date.now()}`,
      kind: 'user',
      title: name,
      subtitle: '',
      tracks: pendingTrack ? [slimTrack(pendingTrack)] : [],
      createdAt: Date.now()
    }
    setSavedCollections((list) => [item, ...list])
    if (pendingTrack) showNotify(`Added to ${name}`, 'success')
    else showCollection(item, { record: false })
  }, [showCollection, showNotify])

  const savePlaylistWithTracks = useCallback((title, tracks = []) => {
    const cleanTitle = String(title || '').trim() || 'Untitled Playlist'
    const cleanTracks = (Array.isArray(tracks) ? tracks : [])
      .filter((t) => t && (t.video_id || t.title))
      .slice(0, 200)
      .map(slimTrack)
      .filter(Boolean)
    const item = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'user',
      title: cleanTitle,
      subtitle: `${cleanTracks.length} song${cleanTracks.length === 1 ? '' : 's'}`,
      cover: cleanTracks[0]?.thumbnail || '',
      tracks: cleanTracks,
      createdAt: Date.now(),
      savedAt: Date.now()
    }
    setSavedCollections((list) => {
      const next = [item, ...list]
      saveStorage('upbeat_library_v1', next)
      return next
    })
    showNotify?.(`Saved "${cleanTitle}" (${cleanTracks.length} songs)`, 'success')
    return item
  }, [showNotify])

  const addTrackToPlaylist = useCallback((pl, track) => {
    if (!pl || !track) return
    setSavedCollections((list) =>
      list.map((c) => (c.id === pl.id ? { ...c, tracks: [...(c.tracks || []), slimTrack(track)] } : c))
    )
    showNotify(`Added to ${pl.title}`, 'success')
  }, [showNotify])

  const removeFromPlaylist = useCallback((id, index) => {
    setSavedCollections((list) =>
      list.map((c) => (c.id === id ? { ...c, tracks: c.tracks.filter((_, i) => i !== index) } : c))
    )
  }, [])

  const deletePlaylist = useCallback((c) => {
    const before = savedCollections
    setSavedCollections((list) => list.filter((x) => x.id !== c.id))
    goBack('/library')
    showNotify(`Deleted "${c.title}"`, 'info', { label: 'Undo', onClick: () => setSavedCollections(before) })
  }, [goBack, savedCollections, showNotify])

  const downloadTrack = useCallback(async (track) => {
    if (!track?.video_id) return
    if (downloadedIds.has(track.video_id)) return showNotify('Already downloaded', 'info')
    showNotify(`Downloading "${track.title}"…`, 'info')
    try {
      await saveTrackOffline(track, {
        onProgress: ({ pct }) => {
          setDownloadProgress((p) => ({ ...p, [track.video_id]: pct }))
        }
      })
      showNotify(`"${track.title}" is ready offline`, 'success')
    } catch (e) {
      if (e?.name === 'AbortError') {
        showNotify('Download cancelled', 'info')
      } else {
        showNotify(`Download failed: ${e?.message || 'try again'}`, 'error')
      }
    } finally {
      setDownloadProgress((p) => {
        if (!(track.video_id in p)) return p
        const next = { ...p }
        delete next[track.video_id]
        return next
      })
    }
  }, [downloadedIds, showNotify])

  const cancelDownloadJob = useCallback((collectionId) => {
    if (!collectionId) return false
    const ctrl = downloadControllersRef.current.get(collectionId)
    if (ctrl) {
      try { ctrl.abort() } catch {}
      downloadControllersRef.current.delete(collectionId)
      setDownloadJobs((j) => {
        const cur = j[collectionId]
        return cur ? { ...j, [collectionId]: { ...cur, busy: false, cancelled: true } } : j
      })
      return true
    }
    return false
  }, [])

  const downloadAll = useCallback(async (c) => {
    const todo = (c?.tracks || []).filter((t) => t.video_id && !downloadedIds.has(t.video_id))
    if (!todo.length || !c?.id) return
    const prevCtrl = downloadControllersRef.current.get(c.id)
    if (prevCtrl) {
      try { prevCtrl.abort() } catch {}
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    if (controller) downloadControllersRef.current.set(c.id, controller)

    setDownloadJobs((j) => ({ ...j, [c.id]: { busy: true, done: 0, total: todo.length, cancelled: false } }))
    let done = 0
    let failed = 0
    let cancelled = false
    const clearTrackProgress = (vid) => {
      setDownloadProgress((p) => {
        if (!(vid in p)) return p
        const next = { ...p }
        delete next[vid]
        return next
      })
    }
    for (const t of todo) {
      if (controller?.signal?.aborted) {
        cancelled = true
        break
      }
      let trackAborted = false
      try {
        await saveTrackOffline(t, {
          signal: controller?.signal,
          onProgress: ({ pct }) => {
            setDownloadProgress((p) => ({ ...p, [t.video_id]: pct }))
          }
        })
      } catch (e) {
        if (e?.name === 'AbortError' || controller?.signal?.aborted) {
          cancelled = true
          trackAborted = true
        } else {
          failed++
        }
      } finally {
        clearTrackProgress(t.video_id)
      }
      if (trackAborted) break
      done++
      setDownloadJobs((j) => ({ ...j, [c.id]: { busy: true, done, total: todo.length, cancelled: false } }))
    }
    if (downloadControllersRef.current.get(c.id) === controller) {
      downloadControllersRef.current.delete(c.id)
    }
    setDownloadJobs((j) => ({ ...j, [c.id]: { busy: false, done, total: todo.length, cancelled } }))
    if (cancelled) {
      showNotify(`Cancelled download for "${c.title}"`, 'info')
    } else {
      showNotify(
        failed ? `Downloaded ${done - failed} of ${todo.length} songs` : `"${c.title}" is ready offline`,
        failed ? 'error' : 'success'
      )
    }
  }, [downloadedIds, showNotify])

  const deleteDownload = useCallback(async (track) => {
    try {
      await deleteOfflineTrack(track.video_id)
      showNotify('Download removed', 'info')
    } catch {}
  }, [showNotify])

  const clearDownloads = useCallback(async () => {
    try {
      await clearAllOfflineTracks()
      showNotify('All downloads deleted', 'info')
    } catch {}
  }, [showNotify])

  return {
    extractedTracks,
    setExtractedTracks,
    favorites,
    setFavorites,
    tasteDna,
    setTasteDna,
    playlist,
    setPlaylist,
    queue,
    setQueue,
    offlineTracks,
    offlineStats,
    offlineMode,
    setOfflineMode,
    toggleOfflineMode,
    downloadedIds,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    recentSearches,
    setRecentSearches,
    savedCollections,
    setSavedCollections,
    recentMixes,
    setRecentMixes,
    playHistory,
    setPlayHistory,
    recents,
    setRecents,
    collectionLoading,
    setCollectionLoading,
    playingFrom,
    setPlayingFrom,
    downloadJobs,
    downloadProgress,
    collectionTokenRef,
    recordMix,
    recordRecent,
    recordHistoryTrack,
    showCollection,
    loadCollection,
    isSavedId,
    toggleSave,
    createPlaylist,
    savePlaylistWithTracks,
    addTrackToPlaylist,
    removeFromPlaylist,
    deletePlaylist,
    downloadTrack,
    downloadAll,
    cancelDownloadJob,
    deleteDownload,
    clearDownloads
  }
}
