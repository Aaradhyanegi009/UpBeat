import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, ChevronDown, Share2, X, Check, Download, Copy, Play, Pause, SkipBack, SkipForward, ArrowDownToLine, TextSelect, Image as ImageIcon } from 'lucide-react'
import { fetchTrackLyrics } from '../standaloneApi'
import { artUrl, IconButton, Spinner, Chip } from '../ui/primitives'

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export function trackKeyOf(track) {
  return track ? track.video_id || `${track.title || ''}|${track.artist || ''}` : ''
}

/** Lyrics for a track: { loading, synced, lines: [{ time, text }], plainText } */
export function useLyrics(track, durationSec = 0) {
  const key = trackKeyOf(track)
  const [state, setState] = useState({ key: '', loading: false, data: null })
  useEffect(() => {
    if (!track?.title) {
      setState({ key: '', loading: false, data: null })
      return
    }
    let alive = true
    setState((s) => ({ key, loading: true, data: s.key === key ? s.data : null }))
    fetchTrackLyrics(track, durationSec)
      .then((data) => alive && setState({ key, loading: false, data: data || null }))
      .catch(() => alive && setState({ key, loading: false, data: null }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // Instrumental markers (♪, …) become spacing, not lines you can select or share
  const lines = useMemo(
    () =>
      (state.data?.lines || []).map((l, i) => {
        const text = (l.text || '').trim()
        return { ...l, i, text: /^[\s♪♫♬.…·*-]*$/.test(text) ? '' : text }
      }),
    [state.data]
  )
  return { loading: state.loading, synced: Boolean(state.data?.synced), lines, hasLyrics: lines.some((l) => l.text) }
}

/** Current playback time when the caller doesn't already have it (desktop right panel). */
export function usePlaybackClock(enabled = true) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setT(window.UpBeatControls?.getCurrentTime?.() || 0), 250)
    return () => clearInterval(id)
  }, [enabled])
  return t
}

export function seekPlayer(sec) {
  window.UpBeatControls?.seekTo?.(sec)
}

function activeIndex(lines, time, synced) {
  if (!synced || !lines.length) return -1
  const t = (Number(time) || 0) + 0.25 // show a line a beat before it is sung
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) idx = i
    else break
  }
  return idx
}

/** Keeps the active line in view unless the person is scrolling themselves. */
function useFollowActive(containerRef, lineRefs, idx, { paused = false, anchor = 0.35 } = {}) {
  const [following, setFollowing] = useState(true)
  const programmatic = useRef(false)
  const resumeTimer = useRef(null)

  useEffect(() => {
    if (!following || paused || idx < 0) return
    const box = containerRef.current
    const el = lineRefs.current[idx]
    if (!box || !el) return
    programmatic.current = true
    const top = el.offsetTop - box.clientHeight * anchor + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    const t = setTimeout(() => (programmatic.current = false), 600)
    return () => clearTimeout(t)
  }, [idx, following, paused, anchor, containerRef, lineRefs])

  const onUserScroll = useCallback(() => {
    if (programmatic.current) return
    setFollowing(false)
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => setFollowing(true), 6000)
  }, [])

  const resume = useCallback(() => {
    clearTimeout(resumeTimer.current)
    setFollowing(true)
  }, [])

  useEffect(() => () => clearTimeout(resumeTimer.current), [])
  return { following, onUserScroll, resume }
}

/* ------------------------------------------------------------------ */
/* Compact card: lives in Now Playing and the desktop right panel       */
/* ------------------------------------------------------------------ */

