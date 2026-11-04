import React, { useEffect } from 'react'
import { X, Trash2, ListPlus, ListMusic } from 'lucide-react'
import { Art, IconButton, Chip, Equalizer } from '../ui/primitives'

/** Up next sheet (phones; desktop uses the right panel). Same props as before. */
export default function QueueDrawer({ isOpen, onClose, queue = [], currentTrack, isPlaying, onPlayTrack, onRemoveFromQueue, onClearQueue, onAddToQueue, upcomingTracks = [] }) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[65] flex items-end sm:items-stretch sm:justify-end select-none" role="dialog" aria-modal="true" aria-labelledby="queue-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-[88dvh] sm:h-full flex flex-col rounded-t-3xl sm:rounded-none bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 pb-safe animate-in slide-in-from-bottom sm:slide-in-from-right duration-200">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 shrink-0">
          <h2 id="queue-title" className="text-xl font-extrabold tracking-[-0.015em]">
            Up next
          </h2>
          <IconButton label="Close" size={40} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
          {currentTrack && (
            <>
              <h3 className="text-sm font-bold text-t2 mt-3 mb-1.5">Now playing</h3>
              <div className="flex items-center gap-3 min-h-[60px]">
                <Art track={currentTrack} className="w-12 h-12" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-t1 truncate">{currentTrack.title}</div>
                  <div className="text-[13px] text-t2 truncate flex items-center gap-1.5">
                    {isPlaying && <Equalizer />}
                    {currentTrack.artist}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex items-baseline justify-between mt-5 mb-1.5">
            <h3 className="text-sm font-bold text-t2">In queue{queue.length ? ` · ${queue.length}` : ''}</h3>
            {queue.length > 0 && (
              <button type="button" onClick={onClearQueue} className="text-sm font-semibold text-t2 hover:text-t1 cursor-pointer">
                Clear
              </button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="text-[13px] text-t2 py-2 flex items-center gap-2">
              <ListMusic className="w-4 h-4 shrink-0" />
              Use “Play next” or “Add to queue” from any song’s ⋯ menu.
            </p>
          ) : (
            queue.map((t, i) => (
              <div key={`${t.video_id || t.title}-q${i}`} className="group flex items-center gap-3 min-h-[60px] -mx-2 px-2 rounded-xl hover:bg-white/[0.04]">
                <button type="button" onClick={() => onPlayTrack(t, i)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer py-1.5">
                  <Art track={t} className="w-12 h-12" />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold truncate">{t.title}</span>
                    <span className="block text-[13px] text-t2 truncate">{t.artist}</span>
                  </span>
                </button>
                <IconButton label={`Remove ${t.title} from queue`} size={40} onClick={() => onRemoveFromQueue(i)}>
                  <Trash2 className="w-[18px] h-[18px]" />
                </IconButton>
              </div>
            ))
          )}

          {upcomingTracks.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-t2 mt-6 mb-1.5">Then from this list</h3>
              {upcomingTracks.slice(0, 20).map((t, i) => (
                <div key={`${t.video_id || t.title}-u${i}`} className="flex items-center gap-3 min-h-[60px] -mx-2 px-2 rounded-xl hover:bg-white/[0.04]">
                  <button type="button" onClick={() => onPlayTrack(t)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer py-1.5">
                    <Art track={t} className="w-12 h-12" />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold truncate">{t.title}</span>
                      <span className="block text-[13px] text-t2 truncate">{t.artist}</span>
                    </span>
                  </button>
                  {onAddToQueue && (
                    <IconButton label={`Add ${t.title} to queue`} size={40} onClick={() => onAddToQueue(t)}>
                      <ListPlus className="w-[18px] h-[18px]" />
                    </IconButton>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export { Chip }
