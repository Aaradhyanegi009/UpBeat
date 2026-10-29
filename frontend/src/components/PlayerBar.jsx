import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  ExternalLink, Video, Music, Heart, Loader2, Download, Check, ListMusic, ChevronUp,
  Monitor, Compass, Mic2, Moon
} from 'lucide-react'
import { getApiBase, hasBackend, getAudioSource, searchYouTubeStandalone, getTrackDownloadUrl, openExternalUrl } from '../standaloneApi'
import { isTrackDownloaded, saveTrackOffline, createOfflineAudioUrl, subscribeOfflineChanges } from '../offlineStorage'
import { useAlbumColor, DEFAULT_LAVENDER_THEME } from '../utils/colorExtractor'
import NowPlayingView from './NowPlayingView'
import SleepTimerModal from './SleepTimerModal'

function formatTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remSec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`
  }
  return `${m}:${remSec.toString().padStart(2, '0')}`
}

function parseDurationText(str) {
  if (!str) return 0
  if (typeof str === 'number' && isFinite(str) && str > 0) return Math.round(str)
  if (typeof str !== 'string' || str === '--:--') return 0
  const clean = str.trim()
  if (/^\d+$/.test(clean)) return parseInt(clean, 10)
  const parts = clean.split(':').map(Number)
  if (parts.some((n) => isNaN(n))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

export default function PlayerBar({
  currentTrack,
  isPlaying,
  setIsPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  playbackMode,
  setPlaybackMode,
  onPushToSafari,
  safariNowPlaying,
  onSafariControl,
  onTrackResolved,
  isTrackFavorite,
  onToggleFavorite,
  onToggleQueue,
  queueCount = 0,
  isQueueOpen = false,
  isNowPlayingOpen,
  setIsNowPlayingOpen,
  crossfadeSec: externalCrossfadeSec,
  setCrossfadeSec: externalSetCrossfadeSec
}) {
  const [internalNowPlaying, setInternalNowPlaying] = useState(false)
  const nowPlayingOpen = typeof isNowPlayingOpen === 'boolean' ? isNowPlayingOpen : internalNowPlaying
  const setNowPlayingOpen = setIsNowPlayingOpen || setInternalNowPlaying

  const [internalCrossfadeSec, setInternalCrossfadeSec] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_crossfade_sec')
      return saved !== null ? Math.max(0, Math.min(12, parseInt(saved, 10) || 0)) : 5
    } catch {
      return 5
    }
  })
  const effectiveCrossfadeSec = typeof externalCrossfadeSec === 'number' ? externalCrossfadeSec : internalCrossfadeSec
  const handleChangeCrossfade = useCallback((val) => {
    const clean = Math.max(0, Math.min(12, Math.round(Number(val) || 0)))
    if (externalSetCrossfadeSec) {
      externalSetCrossfadeSec(clean)
    } else {
      setInternalCrossfadeSec(clean)
    }
    try {
      localStorage.setItem('upbeat_crossfade_sec', String(clean))
    } catch {}
  }, [externalSetCrossfadeSec])

  const [isShuffle, setIsShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState('off') // 'off', 'all', 'one'
  const [showVideo, setShowVideo] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubTime, setScrubTime] = useState(0)
  const [resolvedVid, setResolvedVid] = useState('')
  const [isLoadingStream, setIsLoadingStream] = useState(false)
  const [useIframeFallback, setUseIframeFallback] = useState(false)

  const [sleepTimer, setSleepTimer] = useState({
    active: false,
    mode: 'off', // 'off' | 'minutes' | 'end_of_track'
    targetTimestamp: null,
    totalDurationSec: 0,
    fadeOut: true,
    remainingSec: 0
  })
  const [isSleepModalOpen, setIsSleepModalOpen] = useState(false)
  const sleepTimerRef = useRef(sleepTimer)
  useEffect(() => {
    sleepTimerRef.current = sleepTimer
  }, [sleepTimer])

  const crossfadeSecRef = useRef(effectiveCrossfadeSec)
  const autoCrossfadeDurationMsRef = useRef(0)
  const volumeRef = useRef(volume)
  const isMutedRef = useRef(isMuted)
  const repeatModeRef = useRef(repeatMode)
  useEffect(() => {
    crossfadeSecRef.current = effectiveCrossfadeSec
  }, [effectiveCrossfadeSec])
  useEffect(() => {
    volumeRef.current = volume
    isMutedRef.current = isMuted
  }, [volume, isMuted])
  useEffect(() => {
    repeatModeRef.current = repeatMode
  }, [repeatMode])

  const audioRefA = useRef(null)
  const audioRefB = useRef(null)
  const activeDeckRef = useRef('A')
  const fadeIntervalRef = useRef(null)

  const getActiveAudio = () => (activeDeckRef.current === 'A' ? audioRefA.current : audioRefB.current)
  const getInactiveAudio = () => (activeDeckRef.current === 'A' ? audioRefB.current : audioRefA.current)

  const playerRef = useRef(null)
  const currentVidRef = useRef('')
  const fallbackQueueRef = useRef([])
  const endedTriggeredRef = useRef(false)
  const isScrubbingRef = useRef(false)
  const lastNativeReportSecRef = useRef(0)
  const currentTimeRef = useRef(0)
  const isDocumentHiddenRef = useRef(false)

  useEffect(() => {
    const handleVisChange = () => {
      isDocumentHiddenRef.current = document.hidden
      if (!document.hidden) {
        setCurrentTime(currentTimeRef.current)
      }
    }
    document.addEventListener('visibilitychange', handleVisChange)
    return () => document.removeEventListener('visibilitychange', handleVisChange)
  }, [])

  // Global fix for HE-AAC / SBR 2x duration desync and player freeze bug
  const authoritativeDurationRef = useRef(0)
  const lastCurPosRef = useRef(0)
  const lastCurChangeTimeRef = useRef(Date.now())

  // Defends against the WebKit / Chromium HE-AAC SBR bug (2x duration) and
  // 32kbps partial VBR bitrate estimation bug (which falsely inflates 4:00 -> 15:32).
  const sanitizeDuration = (rawDur) => {
    if (useIframeFallback) return
    if (typeof rawDur !== 'number' || !isFinite(rawDur) || rawDur <= 0) return

    const authDur = authoritativeDurationRef.current

    if (authDur > 0) {
      // The authoritative duration is established from official YouTube track metadata
      // and /api/audio-info. WebKit/Chromium audio.duration is notoriously prone to
      // 32kbps bitrate inflation (e.g. 4:00 -> 15:32) and HE-AAC SBR 2x bug (4:00 -> 8:00).
      // Always clamp duration to the authoritative duration!
      setDuration(authDur)
    } else {
      authoritativeDurationRef.current = Math.round(rawDur)
      setDuration(Math.round(rawDur))
    }
  }

  const onNextRef = useRef(onNext)
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    onNextRef.current = onNext
  }, [onNext])
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])
  useEffect(() => {
    isScrubbingRef.current = isScrubbing
  }, [isScrubbing])

  const track = currentTrack || (safariNowPlaying ? {
    title: safariNowPlaying.title || 'Safari Audio',
    artist: safariNowPlaying.artist || 'Safari',
    thumbnail: safariNowPlaying.thumbnail || '',
    video_id: safariNowPlaying.video_id || '',
    fallback_ids: [],
    url: safariNowPlaying.url || ''
  } : null)

  const isSafariMode = playbackMode === 'safari'
  const effectiveDuration =
    duration > 0
      ? duration
      : (authoritativeDurationRef.current > 0
          ? authoritativeDurationRef.current
          : parseDurationText(track?.duration_text))
  const thumbUrl = track?.thumbnail || (resolvedVid ? `https://i.ytimg.com/vi/${resolvedVid}/hqdefault.jpg` : '')
  const albumColor = useAlbumColor(thumbUrl)
  const displayTime = Math.min(
    isScrubbing ? scrubTime : currentTime,
    effectiveDuration > 0 ? effectiveDuration : Infinity
  )
  const progressPct = effectiveDuration > 0 ? Math.min(100, (displayTime / effectiveDuration) * 100) : 0
  const volumeVal = isMuted ? 0 : volume
  const isFav = track && isTrackFavorite ? isTrackFavorite(track) : false
  const [downloadState, setDownloadState] = useState('idle')
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [isPlayingOffline, setIsPlayingOffline] = useState(false)

  // Track whether currently selected track is downloaded
  useEffect(() => {
    let active = true
    const checkDl = async () => {
      const vid = track?.video_id || resolvedVid
      if (!vid) {
        if (active) setIsDownloaded(false)
        return
      }
      const downloaded = await isTrackDownloaded(vid)
      if (active) setIsDownloaded(downloaded)
    }
    checkDl()
    const unsub = subscribeOfflineChanges(() => checkDl())
    return () => {
      active = false
      unsub()
    }
  }, [track?.video_id, resolvedVid])

  const handleDownload = async (targetTrack = track) => {
    if (!targetTrack) return
    const vid = targetTrack.video_id || resolvedVid
    if (!vid) return

    setDownloadState('downloading')
    try {
      const fullTrack = {
        ...targetTrack,
        video_id: vid,
        thumbnail: targetTrack.thumbnail || thumbUrl || ''
      }

      // 1. Save directly into client IndexedDB offline storage (for instant offline playback on Mac & Android)
      await saveTrackOffline(fullTrack)

      // 2. Also trigger native file download (saves to ~/Downloads in macOS app or browser)
      const title = (fullTrack.title || 'Track').replace(/[\\/*?:"<>|]/g, '').trim()
      const artist = (fullTrack.artist || '').replace(/[\\/*?:"<>|]/g, '').trim()
      const cleanFileName = artist && !title.toLowerCase().includes(artist.toLowerCase())
        ? `${artist} - ${title}.m4a`
        : `${title}.m4a`

      let blobUrl = null
      try {
        blobUrl = await createOfflineAudioUrl(vid)
      } catch {}

      let downloadUrl = blobUrl || getTrackDownloadUrl(fullTrack)
      if (!downloadUrl) {
        const src = await getAudioSource(vid)
        downloadUrl = typeof src === 'string' ? src : src?.url
      }

      if (downloadUrl) {
        const a = document.createElement('a')
        a.href = downloadUrl
        a.download = cleanFileName
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          try {
            document.body.removeChild(a)
            if (blobUrl) URL.revokeObjectURL(blobUrl)
          } catch {}
        }, 1500)
      }

      setDownloadState('success')
      setIsDownloaded(true)
      setTimeout(() => setDownloadState('idle'), 2200)
    } catch (err) {
      console.error('Download error:', err)
      setDownloadState('idle')
    }
  }

  // Centralized playback telemetry for Android media session and macOS WKScriptMessageHandler
  const notifyNativePlayback = useCallback((playing, curSec, durSec, customTrack, customThumb) => {
    const t = customTrack || track
    const title = t?.title || 'UpBeat'
    const artist = t?.artist || ''
    const thumb = customThumb || thumbUrl || (resolvedVid ? `https://i.ytimg.com/vi/${resolvedVid}/hqdefault.jpg` : '')
    const d = Math.round(durSec ?? (effectiveDuration || 0))
    const c = Math.round(curSec ?? (currentTime || 0))

    // 1. Android Capacitor Native Media Session
    if (window.UpBeatNative?.updatePlayback) {
      try {
        window.UpBeatNative.updatePlayback(Boolean(playing), title, artist, thumb, d, c)
      } catch {}
    }

    // 2. macOS Native WKScriptMessageHandler
    if (window.webkit?.messageHandlers?.upbeatNative?.postMessage) {
      try {
        window.webkit.messageHandlers.upbeatNative.postMessage({
          isPlaying: Boolean(playing),
          title,
          artist,
          thumbnail: thumb,
          duration: d,
          currentTime: c
        })
      } catch {}
    }
  }, [track, thumbUrl, resolvedVid, effectiveDuration, currentTime])

  const restoreVolume = useCallback(() => {
    const baseVol = isMuted ? 0 : volume / 100
    const activeAudio = getActiveAudio()
    if (activeAudio) {
      try {
        activeAudio.volume = baseVol
      } catch {}
    }
    const p = playerRef.current
    if (p && typeof p.setVolume === 'function') {
      try {
        p.setVolume(isMuted ? 0 : volume)
      } catch {}
    }
  }, [isMuted, volume])

  const handleTrackEnded = useCallback(() => {
    if (sleepTimerRef.current?.active && sleepTimerRef.current?.mode === 'end_of_track') {
      setSleepTimer({
        active: false,
        mode: 'off',
        targetTimestamp: null,
        totalDurationSec: 0,
        fadeOut: true,
        remainingSec: 0
      })
      const active = getActiveAudio()
      if (active) {
        try {
          active.pause()
          active.volume = isMuted ? 0 : volume / 100
        } catch {}
      }
      const p = playerRef.current
      if (p && typeof p.pauseVideo === 'function') {
        try {
          p.pauseVideo()
          p.setVolume(isMuted ? 0 : volume)
        } catch {}
      }
      setIsPlaying(false)
      notifyNativePlayback(false, currentTimeRef.current, effectiveDuration)
      return true
    }
    return false
  }, [isMuted, volume, effectiveDuration, notifyNativePlayback, setIsPlaying])

  const handleSetSleepTimer = useCallback((type, fadeOut = true) => {
    restoreVolume()
    if (type === 'end_of_track') {
      setSleepTimer({
        active: true,
        mode: 'end_of_track',
        targetTimestamp: null,
        totalDurationSec: 0,
        fadeOut,
        remainingSec: 0
      })
    } else if (typeof type === 'number' && type > 0) {
      const sec = Math.round(type * 60)
      const target = Date.now() + sec * 1000
      setSleepTimer({
        active: true,
        mode: 'minutes',
        targetTimestamp: target,
        totalDurationSec: sec,
        fadeOut,
        remainingSec: sec
      })
    }
  }, [restoreVolume])

  const handleCancelSleepTimer = useCallback(() => {
    restoreVolume()
    setSleepTimer({
      active: false,
      mode: 'off',
      targetTimestamp: null,
      totalDurationSec: 0,
      fadeOut: true,
      remainingSec: 0
    })
  }, [restoreVolume])

  const handleAddSleepMinutes = useCallback((mins) => {
    restoreVolume()
    setSleepTimer((prev) => {
      if (!prev.active || prev.mode !== 'minutes' || !prev.targetTimestamp) return prev
      const addMs = mins * 60 * 1000
      const newTarget = prev.targetTimestamp + addMs
      const remaining = Math.max(0, Math.round((newTarget - Date.now()) / 1000))
      return {
        ...prev,
        targetTimestamp: newTarget,
        totalDurationSec: prev.totalDurationSec + mins * 60,
        remainingSec: remaining
      }
    })
  }, [restoreVolume])

  // Countdown timer effect
  useEffect(() => {
    if (!sleepTimer.active || sleepTimer.mode !== 'minutes' || !sleepTimer.targetTimestamp) {
      return
    }

    const interval = setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, Math.round((sleepTimer.targetTimestamp - now) / 1000))

      setSleepTimer((prev) => {
        if (!prev.active || prev.mode !== 'minutes') return prev
        return { ...prev, remainingSec: remaining }
      })

      // Smooth volume fade-out over last 30 seconds
      const baseVol = isMuted ? 0 : volume / 100
      if (sleepTimer.fadeOut && remaining <= 30 && remaining > 0) {
        const fadeFactor = remaining / 30
        const fadedVol = Math.max(0, Math.min(baseVol, baseVol * fadeFactor))
        const activeAudio = getActiveAudio()
        if (activeAudio) {
          try {
            activeAudio.volume = fadedVol
          } catch {}
        }
        const p = playerRef.current
        if (p && typeof p.setVolume === 'function') {
          try {
            p.setVolume(fadedVol * 100)
          } catch {}
        }
      }

      if (remaining <= 0) {
        clearInterval(interval)
        const activeAudio = getActiveAudio()
        if (activeAudio) {
          try {
            activeAudio.pause()
            activeAudio.volume = baseVol
          } catch {}
        }
        const p = playerRef.current
        if (p && typeof p.pauseVideo === 'function') {
          try {
            p.pauseVideo()
            p.setVolume(isMuted ? 0 : volume)
          } catch {}
        }
        setIsPlaying(false)
        notifyNativePlayback(false, currentTimeRef.current, effectiveDuration)
        setSleepTimer({
          active: false,
          mode: 'off',
          targetTimestamp: null,
          totalDurationSec: 0,
          fadeOut: true,
          remainingSec: 0
        })
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [sleepTimer.active, sleepTimer.mode, sleepTimer.targetTimestamp, sleepTimer.fadeOut, isMuted, volume, effectiveDuration, notifyNativePlayback, setIsPlaying])

  // Prime both audio decks on first user interaction so Safari never blocks background transitions
  const primedRef = useRef(false)
  const primeAudioEngines = useCallback(() => {
    if (primedRef.current) return
    primedRef.current = true
    const silentUri = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
    ;[audioRefA.current, audioRefB.current].forEach((audio) => {
      if (audio && !audio.src) {
        audio.src = silentUri
        audio.play().then(() => {
          audio.pause()
          audio.currentTime = 0
          audio.src = ''
        }).catch(() => {})
      }
    })
  }, [])

  useEffect(() => {
    const handleGesture = () => primeAudioEngines()
    window.addEventListener('pointerdown', handleGesture, { once: true })
    window.addEventListener('keydown', handleGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', handleGesture)
      window.removeEventListener('keydown', handleGesture)
    }
  }, [primeAudioEngines])

  const commitSeek = (targetSec) => {
    const sec = Math.max(0, Number(targetSec) || 0)
    currentTimeRef.current = sec
    setCurrentTime(sec)
    lastCurPosRef.current = sec
    lastCurChangeTimeRef.current = Date.now()
    endedTriggeredRef.current = false
    lastNativeReportSecRef.current = sec
    notifyNativePlayback(Boolean(isPlayingRef.current), sec, effectiveDuration)
    restoreVolume()
    const activeAudio = getActiveAudio()
    if (!useIframeFallback && activeAudio) {
      try {
        if (activeAudio.readyState >= 1) {
          activeAudio.currentTime = sec
        }
      } catch {}
      return
    }
    const p = playerRef.current
    if (p && typeof p.seekTo === 'function') {
      try {
        p.seekTo(sec, true)
      } catch {}
    }
  }

  // Expose global controls for macOS menu bar, media keys, and external extensions
  useEffect(() => {
    window.UpBeatControls = {
      togglePlay: () => setIsPlaying((p) => !p),
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      next: () => onNextRef.current(),
      prev: () => onPrev(),
      seekTo: (sec) => commitSeek(sec)
    }
    return () => {
      delete window.UpBeatControls
    }
  }, [onPrev, setIsPlaying])

  // Resolve video_id if track lacks one
  useEffect(() => {
    endedTriggeredRef.current = false
    currentTimeRef.current = 0
    setCurrentTime(0)
    setScrubTime(0)
    setIsScrubbing(false)
    lastCurPosRef.current = 0
    lastCurChangeTimeRef.current = Date.now()
    lastNativeReportSecRef.current = 0
    setUseIframeFallback(false)

    const initialDur =
      parseDurationText(track?.duration_text) ||
      Number(track?.duration_sec || 0) ||
      Number(track?.duration || 0)
    authoritativeDurationRef.current = initialDur
    setDuration(initialDur)

    if (!track) {
      setResolvedVid('')
      fallbackQueueRef.current = []
      notifyNativePlayback(false, 0, 0, { title: 'UpBeat', artist: '' }, '')
      return
    }

    // Instantly isolate videoId so previous song's thumbnail NEVER leaks into track B
    if (track.video_id) {
      setResolvedVid(track.video_id)
      fallbackQueueRef.current = [...(track.fallback_ids || [])]
    } else {
      setResolvedVid('')
      fallbackQueueRef.current = []
    }

    const immediateThumb =
      track.thumbnail ||
      (track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg` : '')

    // ZERO-LATENCY INSTANT SYNC: Send the new song to native platforms immediately!
    notifyNativePlayback(Boolean(isPlayingRef.current), 0, initialDur, track, immediateThumb)

    let cancelled = false
    ;(async () => {
      const isHourTitle = /1\s*h(?:ou)?r|2\s*h(?:ou)?r/i.test(track?.title || '')
      const isMismatchedShortDur = isHourTitle && initialDur > 0 && initialDur < 1200

      // If track already has a valid video_id and is not a 1-hour/short duration mismatch, NEVER re-search!
      if (track.video_id && !isMismatchedShortDur) {
        if (initialDur <= 0 && hasBackend()) {
          try {
            const r = await fetch(`${getApiBase()}/audio-info/${track.video_id}`)
            if (r.ok) {
              const info = await r.json()
              const durSec = Number(info?.duration || 0)
              if (!cancelled && durSec > 0) {
                authoritativeDurationRef.current = durSec
                setDuration(durSec)
                notifyNativePlayback(Boolean(isPlayingRef.current), 0, durSec, track, immediateThumb)
                if (onTrackResolved) {
                  onTrackResolved(track, {
                    video_id: track.video_id,
                    duration: durSec,
                    duration_text: formatTime(durSec)
                  })
                }
              }
            }
          } catch {}
        }
        return
      }

      // Track lacks video_id OR has a mismatched short duration (e.g. 3:50 on a 1-hour mix):
      const q = `${track.title} ${track.artist}`
      let data = null
      if (hasBackend()) {
        try {
          const r = await fetch(`${getApiBase()}/search?q=${encodeURIComponent(q)}`)
          if (r.ok) data = await r.json()
        } catch {}
      }
      if (!data) {
        data = await searchYouTubeStandalone(q)
      }
      if (!cancelled && data?.video_id) {
        setResolvedVid(data.video_id)
        let resolvedDur = initialDur
        if (data.duration_text && data.duration_text !== '3:42' && data.duration_text !== '--:--') {
          const parsed = parseDurationText(data.duration_text)
          if (parsed > 0) {
            resolvedDur = parsed
            authoritativeDurationRef.current = parsed
            setDuration(parsed)
          }
        }
        fallbackQueueRef.current = [...(data.fallback_ids || [])]
        const resolvedThumb = data.thumbnail || `https://i.ytimg.com/vi/${data.video_id}/hqdefault.jpg`
        notifyNativePlayback(Boolean(isPlayingRef.current), 0, resolvedDur, track, resolvedThumb)
        if (onTrackResolved) onTrackResolved(track, data)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [track?.title, track?.artist, track?.video_id])

  // Primary Engine: Native Dual-Deck HTML5 <audio> with smooth ~1s seamless crossfade
  useEffect(() => {
    if (!resolvedVid || playbackMode !== 'app' || useIframeFallback) return

    let cancelled = false
    const currentActive = getActiveAudio()
    const targetDeck = activeDeckRef.current === 'A' ? 'B' : 'A'
    const targetAudio = targetDeck === 'A' ? audioRefA.current : audioRefB.current

    if (!targetAudio) return

    if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
      try { playerRef.current.stopVideo() } catch {}
    }

    ;(async () => {
      // If the active audio is already playing this video, nothing to load
      if (currentActive?.dataset?.vid === resolvedVid && !currentActive.paused) {
        setIsLoadingStream(false)
        return
      }

      let streamSrc = null

      // Check if track is available in local offline storage (IndexedDB)
      try {
        const offlineUrl = await createOfflineAudioUrl(resolvedVid)
        if (offlineUrl) {
          streamSrc = offlineUrl
          setIsPlayingOffline(true)
        }
      } catch {}

      if (!streamSrc) {
        setIsPlayingOffline(false)
        const isMacBackend = hasBackend()
        streamSrc = isMacBackend ? `${getApiBase()}/audio/${resolvedVid}` : null

        // In standalone mode (or if backend is missing), resolve audio asynchronously
        if (!streamSrc) {
          setIsLoadingStream(true)
          try {
            const streamInfo = await getAudioSource(resolvedVid)
            if (cancelled) return
            streamSrc = typeof streamInfo === 'string' ? streamInfo : streamInfo?.url
          } catch {} finally {
            setIsLoadingStream(false)
          }
        }
      }

      if (!streamSrc) {
        if (fallbackQueueRef.current.length > 0) {
          const nextVid = fallbackQueueRef.current.shift()
          setResolvedVid(nextVid)
          return
        }
        if (!useIframeFallback) {
          setUseIframeFallback(true)
        }
        return
      }

      targetAudio.dataset.vid = resolvedVid
      targetAudio.src = streamSrc
      targetAudio.load()

      const targetVol = isMuted ? 0 : volume / 100
      const isPrevPlaying =
        currentActive &&
        !currentActive.paused &&
        currentActive.currentTime > 0.5 &&
        !currentActive.ended &&
        currentActive.dataset.vid &&
        currentActive.dataset.vid !== resolvedVid

      const isDocumentHidden = typeof document !== 'undefined' && Boolean(document.hidden)

      if (isDocumentHidden && currentActive && isPrevPlaying) {
        // Continuous background playback (Safari/Chrome tab hidden or minimized):
        // Directly reuse the active, already-blessed audio element to eliminate browser background autoplay blocks.
        currentActive.dataset.vid = resolvedVid
        currentActive.src = streamSrc
        currentActive.volume = targetVol
        currentActive.load()
        try {
          await currentActive.play()
        } catch {
          if (fallbackQueueRef.current.length > 0) {
            const nextVid = fallbackQueueRef.current.shift()
            setResolvedVid(nextVid)
            return
          }
        }
        return
      }

      const xfadeSec = Number(crossfadeSecRef.current) || 0
      const autoFadeMs = autoCrossfadeDurationMsRef.current
      autoCrossfadeDurationMsRef.current = 0

      if (isPrevPlaying && isPlayingRef.current && xfadeSec > 0) {
        // Configurable dual-deck crossfade:
        // - Full user-configured duration (2s–12s) when auto-transitioning at end of track
        // - Snappy <=1.5s blend when manually skipping mid-track
        targetAudio.volume = 0
        try {
          await targetAudio.play()
        } catch {
          if (fallbackQueueRef.current.length > 0) {
            const nextVid = fallbackQueueRef.current.shift()
            setResolvedVid(nextVid)
            return
          }
        }

        if (cancelled) {
          targetAudio.pause()
          return
        }

        activeDeckRef.current = targetDeck

        if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current)
        const oldAudio = currentActive
        const oldStartVol = oldAudio.volume
        const fadeStart = Date.now()
        const fadeDuration = autoFadeMs > 0 ? autoFadeMs : Math.min(xfadeSec * 1000, 1500)

        fadeIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - fadeStart
          const progress = Math.min(1, elapsed / fadeDuration)
          const liveTargetVol = isMutedRef.current ? 0 : volumeRef.current / 100

          // Equal-power cosine crossfade curve prevents volume dip in the middle of the overlap
          const fadeIn = Math.sin(progress * Math.PI * 0.5)
          const fadeOut = Math.cos(progress * Math.PI * 0.5)

          if (targetAudio) targetAudio.volume = Math.min(1, Math.max(0, liveTargetVol * fadeIn))
          if (oldAudio) oldAudio.volume = Math.min(1, Math.max(0, oldStartVol * fadeOut))

          if (progress >= 1) {
            clearInterval(fadeIntervalRef.current)
            fadeIntervalRef.current = null
            if (targetAudio) targetAudio.volume = liveTargetVol
            if (oldAudio) {
              oldAudio.pause()
              oldAudio.src = ''
              oldAudio.dataset.vid = ''
            }
          }
        }, 40)
      } else {
        // Initial play or paused state: switch immediately
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current)
          fadeIntervalRef.current = null
        }
        if (currentActive && currentActive !== targetAudio) {
          currentActive.pause()
          currentActive.src = ''
          currentActive.dataset.vid = ''
        }
        activeDeckRef.current = targetDeck
        targetAudio.volume = targetVol
        if (isPlayingRef.current) {
          targetAudio.play().catch(() => {
            if (fallbackQueueRef.current.length > 0) {
              const nextVid = fallbackQueueRef.current.shift()
              setResolvedVid(nextVid)
            }
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [resolvedVid, playbackMode, useIframeFallback])

  // Sync play/pause with HTML5 <audio> or YT.Player fallback
  useEffect(() => {
    if (playbackMode !== 'app') {
      if (audioRefA.current) audioRefA.current.pause()
      if (audioRefB.current) audioRefB.current.pause()
      if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
        try { playerRef.current.pauseVideo() } catch {}
      }
      return
    }

    const activeAudio = getActiveAudio()
    if (!useIframeFallback && activeAudio && resolvedVid) {
      if (isPlaying) {
        if (activeAudio.src) {
          activeAudio.play().catch(() => {})
        }
      } else {
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current)
          fadeIntervalRef.current = null
        }
        if (audioRefA.current) try { audioRefA.current.pause() } catch {}
        if (audioRefB.current) try { audioRefB.current.pause() } catch {}
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
        notifyNativePlayback(false, currentTime, effectiveDuration)
      }
      return
    }

    const p = playerRef.current
    if (useIframeFallback && p && typeof p.getPlayerState === 'function') {
      try {
        const state = p.getPlayerState()
        if (isPlaying && state !== 1 && state !== 3) {
          p.playVideo()
        } else if (!isPlaying && state === 1) {
          p.pauseVideo()
        }
      } catch {}
    }
  }, [isPlaying, playbackMode, useIframeFallback, resolvedVid])

  // Sync volume
  useEffect(() => {
    const activeAudio = getActiveAudio()
    if (activeAudio && !fadeIntervalRef.current) {
      activeAudio.volume = isMuted ? 0 : volume / 100
    }
    const p = playerRef.current
    if (p && typeof p.setVolume === 'function') {
      try {
        p.setVolume(isMuted ? 0 : volume)
      } catch {}
    }
  }, [volume, isMuted])

  // Load YouTube IFrame API only if needed for fallback or video preview
  useEffect(() => {
    if (!useIframeFallback && !showVideo) return
    if (window.YT && window.YT.Player) return
    const existing = document.getElementById('yt-iframe-api-script')
    if (!existing) {
      const tag = document.createElement('script')
      tag.id = 'yt-iframe-api-script'
      tag.src = 'https://www.youtube.com/iframe_api'
      document.body.appendChild(tag)
    }
  }, [useIframeFallback, showVideo])

  // Secondary YT.Player fallback
  useEffect(() => {
    if (!resolvedVid || playbackMode !== 'app' || !useIframeFallback) return

    let cancelled = false

    const initOrLoad = () => {
      if (cancelled) return
      if (!window.YT || !window.YT.Player) {
        setTimeout(initOrLoad, 200)
        return
      }

      if (!playerRef.current) {
        playerRef.current = new window.YT.Player('argon-yt-player-mount', {
          height: '100%',
          width: '100%',
          videoId: resolvedVid,
          playerVars: {
            autoplay: isPlayingRef.current ? 1 : 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1
          },
          events: {
            onReady: (e) => {
              currentVidRef.current = resolvedVid
              e.target.setVolume(isMuted ? 0 : volume)
              if (isPlayingRef.current) {
                e.target.playVideo()
              }
            },
            onStateChange: (e) => {
              if (e.data === 0) {
                if (useIframeFallback && currentVidRef.current === resolvedVid && !endedTriggeredRef.current) {
                  endedTriggeredRef.current = true
                  if (handleTrackEnded()) return
                  onNextRef.current()
                }
              } else if (e.data === 1) {
                endedTriggeredRef.current = false
                setIsPlaying(true)
                const dur = e.target.getDuration()
                if (dur) setDuration(dur)
              } else if (e.data === 2) {
                setIsPlaying(false)
              }
            },
            onError: () => {
              if (useIframeFallback && currentVidRef.current === resolvedVid) {
                onNextRef.current()
              }
            }
          }
        })
      } else if (typeof playerRef.current.loadVideoById === 'function') {
        if (currentVidRef.current !== resolvedVid) {
          currentVidRef.current = resolvedVid
          endedTriggeredRef.current = false
          if (isPlayingRef.current) {
            playerRef.current.loadVideoById(resolvedVid)
          } else {
            playerRef.current.cueVideoById(resolvedVid)
          }
        }
      }
    }

    initOrLoad()
    return () => {
      cancelled = true
    }
  }, [resolvedVid, playbackMode, useIframeFallback])

  // Optimized progress ticker: 250ms when app is active; 1500ms when hidden/in-background to save battery & CPU
  useEffect(() => {
    if (!isPlaying || playbackMode !== 'app') return

    let timerId = null
    let isCancelled = false

    const tick = () => {
      if (isCancelled || isScrubbingRef.current) return

      if (!useIframeFallback) {
        const audio = getActiveAudio()
        if (!audio || !resolvedVid || audio.dataset.vid !== resolvedVid) return
        const cur = audio.currentTime
        const rawDur = audio.duration
        const targetDur =
          duration > 0
            ? duration
            : (authoritativeDurationRef.current > 0
                ? authoritativeDurationRef.current
                : parseDurationText(track?.duration_text))

        if (typeof cur === 'number' && !isNaN(cur) && cur >= 0) {
          currentTimeRef.current = cur
          if (!isDocumentHiddenRef.current) {
            setCurrentTime(cur)
          }

          // Track progress advancement for stall / frozen detection
          if (Math.abs(cur - lastCurPosRef.current) > 0.05) {
            lastCurPosRef.current = cur
            lastCurChangeTimeRef.current = Date.now()
          }

          // Native playback IPC: report periodically (every 5 seconds) to avoid spamming the Android UI thread
          if (Math.abs(cur - lastNativeReportSecRef.current) >= 5) {
            lastNativeReportSecRef.current = cur
            if (isPlayingRef.current) {
              notifyNativePlayback(true, cur, targetDur)
            }
          }
        }

        // Sanitize audio duration to prevent 2x SBR bug from inflating UI
        if (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > 0) {
          sanitizeDuration(rawDur)
        }

        // Multi-tier End-of-Track and Freeze Protection:
        // Must be currently playing the resolvedVid, cur must have progressed (> 0.5s),
        // and targetDur must be established (> 5s).
        const timeSinceAdvance = Date.now() - (lastCurChangeTimeRef.current || Date.now())
        const isEnded = Boolean(audio.ended)
        const reachedTargetEnd = targetDur > 5 && cur >= targetDur - 0.4
        const stalledNearEnd = targetDur > 5 && cur >= targetDur - 2.0 && cur > 5 && timeSinceAdvance >= 1500
        const isSbr2xFreeze =
          typeof rawDur === 'number' &&
          rawDur > 20 &&
          cur > 5 &&
          Math.abs(cur - rawDur / 2) <= 3.0 &&
          timeSinceAdvance >= 1800

        // Early Overlap Crossfade Trigger: start next song `xfadeSec` seconds before current song ends
        const xfade = Number(crossfadeSecRef.current) || 0
        const isEndSleep = sleepTimerRef.current?.active && sleepTimerRef.current?.mode === 'end_of_track'
        if (
          xfade > 0 &&
          repeatModeRef.current !== 'one' &&
          !isEndSleep &&
          targetDur > xfade + 6 &&
          cur >= targetDur - xfade &&
          cur > 2 &&
          !endedTriggeredRef.current
        ) {
          endedTriggeredRef.current = true
          autoCrossfadeDurationMsRef.current = xfade * 1000
          onNextRef.current()
          return
        }

        if ((isEnded || reachedTargetEnd || stalledNearEnd || isSbr2xFreeze) && !endedTriggeredRef.current && cur > 0.5) {
          endedTriggeredRef.current = true
          if (handleTrackEnded()) return
          onNextRef.current()
        }
        return
      }

      const p = playerRef.current
      if (useIframeFallback && p && typeof p.getCurrentTime === 'function') {
        try {
          const cur = p.getCurrentTime()
          if (typeof cur === 'number' && !isNaN(cur) && cur >= 0) {
            currentTimeRef.current = cur
            if (!isDocumentHiddenRef.current) {
              setCurrentTime(cur)
            }
          }
          if (typeof p.getDuration === 'function') {
            const dur = p.getDuration()
            if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
              sanitizeDuration(dur)
              const effectiveDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              if (cur >= effectiveDur - 0.3 && effectiveDur > 5 && !endedTriggeredRef.current) {
                endedTriggeredRef.current = true
                if (handleTrackEnded()) return
                onNextRef.current()
              }
            }
          }
        } catch {}
      }
    }

    const scheduleNextTick = () => {
      const delay = isDocumentHiddenRef.current ? 1500 : 250
      timerId = setTimeout(() => {
        tick()
        if (!isCancelled) {
          scheduleNextTick()
        }
      }, delay)
    }

    scheduleNextTick()

    return () => {
      isCancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [isPlaying, playbackMode, useIframeFallback, duration, track])

  // Sync Android Foreground Media Service + Android Auto + macOS + Lock Screen MediaSession
  // NOTE: currentTime is accessed via currentTimeRef to avoid running this heavy IPC effect 4 times/sec
  useEffect(() => {
    notifyNativePlayback(Boolean(isPlaying), currentTimeRef.current, effectiveDuration)

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        if (track && typeof window.MediaMetadata !== 'undefined') {
          const artUrl = track.thumbnail || (resolvedVid ? `https://i.ytimg.com/vi/${resolvedVid}/hqdefault.jpg` : '')
          navigator.mediaSession.metadata = new window.MediaMetadata({
            title: track.title || 'UpBeat',
            artist: track.artist || 'UpBeat Curator',
            album: 'UpBeat',
            artwork: artUrl ? [{ src: artUrl, sizes: '480x360', type: 'image/jpeg' }] : []
          })
        }
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
        navigator.mediaSession.setActionHandler('play', () => {
          setIsPlaying(true)
          isPlayingRef.current = true
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing'
          }
          const activeAudio = getActiveAudio()
          if (activeAudio && activeAudio.src) {
            try { activeAudio.play().catch(() => {}) } catch {}
          }
          notifyNativePlayback(true, currentTimeRef.current, effectiveDuration)
        })
        navigator.mediaSession.setActionHandler('pause', () => {
          setIsPlaying(false)
          isPlayingRef.current = false
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused'
          }
          const activeAudio = getActiveAudio()
          if (activeAudio) {
            try { activeAudio.pause() } catch {}
          }
          if (audioRefA.current) try { audioRefA.current.pause() } catch {}
          if (audioRefB.current) try { audioRefB.current.pause() } catch {}
          if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
            try { playerRef.current.pauseVideo() } catch {}
          }
          notifyNativePlayback(false, currentTimeRef.current, effectiveDuration)
        })
        navigator.mediaSession.setActionHandler('previoustrack', () => onPrev())
        navigator.mediaSession.setActionHandler('nexttrack', () => onNextRef.current())
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details && typeof details.seekTime === 'number') {
            commitSeek(details.seekTime)
          }
        })
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const offset = details?.seekOffset || 10
          commitSeek(currentTimeRef.current + offset)
        })
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const offset = details?.seekOffset || 10
          commitSeek(Math.max(0, currentTimeRef.current - offset))
        })

        if ('setPositionState' in navigator.mediaSession && effectiveDuration > 0 && currentTimeRef.current >= 0) {
          try {
            navigator.mediaSession.setPositionState({
              duration: Math.max(1, effectiveDuration),
              playbackRate: isPlaying ? 1 : 0,
              position: Math.min(effectiveDuration, Math.max(0, currentTimeRef.current))
            })
          } catch {}
        }
      } catch {}
    }
  }, [isPlaying, track?.title, track?.artist, track?.thumbnail, resolvedVid, thumbUrl, effectiveDuration, onPrev])

  // Listen for in-car seek commands from Android Auto
  useEffect(() => {
    const onCarSeek = (e) => {
      if (typeof e?.detail === 'number') {
        commitSeek(e.detail)
      }
    }
    window.addEventListener('upbeat-car-seek', onCarSeek)
    return () => window.removeEventListener('upbeat-car-seek', onCarSeek)
  }, [duration, useIframeFallback])

  const handleScrubStart = () => {
    setIsScrubbing(true)
    setScrubTime(currentTime)
  }

  const handleScrubChange = (e) => {
    const val = Number(e.target.value)
    if (isScrubbingRef.current) {
      setScrubTime(val)
    } else {
      commitSeek(val)
    }
  }

  const handleScrubEnd = (e) => {
    if (!isScrubbingRef.current) return
    const val = Number(e?.target?.value ?? scrubTime)
    setIsScrubbing(false)
    commitSeek(val)
  }

  return (
    <>
      {['A', 'B'].map((deck) => (
        <audio
          key={deck}
          ref={deck === 'A' ? audioRefA : audioRefB}
          preload="auto"
          onTimeUpdate={(e) => {
            if (activeDeckRef.current === deck && !useIframeFallback && !isScrubbingRef.current) {
              const cur = e.currentTarget.currentTime || 0
              currentTimeRef.current = cur
              if (!isDocumentHiddenRef.current) {
                setCurrentTime(cur)
              }
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              if (sleepTimerRef.current?.active && sleepTimerRef.current?.mode === 'end_of_track' && sleepTimerRef.current?.fadeOut) {
                if (targetDur > 15 && cur >= targetDur - 15) {
                  const factor = Math.max(0, (targetDur - cur) / 15)
                  const baseVol = isMuted ? 0 : volume / 100
                  e.currentTarget.volume = baseVol * factor
                }
              } else {
                const xfade = Number(crossfadeSecRef.current) || 0
                if (
                  xfade > 0 &&
                  repeatModeRef.current !== 'one' &&
                  targetDur > xfade + 6 &&
                  cur >= targetDur - xfade &&
                  cur > 2 &&
                  !endedTriggeredRef.current
                ) {
                  endedTriggeredRef.current = true
                  autoCrossfadeDurationMsRef.current = xfade * 1000
                  onNextRef.current()
                }
              }
            }
          }}
          onLoadedMetadata={(e) => {
            setIsLoadingStream(false)
            if (activeDeckRef.current === deck) {
              sanitizeDuration(e.currentTarget.duration)
            }
            if (isPlayingRef.current && e.currentTarget.paused && !fadeIntervalRef.current) {
              e.currentTarget.play().catch(() => {})
            }
          }}
          onCanPlay={() => {
            setIsLoadingStream(false)
          }}
          onDurationChange={(e) => {
            if (activeDeckRef.current === deck) {
              sanitizeDuration(e.currentTarget.duration)
            }
          }}
          onPlay={(e) => {
            setIsLoadingStream(false)
            if (activeDeckRef.current === deck || e.currentTarget.dataset.vid === resolvedVid) {
              endedTriggeredRef.current = false
              setIsPlaying(true)
              lastCurChangeTimeRef.current = Date.now()
              notifyNativePlayback(true, e.currentTarget.currentTime || 0, effectiveDuration)
            }
          }}
          onPause={(e) => {
            if (activeDeckRef.current === deck && !fadeIntervalRef.current && e.currentTarget.dataset.vid === resolvedVid) {
              const audio = e.currentTarget
              if (audio && !audio.ended) {
                setIsPlaying(false)
                notifyNativePlayback(false, audio.currentTime || 0, effectiveDuration)
              }
            }
          }}
          onWaiting={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid) {
              const cur = e.currentTarget.currentTime || 0
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              if (targetDur > 5 && cur > 5 && cur >= targetDur - 2.0 && !endedTriggeredRef.current) {
                if (repeatMode === 'one') {
                  commitSeek(0)
                  e.currentTarget.currentTime = 0
                  e.currentTarget.play().catch(() => {})
                  return
                }
                endedTriggeredRef.current = true
                if (handleTrackEnded()) return
                onNextRef.current()
              }
            }
          }}
          onStalled={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid) {
              const cur = e.currentTarget.currentTime || 0
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              if (targetDur > 5 && cur > 5 && cur >= targetDur - 2.0 && !endedTriggeredRef.current) {
                if (repeatMode === 'one') {
                  commitSeek(0)
                  e.currentTarget.currentTime = 0
                  e.currentTarget.play().catch(() => {})
                  return
                }
                endedTriggeredRef.current = true
                if (handleTrackEnded()) return
                onNextRef.current()
              }
            }
          }}
          onEnded={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid && !endedTriggeredRef.current) {
              if (repeatMode === 'one') {
                commitSeek(0)
                e.currentTarget.currentTime = 0
                e.currentTarget.play().catch(() => {})
                return
              }
              endedTriggeredRef.current = true
              if (handleTrackEnded()) return
              onNextRef.current()
            }
          }}
          onError={(e) => {
            if (e.currentTarget.dataset.vid !== resolvedVid) return
            setIsLoadingStream(false)
            if (fallbackQueueRef.current.length > 0) {
              const nextAlt = fallbackQueueRef.current.shift()
              setResolvedVid(nextAlt)
            } else if (!useIframeFallback) {
              setUseIframeFallback(true)
            }
          }}
        />
      ))}

      {/* Optional Video Container */}
      <div
        className={
          showVideo && track && playbackMode === 'app' && !nowPlayingOpen
            ? 'fixed bottom-28 sm:bottom-20 right-3 sm:right-6 z-40 w-72 sm:w-80 aspect-video rounded-lg overflow-hidden border border-indigo-500/40 bg-black shadow-2xl'
            : 'fixed bottom-0 right-0 w-[1px] h-[1px] opacity-0 pointer-events-none overflow-hidden'
        }
      >
        <div id="argon-yt-player-mount" className="w-full h-full" />
      </div>

      <footer
        className="bg-black/60 backdrop-blur-xl border-t border-white/[0.08] px-3 sm:px-5 py-2 sm:py-0 sm:h-[70px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 select-none flex-shrink-0 z-30 relative"
        style={{
          '--slider-thumb-color': albumColor.primary,
          '--slider-thumb-glow': albumColor.glow,
          boxShadow: isPlaying ? `0 -8px 28px ${albumColor.subtle}` : 'none',
          transition: 'box-shadow 0.4s ease'
        }}
      >
        {/* Top progress bar */}
        {track && effectiveDuration > 0 && (
          <div
            className="absolute top-0 left-0 h-[2px] transition-all duration-150 pointer-events-none"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(to right, ${albumColor.primary}, ${albumColor.accent})`
            }}
          />
        )}

        {/* Mobile Row 1 / Desktop Left+Center+Right */}
        <div className="flex items-center justify-between gap-2.5 w-full sm:w-auto sm:flex-1">
          {/* Track Artwork + Title + Artist (Click to expand Spotify/YT Music Now Playing screen) */}
          <div
            onClick={() => track && setNowPlayingOpen(true)}
            className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 flex-nowrap sm:w-1/4 sm:min-w-[200px] sm:flex-initial cursor-pointer group select-none"
            title="Tap to expand Now Playing view"
          >
            {track ? (
              <>
                <div
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#14141a] border overflow-hidden shrink-0 relative transition-all duration-300 group-hover:scale-105"
                  style={{
                    borderColor: isPlaying ? albumColor.border : '#22222a',
                    boxShadow: isPlaying ? `0 0 14px ${albumColor.subtle}` : 'none'
                  }}
                >
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#71717a]">
                      <Music className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isPlaying ? 'animate-pulse' : ''
                      }`}
                      style={{
                        backgroundColor: isPlaying ? albumColor.primary : '#52525b'
                      }}
                    />
                    <span className="text-xs sm:text-[13px] font-bold text-[#f4f4f5] tracking-tight truncate group-hover:text-white transition-colors flex-1 min-w-0">
                      {track.title}
                    </span>
                    {isPlayingOffline && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0" title="Offline playback from local storage">
                        OFFLINE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] sm:text-xs text-[#8e8e96] font-medium truncate mt-0.5 pl-3 group-hover:text-zinc-300 transition-colors">
                    {track.artist}
                  </div>
                </div>
                {onToggleFavorite && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(track) }}
                    title={isFav ? 'Remove from Favorites' : 'Save to Favorites'}
                    aria-label="Toggle Favorite"
                    className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer shrink-0 ${
                      isFav ? 'text-rose-400' : 'text-[#71717a] hover:text-rose-300'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                  </button>
                )}
                {track && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(track) }}
                    disabled={downloadState === 'downloading'}
                    title={downloadState === 'downloading' ? 'Downloading...' : (downloadState === 'success' || isDownloaded) ? 'Downloaded (Offline ready)' : 'Download Track'}
                    aria-label="Download Track"
                    className={`hidden sm:flex p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer shrink-0 ${
                      isDownloaded ? 'text-emerald-400' : 'text-[#71717a] hover:text-white'
                    }`}
                  >
                    {downloadState === 'downloading' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    ) : (downloadState === 'success' || isDownloaded) ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </button>
                )}
              </>
            ) : (
              <div className="text-xs text-[#71717a] font-mono py-2">
                Tap any track to play
              </div>
            )}
          </div>

          {/* Mobile Compact Transport Controls */}
          <div className="flex sm:hidden items-center gap-1.5 shrink-0">
            {track && (
              <button
                onClick={() => {
                  setShowLyrics(true)
                  setNowPlayingOpen(true)
                }}
                className={`p-1.5 rounded-md active:scale-90 transition-all cursor-pointer ${
                  nowPlayingOpen && showLyrics ? 'text-white bg-white/15' : 'text-zinc-400 hover:text-white'
                }`}
                style={nowPlayingOpen && showLyrics ? { color: albumColor.primary } : undefined}
                title="Live Synced Lyrics"
                aria-label="Lyrics"
              >
                <Mic2 className="w-4 h-4" />
              </button>
            )}
            {track && (
              <button
                onClick={() => setNowPlayingOpen(true)}
                className="p-1.5 rounded-md text-zinc-400 hover:text-white active:scale-90 transition-transform cursor-pointer"
                title="Expand Now Playing"
                aria-label="Expand Now Playing"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={isSafariMode ? () => onSafariControl('prev') : onPrev}
              disabled={!track}
              className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
              style={{ color: albumColor.primary }}
              aria-label="Previous"
            >
              <SkipBack className="w-4 h-4 fill-current opacity-90" />
            </button>
            <button
              onClick={isSafariMode ? () => onSafariControl('play_pause') : onTogglePlay}
              disabled={!track}
              className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30 transition-all duration-150 active:scale-95 shadow-md cursor-pointer hover:brightness-110"
              style={{
                backgroundColor: albumColor.primary,
                color: albumColor.contrastText,
                boxShadow: isPlaying ? `0 4px 16px ${albumColor.glow}` : '0 2px 8px rgba(0,0,0,0.35)'
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoadingStream ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
            <button
              onClick={isSafariMode ? () => onSafariControl('next') : onNext}
              disabled={!track}
              className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
              style={{ color: albumColor.primary }}
              aria-label="Next"
            >
              <SkipForward className="w-4 h-4 fill-current opacity-90" />
            </button>
            {onToggleQueue && (
              <button
                onClick={onToggleQueue}
                title="Playback Queue"
                aria-label="Open Queue"
                className={`p-1.5 relative rounded-md transition-colors cursor-pointer ${
                  isQueueOpen ? 'text-sky-300 bg-sky-500/20' : 'text-[#8e8e96] active:text-white'
                }`}
              >
                <ListMusic className="w-4 h-4" />
                {queueCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                    {queueCount}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Desktop Center Transport & Scrubber */}
          <div className="hidden sm:flex flex-col items-center gap-1.5 flex-1 max-w-xl px-4">
            <div className="flex items-center gap-5">
              <button
                onClick={isSafariMode ? () => onSafariControl('prev') : onPrev}
                disabled={!track}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-all duration-150 active:scale-90 disabled:opacity-30 cursor-pointer"
                style={{ color: albumColor.primary }}
                title="Previous Track"
              >
                <SkipBack className="w-4 h-4 fill-current opacity-90" />
              </button>

              <button
                onClick={isSafariMode ? () => onSafariControl('play_pause') : onTogglePlay}
                disabled={!track}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center disabled:opacity-30 transition-all duration-150 active:scale-95 shadow-lg cursor-pointer hover:brightness-110 hover:scale-105"
                style={{
                  backgroundColor: albumColor.primary,
                  color: albumColor.contrastText,
                  boxShadow: isPlaying ? `0 4px 20px ${albumColor.glow}` : '0 2px 10px rgba(0,0,0,0.4)'
                }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isLoadingStream ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={isSafariMode ? () => onSafariControl('next') : onNext}
                disabled={!track}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-all duration-150 active:scale-90 disabled:opacity-30 cursor-pointer"
                style={{ color: albumColor.primary }}
                title="Next Track"
              >
                <SkipForward className="w-4 h-4 fill-current opacity-90" />
              </button>
            </div>

            <div className="w-full flex items-center gap-3">
              <span className="text-[11px] font-mono text-[#8e8e96] w-9 text-right">
                {formatTime(displayTime)}
              </span>
              <input
                type="range"
                min="0"
                max={effectiveDuration > 0 ? effectiveDuration : 100}
                step="0.25"
                value={Math.min(displayTime, effectiveDuration > 0 ? effectiveDuration : 100)}
                onPointerDown={handleScrubStart}
                onTouchStart={handleScrubStart}
                onChange={handleScrubChange}
                onPointerUp={handleScrubEnd}
                onTouchEnd={handleScrubEnd}
                onMouseUp={handleScrubEnd}
                disabled={!track || isSafariMode}
                style={{
                  background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent} ${progressPct}%, #202028 ${progressPct}%, #202028 100%)`
                }}
                className="flex-1 argon-slider cursor-pointer disabled:opacity-40"
              />
              <span className="text-[11px] font-mono text-[#8e8e96] w-9">
                {effectiveDuration > 0 ? formatTime(effectiveDuration) : (track?.duration_text && track.duration_text !== '--:--' ? track.duration_text : '0:00')}
              </span>
            </div>
          </div>

          {/* Desktop Right Controls */}
          <div className="hidden sm:flex items-center justify-end gap-3 w-1/4 min-w-[180px]">
            {hasBackend() && (
              <div className="hidden md:flex items-center bg-[#121217] border border-[#22222a] rounded-lg p-0.5 text-[11px] font-mono">
                <button
                  onClick={() => setPlaybackMode('app')}
                  title="App Native Engine"
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    playbackMode === 'app'
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 font-medium'
                      : 'text-[#8e8e96] hover:text-[#e4e4e7]'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPlaybackMode('safari')}
                  title="Safari Web Engine"
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    playbackMode === 'safari'
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 font-medium'
                      : 'text-[#8e8e96] hover:text-[#e4e4e7]'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {onToggleQueue && (
              <button
                onClick={onToggleQueue}
                title="Open Playback Queue"
                className={`p-1.5 rounded-md relative transition-colors cursor-pointer ${
                  isQueueOpen
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-[#8e8e96] hover:text-white hover:bg-[#1a1a22]'
                }`}
              >
                <ListMusic className="w-4 h-4" />
                {queueCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                    {queueCount}
                  </span>
                )}
              </button>
            )}

            <button
              onClick={() => {
                if (nowPlayingOpen && showLyrics) {
                  setShowLyrics(false)
                } else {
                  setShowLyrics(true)
                  setNowPlayingOpen(true)
                }
              }}
              disabled={!track}
              title="Live Synced Lyrics"
              aria-label="Toggle Synced Lyrics"
              className={`p-1.5 rounded-md border text-xs transition-all cursor-pointer disabled:opacity-30 ${
                nowPlayingOpen && showLyrics
                  ? 'text-white'
                  : 'bg-transparent border-transparent text-[#8e8e96] hover:text-white hover:bg-[#1a1a22]'
              }`}
              style={
                nowPlayingOpen && showLyrics
                  ? {
                      backgroundColor: `${albumColor.primary}25`,
                      borderColor: `${albumColor.primary}55`,
                      color: albumColor.primary
                    }
                  : undefined
              }
            >
              <Mic2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                const nextShow = !showVideo
                setShowVideo(nextShow)
                if (nextShow) setUseIframeFallback(true)
              }}
              disabled={!track || playbackMode !== 'app'}
              title="Toggle Video Preview"
              className={`p-1.5 rounded-md border text-xs transition-colors cursor-pointer disabled:opacity-30 ${
                showVideo
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-transparent border-transparent text-[#8e8e96] hover:text-white'
              }`}
            >
              <Video className="w-4 h-4" />
            </button>

            {track && (
              <button
                onClick={() => handleDownload(track)}
                disabled={downloadState === 'downloading'}
                title={downloadState === 'downloading' ? 'Downloading audio...' : (downloadState === 'success' || isDownloaded) ? 'Downloaded (Offline ready)' : 'Download Track'}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${
                  (downloadState === 'success' || isDownloaded)
                    ? 'text-emerald-400 bg-emerald-500/15'
                    : downloadState === 'downloading'
                    ? 'text-emerald-300 animate-pulse bg-emerald-500/10'
                    : 'text-[#8e8e96] hover:text-white hover:bg-[#1a1a22]'
                }`}
              >
                {downloadState === 'downloading' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (downloadState === 'success' || isDownloaded) ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </button>
            )}

            {track && (
              <button
                onClick={() => {
                  if (onPushToSafari) {
                    onPushToSafari(track)
                  } else {
                    const u = track.url || (track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : (resolvedVid ? `https://www.youtube.com/watch?v=${resolvedVid}` : ''))
                    if (u) openExternalUrl(u)
                  }
                }}
                title="Open on YouTube / Browser"
                className="p-1.5 rounded-md text-[#8e8e96] hover:text-white hover:bg-[#1a1a22] transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setIsSleepModalOpen(true)}
              title={
                sleepTimer.active
                  ? (sleepTimer.mode === 'end_of_track' ? 'Sleep Timer: End of song' : `Sleep Timer: ${Math.ceil(sleepTimer.remainingSec / 60)}m left`)
                  : 'Sleep Timer'
              }
              aria-label="Sleep Timer"
              className={`p-1.5 rounded-md transition-colors cursor-pointer relative ${
                sleepTimer.active
                  ? 'text-indigo-400 bg-indigo-500/15'
                  : 'text-[#8e8e96] hover:text-white hover:bg-[#1a1a22]'
              }`}
            >
              <Moon className="w-4 h-4" />
              {sleepTimer.active && sleepTimer.mode === 'minutes' && (
                <span
                  className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center pointer-events-none"
                  style={{ backgroundColor: albumColor.primary }}
                >
                  {Math.ceil(sleepTimer.remainingSec / 60)}m
                </span>
              )}
            </button>

            <div className="hidden lg:flex items-center gap-2">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-[#8e8e96] hover:text-white transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#52525b]" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volumeVal}
                onChange={(e) => {
                  setVolume(Number(e.target.value))
                  setIsMuted(false)
                }}
                style={{
                  background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent} ${volumeVal}%, #202028 ${volumeVal}%, #202028 100%)`
                }}
                className="w-16 argon-slider cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Mobile Scrubber Row */}
        {track && (
          <div className="flex sm:hidden items-center gap-2 w-full px-0.5">
            <span className="text-[10px] font-mono text-[#71717a] w-7">
              {formatTime(displayTime)}
            </span>
            <input
              type="range"
              min="0"
              max={effectiveDuration > 0 ? effectiveDuration : 100}
              step="0.25"
              value={Math.min(displayTime, effectiveDuration > 0 ? effectiveDuration : 100)}
              onPointerDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              onChange={handleScrubChange}
              onPointerUp={handleScrubEnd}
              onTouchEnd={handleScrubEnd}
              onMouseUp={handleScrubEnd}
              disabled={!track || isSafariMode}
              style={{
                background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent} ${progressPct}%, #202028 ${progressPct}%, #202028 100%)`
              }}
              className="flex-1 argon-slider"
            />
            <span className="text-[10px] font-mono text-[#71717a] w-7 text-right">
              {effectiveDuration > 0 ? formatTime(effectiveDuration) : (track?.duration_text && track.duration_text !== '--:--' ? track.duration_text : '0:00')}
            </span>
          </div>
        )}
      </footer>

      {/* Spotify & YouTube Music Style Full Now Playing Screen */}
      <NowPlayingView
        isOpen={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        track={track}
        resolvedVid={resolvedVid}
        isPlaying={isPlaying}
        isLoadingStream={isLoadingStream}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
        onPrev={onPrev}
        effectiveDuration={effectiveDuration}
        displayTime={displayTime}
        progressPct={progressPct}
        handleScrubStart={handleScrubStart}
        handleScrubChange={handleScrubChange}
        handleScrubEnd={handleScrubEnd}
        albumColor={albumColor}
        isFav={isFav}
        onToggleFavorite={onToggleFavorite}
        downloadState={downloadState}
        isDownloaded={isDownloaded}
        handleDownload={handleDownload}
        onToggleQueue={onToggleQueue}
        queueCount={queueCount}
        playbackMode={playbackMode}
        onPushToSafari={onPushToSafari}
        showVideo={showVideo}
        setShowVideo={setShowVideo}
        isShuffle={isShuffle}
        setIsShuffle={setIsShuffle}
        repeatMode={repeatMode}
        setRepeatMode={setRepeatMode}
        volume={volume}
        setVolume={setVolume}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        isPlayingOffline={isPlayingOffline}
        showLyrics={showLyrics}
        setShowLyrics={setShowLyrics}
        onSeek={commitSeek}
        sleepTimer={sleepTimer}
        onOpenSleepTimer={() => setIsSleepModalOpen(true)}
      />

      <SleepTimerModal
        isOpen={isSleepModalOpen}
        onClose={() => setIsSleepModalOpen(false)}
        sleepTimer={sleepTimer}
        onSetTimer={handleSetSleepTimer}
        onCancelTimer={handleCancelSleepTimer}
        onAddMinutes={handleAddSleepMinutes}
        crossfadeSec={effectiveCrossfadeSec}
        onChangeCrossfade={handleChangeCrossfade}
        albumColor={albumColor}
      />
    </>
  )
}
