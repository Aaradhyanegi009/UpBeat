/**
 * Audio playback state machine, queue/shuffle management, next/prev navigation, and favorite toggling.
 */
import { useState, useRef, useMemo, useCallback } from 'react'
import { sameTrack } from '../ui/AppContext'
import { jamManager } from '../jamEngine'
import {
  getApiBase,
  hasBackend,
  formatDurationSeconds,
  fisherYatesShuffle
} from '../standaloneApi'

export function useAudioPlayback({
  playlist,
  setPlaylist,
  favorites,
  setFavorites,
  extractedTracks,
  offlineTracks,
  queue,
  setQueue,
  activeTab,
  setPlayingFrom,
  remoteJamGuardRef,
  onPushToSafari,
  showNotify
}) {
  const [currentTrack, setCurrentTrack] = useState(null)
  const [currentTrackIdx, setCurrentTrackIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackMode, setPlaybackMode] = useState('app')
  const [activePlaybackContext, setActivePlaybackContext] = useState(null)
  const [isShuffle, setIsShuffle] = useState(false)
  const [repeatMode, setRepeatModeState] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_repeat_mode')
      return saved === 'all' || saved === 'one' ? saved : 'off'
    } catch {
      return 'off'
    }
  })
  const [crossfadeSec, setCrossfadeSecState] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_crossfade_sec')
      return saved !== null ? Math.max(0, Math.min(12, parseInt(saved, 10) || 0)) : 5
    } catch {
      return 5
    }
  })

  const currentTrackRef = useRef(currentTrack)
  const isPlayingRef = useRef(isPlaying)
  const queueRef = useRef(queue)
  const repeatModeRef = useRef(repeatMode)
  const originalQueueRef = useRef(null)
  const originalContextRef = useRef(null)
  const handleNextRef = useRef(null)
  const handlePrevRef = useRef(null)

  currentTrackRef.current = currentTrack
  isPlayingRef.current = isPlaying
  queueRef.current = queue
  repeatModeRef.current = repeatMode

  const setRepeatMode = useCallback((valOrFn) => {
    setRepeatModeState((prev) => {
      const raw = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn
      const next = raw === 'all' || raw === 'one' ? raw : 'off'
      repeatModeRef.current = next
      try {
        localStorage.setItem('upbeat_repeat_mode', next)
      } catch {}
      try {
        if (typeof window !== 'undefined' && typeof window.UpBeatNative?.syncRepeatMode === 'function') {
          window.UpBeatNative.syncRepeatMode(next)
        }
      } catch {}
      return next
    })
  }, [])

  const setCrossfadeSec = useCallback((val) => {
    const clean = Math.max(0, Math.min(12, Math.round(Number(val) || 0)))
    setCrossfadeSecState(clean)
    try {
      localStorage.setItem('upbeat_crossfade_sec', String(clean))
    } catch {}
  }, [])

  const isTrackFavorite = useCallback((track) => {
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
  }, [favorites])

  const handleToggleFavorite = useCallback(async (track) => {
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
      alreadyLiked
        ? {
            label: 'Undo',
            onClick: () => setFavorites((cur) => (cur.some((f) => sameTrack(f, track)) ? cur : [track, ...cur]))
          }
        : null
    )
  }, [favorites, isTrackFavorite, setFavorites, showNotify])

  const getActiveTrackList = useCallback(() => {
    if (activePlaybackContext && activePlaybackContext.length > 0) return activePlaybackContext
    if (activeTab === 'library') return extractedTracks
    if (activeTab === 'favorites') return favorites
    if (activeTab === 'offline') return offlineTracks
    return playlist?.tracks || []
  }, [activePlaybackContext, activeTab, extractedTracks, favorites, offlineTracks, playlist])

  const handlePlayTrack = useCallback((track, idxOrList, customList) => {
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
        (t) =>
          (t.video_id && track.video_id && t.video_id === track.video_id) ||
          (t.title === track.title && t.artist === track.artist)
      )
      actualIdx = found >= 0 ? found : 0
    } else if (typeof idxOrList === 'number') {
      actualIdx = idxOrList
      if (Array.isArray(customList) && customList.length > 0) listToUse = customList
    }

    if (listToUse && listToUse.length > 0) {
      setActivePlaybackContext(listToUse)
    } else if (activeTab === 'library') {
      setActivePlaybackContext(extractedTracks)
    } else if (activeTab === 'favorites') {
      setActivePlaybackContext(favorites)
    } else if (activeTab === 'offline') {
      setActivePlaybackContext(offlineTracks)
    } else {
      setActivePlaybackContext(playlist?.tracks || [])
    }

    const isSame =
      currentTrack &&
      ((currentTrack.video_id && currentTrack.video_id === track.video_id) ||
        (currentTrack.title === track.title && currentTrack.artist === track.artist))
    if (isSame) {
      const nextPlay = !isPlayingRef.current
      isPlayingRef.current = nextPlay
      setIsPlaying(nextPlay)
      const curTime = window.UpBeatControls?.getCurrentTime?.() || 0
      if (!nextPlay) window.UpBeatControls?.forcePause?.(curTime)
      else window.UpBeatControls?.forcePlay?.()
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
    if (playbackMode === 'safari' && onPushToSafari) {
      onPushToSafari(track)
    }
  }, [activeTab, currentTrack, extractedTracks, favorites, offlineTracks, onPushToSafari, playbackMode, playlist, remoteJamGuardRef, setQueue, showNotify])

  const handleTogglePlay = useCallback(() => {
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
    if (!next) window.UpBeatControls?.forcePause?.(curTime)
    else window.UpBeatControls?.forcePlay?.()
    if (jamManager.state.active && !remoteJamGuardRef.current) {
      jamManager.broadcastPlayState(next, curTime, currentTrackRef.current)
    }
  }, [currentTrack, playlist, remoteJamGuardRef, showNotify])

  const handleNext = useCallback((fromRemote = false) => {
    if (jamManager.state.active && !jamManager.state.isHost && !fromRemote && !remoteJamGuardRef.current) {
      if (jamManager.state.djMode === 'host_only') {
        showNotify('Host Only DJ mode is active', 'info')
        return
      }
      jamManager.emitPlaybackControl('NEXT', {})
    }
    if (queue.length > 0) {
      const nextTrack = queue[0]
      setQueue((prev) => prev.slice(1))
      setCurrentTrack(nextTrack)
      setIsPlaying(true)
      if (playbackMode === 'safari' && onPushToSafari) onPushToSafari(nextTrack)
      return
    }
    const list = getActiveTrackList()
    if (!list || list.length === 0) return

    let curIdx = typeof currentTrackIdx === 'number' ? currentTrackIdx : 0
    if (
      currentTrack &&
      (curIdx < 0 ||
        curIdx >= list.length ||
        (list[curIdx]?.video_id !== currentTrack.video_id && list[curIdx]?.title !== currentTrack.title))
    ) {
      const found = list.findIndex(
        (t) =>
          (t.video_id && currentTrack.video_id && t.video_id === currentTrack.video_id) ||
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
    if (playbackMode === 'safari' && onPushToSafari) onPushToSafari(nextTrack)
  }, [currentTrack, currentTrackIdx, getActiveTrackList, onPushToSafari, playbackMode, queue, remoteJamGuardRef, setQueue, showNotify])

  handleNextRef.current = handleNext

  const handlePrev = useCallback((fromRemote = false) => {
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
    if (
      currentTrack &&
      (curIdx < 0 ||
        curIdx >= list.length ||
        (list[curIdx]?.video_id !== currentTrack.video_id && list[curIdx]?.title !== currentTrack.title))
    ) {
      const found = list.findIndex(
        (t) =>
          (t.video_id && currentTrack.video_id && t.video_id === currentTrack.video_id) ||
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
    if (playbackMode === 'safari' && onPushToSafari) onPushToSafari(prevTrack)
  }, [currentTrack, currentTrackIdx, getActiveTrackList, onPushToSafari, playbackMode, remoteJamGuardRef, showNotify])

  handlePrevRef.current = handlePrev

  const handlePlayNext = useCallback((track) => {
    if (!track) return
    setQueue((prev) => [track, ...prev.filter((t) => t.video_id !== track.video_id)])
    if (jamManager.state.active && !jamManager.state.isHost) jamManager.emitQueueAdd(track)
    showNotify(`"${track.title}" plays next`, 'info')
  }, [setQueue, showNotify])

  const handleAddToQueue = useCallback((track) => {
    if (!track) return
    setQueue((prev) => [...prev, track])
    if (jamManager.state.active && !jamManager.state.isHost) jamManager.emitQueueAdd(track)
    showNotify('Added to queue', 'info', {
      label: 'Undo',
      onClick: () => setQueue((q) => { const i = q.lastIndexOf(track); return i >= 0 ? q.filter((_, j) => j !== i) : q })
    })
  }, [setQueue, showNotify])

  const handleRemoveFromQueue = useCallback((idx) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx))
  }, [setQueue])

  const handleClearQueue = useCallback(() => {
    setQueue([])
    showNotify('Playback queue cleared', 'info')
  }, [setQueue, showNotify])

  const handleToggleShuffle = useCallback(() => {
    setIsShuffle((prev) => {
      const nextState = !prev
      if (nextState) {
        originalQueueRef.current = [...queue]
        originalContextRef.current = activePlaybackContext ? [...activePlaybackContext] : null
        if (queue.length > 0) setQueue(fisherYatesShuffle(queue))
        if (activePlaybackContext && activePlaybackContext.length > 1) {
          const remaining = activePlaybackContext.filter((t) =>
            t.video_id && currentTrack?.video_id ? t.video_id !== currentTrack.video_id : t.title !== currentTrack?.title
          )
          const shuffled = fisherYatesShuffle(remaining)
          setActivePlaybackContext(currentTrack ? [currentTrack, ...shuffled] : shuffled)
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
            const idx = originalContextRef.current.findIndex((t) =>
              t.video_id && currentTrack.video_id ? t.video_id === currentTrack.video_id : t.title === currentTrack.title
            )
            if (idx >= 0) setCurrentTrackIdx(idx)
          }
          originalContextRef.current = null
        }
        showNotify('Shuffle off', 'info')
      }
      return nextState
    })
  }, [activePlaybackContext, currentTrack, queue, setQueue, showNotify])

  const handleShufflePlayAll = useCallback((customTracks) => {
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
    if (playbackMode === 'safari' && onPushToSafari) onPushToSafari(shuffled[0])
  }, [onPushToSafari, playbackMode, playlist, setQueue])

  const playList = useCallback((tracks, { shuffle = false, from = null } = {}) => {
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
      if (playbackMode === 'safari' && onPushToSafari) onPushToSafari(shuffled[0])
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
    setPlayingFrom?.(from)
  }, [currentTrack, handlePlayTrack, onPushToSafari, playbackMode, setPlayingFrom])

  const handleUserSeek = useCallback((targetSec) => {
    if (!jamManager.state.active || remoteJamGuardRef.current) return
    if (jamManager.state.isHost) {
      jamManager.broadcastHostSync({ currentTime: targetSec })
    } else if (jamManager.state.djMode !== 'host_only') {
      jamManager.emitPlaybackControl('SEEK', { currentTime: targetSec })
    }
  }, [remoteJamGuardRef])

  const handleTrackResolved = useCallback((track, resolvedData) => {
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
        if (t.video_id === newVid && t.duration_text === finalDur && t.thumbnail) return t
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
      if (cur.video_id === newVid && cur.duration_text === finalDur && cur.thumbnail) return cur
      return {
        ...cur,
        video_id: newVid,
        fallback_ids: resolvedData.fallback_ids?.length ? resolvedData.fallback_ids : cur.fallback_ids,
        thumbnail: resolvedData.thumbnail || cur.thumbnail,
        duration_text: finalDur
      }
    })
  }, [setPlaylist])

  const upNext = useMemo(() => {
    const ctx = activePlaybackContext || []
    const idx = ctx.findIndex((t) => sameTrack(t, currentTrack))
    const rest = idx >= 0 ? ctx.slice(idx + 1) : []
    return [...queue, ...rest].slice(0, 60)
  }, [activePlaybackContext, currentTrack, queue])

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      const next = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
      showNotify(
        next === 'one' ? 'Looping current song' : next === 'all' ? 'Repeat all' : 'Repeat off',
        'info'
      )
      return next
    })
  }, [setRepeatMode, showNotify])

  const toggleLoopSong = useCallback((targetTrack = null) => {
    if (targetTrack && !sameTrack(targetTrack, currentTrackRef.current)) {
      const baseList = activePlaybackContext && activePlaybackContext.length
        ? [targetTrack, ...activePlaybackContext.filter((t) => !sameTrack(t, targetTrack))]
        : [targetTrack]
      handlePlayTrack(targetTrack, 0, baseList)
      setRepeatMode('one')
      showNotify(`Looping "${targetTrack.title}"`, 'info')
      return
    }
    const next = repeatModeRef.current === 'one' ? 'off' : 'one'
    setRepeatMode(next)
    const label = currentTrackRef.current?.title
    showNotify(next === 'one' ? `Looping "${label || 'current song'}"` : 'Song loop off', 'info')
  }, [activePlaybackContext, handlePlayTrack, setRepeatMode, showNotify])

  return {
    currentTrack,
    setCurrentTrack,
    currentTrackIdx,
    setCurrentTrackIdx,
    isPlaying,
    setIsPlaying,
    playbackMode,
    setPlaybackMode,
    activePlaybackContext,
    setActivePlaybackContext,
    isShuffle,
    setIsShuffle,
    repeatMode,
    setRepeatMode,
    repeatModeRef,
    crossfadeSec,
    setCrossfadeSec,
    currentTrackRef,
    isPlayingRef,
    queueRef,
    handleNextRef,
    handlePrevRef,
    upNext,
    isTrackFavorite,
    handleToggleFavorite,
    handlePlayTrack,
    handleTogglePlay,
    getActiveTrackList,
    handleNext,
    handlePlayNext,
    handleAddToQueue,
    handleRemoveFromQueue,
    handleClearQueue,
    handleToggleShuffle,
    cycleRepeatMode,
    toggleLoopSong,
    handleShufflePlayAll,
    handlePrev,
    handleUserSeek,
    handleTrackResolved,
    playList
  }
}
