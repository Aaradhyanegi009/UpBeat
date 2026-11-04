import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  ChevronDown, Heart, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Download, Check, Loader2,
  ListMusic, ExternalLink, Video, Calendar, Sparkles, Volume2, VolumeX, Music, ShieldCheck, Mic2,
  Share2, Copy, X, Moon, Users, User, Radio, MessageSquareQuote, ListPlus
} from 'lucide-react'
import { fetchTrackExtendedMeta, fetchTrackLyrics, openExternalUrl } from '../standaloneApi'
import { ActionMenu, artUrl } from '../ui/primitives'
import { LyricsCard, LyricsFullView } from '../lyrics/Lyrics'

function firstArtist(artist = '') {
  return String(artist).split(/,|&| feat\.| ft\./i)[0].trim()
}

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

function NowPlayingView({
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
  onToggleShuffle,
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
  onOpenSleepTimer,
  playingFromTitle = '',
  onGoToArtist,
  onStartRadio,
  onAddToPlaylist,
  jamActive = false,
  onOpenJam
}) {
  const [extendedMeta, setExtendedMeta] = useState(null)
  const [internalShowLyrics, setInternalShowLyrics] = useState(false)
  const showLyrics = typeof externalShowLyrics === 'boolean' ? externalShowLyrics : internalShowLyrics
  const setShowLyrics = externalSetShowLyrics || setInternalShowLyrics

  const [lyricsSelectStart, setLyricsSelectStart] = useState(false)
  const scrollRootRef = useRef(null)
  const lyricsSectionRef = useRef(null)

  const vid = track?.video_id || resolvedVid
  const thumbUrl = track?.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '')
  // Large, un-letterboxed artwork for the player
  const coverUrl = artUrl(track, true) || thumbUrl
  const coverFallback = artUrl(track, false) || thumbUrl
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

  // Lyrics live in a card below the controls; Expand opens the full-screen view
  const handleToggleLyrics = () => {
    lyricsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openFullLyrics = (select = false) => {
    setLyricsSelectStart(select)
    setShowLyrics(true)
    if (showVideo && setShowVideo) setShowVideo(false)
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
    <div
      ref={scrollRootRef}
      className="fixed inset-0 z-50 bg-[#0A0A0B] overflow-y-auto overflow-x-hidden overscroll-contain select-none animate-in fade-in slide-in-from-bottom-8 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${track.title}`}
    >
      {/* Background taken from the artwork */}
      {coverFallback && (
        <img
          src={coverFallback}
          alt=""
          aria-hidden="true"
          className="fixed -inset-[120px] w-[calc(100%+240px)] h-[calc(100%+240px)] max-w-none object-cover blur-[70px] saturate-[1.3] brightness-[0.55] pointer-events-none -z-10"
        />
      )}
      <div className="fixed inset-0 -z-10 pointer-events-none bg-gradient-to-b from-black/10 via-black/50 to-black/90" />

      {/* First screen: the player. The lyrics card peeks in below it. */}
      <div className="relative min-h-[calc(100dvh-64px)] flex flex-col justify-between">

      {/* Header: close, where this is playing from, more */}
      <header className="pt-safe-top shrink-0 z-20">
        <div className="h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
            title="Close player"
            aria-label="Close player"
          >
            <ChevronDown className="w-7 h-7" />
          </button>
          <div className="min-w-0 text-center">
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-white/70">
              {playingFromTitle ? 'Playing from' : 'Now playing'}
            </div>
            <div className="text-sm font-bold truncate">{playingFromTitle || track.title}</div>
          </div>
          <ActionMenu
            label="More options"
            buttonSize={44}
            className="!text-white/90"
            items={[
              onAddToPlaylist && { label: 'Add to playlist…', icon: ListPlus, onClick: () => onAddToPlaylist(track) },
              onGoToArtist && track.artist && { label: `Go to ${firstArtist(track.artist)}`, icon: User, onClick: () => onGoToArtist(firstArtist(track.artist)) },
              onStartRadio && { label: 'Start radio', icon: Radio, onClick: () => onStartRadio(track) },
              { divider: true },
              { label: showVideo ? 'Show artwork' : 'Watch video', icon: Video, onClick: handleToggleVideo },
              onToggleQueue && { label: queueCount ? `Queue (${queueCount})` : 'Queue', icon: ListMusic, onClick: onToggleQueue },
              { label: 'Open in YouTube', icon: ExternalLink, onClick: handleOpenExternal }
            ].filter(Boolean)}
          />
        </div>
      </header>

      {/* Artwork or video */}
      {(
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 sm:px-12 py-2 sm:py-4">
          <div
            className={`relative w-full ${
              showVideo
                ? 'max-w-[340px] xs:max-w-[420px] sm:max-w-[500px] aspect-video'
                : 'max-w-[280px] xs:max-w-[320px] sm:max-w-[380px] aspect-square'
            } rounded-2xl sm:rounded-3xl overflow-hidden transition-all duration-300 bg-black`}
            style={{
              boxShadow: '0 30px 70px rgba(0,0,0,0.55)',
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
            ) : coverUrl ? (
              <img
                src={coverUrl}
                alt={track.title}
                className="w-full h-full object-cover select-none"
                loading="eager"
                onError={(e) => {
                  if (coverFallback && e.currentTarget.src !== coverFallback) e.currentTarget.src = coverFallback
                }}
              />
            ) : (
              <div className="w-full h-full bg-[#121218] flex items-center justify-center text-zinc-600">
                <Music className="w-16 h-16" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Track Info & Metadata Section */}
      <div className="px-6 sm:px-10 shrink-0 flex flex-col gap-1.5 max-w-lg mx-auto w-full z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold text-white tracking-[-0.02em] truncate">
              {track.title}
            </h2>
            <div className="flex items-center gap-2 text-[15px] text-white/75 font-medium min-w-0 mt-0.5">
              <button
                type="button"
                onClick={() => onGoToArtist?.(firstArtist(artistName))}
                className="truncate hover:underline cursor-pointer text-left"
              >
                {artistName}
              </button>
              {isPlayingOffline && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-live shrink-0">
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
              title={isFav ? 'Remove from liked songs' : 'Like'}
              aria-label={isFav ? 'Remove from liked songs' : 'Like'}
              className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
            >
              <Heart className={`w-7 h-7 transition-colors ${isFav ? 'fill-accent text-accent' : 'text-white/80 hover:text-white'}`} />
            </button>
          )}
        </div>

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
          aria-label="Seek"
          style={{ '--pct': `${progressPct}%`, '--s3': 'rgba(255,255,255,0.22)' }}
          className="ub-range w-full"
        />
        <div className="flex items-center justify-between text-xs font-semibold text-white/65 mt-0.5 tabular-nums">
          <span>{formatTime(displayTime)}</span>
          <span>{effectiveDuration > 0 ? formatTime(effectiveDuration) : (track?.duration_text || '0:00')}</span>
        </div>
      </div>

      {/* Playback Transport Controls */}
      <div className="px-6 sm:px-10 py-2 sm:py-4 shrink-0 flex items-center justify-between max-w-lg mx-auto w-full z-10">
        <button
          onClick={() => (onToggleShuffle ? onToggleShuffle() : setIsShuffle && setIsShuffle((prev) => !prev))}
          className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isShuffle ? 'text-white' : 'text-white/60 hover:text-white'
          }`}
          title={isShuffle ? 'Shuffle on' : 'Shuffle off'}
          aria-label={isShuffle ? 'Shuffle on' : 'Shuffle off'}
          aria-pressed={isShuffle}
        >
          <Shuffle className="w-[22px] h-[22px]" />
          {isShuffle && <span className="absolute bottom-1 left-1/2 -ml-[2px] w-1 h-1 rounded-full bg-current" />}
        </button>

        <button
          onClick={onPrev}
          disabled={!track}
          className="w-14 h-14 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
          title="Previous"
          aria-label="Previous"
        >
          <SkipBack className="w-8 h-8 fill-current" />
        </button>

        <button
          onClick={onTogglePlay}
          disabled={!track}
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-white text-[#0A0A0B] active:scale-95 transition-all shadow-xl cursor-pointer hover:scale-105"
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
          className="w-14 h-14 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-transform cursor-pointer"
          title="Next"
          aria-label="Next"
        >
          <SkipForward className="w-8 h-8 fill-current" />
        </button>

        <button
          onClick={() => setRepeatMode && setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'))}
          className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            repeatMode && repeatMode !== 'off' ? 'text-white' : 'text-white/60 hover:text-white'
          }`}
          title={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}
          aria-label={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}
        >
          {repeatMode === 'one' ? <Repeat1 className="w-[22px] h-[22px]" /> : <Repeat className="w-[22px] h-[22px]" />}
          {repeatMode && repeatMode !== 'off' && <span className="absolute bottom-1 left-1/2 -ml-[2px] w-1 h-1 rounded-full bg-current" />}
        </button>
      </div>

      {/* Bottom row: Jam, Lyrics, Download, Sleep (+ volume on wide screens) */}
      <div className="px-8 pb-safe pb-5 pt-1 sm:pb-7 shrink-0 flex items-center justify-between text-white/80 max-w-lg mx-auto w-full z-10">
        {onOpenJam && (
          <button
            type="button"
            onClick={onOpenJam}
            title={jamActive ? 'Jam is live' : 'Listen with friends'}
            aria-label={jamActive ? 'Jam is live' : 'Listen with friends'}
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer ${jamActive ? 'text-live' : ''}`}
          >
            <Users className="w-[22px] h-[22px]" />
          </button>
        )}

        <button
          type="button"
          onClick={handleToggleLyrics}
          disabled={!track}
          title={showLyrics ? 'Hide lyrics' : 'Lyrics'}
          aria-label={showLyrics ? 'Hide lyrics' : 'Lyrics'}
          aria-pressed={showLyrics}
          className={`relative w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 ${showLyrics ? 'bg-white/15 text-white' : ''}`}
        >
          <MessageSquareQuote className="w-[22px] h-[22px]" />
        </button>

        {track && (
          <button
            type="button"
            onClick={() => handleDownload && handleDownload(track)}
            disabled={downloadState === 'downloading'}
            title={downloadState === 'downloading' ? 'Downloading…' : isDownloaded ? 'Downloaded' : 'Download'}
            aria-label={downloadState === 'downloading' ? 'Downloading' : isDownloaded ? 'Downloaded' : 'Download'}
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer ${isDownloaded ? 'text-live' : ''}`}
          >
            {downloadState === 'downloading' ? (
              <Loader2 className="w-[22px] h-[22px] animate-spin" />
            ) : isDownloaded ? (
              <Check className="w-[22px] h-[22px]" />
            ) : (
              <Download className="w-[22px] h-[22px]" />
            )}
          </button>
        )}

        {onOpenSleepTimer && (
          <button
            onClick={onOpenSleepTimer}
            title={
              sleepTimer?.active
                ? (sleepTimer.mode === 'end_of_track' ? 'Sleep Timer: End of song' : `Sleep Timer: ${Math.ceil((sleepTimer.remainingSec || 0) / 60)}m left`)
                : 'Sleep Timer & Crossfade'
            }
            aria-label="Sleep Timer & Crossfade"
            className={`w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer relative ${
              sleepTimer?.active ? 'text-white bg-white/15' : ''
            }`}
          >
            <Moon className="w-[22px] h-[22px]" />
            {sleepTimer?.active && sleepTimer.mode === 'minutes' && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-extrabold bg-white text-[#0A0A0B] flex items-center justify-center"
              >
                {Math.ceil((sleepTimer.remainingSec || 0) / 60)}m
              </span>
            )}
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

      </div>

      {/* Lyrics card (scroll down, or tap the lyrics button) */}
      <section ref={lyricsSectionRef} className="relative px-4 sm:px-6 pt-2 pb-10 max-w-lg mx-auto w-full scroll-mt-4">
        <LyricsCard
          track={track}
          time={displayTime}
          duration={effectiveDuration}
          color={albumColor.primary}
          onExpand={() => openFullLyrics(false)}
          onShare={() => openFullLyrics(true)}
        />
      </section>

      <LyricsFullView
        open={showLyrics}
        track={track}
        time={displayTime}
        duration={effectiveDuration}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
        onPrev={onPrev}
        onClose={() => setShowLyrics(false)}
        startInSelect={lyricsSelectStart}
      />
    </div>
  )
}

export default React.memo(NowPlayingView, (prev, next) => {
  if (!prev.isOpen && !next.isOpen) {
    return (
      prev.track?.video_id === next.track?.video_id &&
      prev.track?.title === next.track?.title &&
      prev.resolvedVid === next.resolvedVid
    )
  }
  return false
})