export function LyricsCard({ track, time, duration = 0, color = '#2A2A2F', onExpand, onShare, fill = false, className = '' }) {
  const { loading, synced, lines, hasLyrics } = useLyrics(track, duration)
  const idx = activeIndex(lines, time, synced)
  const boxRef = useRef(null)
  const lineRefs = useRef({})
  const { following, onUserScroll, resume } = useFollowActive(boxRef, lineRefs, idx, { anchor: 0.3 })

  return (
    <section
      aria-label="Lyrics"
      className={`relative rounded-3xl overflow-hidden flex flex-col ${fill ? 'h-full' : ''} ${className}`}
      style={{ background: `color-mix(in srgb, ${color} 42%, #141416)` }}
    >
      <div className="flex items-center justify-between pl-5 pr-2 pt-3 pb-1 shrink-0">
        <h3 className="text-base font-extrabold">Lyrics</h3>
        <div className="flex items-center">
          {hasLyrics && onShare && (
            <IconButton label="Share lyrics" size={40} className="!text-white/85 hover:!text-white" onClick={onShare}>
              <Share2 className="w-[18px] h-[18px]" />
            </IconButton>
          )}
          {hasLyrics && onExpand && (
            <IconButton label="Expand lyrics" size={40} className="!text-white/85 hover:!text-white" onClick={onExpand}>
              <Maximize2 className="w-[18px] h-[18px]" />
            </IconButton>
          )}
        </div>
      </div>

      {loading && !hasLyrics ? (
        <div className="flex items-center gap-2.5 px-5 py-8 text-sm font-semibold text-white/70">
          <Spinner className="w-4 h-4" />
          Finding lyrics…
        </div>
      ) : !hasLyrics ? (
        <p className="px-5 pt-2 pb-6 text-sm text-white/70">Lyrics aren’t available for this song yet.</p>
      ) : (
        <div className="relative flex-1 min-h-0">
          <div
            ref={boxRef}
            onScroll={onUserScroll}
            className={`relative overflow-y-auto no-scrollbar px-5 pb-6 ${fill ? 'h-full' : 'h-[300px]'}`}
            style={{ maskImage: 'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 40px), transparent 100%)' }}
          >
            <div className="h-3" />
            {lines.map((l) =>
              l.text ? (
                <button
                  key={l.i}
                  ref={(el) => (lineRefs.current[l.i] = el)}
                  type="button"
                  onClick={() => (synced ? seekPlayer(l.time) : onExpand?.())}
                  className={`block w-full text-left text-[20px] leading-snug font-extrabold tracking-[-0.01em] py-1.5 transition-colors cursor-pointer ${
                    !synced ? 'text-white' : l.i === idx ? 'text-white' : l.i < idx ? 'text-white/45' : 'text-white/60 hover:text-white/85'
                  }`}
                >
                  {l.text}
                </button>
              ) : (
                <div key={l.i} ref={(el) => (lineRefs.current[l.i] = el)} className="h-6" aria-hidden="true" />
              )
            )}
          </div>
          {synced && !following && idx >= 0 && (
            <button
              type="button"
              onClick={resume}
              className="absolute left-1/2 -translate-x-1/2 bottom-3 h-8 px-3 rounded-full bg-white text-[#0A0A0B] text-xs font-bold shadow-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              Back to now
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Full-screen view                                                     */
/* ------------------------------------------------------------------ */

function fmt(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function LyricsFullView({
  open,
  track,
  time,
  duration = 0,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  onClose,
  startInSelect = false
}) {
  const { loading, synced, lines, hasLyrics } = useLyrics(track, duration)
  const idx = activeIndex(lines, time, synced)
  const boxRef = useRef(null)
  const lineRefs = useRef({})
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [shareLines, setShareLines] = useState(null) // lines passed to the share sheet
  const [scrub, setScrub] = useState(null)
  const anchorRef = useRef(null) // last tapped line, for range selection with Shift
  const pressTimer = useRef(null)
  const { following, onUserScroll, resume } = useFollowActive(boxRef, lineRefs, idx, { paused: selecting || Boolean(shareLines), anchor: 0.32 })

  useEffect(() => {
    if (!open) return
    setSelecting(startInSelect)
    setSelected(new Set())
    setShareLines(null)
  }, [open, startInSelect, trackKeyOf(track)])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (shareLines) setShareLines(null)
      else if (selecting) {
        setSelecting(false)
        setSelected(new Set())
      } else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, selecting, shareLines, onClose])

  if (!open || !track) return null

  const vocal = lines.filter((l) => l.text)
  const allSelected = vocal.length > 0 && vocal.every((l) => selected.has(l.i))

  const toggleLine = (l, withRange = false) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (withRange && anchorRef.current !== null) {
        const [a, b] = [Math.min(anchorRef.current, l.i), Math.max(anchorRef.current, l.i)]
        lines.forEach((x) => x.text && x.i >= a && x.i <= b && next.add(x.i))
      } else if (next.has(l.i)) next.delete(l.i)
      else next.add(l.i)
      return next
    })
    anchorRef.current = l.i
  }

  const startSelectAt = (l) => {
    setSelecting(true)
    setSelected(new Set([l.i]))
    anchorRef.current = l.i
  }

  const onLineClick = (l, e) => {
    if (selecting) return toggleLine(l, e.shiftKey)
    if (synced) {
      seekPlayer(l.time)
      resume()
    }
  }

  const art = artUrl(track, false)
  const progress = duration > 0 ? Math.min(100, ((scrub ?? time) / duration) * 100) : 0
  const selectedLines = vocal.filter((l) => selected.has(l.i))

  return createPortal(
    <div className="fixed inset-0 z-[75] bg-[#0A0A0B] text-white flex flex-col select-none" role="dialog" aria-modal="true" aria-label={`Lyrics: ${track.title}`}>
      {art && (
        <img
          src={art}
          alt=""
          aria-hidden="true"
          className="fixed -inset-[120px] w-[calc(100%+240px)] h-[calc(100%+240px)] max-w-none object-cover blur-[80px] saturate-[1.4] brightness-[0.5] pointer-events-none"
        />
      )}
      <div className="fixed inset-0 bg-gradient-to-b from-black/30 via-black/35 to-black/80 pointer-events-none" />

      {/* Header */}
      <header className="relative shrink-0 pt-safe-top">
        <div className="h-16 px-3 sm:px-6 flex items-center gap-3 max-w-3xl mx-auto w-full">
          {selecting ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSelecting(false)
                  setSelected(new Set())
                }}
                className="h-10 px-3 rounded-full text-[15px] font-bold hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <div className="flex-1 text-center text-[15px] font-bold" aria-live="polite">
                {selected.size ? `${selected.size} line${selected.size > 1 ? 's' : ''} selected` : 'Tap lines to select'}
              </div>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(vocal.map((l) => l.i)))}
                className="h-10 px-3 rounded-full text-[15px] font-bold hover:bg-white/10 cursor-pointer"
              >
                {allSelected ? 'Clear' : 'Select all'}
              </button>
            </>
          ) : (
            <>
              <IconButton label="Close lyrics" size={44} className="!text-white" onClick={onClose}>
                <ChevronDown className="w-7 h-7" />
              </IconButton>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {art && <img src={art} alt="" className="w-11 h-11 rounded-[10px] object-cover shrink-0" />}
                <div className="min-w-0">
                  <div className="text-[15px] font-bold truncate">{track.title}</div>
                  <div className="text-[13px] text-white/70 truncate">{track.artist}</div>
                </div>
              </div>
              {hasLyrics && (
                <>
                  <IconButton label="Select lines to share" size={44} className="!text-white" onClick={() => setSelecting(true)}>
                    <TextSelect className="w-5 h-5" />
                  </IconButton>
                  <IconButton label="Share the whole song" size={44} className="!text-white" onClick={() => setShareLines(vocal)}>
                    <Share2 className="w-5 h-5" />
                  </IconButton>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {/* Lines */}
      <div className="relative flex-1 min-h-0">
        {loading && !hasLyrics ? (
          <div className="h-full flex items-center justify-center gap-3 text-white/75 font-semibold">
            <Spinner className="w-5 h-5" />
            Finding lyrics…
          </div>
        ) : !hasLyrics ? (
          <div className="h-full flex items-center justify-center px-8 text-center text-white/75 text-lg font-semibold">Lyrics aren’t available for this song yet.</div>
        ) : (
          <div
            ref={boxRef}
            onScroll={onUserScroll}
            className="h-full overflow-y-auto no-scrollbar"
            style={{ maskImage: 'linear-gradient(to bottom, transparent 0, black 48px, black calc(100% - 80px), transparent 100%)' }}
          >
            <div className="max-w-3xl mx-auto px-6 sm:px-10 pt-[18vh] pb-[45vh]">
              {!synced && <p className="text-sm font-semibold text-white/60 mb-6">These lyrics aren’t time-synced.</p>}
              {lines.map((l) => {
                if (!l.text) return <div key={l.i} ref={(el) => (lineRefs.current[l.i] = el)} className="h-10" aria-hidden="true" />
                const isActive = l.i === idx
                const isSel = selected.has(l.i)
                const tone = selecting
                  ? isSel
                    ? 'text-white'
                    : 'text-white/45'
                  : !synced
                    ? 'text-white'
                    : isActive
                      ? 'text-white'
                      : l.i < idx
                        ? 'text-white/35'
                        : 'text-white/55 hover:text-white/80'
                return (
                  <button
                    key={l.i}
                    ref={(el) => (lineRefs.current[l.i] = el)}
                    type="button"
                    aria-pressed={selecting ? isSel : undefined}
                    onClick={(e) => onLineClick(l, e)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      if (!selecting) startSelectAt(l)
                    }}
                    onPointerDown={(e) => {
                      if (selecting || e.pointerType === 'mouse') return
                      clearTimeout(pressTimer.current)
                      pressTimer.current = setTimeout(() => startSelectAt(l), 450)
                    }}
                    onPointerUp={() => clearTimeout(pressTimer.current)}
                    onPointerLeave={() => clearTimeout(pressTimer.current)}
                    onPointerCancel={() => clearTimeout(pressTimer.current)}
                    className={`relative block w-full text-left text-[28px] sm:text-[36px] leading-[1.22] font-extrabold tracking-[-0.02em] py-2 transition-[color,transform] duration-300 cursor-pointer origin-left ${tone} ${
                      selecting && isSel ? 'pl-4' : ''
                    } ${isActive && !selecting && synced ? 'scale-[1.02]' : ''}`}
                  >
                    {selecting && isSel && <span className="absolute left-0 top-3 bottom-3 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
                    {l.text}
                  </button>
                )
              })}
              <p className="text-xs text-white/40 mt-10">Lyrics from LRCLIB</p>
            </div>
          </div>
        )}

        {synced && !following && !selecting && idx >= 0 && (
          <button
            type="button"
            onClick={resume}
            className="absolute left-1/2 -translate-x-1/2 bottom-5 h-10 px-4 rounded-full bg-white text-[#0A0A0B] text-sm font-bold shadow-xl inline-flex items-center gap-2 cursor-pointer"
          >
            <ArrowDownToLine className="w-4 h-4" />
            Back to now
          </button>
        )}
      </div>

      {/* Footer: share bar while selecting, mini player otherwise */}
      <footer className="relative shrink-0 pb-safe">
        <div className="max-w-3xl mx-auto w-full px-5 sm:px-10 pt-2 pb-5">
          {selecting ? (
            <button
              type="button"
              disabled={!selected.size}
              onClick={() => setShareLines(selectedLines)}
              className="w-full h-14 rounded-full bg-white text-[#0A0A0B] text-base font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              <Share2 className="w-5 h-5" />
              {selected.size ? `Share ${selected.size} line${selected.size > 1 ? 's' : ''}` : 'Select lines to share'}
            </button>
          ) : (
            <>
              <input
                type="range"
                aria-label="Seek"
                min="0"
                max={duration || 100}
                step="0.25"
                value={Math.min(scrub ?? time, duration || 100)}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrub !== null) seekPlayer(scrub)
                  setScrub(null)
                  resume()
                }}
                onKeyUp={() => {
                  if (scrub !== null) seekPlayer(scrub)
                  setScrub(null)
                }}
                className="ub-range sm w-full"
                style={{ '--pct': `${progress}%`, '--s3': 'rgba(255,255,255,0.22)', '--t1': '#fff' }}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs font-semibold text-white/65 tabular-nums w-12">{fmt(scrub ?? time)}</span>
                <div className="flex items-center gap-4">
                  <IconButton label="Previous" size={48} className="!text-white" onClick={onPrev}>
                    <SkipBack className="w-6 h-6 fill-current" />
                  </IconButton>
                  <button
                    type="button"
                    onClick={onTogglePlay}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="w-14 h-14 rounded-full bg-white text-[#0A0A0B] flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                  </button>
                  <IconButton label="Next" size={48} className="!text-white" onClick={onNext}>
                    <SkipForward className="w-6 h-6 fill-current" />
                  </IconButton>
                </div>
                <span className="text-xs font-semibold text-white/65 tabular-nums w-12 text-right">{fmt(duration)}</span>
              </div>
            </>
          )}
        </div>
      </footer>

      <LyricsShareSheet
        open={Boolean(shareLines)}
        lines={shareLines || []}
        wholeSong={Boolean(shareLines) && shareLines.length === vocal.length}
        track={track}
        onClose={() => setShareLines(null)}
        onDone={() => {
          setShareLines(null)
          setSelecting(false)
          setSelected(new Set())
        }}
      />
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ */
/* Share sheet                                                          */
/* ------------------------------------------------------------------ */

