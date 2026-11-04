import React, { useEffect, useRef, useState } from 'react'
import { X, Heart, Plus, ListMusic, MessageSquareQuote, Users } from 'lucide-react'
import { Art, Avatar, IconButton, Collage, Chip, EmptyState } from './primitives'
import { SongRow, sameTrack } from './AppContext'
import { LyricsCard, usePlaybackClock } from '../lyrics/Lyrics'

/* ------------------------------------------------------------------ */
/* Desktop right panel                                                 */
/* ------------------------------------------------------------------ */

export function RightPanel({ track, contextTitle, upNext = [], queueCount = 0, friends = [], tab, setTab, isFav, onToggleFav, onClose, onOpenLyrics, onListenAlong, onOpenFriends }) {
  const online = friends.filter((f) => f.online)
  const lyricsTab = tab === 'lyrics'
  const clock = usePlaybackClock(lyricsTab && Boolean(track))
  return (
    <aside aria-label="Now playing" className="relative rounded-[14px] bg-bg overflow-hidden w-[344px] flex flex-col min-h-0">
      {track && (
        <>
          <Art track={track} hi className="!absolute -inset-20 !rounded-none blur-[60px] saturate-[1.3] brightness-[0.45] scale-110 !bg-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-[rgba(10,10,11,0.15)] via-[rgba(10,10,11,0.7)] to-[rgba(10,10,11,0.95)]" />
        </>
      )}
      <div className="relative flex flex-col min-h-0 h-full">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.1em] text-white/65 uppercase">{contextTitle ? 'Playing from' : 'Now playing'}</div>
            <div className="text-sm font-bold truncate">{contextTitle || track?.title || 'Nothing playing'}</div>
          </div>
          <IconButton label="Close panel" size={36} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {track && lyricsTab ? (
          <div className="px-5 mt-3.5 flex items-center gap-3">
            <Art track={track} className="w-12 h-12 !rounded-[10px]" />
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold truncate">{track.title}</div>
              <div className="text-[13px] text-white/70 truncate">{track.artist}</div>
            </div>
            <IconButton label={isFav ? 'Remove from liked songs' : 'Like'} onClick={onToggleFav} active={isFav}>
              <Heart className={`w-5 h-5 ${isFav ? 'fill-accent text-accent' : ''}`} />
            </IconButton>
          </div>
        ) : track ? (
          <div className="px-5">
            <Art track={track} hi className="w-full aspect-square !rounded-[18px] mt-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]" />
            <div className="flex items-center mt-4">
              <div className="flex-1 min-w-0">
                <div className="text-[22px] font-extrabold tracking-[-0.02em] truncate">{track.title}</div>
                <div className="text-sm text-white/70 truncate mt-0.5">{track.artist}</div>
              </div>
              <IconButton label={isFav ? 'Remove from liked songs' : 'Like'} onClick={onToggleFav} active={isFav}>
                <Heart className={`w-6 h-6 ${isFav ? 'fill-accent text-accent' : ''}`} />
              </IconButton>
            </div>
          </div>
        ) : (
          <EmptyState icon={ListMusic} title="Nothing playing" body="Pick a song, mix or chart to start." />
        )}

        <div className="flex gap-1.5 mx-5 mt-4 mb-2 p-1 rounded-full bg-black/35" role="tablist">
          {[
            { id: 'next', label: 'Up next' },
            { id: 'lyrics', label: 'Lyrics' },
            { id: 'friends', label: online.length ? `Friends · ${online.length}` : 'Friends' }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 h-[34px] rounded-full text-[13px] font-bold cursor-pointer transition-colors ${tab === t.id ? 'bg-white/[0.14] text-white' : 'text-white/70 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {lyricsTab && track && (
          <div className="flex-1 min-h-0 px-3 pb-3 pt-1">
            <LyricsCard
              fill
              track={track}
              time={clock}
              duration={window.UpBeatControls?.getDuration?.() || 0}
              color="var(--album)"
              onExpand={onOpenLyrics}
              onShare={onOpenLyrics}
            />
          </div>
        )}

        <div className={`flex-1 min-h-0 overflow-y-auto px-5 pb-4 ${lyricsTab && track ? 'hidden' : ''}`}>
          {tab === 'next' &&
            (upNext.length === 0 ? (
              <p className="text-sm text-t2 py-4">Nothing queued. Songs from the current list play next.</p>
            ) : (
              <>
                {queueCount > 0 && <div className="text-xs font-bold uppercase tracking-[0.08em] text-white/60 mt-2 mb-1">In queue</div>}
                {upNext.map((t, i) => (
                  <React.Fragment key={`${t.video_id || t.title}-${i}`}>
                    {queueCount > 0 && i === queueCount && <div className="text-xs font-bold uppercase tracking-[0.08em] text-white/60 mt-4 mb-1">Then</div>}
                    <SongRow track={t} list={upNext.slice(i)} index={i} artSize={44} showFav={false} />
                  </React.Fragment>
                ))}
              </>
            ))}
          {tab === 'friends' &&
            (friends.length === 0 ? (
              <div className="py-4">
                <p className="text-sm text-t2">Add friends to see what they're playing and listen together.</p>
                <Chip className="mt-3" onClick={onOpenFriends}>
                  <Users className="w-4 h-4" />
                  Add friends
                </Chip>
              </div>
            ) : (
              friends.map((f) => (
                <div key={f.friendCode} className="flex items-center gap-3 py-2.5">
                  <Avatar name={f.name} picture={f.picture} size={40} live={f.online} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{f.name}</div>
                    <div className="text-[13px] text-t2 truncate">{f.online ? (f.currentTrack ? `${f.currentTrack.title} · ${f.currentTrack.artist || ''}` : 'Online') : 'Offline'}</div>
                  </div>
                  {f.online && f.currentTrack && (
                    <Chip variant="ghost" className="!h-8 !px-3 !text-[13px]" onClick={() => onListenAlong(f)}>
                      Listen
                    </Chip>
                  )}
                </div>
              ))
            ))}
        </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function Dialog({ open, onClose, title, children, labelledBy }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div ref={ref} className="relative w-full sm:w-[420px] max-h-[80vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl pb-safe">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5" />
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 id={labelledBy} className="text-lg font-extrabold">
            {title}
          </h2>
          <IconButton label="Close" size={36} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

export function AddToPlaylistSheet({ open, track, playlists = [], onClose, onPick, onCreate }) {
  return (
    <Dialog open={open} onClose={onClose} title="Add to playlist" labelledBy="add-to-playlist-title">
      {track && (
        <div className="flex items-center gap-3 px-5 pb-3">
          <Art track={track} className="w-10 h-10 !rounded-lg" />
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{track.title}</div>
            <div className="text-[13px] text-t2 truncate">{track.artist}</div>
          </div>
        </div>
      )}
      <div className="overflow-y-auto px-3 pb-4">
        <button type="button" onClick={onCreate} className="w-full flex items-center gap-3.5 h-16 px-2 rounded-xl hover:bg-white/[0.05] text-left cursor-pointer">
          <span className="w-12 h-12 rounded-xl bg-s2 flex items-center justify-center">
            <Plus className="w-6 h-6" />
          </span>
          <span className="text-[15px] font-bold">New playlist</span>
        </button>
        {playlists.map((p) => {
          const has = track && p.tracks?.some((t) => sameTrack(t, track))
          return (
            <button
              key={p.id}
              type="button"
              disabled={has}
              onClick={() => onPick(p)}
              className="w-full flex items-center gap-3.5 h-16 px-2 rounded-xl hover:bg-white/[0.05] text-left cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <Collage tracks={p.tracks || []} className="w-12 h-12" />
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold truncate">{p.title}</span>
                <span className="block text-[13px] text-t2">{has ? 'Already added' : `${p.tracks?.length || 0} songs`}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

export function NameDialog({ open, title = 'New playlist', initial = '', confirmLabel = 'Create', onClose, onConfirm }) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])
  return (
    <Dialog open={open} onClose={onClose} title={title} labelledBy="name-dialog-title">
      <form
        className="px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onConfirm(value.trim())
        }}
      >
        <label htmlFor="name-input" className="sr-only">
          Name
        </label>
        <input
          id="name-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Give it a name"
          maxLength={80}
          className="w-full h-12 rounded-xl bg-s2 px-4 text-base font-semibold placeholder:text-t3 placeholder:font-medium focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Chip variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Chip>
          <button type="submit" disabled={!value.trim()} className="h-9 px-5 rounded-full bg-t1 text-[#0A0A0B] text-sm font-bold cursor-pointer disabled:opacity-40">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function Toast({ notification, onAction, bottomOffset }) {
  if (!notification) return null
  const isError = notification.type === 'error'
  return (
    <div className="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none" style={{ bottom: bottomOffset }} role="status" aria-live="polite">
      <div className={`pointer-events-auto max-w-md w-full sm:w-auto flex items-center gap-3 pl-4 pr-2 min-h-[48px] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.5)] ring-1 ${isError ? 'bg-[#2A1512] ring-[#FF8A73]/30' : 'bg-s2 ring-white/10'}`}>
        <span className={`text-sm font-semibold py-3 flex-1 ${isError ? 'text-[#FFB4A6]' : 'text-t1'}`}>{notification.msg}</span>
        {notification.action ? (
          <button type="button" onClick={onAction} className="h-9 px-3 rounded-xl text-sm font-bold text-accent hover:bg-white/[0.06] cursor-pointer shrink-0">
            {notification.action.label}
          </button>
        ) : (
          <span className="w-2" />
        )}
      </div>
    </div>
  )
}

export { MessageSquareQuote }
