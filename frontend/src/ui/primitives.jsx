import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Music, MoreHorizontal, ChevronLeft, Heart, CircleCheck } from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Artwork                                                             */
/* ------------------------------------------------------------------ */

// YouTube "hqdefault" thumbnails are letterboxed; "mqdefault" is 16:9 without bars
// and crops cleanly to a square. Non-YouTube art (e.g. YT Music squares) is used as-is.
export function artUrl(track, hi = false) {
  if (!track) return ''
  const thumb = track.thumbnail || track.cover || ''
  const vid = track.video_id
  if (thumb && !/i\.ytimg\.com\/vi\//.test(thumb)) return thumb
  const id = vid || (thumb.match(/\/vi\/([A-Za-z0-9_-]{11})\//) || [])[1]
  if (id) return `https://i.ytimg.com/vi/${id}/${hi ? 'hq720' : 'mqdefault'}.jpg`
  return thumb
}

export function Art({ track, src, className = '', round = false, hi = false, style }) {
  const primary = src || artUrl(track, hi)
  const [attempt, setAttempt] = useState(0) // 0 = primary, 1 = standard size, 2 = give up
  useEffect(() => setAttempt(0), [primary])
  const url = attempt === 0 ? primary : attempt === 1 && hi && track ? artUrl(track, false) : ''
  const failed = !url
  return (
    <div
      className={`relative overflow-hidden bg-s2 shrink-0 ${round ? 'rounded-full' : 'rounded-xl'} ${className}`}
      style={style}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setAttempt((a) => (a === 0 && hi && track ? 1 : 2))}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-t3">
          <Music className="w-1/3 h-1/3 max-w-6 max-h-6" />
        </div>
      )}
    </div>
  )
}

/** 2×2 cover from the first four distinct artworks. Falls back to a single image. */
export function Collage({ tracks = [], className = '', cover }) {
  const seen = new Set()
  const picks = []
  for (const t of tracks) {
    const u = artUrl(t)
    if (u && !seen.has(u)) {
      seen.add(u)
      picks.push(t)
    }
    if (picks.length === 4) break
  }
  if (picks.length < 4) {
    return <Art track={picks[0]} src={picks[0] ? undefined : cover} className={className} />
  }
  return (
    <div className={`grid grid-cols-2 overflow-hidden rounded-xl shrink-0 bg-s2 ${className}`}>
      {picks.map((t, i) => (
        <Art key={i} track={t} className="!rounded-none w-full h-full" />
      ))}
    </div>
  )
}

export function LikedTile({ className = '' }) {
  return (
    <div className={`rounded-xl bg-accent text-on-accent flex items-center justify-center shrink-0 ${className}`}>
      <Heart className="w-[42%] h-[42%] fill-current" strokeWidth={0} />
    </div>
  )
}