const THEMES = [
  { id: 'art', name: 'Artwork', bg: null, text: '#FFFFFF', sub: 'rgba(255,255,255,0.72)' },
  { id: 'graphite', name: 'Graphite', bg: ['#26262B', '#0A0A0B'], text: '#FFFFFF', sub: 'rgba(255,255,255,0.65)' },
  { id: 'ember', name: 'Ember', bg: ['#FF5E3A', '#B2301A'], text: '#1B0A05', sub: 'rgba(27,10,5,0.7)' },
  { id: 'paper', name: 'Paper', bg: ['#F4F1EA', '#E7E1D6'], text: '#141416', sub: 'rgba(20,20,22,0.62)' }
]

function shareText(track, lines, wholeSong) {
  const body = lines.map((l) => l.text).join('\n')
  const head = wholeSong ? '' : ''
  return `${head}${body}\n\n— ${track?.title || ''}${track?.artist ? ` · ${track.artist}` : ''}`
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => resolve(null), 2500)
    img.onload = () => {
      clearTimeout(t)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(t)
      resolve(null)
    }
    img.src = src
  })
}

/** Renders the card as a PNG. Any number of lines: the text gets smaller and the card taller. */
async function renderCard({ track, lines, theme }) {
  const W = 1080
  const pad = 88
  const font = '"Plus Jakarta Sans", -apple-system, "Segoe UI", sans-serif'
  const n = lines.length
  const size = n <= 6 ? 56 : n <= 14 ? 46 : n <= 30 ? 38 : 32
  const lh = Math.round(size * 1.28)
  const gap = Math.round(size * 0.35)

  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = `800 ${size}px ${font}`
  const maxW = W - pad * 2
  const wrapped = lines.map((l) => {
    const words = String(l.text).split(/\s+/)
    const out = []
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (ctx.measureText(test).width > maxW && cur) {
        out.push(cur)
        cur = w
      } else cur = test
    }
    if (cur) out.push(cur)
    return out
  })
  const textH = wrapped.reduce((a, b) => a + b.length * lh, 0) + Math.max(0, wrapped.length - 1) * gap
  const headerH = 150
  const footerH = 110
  const H = Math.max(1080, pad + headerH + 70 + textH + 70 + footerH)
  c.width = W
  c.height = H

  const art = await loadImage(artUrl(track, false))

  // Background
  if (theme.bg) {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, theme.bg[0])
    g.addColorStop(1, theme.bg[1])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = '#141416'
    ctx.fillRect(0, 0, W, H)
    if (art) {
      ctx.save()
      ctx.filter = 'blur(70px) saturate(1.4) brightness(0.55)'
      const s = Math.max(W, H) * 1.3
      ctx.drawImage(art, (W - s) / 2, (H - s) / 2, s, s)
      ctx.restore()
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, 0, W, H)
  }

  // Header: art + title + artist
  const artS = 120
  let y = pad
  if (art) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(pad, y, artS, artS, 22)
    ctx.clip()
    const side = Math.min(art.width, art.height)
    ctx.drawImage(art, (art.width - side) / 2, (art.height - side) / 2, side, side, pad, y, artS, artS)
    ctx.restore()
  }
  const tx = art ? pad + artS + 32 : pad
  const tMax = W - tx - pad
  const clip = (str, f) => {
    ctx.font = f
    let s = str
    while (ctx.measureText(s).width > tMax && s.length > 4) s = `${s.slice(0, -2)}…`
    return s
  }
  ctx.fillStyle = theme.text
  ctx.font = `800 40px ${font}`
  ctx.fillText(clip(track?.title || '', `800 40px ${font}`), tx, y + 54)
  ctx.fillStyle = theme.sub
  ctx.fillText(clip(track?.artist || '', `600 30px ${font}`), tx, y + 98)

  // Lines
  y += headerH + 70
  ctx.fillStyle = theme.text
  ctx.font = `800 ${size}px ${font}`
  for (const block of wrapped) {
    for (const s of block) {
      ctx.fillText(s, pad, y)
      y += lh
    }
    y += gap
  }

  // Footer
  ctx.fillStyle = theme.sub
  ctx.font = `800 30px ${font}`
  ctx.fillText('UpBeat', pad, H - pad + 10)

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'))
}

