import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Music, Heart, Loader2, ListMusic, Moon, Shuffle, Repeat, Repeat1, Users, Maximize2, MessageSquareQuote
} from 'lucide-react'
import { artUrl } from '../ui/primitives'
import { getApiBase, hasBackend, getAudioSource, resolveStandaloneAudio, searchYouTubeStandalone, getTrackDownloadUrl, openExternalUrl, prewarmTrack } from '../standaloneApi'
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
  setCrossfadeSec: externalSetCrossfadeSec,
  isShuffle: externalIsShuffle,
  setIsShuffle: externalSetIsShuffle,
  onToggleShuffle: externalOnToggleShuffle,
  onUserSeek,
  isDesktop = false,
  playingFromTitle = '',
  rightPanelOpen = false,
  onToggleRightPanel,
  jamActive = false,
  onOpenJam,
  onGoToArtist,
  onStartRadio,
  onAddToPlaylist,
  upNextTrack = null
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

  const [internalShuffle, setInternalShuffle] = useState(false)
  const isShuffle = typeof externalIsShuffle === 'boolean' ? externalIsShuffle : internalShuffle
  const setIsShuffle = externalSetIsShuffle || setInternalShuffle
  const handleToggleShuffle = externalOnToggleShuffle || (() => setIsShuffle((prev) => !prev))
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
  const fadeOutAudioRef = useRef(null) // outgoing deck while a crossfade is running

  const getActiveAudio = () => (activeDeckRef.current === 'A' ? audioRefA.current : audioRefB.current)
  const getInactiveAudio = () => (activeDeckRef.current === 'A' ? audioRefB.current : audioRefA.current)

  // Fully releases a deck. Clears dataset.vid first so unmount/error events are ignored.
  const unloadAudio = (audio) => {
    if (!audio) return
    audio.dataset.vid = ''
    try {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    } catch {}
  }

  // Instantly completes any running crossfade: stops the outgoing deck and restores the
  // incoming (active) deck to full volume. Prevents a stale fade from wiping a newly
  // loaded song or leaving the player stuck at a partial volume.
  const finishCrossfadeNow = () => {
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current)
      fadeIntervalRef.current = null
    }
    const outgoing = fadeOutAudioRef.current
    fadeOutAudioRef.current = null
    const active = getActiveAudio()
    if (outgoing && outgoing !== active) {
      unloadAudio(outgoing)
    }
    if (active) {
      try {
        active.volume = isMutedRef.current ? 0 : volumeRef.current / 100
      } catch {}
    }
  }

  const playerRef = useRef(null)
  const currentVidRef = useRef('')
  const fallbackQueueRef = useRef([])
  const endedTriggeredRef = useRef(false)
  const endedTriggeredTrackKeyRef = useRef('')
  const hasPrewarmedNextRef = useRef(false)
  const loadWatchdogRef = useRef(null)

  const clearLoadWatchdog = () => {
    if (loadWatchdogRef.current) {
      clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }

  const getTrackTriggerKey = (vid = resolvedVid) => `${vid || ''}_${track?.video_id || ''}_${track?.title || ''}`
  const isEndTriggered = (vid = resolvedVid) =>
    endedTriggeredRef.current || (endedTriggeredTrackKeyRef.current && endedTriggeredTrackKeyRef.current === getTrackTriggerKey(vid))
  const markEndTriggered = (vid = resolvedVid) => {
    endedTriggeredRef.current = true
    endedTriggeredTrackKeyRef.current = getTrackTriggerKey(vid)
  }
  const clearEndTriggered = () => {
    endedTriggeredRef.current = false
    endedTriggeredTrackKeyRef.current = ''
  }

  const isScrubbingRef = useRef(false)
  const lastNativeReportSecRef = useRef(0)
  const currentTimeRef = useRef(0)
  const lastUiTimeRef = useRef(-1)
  const isDocumentHiddenRef = useRef(false)
  const nowPlayingOpenRef = useRef(false)
  const showLyricsRef = useRef(false)

  useEffect(() => {
    nowPlayingOpenRef.current = Boolean(nowPlayingOpen)
    showLyricsRef.current = Boolean(showLyrics)
  }, [nowPlayingOpen, showLyrics])

  const syncUiCurrentTime = (cur, force = false) => {
    currentTimeRef.current = cur
    if (isDocumentHiddenRef.current) return
    const minDelta = (nowPlayingOpenRef.current && showLyricsRef.current) ? 0.22 : 0.48
    if (force || cur < 0.3 || Math.abs(cur - lastUiTimeRef.current) >= minDelta) {
      lastUiTimeRef.current = cur
      setCurrentTime(cur)
    }
  }

  useEffect(() => {
    const handleVisChange = () => {
      isDocumentHiddenRef.current = document.hidden
      if (!document.hidden) {
        lastUiTimeRef.current = currentTimeRef.current
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
      // and /api/audio-info. If authDur was a bogus short value (e.g. <=60s) but the audio
      // element has loaded a full track (>75s), update authDur to the real duration!
      if (authDur <= 60 && rawDur > 75) {
        authoritativeDurationRef.current = Math.round(rawDur)
        setDuration(Math.round(rawDur))
        return
      }
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
  const thumbUrl = (track ? artUrl(track) : '') || track?.thumbnail || (resolvedVid ? `https://i.ytimg.com/vi/${resolvedVid}/hqdefault.jpg` : '')
  const albumColor = useAlbumColor(thumbUrl)

  // Dynamic Subtle Playing-Song Ambient Aura across the App (~5% Touch)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (track && albumColor && albumColor.rgb) {
      root.style.setProperty('--song-glow-1', `rgba(${albumColor.rgb}, 0.07)`)
      root.style.setProperty('--song-glow-2', `rgba(${albumColor.rgb}, 0.04)`)
      root.style.setProperty('--song-glow-3', `rgba(${albumColor.rgb}, 0.05)`)
      root.style.setProperty('--song-primary', albumColor.primary)
      root.style.setProperty('--song-accent', albumColor.accent || albumColor.primary)
      root.style.setProperty('--album', albumColor.primary)
    } else {
      root.style.setProperty('--song-glow-1', 'transparent')
      root.style.setProperty('--song-glow-2', 'transparent')
      root.style.setProperty('--song-glow-3', 'transparent')
      root.style.setProperty('--song-primary', '#F43F5E')
      root.style.setProperty('--song-accent', '#F43F5E')
      root.style.setProperty('--album', '#2A2A2F')
    }
  }, [track, albumColor])

  const miniArt = thumbUrl
  const swipeRef = useRef(null)
  const cycleRepeat = () => setRepeatMode((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'))

  // Other surfaces (desktop right panel) can ask for the lyrics view
  useEffect(() => {
    const openLyrics = () => {
      setShowLyrics(true)
      setNowPlayingOpen(true)
    }
    window.addEventListener('upbeat-open-lyrics', openLyrics)
    return () => window.removeEventListener('upbeat-open-lyrics', openLyrics)
  }, [setNowPlayingOpen])
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
      if (audio && !audio.getAttribute('src')) {
        audio.src = silentUri
        audio.play().then(() => {
          // Only reset if a real song hasn't been loaded into this deck meanwhile —
          // otherwise this would wipe the user's first song and leave the player silent.
          if (audio.src !== silentUri) return
          audio.pause()
          audio.currentTime = 0
          audio.removeAttribute('src')
          audio.load()
        }).catch(() => {})
      }
    })
  }, [])

  useEffect(() => {
    const handleGesture = () => primeAudioEngines()
    window.addEventListener('pointerdown', handleGesture, { once: true, passive: true })
    window.addEventListener('keydown', handleGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', handleGesture)
      window.removeEventListener('keydown', handleGesture)
    }
  }, [primeAudioEngines])

  const pendingSeekSecRef = useRef(null)
  const commitSeekRef = useRef(null)

  const commitSeek = (targetSec, fromRemoteJam = false) => {
    finishCrossfadeNow()
    const sec = Math.max(0, Number(targetSec) || 0)
    currentTimeRef.current = sec
    setCurrentTime(sec)
    lastCurPosRef.current = sec
    lastCurChangeTimeRef.current = Date.now()
    clearEndTriggered()
    lastNativeReportSecRef.current = sec
    notifyNativePlayback(Boolean(isPlayingRef.current), sec, effectiveDuration)
    restoreVolume()
    if (!fromRemoteJam && onUserSeek) {
      try {
        onUserSeek(sec)
      } catch {}
    }
    const activeAudio = getActiveAudio()
    if (!useIframeFallback && activeAudio) {
      try {
        if (activeAudio.readyState >= 1) {
          activeAudio.currentTime = sec
          pendingSeekSecRef.current = null
        } else {
          pendingSeekSecRef.current = sec
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
  commitSeekRef.current = commitSeek

  const forcePauseDirect = (targetSec) => {
    isPlayingRef.current = false
    setIsPlaying(false)
    finishCrossfadeNow()
    ;[audioRefA.current, audioRefB.current].forEach((a) => {
      if (a) {
        try {
          a.playbackRate = 1.0
          a.pause()
        } catch {}
      }
    })
    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
      try {
        playerRef.current.pauseVideo()
      } catch {}
    }
    if (typeof targetSec === 'number' && !isNaN(targetSec) && targetSec >= 0) {
      const sec = Math.max(0, Number(targetSec) || 0)
      currentTimeRef.current = sec
      setCurrentTime(sec)
      lastCurPosRef.current = sec
      const activeAudio = getActiveAudio()
      if (!useIframeFallback && activeAudio) {
        try {
          if (activeAudio.readyState >= 1) {
            if (Math.abs((activeAudio.currentTime || 0) - sec) > 0.15) {
              activeAudio.currentTime = sec
            }
            pendingSeekSecRef.current = null
          } else {
            pendingSeekSecRef.current = sec
          }
        } catch {}
      } else if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
        try {
          playerRef.current.seekTo(sec, true)
        } catch {}
      }
    }
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused'
      } catch {}
    }
    notifyNativePlayback(false, currentTimeRef.current || 0, effectiveDuration)
  }

  const forcePlayDirect = (targetSec) => {
    isPlayingRef.current = true
    setIsPlaying(true)
    if (typeof targetSec === 'number' && !isNaN(targetSec) && targetSec >= 0) {
      if (Math.abs((currentTimeRef.current || 0) - targetSec) > 0.35) {
        commitSeekRef.current?.(targetSec, true)
      }
    }
    const activeAudio = getActiveAudio()
    if (!useIframeFallback && activeAudio && activeAudio.getAttribute('src')) {
      try {
        activeAudio.play().catch(() => {})
      } catch {}
    } else if (useIframeFallback && playerRef.current && typeof playerRef.current.playVideo === 'function') {
      try {
        playerRef.current.playVideo()
      } catch {}
    }
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'playing'
      } catch {}
    }
    notifyNativePlayback(true, currentTimeRef.current || 0, effectiveDuration)
  }

  const forcePauseRef = useRef(forcePauseDirect)
  forcePauseRef.current = forcePauseDirect
  const forcePlayRef = useRef(forcePlayDirect)
  forcePlayRef.current = forcePlayDirect

  // Expose global controls for macOS menu bar, media keys, Jam sync engine, and external extensions
  useEffect(() => {
    window.UpBeatControls = {
      togglePlay: () => {
        if (isPlayingRef.current) {
          forcePauseRef.current?.()
        } else {
          forcePlayRef.current?.()
        }
      },
      play: (targetSec) => forcePlayRef.current?.(targetSec),
      pause: (targetSec) => forcePauseRef.current?.(targetSec),
      forcePlay: (targetSec) => forcePlayRef.current?.(targetSec),
      forcePause: (targetSec) => forcePauseRef.current?.(targetSec),
      next: () => onNextRef.current(),
      prev: () => onPrev(),
      seekTo: (sec, fromRemoteJam = false) => commitSeekRef.current?.(sec, fromRemoteJam),
      getCurrentTime: () => currentTimeRef.current || 0,
      getDuration: () => authoritativeDurationRef.current || 0,
      setPlaybackRate: (rate) => {
        const a = getActiveAudio()
        if (a) {
          try {
            a.preservesPitch = true
            a.playbackRate = Number(rate) || 1.0
          } catch {}
        }
      }
    }
    return () => {
      delete window.UpBeatControls
    }
  }, [onPrev, setIsPlaying])

  // Resolve video_id if track lacks one
  useEffect(() => {
    clearEndTriggered()
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
            const expParam = initialDur > 0 ? `&expected_duration=${initialDur}` : ''
            const r = await fetch(`${getApiBase()}/audio-info/${track.video_id}?title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}${expParam}`)
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

  // Primary Engine: Native Dual-Deck HTML5 <audio> with configurable crossfade
  useEffect(() => {
    if (!resolvedVid || playbackMode !== 'app' || useIframeFallback) return

    hasPrewarmedNextRef.current = false

    // Any crossfade still running from the previous transition must be completed NOW,
    // otherwise its final tick would pause/unload the deck we are about to load into.
    finishCrossfadeNow()

    let cancelled = false
    const currentActive = getActiveAudio()
    const targetDeck = activeDeckRef.current === 'A' ? 'B' : 'A'
    const targetAudio = targetDeck === 'A' ? audioRefA.current : audioRefB.current
    const autoFadeMs = autoCrossfadeDurationMsRef.current
    autoCrossfadeDurationMsRef.current = 0

    if (!targetAudio) return

    if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
      try { playerRef.current.stopVideo() } catch {}
    }

    const tryNextFallback = () => {
      if (cancelled) return true
      if (fallbackQueueRef.current.length > 0) {
        setResolvedVid(fallbackQueueRef.current.shift())
        return true
      }
      return false
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
        if (cancelled) return
        if (offlineUrl) {
          streamSrc = offlineUrl
          setIsPlayingOffline(true)
        }
      } catch {}
      if (cancelled) return

      if (!streamSrc) {
        setIsPlayingOffline(false)
        setIsLoadingStream(true)
        try {
          const streamInfo = await getAudioSource(resolvedVid, track)
          if (cancelled) return
          streamSrc = typeof streamInfo === 'string' ? streamInfo : streamInfo?.url
          if (streamInfo?.video_id && streamInfo.video_id !== resolvedVid) {
            targetAudio.dataset.vid = streamInfo.video_id
            setResolvedVid(streamInfo.video_id)
          }
        } catch {} finally {
          if (!cancelled) setIsLoadingStream(false)
        }
        if (cancelled) return
      }

      if (!streamSrc) {
        setIsLoadingStream(false)
        if (tryNextFallback()) return
        if (!useIframeFallback) setUseIframeFallback(true)
        return
      }

      clearLoadWatchdog()
      if (isPlayingRef.current) {
        loadWatchdogRef.current = setTimeout(async () => {
          if (cancelled) return
          const active = getActiveAudio()
          if (isPlayingRef.current && active && active.dataset.vid === resolvedVid) {
            if ((active.currentTime || 0) < 0.1 && (active.paused || active.readyState < 2)) {
              console.warn('[UpBeat] Playback watchdog triggered for', resolvedVid)
              try {
                await active.play()
                return
              } catch {}
              if (active.src && active.src.includes('/api/audio/')) {
                try {
                  const direct = await resolveStandaloneAudio(resolvedVid, track)
                  if (direct?.url && !cancelled) {
                    active.src = direct.url
                    await active.play()
                    return
                  }
                } catch {}
              }
              if (tryNextFallback()) return
              if (!useIframeFallback) {
                setUseIframeFallback(true)
                return
              }
              onNextRef.current()
            }
          }
        }, 9000)
      }

      const targetVol = isMutedRef.current ? 0 : volumeRef.current / 100
      const isPrevPlaying =
        currentActive &&
        !currentActive.paused &&
        currentActive.currentTime > 0.5 &&
        !currentActive.ended &&
        currentActive.dataset.vid &&
        currentActive.dataset.vid !== resolvedVid

      const isDocumentHidden = typeof document !== 'undefined' && Boolean(document.hidden)

      if (isDocumentHidden && currentActive && isPrevPlaying && isPlayingRef.current) {
        // Continuous background playback (Safari/Chrome tab hidden or minimized):
        // Directly reuse the active, already-blessed audio element to eliminate browser background autoplay blocks.
        // The idle deck is NOT loaded here, so it can never start a duplicate copy in the background.
        unloadAudio(targetAudio)
        currentActive.dataset.vid = resolvedVid
        currentActive.src = streamSrc
        currentActive.volume = targetVol
        currentActive.load()
        try {
          await currentActive.play()
        } catch {
          tryNextFallback()
        }
        return
      }

      // Abort previous pending stream on rapid clicks to free socket bandwidth immediately
      if (targetAudio.src && targetAudio.src !== streamSrc) {
        try {
          targetAudio.pause()
          targetAudio.removeAttribute('src')
          targetAudio.load()
        } catch {}
      }

      targetAudio.dataset.vid = resolvedVid
      targetAudio.src = streamSrc
      targetAudio.load()

      const xfadeSec = Number(crossfadeSecRef.current) || 0

      if (isPrevPlaying && isPlayingRef.current && xfadeSec > 0) {
        // Configurable dual-deck crossfade:
        // - Full user-configured duration (2s–12s) when auto-transitioning at end of track
        // - Snappy <=1.5s blend when manually skipping mid-track
        targetAudio.volume = 0
        let started = true
        try {
          await targetAudio.play()
        } catch (err) {
          if (err?.name === 'NotAllowedError') {
            setIsPlaying(false)
            isPlayingRef.current = false
            return
          }
          started = false
        }
        if (cancelled) return // a newer track owns the decks now — touch nothing

        if (!started) {
          // If dual-deck play was blocked (e.g. autoplay restriction on the idle deck),
          // reuse currentActive immediately so playback never dies!
          if (currentActive) {
            unloadAudio(targetAudio)
            currentActive.dataset.vid = resolvedVid
            currentActive.src = streamSrc
            currentActive.volume = targetVol
            try {
              await currentActive.play()
              return
            } catch {}
          }
          if (tryNextFallback()) return
          return
        }

        activeDeckRef.current = targetDeck

        const oldAudio = currentActive
        const oldStartVol = oldAudio.volume
        const fadeStart = Date.now()
        const fadeDuration = Math.max(300, autoFadeMs > 0 ? autoFadeMs : Math.min(xfadeSec * 1000, 1500))
        fadeOutAudioRef.current = oldAudio

        fadeIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - fadeStart
          const progress = Math.min(1, elapsed / fadeDuration)
          const liveTargetVol = isMutedRef.current ? 0 : volumeRef.current / 100

          // Equal-power cosine crossfade curve prevents volume dip in the middle of the overlap
          const fadeIn = Math.sin(progress * Math.PI * 0.5)
          const fadeOut = Math.cos(progress * Math.PI * 0.5)

          try {
            targetAudio.volume = Math.min(1, Math.max(0, liveTargetVol * fadeIn))
            oldAudio.volume = Math.min(1, Math.max(0, oldStartVol * fadeOut))
          } catch {}

          if (progress >= 1) finishCrossfadeNow()
        }, 40)
      } else {
        // Initial play, paused state, or crossfade off: switch immediately
        if (currentActive && currentActive !== targetAudio) {
          unloadAudio(currentActive)
        }
        activeDeckRef.current = targetDeck
        targetAudio.volume = targetVol
        if (isPlayingRef.current) {
          targetAudio.play().catch((err) => {
            if (err?.name === 'NotAllowedError') {
              setIsPlaying(false)
              isPlayingRef.current = false
              return
            }
            // Autoplay recovery: if target deck failed, try currentActive
            if (currentActive && currentActive !== targetAudio) {
              currentActive.dataset.vid = resolvedVid
              currentActive.src = streamSrc
              currentActive.volume = targetVol
              currentActive.play().catch((err2) => {
                if (err2?.name === 'NotAllowedError') {
                  setIsPlaying(false)
                  isPlayingRef.current = false
                  return
                }
                tryNextFallback()
              })
              return
            }
            tryNextFallback()
          })
        }
      }
    })()

    return () => {
      cancelled = true
      clearLoadWatchdog()
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
        if (activeAudio.getAttribute('src')) {
          // Restore full volume in case a pause interrupted a crossfade mid-way
          // (sleep timer's own final-30s fade is left alone).
          const st = sleepTimerRef.current
          const inSleepFade = st?.active && st?.fadeOut && st?.mode === 'minutes' && st?.remainingSec <= 30
          if (!fadeIntervalRef.current && !inSleepFade) {
            try { activeAudio.volume = isMuted ? 0 : volume / 100 } catch {}
          }
          activeAudio.play().catch(() => {})
        }
      } else {
        finishCrossfadeNow()
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
  }, [isPlaying, playbackMode, useIframeFallback])

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
                if (useIframeFallback && currentVidRef.current === resolvedVid && !isEndTriggered(resolvedVid)) {
                  markEndTriggered(resolvedVid)
                  if (handleTrackEnded()) return
                  onNextRef.current()
                }
              } else if (e.data === 1) {
                clearEndTriggered()
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
          clearEndTriggered()
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
          syncUiCurrentTime(cur)

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
        // If rawDur is valid and longer than targetDur, targetDur was an underestimate.
        // Never trigger early crossfade if audio still has more to play!
        const effectiveEndDur = (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > targetDur) ? rawDur : targetDur
        const timeSinceAdvance = Date.now() - (lastCurChangeTimeRef.current || Date.now())
        const isEnded = Boolean(audio.ended)
        const reachedTargetEnd = effectiveEndDur > 5 && cur >= effectiveEndDur - 0.4
        const stalledNearEnd = effectiveEndDur > 5 && cur >= effectiveEndDur - 2.0 && cur > 5 && timeSinceAdvance >= 1500
        const isSbr2xFreeze =
          typeof rawDur === 'number' &&
          rawDur > 20 &&
          cur > 5 &&
          Math.abs(cur - rawDur / 2) <= 3.0 &&
          timeSinceAdvance >= 1800
        const midTrackStall = cur > 1 && timeSinceAdvance >= 12000

        if (midTrackStall && isPlayingRef.current) {
          audio.play().catch(() => {})
          if (timeSinceAdvance >= 18000 && !isEndTriggered()) {
            console.warn('[UpBeat] Mid-track stall recovery: advancing track')
            markEndTriggered()
            if (handleTrackEnded()) return
            onNextRef.current()
            return
          }
        }

        // Early Overlap Crossfade Trigger: start next song `xfadeSec` seconds before current song ends
        const xfade = Number(crossfadeSecRef.current) || 0
        const isEndSleep = sleepTimerRef.current?.active && sleepTimerRef.current?.mode === 'end_of_track'
        if (
          xfade > 0 &&
          repeatModeRef.current !== 'one' &&
          !isEndSleep &&
          effectiveEndDur > xfade + 6 &&
          cur >= effectiveEndDur - xfade &&
          cur > 2 &&
          !isEndTriggered()
        ) {
          markEndTriggered()
          autoCrossfadeDurationMsRef.current = xfade * 1000
          onNextRef.current()
          return
        }

        if ((isEnded || reachedTargetEnd || stalledNearEnd || isSbr2xFreeze) && !isEndTriggered() && cur > 0.5) {
          markEndTriggered()
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
            syncUiCurrentTime(cur)
          }
          if (typeof p.getDuration === 'function') {
            const dur = p.getDuration()
            if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
              sanitizeDuration(dur)
              const effectiveDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              if (cur >= effectiveDur - 0.3 && effectiveDur > 5 && !isEndTriggered(resolvedVid)) {
                markEndTriggered(resolvedVid)
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
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid && !useIframeFallback && !isScrubbingRef.current) {
              const cur = e.currentTarget.currentTime || 0
              syncUiCurrentTime(cur)
              if (cur > 0.5) {
                clearLoadWatchdog()
              }
              if (cur > 5 && !hasPrewarmedNextRef.current) {
                hasPrewarmedNextRef.current = true
                if (upNextTrack?.video_id) {
                  prewarmTrack(upNextTrack.video_id)
                }
              }
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              const rawDur = e.currentTarget.duration
              const effectiveEndDur = (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > targetDur) ? rawDur : targetDur

              const isEndSleep = sleepTimerRef.current?.active && sleepTimerRef.current?.mode === 'end_of_track'
              if (isEndSleep) {
                if (sleepTimerRef.current?.fadeOut && effectiveEndDur > 15 && cur >= effectiveEndDur - 15) {
                  const factor = Math.max(0, (effectiveEndDur - cur) / 15)
                  const baseVol = isMuted ? 0 : volume / 100
                  e.currentTarget.volume = baseVol * factor
                }
              } else {
                const xfade = Number(crossfadeSecRef.current) || 0
                if (
                  xfade > 0 &&
                  repeatModeRef.current !== 'one' &&
                  effectiveEndDur > xfade + 6 &&
                  cur >= effectiveEndDur - xfade &&
                  cur > 2 &&
                  !isEndTriggered(e.currentTarget.dataset.vid)
                ) {
                  markEndTriggered(e.currentTarget.dataset.vid)
                  autoCrossfadeDurationMsRef.current = xfade * 1000
                  onNextRef.current()
                }
              }
            }
          }}
          onLoadedMetadata={(e) => {
            setIsLoadingStream(false)
            if (activeDeckRef.current === deck || e.currentTarget.dataset.vid === resolvedVid) {
              sanitizeDuration(e.currentTarget.duration)
              if (pendingSeekSecRef.current !== null && pendingSeekSecRef.current > 0) {
                try {
                  e.currentTarget.currentTime = pendingSeekSecRef.current
                  pendingSeekSecRef.current = null
                } catch {}
              }
            }
            if (isPlayingRef.current && e.currentTarget.paused && !fadeIntervalRef.current) {
              e.currentTarget.play().catch(() => {})
            }
          }}
          onLoadedData={(e) => {
            setIsLoadingStream(false)
            if (isPlayingRef.current && e.currentTarget.paused && !fadeIntervalRef.current) {
              e.currentTarget.play().catch(() => {})
            }
          }}
          onCanPlay={(e) => {
            setIsLoadingStream(false)
            if (isPlayingRef.current && e.currentTarget.paused && !fadeIntervalRef.current) {
              e.currentTarget.play().catch(() => {})
            }
          }}
          onDurationChange={(e) => {
            if (activeDeckRef.current === deck || e.currentTarget.dataset.vid === resolvedVid) {
              sanitizeDuration(e.currentTarget.duration)
            }
          }}
          onPlay={(e) => {
            setIsLoadingStream(false)
            clearLoadWatchdog()
            // If playback was explicitly paused (e.g. via Host Jam pause or forcePause),
            // do not allow an asynchronous browser play/seek event to unpause the deck!
            if (!isPlayingRef.current) {
              try {
                e.currentTarget.pause()
              } catch {}
              return
            }
            if (activeDeckRef.current === deck || e.currentTarget.dataset.vid === resolvedVid) {
              setIsPlaying(true)
              isPlayingRef.current = true
              lastCurChangeTimeRef.current = Date.now()
              notifyNativePlayback(true, e.currentTarget.currentTime || 0, effectiveDuration)
            }
          }}
          onPause={() => {
            // Synthetic pause events fired by the browser during buffering, source changes,
            // or deck swaps must NEVER flip the user's playback state to paused!
          }}
          onWaiting={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid) {
              const cur = e.currentTarget.currentTime || 0
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              const rawDur = e.currentTarget.duration
              const effectiveEndDur = (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > targetDur) ? rawDur : targetDur
              if (effectiveEndDur > 5 && cur > 5 && cur >= effectiveEndDur - 2.0 && !isEndTriggered(e.currentTarget.dataset.vid)) {
                if (repeatMode === 'one') {
                  commitSeek(0)
                  e.currentTarget.currentTime = 0
                  e.currentTarget.play().catch(() => {})
                  return
                }
                markEndTriggered(e.currentTarget.dataset.vid)
                if (handleTrackEnded()) return
                onNextRef.current()
              }
            }
          }}
          onStalled={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid) {
              const cur = e.currentTarget.currentTime || 0
              const targetDur = duration > 0 ? duration : (authoritativeDurationRef.current || parseDurationText(track?.duration_text))
              const rawDur = e.currentTarget.duration
              const effectiveEndDur = (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > targetDur) ? rawDur : targetDur
              if (effectiveEndDur > 5 && cur > 5 && cur >= effectiveEndDur - 2.0 && !isEndTriggered(e.currentTarget.dataset.vid)) {
                if (repeatMode === 'one') {
                  commitSeek(0)
                  e.currentTarget.currentTime = 0
                  e.currentTarget.play().catch(() => {})
                  return
                }
                markEndTriggered(e.currentTarget.dataset.vid)
                if (handleTrackEnded()) return
                onNextRef.current()
              }
            }
          }}
          onEnded={(e) => {
            if (activeDeckRef.current === deck && e.currentTarget.dataset.vid === resolvedVid && !isEndTriggered(e.currentTarget.dataset.vid)) {
              if (repeatMode === 'one') {
                commitSeek(0)
                e.currentTarget.currentTime = 0
                e.currentTarget.play().catch(() => {})
                return
              }
              markEndTriggered(e.currentTarget.dataset.vid)
              if (handleTrackEnded()) return
              onNextRef.current()
            }
          }}
          onError={async (e) => {
            if (e.currentTarget.dataset.vid !== resolvedVid) return
            setIsLoadingStream(false)
            clearLoadWatchdog()
            const failedSrc = e.currentTarget.src || ''

            // Immediate recovery: try direct Innertube standalone stream for this song
            try {
              const direct = await resolveStandaloneAudio(resolvedVid, track)
              if (direct?.url && direct.url !== failedSrc && e.currentTarget.dataset.vid === resolvedVid) {
                e.currentTarget.src = direct.url
                e.currentTarget.play().catch(() => {})
                return
              }
            } catch {}

            if (fallbackQueueRef.current.length > 0) {
              const nextAlt = fallbackQueueRef.current.shift()
              setResolvedVid(nextAlt)
            } else if (!useIframeFallback) {
              setUseIframeFallback(true)
            } else {
              onNextRef.current()
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

      {isDesktop ? (
        <footer
          className="relative h-[88px] pl-3 pr-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] items-center gap-4 select-none shrink-0 transition-all duration-700"
          style={{
            background: track
              ? `linear-gradient(90deg, color-mix(in srgb, ${albumColor.primary} 6%, #0A0A0B) 0%, color-mix(in srgb, ${albumColor.primary} 5%, #0A0A0B) 50%, color-mix(in srgb, ${albumColor.accent || albumColor.primary} 6%, #0A0A0B) 100%)`
              : '#000000',
            borderTop: track ? `1px solid rgba(${albumColor.rgb}, 0.14)` : '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {track && (
            <div className="absolute left-0 right-0 top-0 h-[1.5px] bg-white/[0.04] pointer-events-none overflow-hidden" aria-hidden="true">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${progressPct}%`,
                  background: `linear-gradient(to right, ${albumColor.primary}, ${albumColor.accent || albumColor.primary})`,
                  opacity: 0.75,
                }}
              />
            </div>
          )}
          {/* Song */}
          <div className="flex items-center gap-3.5 min-w-0">
            {track ? (
              <>
                <button
                  type="button"
                  onClick={() => setNowPlayingOpen(true)}
                  aria-label="Open full-screen player"
                  title="Open full-screen player"
                  className="relative w-14 h-14 rounded-[10px] overflow-hidden shrink-0 bg-s2 cursor-pointer transition-shadow duration-500"
                  style={{
                    boxShadow: isPlaying ? `0 4px 18px rgba(${albumColor.rgb}, 0.22)` : 'none',
                    border: `1px solid rgba(${albumColor.rgb}, 0.18)`,
                  }}
                >
                  {miniArt ? <img src={miniArt} alt="" className="w-full h-full object-cover" /> : <Music className="w-5 h-5 text-t3 m-auto" />}
                </button>
                <div className="min-w-0">
                  <button type="button" onClick={() => setNowPlayingOpen(true)} className="block max-w-full text-[15px] font-bold truncate hover:underline cursor-pointer text-left">
                    {track.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => onGoToArtist?.(firstArtist(track.artist))}
                    className="block max-w-full text-[13px] text-t2 truncate hover:underline hover:text-t1 cursor-pointer text-left"
                  >
                    {track.artist}
                  </button>
                </div>
                {onToggleFavorite && (
                  <BarButton label={isFav ? 'Remove from liked songs' : 'Like'} onClick={() => onToggleFavorite(track)} active={isFav}>
                    <Heart className={`w-5 h-5 ${isFav ? 'fill-accent text-accent' : ''}`} />
                  </BarButton>
                )}
              </>
            ) : (
              <span className="text-sm text-t3 pl-2">Pick something to play</span>
            )}
          </div>

          {/* Transport */}
          <div className="flex flex-col items-center gap-1 min-w-0">
            <div className="flex items-center gap-3">
              <BarButton label={isShuffle ? 'Shuffle on' : 'Shuffle off'} onClick={handleToggleShuffle} active={isShuffle} dot={isShuffle} disabled={!track}>
                <Shuffle className="w-[18px] h-[18px]" />
              </BarButton>
              <BarButton label="Previous" onClick={isSafariMode ? () => onSafariControl('prev') : onPrev} disabled={!track} active>
                <SkipBack className="w-5 h-5 fill-current" />
              </BarButton>
              <button
                type="button"
                onClick={isSafariMode ? () => onSafariControl('play_pause') : onTogglePlay}
                disabled={!track}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                className="w-10 h-10 rounded-full bg-white text-[#0A0A0B] flex items-center justify-center hover:scale-105 transition-all cursor-pointer disabled:opacity-40"
                style={{
                  boxShadow: track && isPlaying ? `0 0 18px rgba(${albumColor.rgb}, 0.25)` : 'none',
                }}
              >
                {isLoadingStream ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
              <BarButton label="Next" onClick={isSafariMode ? () => onSafariControl('next') : onNext} disabled={!track} active>
                <SkipForward className="w-5 h-5 fill-current" />
              </BarButton>
              <BarButton label={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'} onClick={cycleRepeat} active={repeatMode !== 'off'} dot={repeatMode !== 'off'} disabled={!track}>
                {repeatMode === 'one' ? <Repeat1 className="w-[18px] h-[18px]" /> : <Repeat className="w-[18px] h-[18px]" />}
              </BarButton>
            </div>
            <div className="w-full max-w-[600px] flex items-center gap-2.5 text-xs text-t3 font-semibold tabular-nums">
              <span className="w-10 text-right">{formatTime(displayTime)}</span>
              <input
                type="range"
                aria-label="Seek"
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
                className="ub-range sm flex-1"
                style={{ '--pct': `${progressPct}%`, '--range-fill': track ? albumColor.primary : 'var(--t1)' }}
              />
              <span className="w-10">
                {effectiveDuration > 0 ? formatTime(effectiveDuration) : track?.duration_text && track.duration_text !== '--:--' ? track.duration_text : '0:00'}
              </span>
            </div>
          </div>

          {/* Tools */}
          <div className="flex items-center justify-end gap-0.5 min-w-0">
            <BarButton
              label="Lyrics"
              disabled={!track}
              active={nowPlayingOpen && showLyrics}
              onClick={() => {
                if (nowPlayingOpen && showLyrics) {
                  setShowLyrics(false)
                  setNowPlayingOpen(false)
                } else {
                  setShowLyrics(true)
                  setNowPlayingOpen(true)
                }
              }}
            >
              <MessageSquareQuote className="w-5 h-5" />
            </BarButton>
            <BarButton label={rightPanelOpen ? 'Hide up next' : 'Show up next'} onClick={onToggleRightPanel} active={rightPanelOpen} badge={queueCount || null}>
              <ListMusic className="w-5 h-5" />
            </BarButton>
            <BarButton label={jamActive ? 'Jam is live' : 'Listen with friends'} onClick={onOpenJam} active={jamActive} live={jamActive}>
              <Users className="w-5 h-5" />
            </BarButton>
            <BarButton
              label={sleepTimer.active ? (sleepTimer.mode === 'end_of_track' ? 'Sleep timer: end of song' : `Sleep timer: ${Math.ceil(sleepTimer.remainingSec / 60)} min left`) : 'Sleep timer'}
              onClick={() => setIsSleepModalOpen(true)}
              active={sleepTimer.active}
              badge={sleepTimer.active && sleepTimer.mode === 'minutes' ? `${Math.ceil(sleepTimer.remainingSec / 60)}` : null}
            >
              <Moon className="w-5 h-5" />
            </BarButton>
            <BarButton label={isMuted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => setIsMuted(!isMuted)}>
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </BarButton>
            <input
              type="range"
              aria-label="Volume"
              min="0"
              max="100"
              value={volumeVal}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setIsMuted(false)
              }}
              className="ub-range sm w-24 mr-1"
              style={{ '--pct': `${volumeVal}%`, '--range-fill': track ? albumColor.primary : 'var(--t1)' }}
            />
            <BarButton label="Full-screen player" onClick={() => setNowPlayingOpen(true)} disabled={!track}>
              <Maximize2 className="w-[18px] h-[18px]" />
            </BarButton>
          </div>
        </footer>
      ) : track ? (
        <footer
          className="relative h-16 flex items-center gap-1 pl-3.5 pr-1.5 select-none shrink-0 transition-colors duration-500"
          style={{
            background: `linear-gradient(90deg, color-mix(in srgb, ${albumColor.primary} 7%, #121214) 0%, color-mix(in srgb, ${albumColor.accent || albumColor.primary} 5%, #121214) 100%)`,
            borderTop: `1px solid rgba(${albumColor.rgb}, 0.16)`,
          }}
          onTouchStart={(e) => {
            const t = e.touches[0]
            swipeRef.current = { x: t.clientX, y: t.clientY, at: Date.now() }
          }}
          onTouchEnd={(e) => {
            const start = swipeRef.current
            swipeRef.current = null
            if (!start) return
            const t = e.changedTouches[0]
            const dx = t.clientX - start.x
            const dy = t.clientY - start.y
            if (Date.now() - start.at > 600) return
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
              if (dx < 0) (isSafariMode ? () => onSafariControl('next') : onNext)()
              else (isSafariMode ? () => onSafariControl('prev') : onPrev)()
            } else if (dy < -40 && Math.abs(dx) < 40) {
              setNowPlayingOpen(true)
            }
          }}
        >
          <div className="absolute left-0 right-0 top-0 h-[2px] bg-white/10" aria-hidden="true">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${progressPct}%`,
                background: `linear-gradient(to right, ${albumColor.primary}, ${albumColor.accent || albumColor.primary})`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => setNowPlayingOpen(true)}
            aria-label={`Open player: ${track.title}`}
            className="flex items-center gap-3 flex-1 min-w-0 h-full text-left cursor-pointer"
          >
            <span className="w-11 h-11 rounded-[10px] overflow-hidden shrink-0 bg-s2 flex items-center justify-center">
              {miniArt ? <img src={miniArt} alt="" className="w-full h-full object-cover" /> : <Music className="w-5 h-5 text-t3" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold truncate">{track.title}</span>
              <span className="block text-[13px] text-white/70 truncate">
                {jamActive ? 'Jam · ' : ''}
                {track.artist}
              </span>
            </span>
          </button>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(track)}
              aria-label={isFav ? 'Remove from liked songs' : 'Like'}
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Heart className={`w-[22px] h-[22px] ${isFav ? 'fill-accent text-accent' : 'text-white/80'}`} />
            </button>
          )}
          <button
            type="button"
            onClick={isSafariMode ? () => onSafariControl('play_pause') : onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer"
          >
            {isLoadingStream ? <Loader2 className="w-6 h-6 animate-spin" /> : isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
          </button>
        </footer>
      ) : null}

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
        onToggleShuffle={handleToggleShuffle}
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
        playingFromTitle={playingFromTitle}
        onGoToArtist={onGoToArtist}
        onStartRadio={onStartRadio}
        onAddToPlaylist={onAddToPlaylist}
        jamActive={jamActive}
        onOpenJam={onOpenJam}
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

function firstArtist(artist = '') {
  return String(artist).split(/,|&| feat\.| ft\.| x /i)[0].trim()
}

function BarButton({ label, onClick, children, active = false, disabled = false, dot = false, badge = null, live = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
        live ? 'text-live' : active ? 'text-t1' : 'text-t2 hover:text-t1'
      }`}
    >
      {children}
      {dot && <span className="absolute bottom-1 left-1/2 -ml-[2px] w-1 h-1 rounded-full bg-current" />}
      {badge !== null && badge !== undefined && badge !== 0 && (
        <span className="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-t1 text-[#0A0A0B] text-[10px] font-extrabold flex items-center justify-center">{badge}</span>
      )}
    </button>
  )
}
