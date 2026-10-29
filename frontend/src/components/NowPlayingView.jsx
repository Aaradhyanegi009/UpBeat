import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  ChevronDown, Heart, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Download, Check, Loader2,
  ListMusic, ExternalLink, Video, Calendar, Sparkles, Volume2, VolumeX, Music, ShieldCheck, Mic2,
  Share2, Copy, X, Moon
} from 'lucide-react'
import { fetchTrackExtendedMeta, fetchTrackLyrics, openExternalUrl } from '../standaloneApi'

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

export default function NowPlayingView({
  isOpen,
  onClose,
  track,
  resolvedVid,
  isPlaying,
  isLoadingStream,
  onTogglePlay,
  onNext,
  onPrev,
  effectiveDuration,
  displayTime,
  progressPct,
  handleScrubStart,
  handleScrubChange,
  handleScrubEnd,
  albumColor,
  isFav,
  onToggleFavorite,
  downloadState,
  isDownloaded,
  handleDownload,
  onToggleQueue,
  queueCount,
  playbackMode,
  onPushToSafari,
  showVideo,
  setShowVideo,
  isShuffle,
  setIsShuffle,
  repeatMode,
  setRepeatMode,
  volume,
  setVolume,
  isMuted,
  setIsMuted,
  isPlayingOffline,
  showLyrics: externalShowLyrics,
  setShowLyrics: externalSetShowLyrics,
  onSeek,
  sleepTimer,
  onOpenSleepTimer
}) {
  const [extendedMeta, setExtendedMeta] = useState(null)
  const [internalShowLyrics, setInternalShowLyrics] = useState(false)
  const showLyrics = typeof externalShowLyrics === 'boolean' ? externalShowLyrics : internalShowLyrics
  const setShowLyrics = externalSetShowLyrics || setInternalShowLyrics

  const [lyricsState, setLyricsState] = useState({ loading: false, data: null, trackKey: '' })
  const [userScrolledRecently, setUserScrolledRecently] = useState(false)
  const [isSelectingLyrics, setIsSelectingLyrics] = useState(false)
  const [selectedLineIndices, setSelectedLineIndices] = useState([])
  const [showShareCardModal, setShowShareCardModal] = useState(false)
  const [shareThemeIdx, setShareThemeIdx] = useState(0)
  const [copiedFeedback, setCopiedFeedback] = useState(false)
  const [isExportingCard, setIsExportingCard] = useState(false)
  const lyricsContainerRef = useRef(null)
  const lineRefs = useRef({})
  const scrollTimeoutRef = useRef(null)
  const isProgrammaticScrollRef = useRef(false)

  const vid = track?.video_id || resolvedVid
  const thumbUrl = track?.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '')
  const trackKey = vid || `${track?.title || ''}|${track?.artist || ''}`

  useEffect(() => {
    if (!vid) {
      setExtendedMeta(null)
      return
    }

    let active = true
    fetchTrackExtendedMeta(vid).then((meta) => {
      if (active && meta) {
        setExtendedMeta(meta)
      }
    }).catch(() => {})

    return () => {
      active = false
    }
  }, [vid])

  // Fetch synced lyrics whenever track changes
  useEffect(() => {
    if (!track || !track.title) {
      setLyricsState({ loading: false, data: null, trackKey: '' })
      return
    }

    let active = true
    setLyricsState((prev) => ({
      loading: true,
      data: prev.trackKey === trackKey ? prev.data : null,
      trackKey
    }))
    setUserScrolledRecently(false)
    setIsSelectingLyrics(false)
    setSelectedLineIndices([])
    setShowShareCardModal(false)
    lineRefs.current = {}

    fetchTrackLyrics(track, effectiveDuration)
      .then((res) => {
        if (active) {
          setLyricsState({ loading: false, data: res, trackKey })
        }
      })
      .catch(() => {
        if (active) {
          setLyricsState({ loading: false, data: null, trackKey })
        }
      })

    return () => {
      active = false
    }
  }, [trackKey, track?.title, track?.artist])

  // Compute current active lyric line index (with 0.25s vocal anticipation)
  const activeLineIdx = useMemo(() => {
    const data = lyricsState.data
    if (!data || !data.synced || !Array.isArray(data.lines) || !data.lines.length) return -1
    const syncTime = (Number(displayTime) || 0) + 0.25
    let idx = -1
    for (let i = 0; i < data.lines.length; i++) {
      if (data.lines[i].time <= syncTime) {
        idx = i
      } else {
        break
      }
    }
    return idx
  }, [lyricsState.data, displayTime])

  // Smoothly auto-scroll the active lyric line into the vertical center of the lyrics container
  useEffect(() => {
    if (!isOpen || !showLyrics || userScrolledRecently || isSelectingLyrics || showShareCardModal) return
    if (activeLineIdx < 0) return

    const activeEl = lineRefs.current[activeLineIdx]
    const container = lyricsContainerRef.current
    if (!activeEl || !container) return

    isProgrammaticScrollRef.current = true
    try {
      const containerRect = container.getBoundingClientRect()
      const elRect = activeEl.getBoundingClientRect()
      const currentScrollTop = container.scrollTop
      const offsetWithinContainer = elRect.top - containerRect.top
      const targetScrollTop = currentScrollTop + offsetWithinContainer - containerRect.height * 0.38 + elRect.height / 2

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      })
    } catch {
      try {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {}
    }

    const releaseTimer = setTimeout(() => {
      isProgrammaticScrollRef.current = false
    }, 550)
    return () => clearTimeout(releaseTimer)
  }, [activeLineIdx, isOpen, showLyrics, userScrolledRecently, isSelectingLyrics, showShareCardModal])

  const handleUserScrollInteraction = () => {
    if (isProgrammaticScrollRef.current || isSelectingLyrics) return
    if (!lyricsState.data?.synced) return
    setUserScrolledRecently(true)
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      setUserScrolledRecently(false)
    }, 3800)
  }

  const toggleSelectLyricLine = (idx) => {
    setSelectedLineIndices((prev) => {
      if (prev.includes(idx)) {
        return prev.filter((i) => i !== idx)
      }
      if (prev.length >= 5) {
        return [...prev.slice(1), idx].sort((a, b) => a - b)
      }
      return [...prev, idx].sort((a, b) => a - b)
    })
  }

  const handleStartSelectingFromLine = (idx, e) => {
    if (e) e.stopPropagation()
    setIsSelectingLyrics(true)
    setSelectedLineIndices([idx])
  }

  const handleToggleSelectionMode = () => {
    if (isSelectingLyrics) {
      setIsSelectingLyrics(false)
      setSelectedLineIndices([])
    } else {
      setIsSelectingLyrics(true)
      // Pre-select current active vocal line if available
      const lines = lyricsState.data?.lines || []
      if (activeLineIdx >= 0 && lines[activeLineIdx] && !lines[activeLineIdx].isInstrumental) {
        setSelectedLineIndices([activeLineIdx])
      } else {
        const firstVocal = lines.findIndex((l) => !l.isInstrumental && l.text)
        setSelectedLineIndices(firstVocal >= 0 ? [firstVocal] : [])
      }
    }
  }

  const selectedLyricLines = useMemo(() => {
    const lines = lyricsState.data?.lines || []
    return selectedLineIndices
      .map((i) => lines[i])
      .filter((l) => l && !l.isInstrumental && l.text)
  }, [lyricsState.data, selectedLineIndices])

  const shareCardThemes = useMemo(() => [
    {
      name: 'Album Glow',
      bgStart: albumColor.primary || '#10b981',
      bgEnd: '#09090f',
      accent: albumColor.primary || '#10b981',
      cardBg: `linear-gradient(145deg, ${albumColor.primary || '#10b981'}40 0%, #101018 65%, #08080c 100%)`
    },
    {
      name: 'Emerald Studio',
      bgStart: '#059669',
      bgEnd: '#061512',
      accent: '#34d399',
      cardBg: 'linear-gradient(145deg, #05966955 0%, #091d18 65%, #060d0b 100%)'
    },
    {
      name: 'Crimson Velvet',
      bgStart: '#e11d48',
      bgEnd: '#16070c',
      accent: '#fb7185',
      cardBg: 'linear-gradient(145deg, #e11d4850 0%, #1f0a11 65%, #0c0508 100%)'
    },
    {
      name: 'Royal Indigo',
      bgStart: '#4f46e5',
      bgEnd: '#090919',
      accent: '#818cf8',
      cardBg: 'linear-gradient(145deg, #4f46e550 0%, #111128 65%, #080812 100%)'
    },
    {
      name: 'Midnight Obsidian',
      bgStart: '#27272a',
      bgEnd: '#09090b',
      accent: '#e4e4e7',
      cardBg: 'linear-gradient(145deg, #27272a60 0%, #121216 65%, #09090b 100%)'
    }
  ], [albumColor.primary])

  const activeShareTheme = shareCardThemes[shareThemeIdx] || shareCardThemes[0]

  const getFormattedShareText = () => {
    const quote = selectedLyricLines.map((l) => `"${l.text}"`).join('\n')
    const artist = track?.artist || extendedMeta?.author || 'UpBeat'
    return `${quote}\n\n— ${track?.title || 'Track'} • ${artist}`
  }

  const handleCopySelectedLyrics = async () => {
    if (!selectedLyricLines.length) return
    const text = getFormattedShareText()
    try {
      await navigator.clipboard.writeText(text)
      setCopiedFeedback(true)
      setTimeout(() => setCopiedFeedback(false), 2000)
    } catch {}
  }

  // Renders a crisp 1080w PNG Lyric Card on an offscreen HTML5 Canvas
  const generateLyricCardBlob = async () => {
    const canvas = document.createElement('canvas')
    const width = 1080
    const ctx = canvas.getContext('2d')

    const fontStack = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.font = `800 54px ${fontStack}`

    // Wrap each selected lyric line to max width 880px
    const maxTextWidth = 880
    const wrappedBlocks = []
    for (const lineObj of selectedLyricLines) {
      const words = String(lineObj.text || '').split(/\s+/)
      let currentLine = ''
      const subLines = []
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
          subLines.push(currentLine)
          currentLine = word
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) subLines.push(currentLine)
      wrappedBlocks.push(subLines)
    }

    const totalSubLines = wrappedBlocks.reduce((acc, b) => acc + b.length, 0)
    const blockGaps = Math.max(0, wrappedBlocks.length - 1) * 34
    const lyricsHeight = totalSubLines * 72 + blockGaps
    const height = Math.max(1120, lyricsHeight + 520)

    canvas.width = width
    canvas.height = height

    // 1. Background gradient
    const grad = ctx.createLinearGradient(0, 0, width, height)
    grad.addColorStop(0, activeShareTheme.bgStart)
    grad.addColorStop(0.55, '#12121a')
    grad.addColorStop(1, activeShareTheme.bgEnd)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)

    // Subtle dark glass inner card
    const pad = 64
    const cardW = width - pad * 2
    const cardH = height - pad * 2
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(pad, pad, cardW, cardH, 56)
    ctx.fillStyle = 'rgba(10, 10, 16, 0.58)'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.stroke()
    ctx.restore()

    // 2. Load album thumbnail if available
    const innerX = pad + 64
    const headerY = pad + 68
    const artSize = 116
    let artLoaded = false

    if (thumbUrl) {
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1800)
          img.onload = () => {
            clearTimeout(timer)
            artLoaded = true
            resolve()
          }
          img.onerror = () => {
            clearTimeout(timer)
            resolve()
          }
          img.src = thumbUrl
        })
        if (artLoaded) {
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(innerX, headerY, artSize, artSize, 28)
          ctx.clip()
          ctx.drawImage(img, innerX, headerY, artSize, artSize)
          ctx.restore()
        }
      } catch {}
    }

    if (!artLoaded) {
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(innerX, headerY, artSize, artSize, 28)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.fill()
      ctx.fillStyle = activeShareTheme.accent
      ctx.font = `700 48px ${fontStack}`
      ctx.fillText('♫', innerX + 38, headerY + 76)
      ctx.restore()
    }

    // 3. Track Title & Artist
    const textX = innerX + artSize + 32
    const maxHeaderTextW = width - textX - pad - 64
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 38px ${fontStack}`
    let titleStr = track?.title || 'UpBeat'
    while (ctx.measureText(titleStr).width > maxHeaderTextW && titleStr.length > 6) {
      titleStr = titleStr.slice(0, -2) + '…'
    }
    ctx.fillText(titleStr, textX, headerY + 52)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.68)'
    ctx.font = `600 28px ${fontStack}`
    let artistStr = track?.artist || extendedMeta?.author || 'UpBeat Music'
    while (ctx.measureText(artistStr).width > maxHeaderTextW && artistStr.length > 6) {
      artistStr = artistStr.slice(0, -2) + '…'
    }
    ctx.fillText(artistStr, textX, headerY + 94)

    // 4. Lyric Lines
    let curY = headerY + artSize + 105
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 52px ${fontStack}`
    for (const subLines of wrappedBlocks) {
      for (const sLine of subLines) {
        ctx.fillText(sLine, innerX, curY)
        curY += 72
      }
      curY += 34
    }

    // 5. Footer Branding
    const footerY = height - pad - 64
    ctx.fillStyle = activeShareTheme.accent
    ctx.font = `800 28px ${fontStack}`
    ctx.fillText('♫ UpBeat', innerX, footerY)

    if (selectedLyricLines[0] && lyricsState.data?.synced) {
      const timeLabel = formatTime(selectedLyricLines[0].time)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.font = `600 26px ${fontStack}`
      const tw = ctx.measureText(timeLabel).width
      ctx.fillText(timeLabel, width - pad - 64 - tw, footerY)
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95)
    })
  }

  const handleDownloadCardImage = async () => {
    if (!selectedLyricLines.length || isExportingCard) return
    setIsExportingCard(true)
    try {
      const blob = await generateLyricCardBlob()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const cleanTitle = (track?.title || 'Lyrics').replace(/[\\/*?:"<>|]/g, '').trim()
      const a = document.createElement('a')
      a.href = url
      a.download = `${cleanTitle} - Lyrics.png`
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        try {
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
        } catch {}
      }, 1500)
    } finally {
      setIsExportingCard(false)
    }
  }

  const handleShareCardNative = async () => {
    if (!selectedLyricLines.length || isExportingCard) return
    setIsExportingCard(true)
    try {
      const blob = await generateLyricCardBlob()
      const shareText = getFormattedShareText()
      const cleanTitle = (track?.title || 'Lyrics').replace(/[\\/*?:"<>|]/g, '').trim()

      if (blob && typeof navigator !== 'undefined' && navigator.share) {
        const file = new File([blob], `${cleanTitle} - Lyrics.png`, { type: 'image/png' })
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `${track?.title || 'Lyrics'} — UpBeat`,
            text: shareText
          })
          return
        }
        await navigator.share({
          title: `${track?.title || 'Lyrics'} — UpBeat`,
          text: shareText
        })
        return
      }

      // Desktop / fallback: copy image (or text) to clipboard and download PNG
      if (blob && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
          setCopiedFeedback(true)
          setTimeout(() => setCopiedFeedback(false), 2200)
        } catch {
          await handleCopySelectedLyrics()
        }
      } else {
        await handleCopySelectedLyrics()
      }
      await handleDownloadCardImage()
    } catch {} finally {
      setIsExportingCard(false)
    }
  }

  const handleLyricLineClick = (line, idx) => {
    if (isSelectingLyrics) {
      if (line && !line.isInstrumental) {
        toggleSelectLyricLine(idx)
      }
      return
    }
    if (!lyricsState.data?.synced || !line || typeof line.time !== 'number') return
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    setUserScrolledRecently(false)
    if (onSeek) {
      onSeek(line.time)
    }
  }

  const handleToggleLyrics = () => {
    const next = !showLyrics
    setShowLyrics(next)
    if (next && showVideo && setShowVideo) {
      setShowVideo(false)
      if (isPlaying) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.src) try { el.play().catch(() => {}) } catch {}
        })
      }
    }
  }

  const handleOpenExternal = () => {
    if (!track) return
    const targetUrl = track.url || (vid ? `https://www.youtube.com/watch?v=${vid}` : '')
    if (!targetUrl) return
    if (onPushToSafari) {
      try {
        onPushToSafari(track)
        return
      } catch {}
    }
    openExternalUrl(targetUrl)
  }

  const handleToggleVideo = () => {
    const nextShow = !showVideo
    if (setShowVideo) setShowVideo(nextShow)
    if (nextShow) {
      if (showLyrics) setShowLyrics(false)
      // Pause background audio when viewing video
      document.querySelectorAll('audio').forEach((el) => {
        try { el.pause() } catch {}
      })
    } else {
      // Resume background audio when exiting video mode
      if (isPlaying) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.src) try { el.play().catch(() => {}) } catch {}
        })
      }
    }
  }

  const handleClose = () => {
    if (showVideo && setShowVideo) {
      setShowVideo(false)
      if (isPlaying) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.src) try { el.play().catch(() => {}) } catch {}
        })
      }
    }
    if (onClose) onClose()
  }

  if (!isOpen || !track) return null

  // Format release date cleanly
  const releaseDateStr = (() => {
    if (extendedMeta?.releaseDate) return extendedMeta.releaseDate
    if (track?.release_date) {
      try {
        const d = new Date(track.release_date)
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        }
      } catch {}
      return String(track.release_date)
    }
    if (track?.year) return String(track.year)
    if (track?.reason) {
      const yearMatch = track.reason.match(/\b(19\d\d|20\d\d)\b/)
      if (yearMatch) return yearMatch[0]
      if (track.reason.includes('ago')) {
        const parts = track.reason.split('•')
        const agoPart = parts.find((p) => p.includes('ago'))
        if (agoPart) return agoPart.trim()
      }
    }
    return '2024'
  })()

  const artistName = track?.artist || extendedMeta?.author || 'UpBeat'
  const channelInfo = extendedMeta?.author && extendedMeta.author !== artistName ? extendedMeta.author : null
  const viewCountStr = extendedMeta?.viewCount
    ? `${extendedMeta.viewCount} views`
    : (track?.reason && track.reason.includes('views') ? track.reason.split('•')[0].trim() : '')

  return (
    <div className="fixed inset-0 z-50 bg-[#08080c]/98 backdrop-blur-2xl flex flex-col justify-between overflow-hidden select-none animate-in fade-in slide-in-from-bottom-8 duration-200">
      {/* Dynamic Ambient Background Glow */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-700 -z-10"
        style={{
          background: `radial-gradient(circle at 50% 28%, ${albumColor.primary}35 0%, ${albumColor.accent}18 40%, #08080c 75%)`
        }}
      />

      {/* Top Header Bar */}
      <header className="pt-safe-top bg-black/40 backdrop-blur-md border-b border-white/10 shrink-0 sticky top-0 z-20">
        <div className="h-12 sm:h-16 px-4 sm:px-8 flex items-center justify-between">
          <button
            onClick={handleClose}
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
            title="Collapse to mini player"
            aria-label="Collapse"
          >
            <ChevronDown className="w-6 h-6" />
          </button>

          {/* Segmented Mode Switcher: Artwork vs Live Lyrics */}
          <div className="flex items-center p-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md">
            <button
              onClick={() => setShowLyrics(false)}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                !showLyrics
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Track
            </button>
            <button
              onClick={() => {
                if (!showLyrics) handleToggleLyrics()
              }}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                showLyrics
                  ? 'text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              style={
                showLyrics
                  ? {
                      backgroundColor: `${albumColor.primary}30`,
                      border: `1px solid ${albumColor.primary}60`
                    }
                  : undefined
              }
            >
              <Mic2 className="w-3.5 h-3.5" style={showLyrics ? { color: albumColor.primary } : undefined} />
              <span>Lyrics</span>
              {lyricsState.data?.synced && (
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: albumColor.primary }}
                  title="Live Time-Synced Lyrics Available"
                />
              )}
            </button>
          </div>

          <div className="flex items-center gap-1">
            {onOpenSleepTimer && (
              <button
                onClick={onOpenSleepTimer}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer relative ${
                  sleepTimer?.active
                    ? 'text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
                style={
                  sleepTimer?.active
                    ? { backgroundColor: `${albumColor.primary}30`, color: albumColor.primary }
                    : undefined
                }
                title={
                  sleepTimer?.active
                    ? (sleepTimer.mode === 'end_of_track' ? 'Sleep Timer: End of song' : `Sleep Timer: ${Math.ceil((sleepTimer.remainingSec || 0) / 60)}m left`)
                    : 'Sleep Timer'
                }
                aria-label="Sleep Timer"
              >
                <Moon className="w-5 h-5" />
                {sleepTimer?.active && sleepTimer.mode === 'minutes' && (
                  <span
                    className="absolute top-1.5 right-1 min-w-3.5 h-3.5 px-0.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-xs"
                    style={{ backgroundColor: albumColor.primary }}
                  >
                    {Math.ceil((sleepTimer.remainingSec || 0) / 60)}m
                  </span>
                )}
              </button>
            )}

            {onToggleQueue && (
              <button
                onClick={onToggleQueue}
                className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer relative"
                title="Open Playback Queue"
                aria-label="Open Queue"
              >
                <ListMusic className="w-5 h-5" />
                {queueCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                    {queueCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Center Section: Live Synced Lyrics OR Artwork / Video */}
      {showLyrics ? (
        <div className="flex-1 min-h-0 flex flex-col w-full max-w-2xl mx-auto px-5 sm:px-10 pt-2 pb-1 sm:py-2 z-10 relative">
          {/* Top Action Row: Share Lyrics & Resume Sync */}
          {lyricsState.data && lyricsState.data.lines?.length > 0 && (
            <div className="flex items-center justify-between gap-2 pb-2.5 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleSelectionMode}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border backdrop-blur-md transition-all cursor-pointer active:scale-95 ${
                    isSelectingLyrics
                      ? 'bg-white text-black border-white shadow-md'
                      : 'bg-white/[0.08] hover:bg-white/[0.15] text-zinc-100 border-white/10'
                  }`}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{isSelectingLyrics ? 'Done Selecting' : 'Share Lyrics'}</span>
                </button>
                {isSelectingLyrics && (
                  <span className="text-xs font-medium text-zinc-400">
                    Tap up to 5 lines
                  </span>
                )}
              </div>

              {userScrolledRecently && lyricsState.data?.synced && !isSelectingLyrics && (
                <button
                  onClick={() => setUserScrolledRecently(false)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.15] text-zinc-100 border border-white/10 backdrop-blur-md transition-all cursor-pointer active:scale-95"
                >
                  Resume Sync
                </button>
              )}
            </div>
          )}

          {/* Scrollable Lyrics Canvas */}
          <div
            ref={lyricsContainerRef}
            onWheel={handleUserScrollInteraction}
            onTouchMove={handleUserScrollInteraction}
            className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1 select-none"
            style={{
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)'
            }}
          >
            {lyricsState.loading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-400">
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: albumColor.primary }} />
                <p className="text-xs font-medium text-zinc-400">
                  Loading lyrics...
                </p>
              </div>
            ) : lyricsState.data && lyricsState.data.lines?.length > 0 ? (
              <div className="py-16 sm:py-24 flex flex-col gap-4 sm:gap-5">
                {lyricsState.data.lines.map((line, idx) => {
                  const isSynced = lyricsState.data.synced
                  const isActive = isSynced && idx === activeLineIdx
                  const isPast = isSynced && activeLineIdx >= 0 && idx < activeLineIdx
                  const isSelected = isSelectingLyrics && selectedLineIndices.includes(idx)

                  if (line.isInstrumental) {
                    return (
                      <div
                        key={`${idx}-${line.time}`}
                        ref={(el) => { lineRefs.current[idx] = el }}
                        onClick={() => handleLyricLineClick(line, idx)}
                        className={`flex items-center gap-3 py-1 transition-all duration-300 ${
                          isSynced ? 'cursor-pointer' : ''
                        } ${isActive ? 'opacity-100 scale-105 origin-left' : isPast ? 'opacity-25' : 'opacity-40'}`}
                      >
                        <span
                          className="text-2xl sm:text-3xl font-bold"
                          style={isActive ? { color: albumColor.primary } : undefined}
                        >
                          ♪
                        </span>
                        {isActive && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: albumColor.primary, animationDelay: '0ms' }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: albumColor.primary, animationDelay: '150ms' }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: albumColor.primary, animationDelay: '300ms' }} />
                          </span>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div
                      key={`${idx}-${line.time}`}
                      ref={(el) => { lineRefs.current[idx] = el }}
                      onClick={() => handleLyricLineClick(line, idx)}
                      className={`group relative rounded-2xl py-2 px-3 -mx-3 transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer ${
                        isSelectingLyrics
                          ? isSelected
                            ? 'text-white shadow-lg'
                            : 'text-white/55 hover:text-white hover:bg-white/[0.04]'
                          : !isSynced
                          ? 'text-white/85 text-lg sm:text-xl font-semibold leading-relaxed hover:bg-white/[0.04]'
                          : isActive
                          ? 'text-white text-xl sm:text-2xl md:text-[26px] font-extrabold leading-snug tracking-tight scale-[1.02] origin-left hover:bg-white/[0.04]'
                          : isPast
                          ? 'text-white/28 hover:text-white/70 text-lg sm:text-xl font-bold leading-snug hover:bg-white/[0.04]'
                          : 'text-white/50 hover:text-white/80 text-lg sm:text-xl font-bold leading-snug hover:bg-white/[0.04]'
                      }`}
                      style={
                        isSelected
                          ? {
                              backgroundColor: `${albumColor.primary}22`,
                              border: `1px solid ${albumColor.primary}60`
                            }
                          : isActive && !isSelectingLyrics
                          ? {
                              textShadow: `0 0 28px ${albumColor.glow || 'rgba(196,181,253,0.45)'}`
                            }
                          : { border: '1px solid transparent' }
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {isSelectingLyrics && (
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                              isSelected
                                ? 'border-transparent text-black'
                                : 'border-white/25 bg-white/[0.04]'
                            }`}
                            style={isSelected ? { backgroundColor: albumColor.primary } : undefined}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        )}
                        <span className={isSelectingLyrics ? 'text-base sm:text-lg font-bold leading-snug' : ''}>
                          {line.text}
                        </span>
                        {isSynced && !isSelectingLyrics && (
                          <span className="ml-2 text-xs font-medium text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity align-middle shrink-0">
                            {formatTime(line.time)}
                          </span>
                        )}
                      </div>

                      {!isSelectingLyrics && (
                        <button
                          onClick={(e) => handleStartSelectingFromLine(idx, e)}
                          title="Select & share this lyric line"
                          className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all shrink-0 cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-2.5">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/[0.05] border border-white/10"
                  style={{ color: albumColor.primary }}
                >
                  <Mic2 className="w-6 h-6" />
                </div>
                <p className="text-sm sm:text-base font-semibold text-zinc-200">
                  No synced lyrics found for this track
                </p>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Lyrics may not be available yet for this release or remix.
                </p>
              </div>
            )}
          </div>

          {/* Floating Selection Action Bar */}
          {isSelectingLyrics && (
            <div className="mt-2 p-2.5 rounded-2xl bg-[#12121a]/95 border border-white/15 backdrop-blur-2xl shadow-2xl flex items-center justify-between gap-2 animate-in fade-in slide-in-from-bottom-3 duration-150">
              <div className="flex items-center gap-2 pl-2">
                <span
                  className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${albumColor.primary}25`,
                    color: albumColor.primary
                  }}
                >
                  {selectedLyricLines.length} / 5
                </span>
                <span className="text-xs font-medium text-zinc-300 hidden xs:inline">
                  {selectedLyricLines.length === 1 ? 'line selected' : 'lines selected'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopySelectedLyrics}
                  disabled={selectedLyricLines.length === 0}
                  className="px-3 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] disabled:opacity-40 text-xs font-semibold text-white border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                >
                  {copiedFeedback ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedFeedback ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  onClick={() => setShowShareCardModal(true)}
                  disabled={selectedLyricLines.length === 0}
                  className="px-4 py-1.5 rounded-full bg-white hover:bg-zinc-200 disabled:opacity-40 text-xs font-bold text-black flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Card</span>
                </button>

                <button
                  onClick={() => {
                    setIsSelectingLyrics(false)
                    setSelectedLineIndices([])
                  }}
                  className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Cancel selection"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 sm:px-12 py-2 sm:py-4">
          <div
            className={`relative w-full ${
              showVideo
                ? 'max-w-[340px] xs:max-w-[420px] sm:max-w-[500px] aspect-video'
                : 'max-w-[280px] xs:max-w-[320px] sm:max-w-[380px] aspect-square'
            } rounded-2xl sm:rounded-3xl overflow-hidden transition-all duration-300 bg-black`}
            style={{
              boxShadow: isPlaying ? `0 20px 50px ${albumColor.glow || 'rgba(0,0,0,0.6)'}` : '0 10px 30px rgba(0,0,0,0.5)',
              maxHeight: showVideo ? 'min(40vh, 400px)' : 'min(36vh, 380px)'
            }}
          >
            {showVideo && vid ? (
              <iframe
                key={vid}
                src={`https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1`}
                title={track.title}
                className="w-full h-full border-0 select-none rounded-2xl sm:rounded-3xl"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : thumbUrl ? (
              <img
                src={thumbUrl}
                alt={track.title}
                className="w-full h-full object-cover select-none"
                loading="eager"
              />
            ) : (
              <div className="w-full h-full bg-[#121218] flex items-center justify-center text-zinc-600">
                <Music className="w-16 h-16" />
              </div>
            )}

            {/* Playing wave overlay indicator */}
            {!showVideo && isPlaying && (
              <div className="absolute bottom-2.5 right-2.5 px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: albumColor.primary }} />
                <span className="text-[10px] text-zinc-200 font-semibold">Live</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Track Info & Metadata Section */}
      <div className="px-6 sm:px-10 shrink-0 flex flex-col gap-1.5 max-w-lg mx-auto w-full z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
              {track.title}
            </h2>
            <div className="flex items-center gap-1.5 text-sm sm:text-base text-zinc-300 font-medium truncate mt-0.5">
              <span>{artistName}</span>
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" title="Verified Track" />
              {isPlayingOffline && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                  Offline
                </span>
              )}
            </div>
            {channelInfo && (
              <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-normal">
                via {channelInfo}
              </div>
            )}
          </div>

          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(track)}
              title={isFav ? 'Remove from Favorites' : 'Save to Favorites'}
              aria-label="Toggle Favorite"
              className="p-2.5 rounded-full hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
            >
              <Heart className={`w-6 h-6 transition-colors ${isFav ? 'fill-rose-500 text-rose-500' : 'text-zinc-400 hover:text-white'}`} />
            </button>
          )}
        </div>

        {/* Release Date & Extra Info Badges (Hidden when lyrics view is expanded to maximize lyrics space) */}
        {!showLyrics && (
          <div className="flex items-center flex-wrap gap-2 text-xs font-medium mt-1">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-zinc-200">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              <span>Released: {releaseDateStr}</span>
            </div>

            {track?.vibe && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/25 text-purple-200">
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>{track.vibe}</span>
              </div>
            )}

            {viewCountStr && (
              <div className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-zinc-400 hidden xs:inline-flex items-center gap-1">
                <span>{viewCountStr}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrubber & Live Time Duration */}
      <div className="px-6 sm:px-10 shrink-0 mt-3 sm:mt-4 max-w-lg mx-auto w-full z-10">
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
          disabled={!track}
          style={{
            background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent} ${progressPct}%, #202028 ${progressPct}%, #202028 100%)`
          }}
          className="w-full argon-slider cursor-pointer h-1.5"
        />
        <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 mt-1.5">
          <span>{formatTime(displayTime)}</span>
          <span>{effectiveDuration > 0 ? formatTime(effectiveDuration) : (track?.duration_text || '0:00')}</span>
        </div>
      </div>

      {/* Playback Transport Controls */}
      <div className="px-6 sm:px-10 py-2 sm:py-4 shrink-0 flex items-center justify-between max-w-lg mx-auto w-full z-10">
        <button
          onClick={() => setIsShuffle && setIsShuffle((prev) => !prev)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isShuffle ? 'text-white bg-white/15' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
          aria-label="Toggle Shuffle"
        >
          <Shuffle className="w-5 h-5" />
        </button>

        <button
          onClick={onPrev}
          disabled={!track}
          className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
          style={{ color: albumColor.primary }}
          title="Previous Track"
          aria-label="Previous Track"
        >
          <SkipBack className="w-7 h-7 fill-current opacity-90" />
        </button>

        <button
          onClick={onTogglePlay}
          disabled={!track}
          className="w-16 h-16 sm:w-18 sm:h-18 rounded-full flex items-center justify-center active:scale-95 transition-all shadow-xl cursor-pointer hover:brightness-110"
          style={{
            backgroundColor: albumColor.primary,
            color: albumColor.contrastText,
            boxShadow: isPlaying ? `0 8px 32px ${albumColor.glow}` : '0 4px 16px rgba(0,0,0,0.5)'
          }}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoadingStream ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-7 h-7 fill-current" />
          ) : (
            <Play className="w-7 h-7 fill-current ml-1" />
          )}
        </button>

        <button
          onClick={onNext}
          disabled={!track}
          className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
          style={{ color: albumColor.primary }}
          title="Next Track"
          aria-label="Next Track"
        >
          <SkipForward className="w-7 h-7 fill-current opacity-90" />
        </button>

        <button
          onClick={() => setRepeatMode && setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'))}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            repeatMode && repeatMode !== 'off' ? 'text-white bg-white/15' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={`Repeat: ${repeatMode || 'off'}`}
          aria-label="Toggle Repeat"
        >
          {repeatMode === 'one' ? <Repeat1 className="w-5 h-5 text-emerald-400" /> : <Repeat className="w-5 h-5" />}
        </button>
      </div>

      {/* Bottom Utility Row (Lyrics, Download, Share, Video Preview, Volume) */}
      <div className="px-8 pb-safe pb-4 pt-1 sm:pb-6 shrink-0 flex items-center justify-between text-zinc-400 max-w-lg mx-auto w-full z-10">
        <button
          onClick={handleToggleLyrics}
          disabled={!track}
          title={showLyrics ? 'Hide Synced Lyrics' : 'Show Live Synced Lyrics'}
          aria-label="Toggle Lyrics"
          className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 active:scale-90 relative ${
            showLyrics ? 'text-white ring-1' : 'text-zinc-400 hover:text-white'
          }`}
          style={
            showLyrics
              ? {
                  backgroundColor: `${albumColor.primary}25`,
                  borderColor: `${albumColor.primary}60`,
                  color: albumColor.primary
                }
              : undefined
          }
        >
          <Mic2 className="w-5 h-5" />
          {lyricsState.data?.synced && !showLyrics && (
            <span
              className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: albumColor.primary }}
            />
          )}
        </button>

        {track && (
          <button
            onClick={() => handleDownload && handleDownload(track)}
            disabled={downloadState === 'downloading'}
            title={downloadState === 'downloading' ? 'Downloading...' : isDownloaded ? 'Downloaded (Offline Ready)' : 'Download Track'}
            aria-label="Download Track"
            className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
              isDownloaded ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {downloadState === 'downloading' ? (
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
            ) : isDownloaded ? (
              <Check className="w-5 h-5 text-emerald-400" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </button>
        )}

        {track && (
          <button
            onClick={handleOpenExternal}
            title="Open on YouTube / Browser"
            aria-label="Open on YouTube / Browser"
            className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer active:scale-90"
          >
            <ExternalLink className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={handleToggleVideo}
          disabled={!track || (!track.video_id && !resolvedVid)}
          title={showVideo ? 'Switch to Artwork' : 'Watch Video'}
          aria-label={showVideo ? 'Switch to Artwork' : 'Watch Video'}
          className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 active:scale-90 ${
            showVideo ? 'text-emerald-300 bg-emerald-500/20 ring-1 ring-emerald-500/40' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Video className="w-5 h-5" />
        </button>

        {onOpenSleepTimer && (
          <button
            onClick={onOpenSleepTimer}
            title={
              sleepTimer?.active
                ? (sleepTimer.mode === 'end_of_track' ? 'Sleep Timer: End of song' : `Sleep Timer: ${Math.ceil((sleepTimer.remainingSec || 0) / 60)}m left`)
                : 'Sleep Timer'
            }
            aria-label="Sleep Timer"
            className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer active:scale-90 relative ${
              sleepTimer?.active ? 'text-white bg-white/15' : 'text-zinc-400 hover:text-white'
            }`}
            style={sleepTimer?.active ? { color: albumColor.primary } : undefined}
          >
            <Moon className="w-5 h-5" />
          </button>
        )}

        {/* Volume controls on larger screens */}
        <div className="hidden sm:flex items-center gap-2">
          <button onClick={() => setIsMuted && setIsMuted(!isMuted)} className="p-1 text-zinc-400 hover:text-white">
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-zinc-600" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              if (setVolume) setVolume(Number(e.target.value))
              if (setIsMuted) setIsMuted(false)
            }}
            style={{
              background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent} ${volume}%, #202028 ${volume}%, #202028 100%)`
            }}
            className="w-16 argon-slider cursor-pointer"
          />
        </div>
      </div>

      {/* Spotify / Apple Music Style Lyric Share Card Modal */}
      {showShareCardModal && selectedLyricLines.length > 0 && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150"
          onClick={() => setShowShareCardModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-[#101017] border border-white/15 p-5 sm:p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto no-scrollbar"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Share Lyrics
                </h3>
                <p className="text-xs text-zinc-400 font-normal mt-0.5">
                  Customize card style or share directly
                </p>
              </div>
              <button
                onClick={() => setShowShareCardModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Visual Lyric Card Preview */}
            <div
              className="rounded-3xl p-5 sm:p-6 border border-white/15 shadow-2xl flex flex-col justify-between gap-6 transition-all duration-300"
              style={{
                background: activeShareTheme.cardBg
              }}
            >
              {/* Card Track Header */}
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/15 shadow-md">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-400">
                      <Music className="w-5 h-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white truncate tracking-tight">
                    {track.title}
                  </div>
                  <div className="text-xs text-white/70 truncate font-medium mt-0.5">
                    {artistName}
                  </div>
                </div>
              </div>

              {/* Selected Lyric Lines */}
              <div className="flex flex-col gap-3 py-1">
                {selectedLyricLines.map((line, i) => (
                  <p
                    key={`${i}-${line.time}`}
                    className="text-lg sm:text-xl font-extrabold text-white leading-snug tracking-tight"
                  >
                    {line.text}
                  </p>
                ))}
              </div>

              {/* Card Footer Branding */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span
                  className="text-xs font-bold tracking-tight flex items-center gap-1.5"
                  style={{ color: activeShareTheme.accent }}
                >
                  <span>♫ UpBeat</span>
                </span>
                {lyricsState.data?.synced && selectedLyricLines[0] && (
                  <span className="text-xs font-semibold text-white/50">
                    {formatTime(selectedLyricLines[0].time)}
                  </span>
                )}
              </div>
            </div>

            {/* Theme Color Swatches */}
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold text-zinc-400">
                Card Theme
              </span>
              <div className="flex items-center gap-2">
                {shareCardThemes.map((th, idx) => (
                  <button
                    key={th.name}
                    onClick={() => setShareThemeIdx(idx)}
                    title={th.name}
                    className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                      shareThemeIdx === idx ? 'scale-115 ring-2 ring-white border-white' : 'border-white/20 opacity-75 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: th.bgStart }}
                  />
                ))}
              </div>
            </div>

            {/* Share / Save / Copy Action Buttons */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <button
                onClick={handleCopySelectedLyrics}
                className="py-2.5 px-3 rounded-2xl bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                {copiedFeedback ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedFeedback ? 'Copied!' : 'Copy Text'}</span>
              </button>

              <button
                onClick={handleDownloadCardImage}
                disabled={isExportingCard}
                className="py-2.5 px-3 rounded-2xl bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
              >
                {isExportingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Save Card</span>
              </button>

              <button
                onClick={handleShareCardNative}
                disabled={isExportingCard}
                className="py-2.5 px-3 rounded-2xl bg-white hover:bg-zinc-200 text-xs font-bold text-black flex items-center justify-center gap-1.5 shadow-lg transition-all cursor-pointer active:scale-95 disabled:opacity-40"
              >
                {isExportingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                <span>Share</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