export function Avatar({ name = '', picture = '', size = 40, live = false, className = '' }) {
  const letter = (name || 'U').trim()[0]?.toUpperCase() || 'U'
  const palette = ['#F2C6B4', '#A8D5C2', '#C9C3F0', '#F3D98B', '#B9D7F2']
  const bg = palette[(letter.charCodeAt(0) || 0) % palette.length]
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full shrink-0 font-extrabold text-[#0A0A0B] ${className}`}
      style={{ width: size, height: size, background: picture ? undefined : bg, fontSize: Math.round(size * 0.4) }}
    >
      {picture ? <img src={picture} alt="" className="w-full h-full rounded-full object-cover" /> : letter}
      {live && (
        <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-live ring-[2.5px] ring-[#0A0A0B]" />
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function IconButton({ label, onClick, children, variant = 'plain', size = 44, className = '', disabled, active, ...rest }) {
  const base = 'inline-flex items-center justify-center rounded-full shrink-0 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default'
  const look =
    variant === 'filled'
      ? 'bg-s2 hover:bg-s3 text-t1'
      : variant === 'light'
        ? 'bg-white text-[#0A0A0B] hover:bg-white/90'
        : variant === 'accent'
          ? 'bg-accent text-on-accent hover:brightness-110'
          : `${active ? 'text-t1' : 'text-t2'} hover:text-t1 hover:bg-white/[0.06]`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${look} ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Chip({ active, onClick, children, icon: Icon, variant = 'solid', className = '', ...rest }) {
  const look = active
    ? 'bg-t1 text-[#0A0A0B]'
    : variant === 'ghost'
      ? 'bg-transparent text-t1 ring-1 ring-inset ring-white/15 hover:bg-white/[0.06]'
      : 'bg-s2 text-t1 hover:bg-s3'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${look} ${className}`}
      {...rest}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  )
}

export function ChipRow({ children, className = '' }) {
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 lg:mx-0 lg:px-0 ${className}`}>
      {children}
      <span className="w-1 shrink-0" aria-hidden="true" />
    </div>
  )
}

export function SectionHeader({ title, action, onAction, className = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 mt-8 mb-3.5 ${className}`}>
      <h2 className="text-xl font-extrabold tracking-[-0.015em]">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="text-sm font-semibold text-t2 hover:text-t1 cursor-pointer">
          {action}
        </button>
      )}
    </div>
  )
}

/** Header for pages below the tab level (has a back button). */
export function PageHeader({ title, onBack, actions, transparent = false }) {
  return (
    <div className={`sticky top-0 z-20 flex items-center gap-2 h-14 px-3 lg:px-5 ${transparent ? '' : 'bg-[rgba(10,10,11,0.94)] backdrop-blur-md'}`}>
      {onBack && (
        <IconButton label="Back" variant="filled" size={40} onClick={onBack}>
          <ChevronLeft className="w-5 h-5" />
        </IconButton>
      )}
      <div className="flex-1 min-w-0 text-base font-bold truncate px-1">{title}</div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-s2 flex items-center justify-center text-t2 mb-4">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div className="text-base font-bold">{title}</div>
      {body && <p className="text-sm text-t2 mt-1.5 max-w-xs leading-relaxed">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Equalizer({ className = '' }) {
  return (
    <span className={`inline-flex items-end gap-[2px] h-3 ${className}`} aria-hidden="true">
      <span className="w-[3px] bg-accent rounded-sm h-full animate-[eq_0.9s_ease-in-out_infinite]" />
      <span className="w-[3px] bg-accent rounded-sm h-2/3 animate-[eq_0.9s_ease-in-out_infinite_0.2s]" />
      <span className="w-[3px] bg-accent rounded-sm h-4/5 animate-[eq_0.9s_ease-in-out_infinite_0.4s]" />
    </span>
  )
}

export function Spinner({ className = 'w-5 h-5' }) {
  return <span className={`inline-block rounded-full border-2 border-white/20 border-t-white animate-spin ${className}`} aria-label="Loading" />
}

/* ------------------------------------------------------------------ */
/* Action menu (⋯) rendered in a portal so it never clips              */
/* ------------------------------------------------------------------ */

export function ActionMenu({ items = [], label = 'More', icon: Icon = MoreHorizontal, buttonSize = 40, className = '' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const menuH = Math.min(items.length * 48 + 12, 420)
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow < menuH + 16 ? Math.max(8, r.top - menuH - 4) : r.bottom + 4
    const left = Math.min(Math.max(8, r.right - 232), window.innerWidth - 240)
    setPos({ top, left })
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const openedAt = Date.now()
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    // Taps can nudge the page by a pixel; only close on a real scroll after opening
    const onScroll = (e) => {
      if (Date.now() - openedAt < 400) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const visible = items.filter(Boolean)
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={`inline-flex items-center justify-center rounded-full text-t2 hover:text-t1 hover:bg-white/[0.06] shrink-0 cursor-pointer ${className}`}
        style={{ width: buttonSize, height: buttonSize }}
      >
        <Icon className="w-5 h-5" />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[80] w-[232px] rounded-2xl bg-s2 shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10 py-1.5 overflow-y-auto"
            style={{ top: pos.top, left: pos.left, maxHeight: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            {visible.map((it, i) =>
              it.divider ? (
                <div key={i} className="h-px bg-white/[0.08] my-1.5" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    it.onClick?.()
                  }}
                  className={`w-full h-11 px-4 flex items-center gap-3 text-[15px] font-medium text-left hover:bg-white/[0.06] cursor-pointer ${it.danger ? 'text-[#FF8A73]' : 'text-t1'}`}
                >
                  {it.icon && <it.icon className="w-[18px] h-[18px] text-t2 shrink-0" />}
                  <span className="truncate">{it.label}</span>
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Track row                                                           */
/* ------------------------------------------------------------------ */

export function TrackRow({
  track,
  index,
  showIndex = false,
  isCurrent = false,
  isPlaying = false,
  isFav = false,
  downloaded = false,
  onPlay,
  onToggleFav,
  menuItems = [],
  artSize = 52,
  showFav = true,
  trailing
}) {
  if (!track) return null
  const sub = [track.artist, track.duration_text && track.duration_text !== '--:--' ? track.duration_text : null].filter(Boolean).join(' · ')
  return (
    <div
      className={`group flex items-center gap-3.5 min-h-[64px] py-1.5 px-2 -mx-2 rounded-xl cursor-pointer hover:bg-white/[0.04] ${isCurrent ? 'bg-white/[0.03]' : ''}`}
      onClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onPlay?.()
      }}
    >
      {showIndex && (
        <span className="w-6 text-center text-sm font-semibold text-t3 tabular-nums shrink-0 hidden sm:block">
          {isCurrent && isPlaying ? <Equalizer /> : index + 1}
        </span>
      )}
      <Art track={track} style={{ width: artSize, height: artSize }} className={artSize < 48 ? '!rounded-lg' : ''} />
      <div className="flex-1 min-w-0">
        <div className={`text-[15px] sm:text-base font-bold truncate ${isCurrent ? 'text-accent' : 'text-t1'}`}>{track.title}</div>
        <div className="text-[13px] text-t2 mt-0.5 truncate flex items-center gap-1.5">
          {isCurrent && isPlaying && !showIndex && <Equalizer className="shrink-0" />}
          {downloaded && <CircleCheck className="w-3.5 h-3.5 text-live shrink-0" aria-label="Downloaded" />}
          <span className="truncate">{sub}</span>
        </div>
      </div>
      {trailing}
      {showFav && onToggleFav && (
        <button
          type="button"
          aria-label={isFav ? 'Remove from liked songs' : 'Add to liked songs'}
          title={isFav ? 'Remove from liked songs' : 'Add to liked songs'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav()
          }}
          className={`hidden sm:inline-flex w-10 h-10 items-center justify-center rounded-full hover:bg-white/[0.06] cursor-pointer ${isFav ? 'text-accent' : 'text-t3 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
        >
          <Heart className={`w-[18px] h-[18px] ${isFav ? 'fill-current' : ''}`} />
        </button>
      )}
      {menuItems.length > 0 && <ActionMenu items={menuItems} label={`More options for ${track.title}`} />}
    </div>
  )
}