export function LyricsShareSheet({ open, lines = [], wholeSong = false, track, onClose, onDone }) {
  const [themeId, setThemeId] = useState('art')
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0]

  useEffect(() => {
    if (open) setDone('')
  }, [open])

  if (!open) return null
  const text = shareText(track, lines, wholeSong)
  const fileName = `${(track?.title || 'Lyrics').replace(/[\\/*?:"<>|]/g, '').trim()} - lyrics.png`
  const flash = (k) => {
    setDone(k)
    setTimeout(() => setDone(''), 1800)
  }

  const shareImage = async () => {
    setBusy('share')
    try {
      const blob = await renderCard({ track, lines, theme })
      const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: track?.title, text })
        onDone?.()
      } else if (blob && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
        flash('imgcopied')
      } else {
        await saveBlob(blob, fileName)
        flash('saved')
      }
    } catch {} finally {
      setBusy('')
    }
  }

  const saveImage = async () => {
    setBusy('save')
    try {
      await saveBlob(await renderCard({ track, lines, theme }), fileName)
      flash('saved')
    } finally {
      setBusy('')
    }
  }

  const shareTextOnly = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: track?.title, text })
        onDone?.()
        return
      }
    } catch {
      return
    }
    copyText()
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      flash('copied')
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="lyrics-share-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div className="relative w-full sm:w-[480px] max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 pb-safe overflow-hidden">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 shrink-0">
          <h2 id="lyrics-share-title" className="text-xl font-extrabold tracking-[-0.015em]">
            {wholeSong ? 'Share the whole song' : `Share ${lines.length} line${lines.length > 1 ? 's' : ''}`}
          </h2>
          <IconButton label="Close" size={40} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Preview */}
        <div className="px-5 pt-3 min-h-0 flex-1 overflow-y-auto">
          <CardPreview track={track} lines={lines} theme={theme} />
        </div>

        <div className="px-5 pt-4 pb-5 shrink-0">
          <div className="flex gap-2 mb-4" role="radiogroup" aria-label="Card style">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={themeId === t.id}
                aria-label={t.name}
                title={t.name}
                onClick={() => setThemeId(t.id)}
                className={`w-10 h-10 rounded-full cursor-pointer ring-offset-2 ring-offset-[#141416] ${themeId === t.id ? 'ring-2 ring-white' : 'ring-1 ring-white/15'}`}
                style={{
                  background: t.bg ? `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})` : `center/cover url(${artUrl(track, false)})`
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={shareImage}
            disabled={Boolean(busy)}
            className="w-full h-12 rounded-full bg-t1 text-[#0A0A0B] font-extrabold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {busy === 'share' ? <Spinner className="w-5 h-5 !border-black/20 !border-t-black" /> : <ImageIcon className="w-5 h-5" />}
            {done === 'imgcopied' ? 'Image copied' : 'Share as image'}
          </button>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <Chip className="!h-11 justify-center" onClick={saveImage} disabled={Boolean(busy)}>
              {done === 'saved' ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {done === 'saved' ? 'Saved' : 'Save'}
            </Chip>
            <Chip className="!h-11 justify-center" onClick={copyText}>
              {done === 'copied' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {done === 'copied' ? 'Copied' : 'Copy text'}
            </Chip>
            <Chip className="!h-11 justify-center" onClick={shareTextOnly}>
              <Share2 className="w-4 h-4" />
              Text
            </Chip>
          </div>
        </div>
      </div>
    </div>
  )
}

async function saveBlob(blob, name) {
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1500)
}

function CardPreview({ track, lines, theme }) {
  const art = artUrl(track, false)
  const n = lines.length
  const size = n <= 6 ? 'text-[22px]' : n <= 14 ? 'text-lg' : n <= 30 ? 'text-base' : 'text-sm'
  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ color: theme.text }}>
      {theme.bg ? (
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.bg[0]}, ${theme.bg[1]})` }} />
      ) : (
        <>
          <div className="absolute inset-0 bg-[#141416]" />
          {art && <img src={art} alt="" aria-hidden="true" className="absolute -inset-10 w-[calc(100%+80px)] h-[calc(100%+80px)] max-w-none object-cover blur-[40px] saturate-[1.4] brightness-[0.55]" />}
          <div className="absolute inset-0 bg-black/25" />
        </>
      )}
      <div className="relative p-6">
        <div className="flex items-center gap-3">
          {art && <img src={art} alt="" className="w-12 h-12 rounded-lg object-cover" />}
          <div className="min-w-0">
            <div className="font-extrabold truncate">{track?.title}</div>
            <div className="text-sm truncate" style={{ color: theme.sub }}>
              {track?.artist}
            </div>
          </div>
        </div>
        <div className={`mt-6 font-extrabold leading-snug tracking-[-0.01em] ${size} flex flex-col gap-1.5`}>
          {lines.map((l) => (
            <span key={l.i}>{l.text}</span>
          ))}
        </div>
        <div className="mt-6 text-sm font-extrabold" style={{ color: theme.sub }}>
          UpBeat
        </div>
      </div>
    </div>
  )
}
