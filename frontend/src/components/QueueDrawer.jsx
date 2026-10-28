import React from 'react'
import { X, Play, Trash2, ListMusic, Music, ListPlus } from 'lucide-react'

export default function QueueDrawer({
  isOpen,
  onClose,
  queue = [],
  currentTrack,
  isPlaying,
  onPlayTrack,
  onRemoveFromQueue,
  onClearQueue,
  onAddToQueue,
  upcomingTracks = []
}) {
  if (!isOpen) return null

  const getThumb = (track) => {
    if (!track) return ''
    if (track.thumbnail) return track.thumbnail
    if (track.video_id) return `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg`
    return ''
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-md bg-[#0b0b10]/98 backdrop-blur-2xl border-l border-white/[0.08] h-full flex flex-col z-10 shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Sticky Header */}
        <div className="pt-safe-top border-b border-white/[0.08] bg-black/40 backdrop-blur-md shrink-0">
          <div className="px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
              <ListMusic className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Playback Queue
                </h3>
                {queue.length > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {queue.length}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 font-normal mt-0.5">
                Tracks play sequentially
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={onClearQueue}
                className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-xs font-semibold text-zinc-300 hover:text-rose-300 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                title="Clear all queued songs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-90"
              title="Close Queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6 gpu-scroll">
          {/* Section: Now Playing */}
          {currentTrack && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-emerald-400 tracking-tight flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${isPlaying ? 'animate-ping' : ''}`} />
                  <span>Now Playing</span>
                </span>
                {currentTrack.duration_text && currentTrack.duration_text !== '--:--' && (
                  <span className="text-xs font-semibold text-zinc-400">
                    {currentTrack.duration_text}
                  </span>
                )}
              </div>

              <div className="p-3 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/30 flex items-center gap-3.5 shadow-lg backdrop-blur-xl">
                <div className="relative w-12 h-12 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                  {getThumb(currentTrack) ? (
                    <img
                      src={getThumb(currentTrack)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-500">
                      <Music className="w-4 h-4" />
                    </div>
                  )}
                  {isPlaying && (
                    <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                      <div className="flex items-end gap-0.5 h-3.5">
                        <span className="w-1 bg-emerald-400 rounded-full h-full animate-[bounce_0.8s_infinite_100ms]" />
                        <span className="w-1 bg-emerald-400 rounded-full h-2/3 animate-[bounce_0.8s_infinite_300ms]" />
                        <span className="w-1 bg-emerald-400 rounded-full h-4/5 animate-[bounce_0.8s_infinite_200ms]" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs sm:text-sm font-bold text-white truncate tracking-tight">
                    {currentTrack.title}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-normal">
                    {currentTrack.artist}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section: Up Next in Queue */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-tight">
                  Queued Next
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/10">
                  {queue.length}
                </span>
              </div>
              {queue.length > 0 && (
                <span className="text-[11px] font-semibold text-emerald-400">
                  Plays First
                </span>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-zinc-400 shrink-0">
                  <ListPlus className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white tracking-tight">
                    Your priority queue is empty
                  </p>
                  <p className="text-[11px] text-zinc-400 font-normal mt-0.5">
                    Tap <span className="text-white font-semibold">+</span> on any track to play it next.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {queue.map((t, idx) => (
                  <div
                    key={`${t.video_id || t.title}-${idx}`}
                    onClick={() => onPlayTrack(t, idx)}
                    className="group p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] flex items-center justify-between gap-3 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-5 text-center shrink-0">
                        <span className="text-xs font-semibold text-zinc-500 group-hover:hidden">
                          {(idx + 1).toString().padStart(2, '0')}
                        </span>
                        <Play className="w-3.5 h-3.5 text-white fill-current mx-auto hidden group-hover:block" />
                      </div>

                      <div className="w-10 h-10 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                        {getThumb(t) ? (
                          <img src={getThumb(t)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <Music className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold text-white group-hover:text-emerald-300 truncate tracking-tight transition-colors">
                          {t.title}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-normal">
                          {t.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {t.duration_text && t.duration_text !== '--:--' && (
                        <span className="text-xs font-semibold text-zinc-400">
                          {t.duration_text}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveFromQueue(idx)
                        }}
                        className="p-1.5 rounded-full text-zinc-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                        title="Remove from queue"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: Next Up from Playlist */}
          {upcomingTracks.length > 0 && (
            <div className="pt-2 border-t border-white/[0.08]">
              <div className="flex items-center justify-between mb-2.5 pt-2">
                <span className="text-xs font-bold text-white tracking-tight">
                  Next Up from Playlist
                </span>
                <span className="text-[11px] font-semibold text-zinc-400">
                  Autoplay
                </span>
              </div>

              <div className="space-y-1.5">
                {upcomingTracks.slice(0, 12).map((t, idx) => (
                  <div
                    key={`up-${t.video_id || idx}`}
                    onClick={() => onPlayTrack(t)}
                    className="group p-2 rounded-2xl hover:bg-white/[0.05] border border-transparent hover:border-white/[0.07] flex items-center justify-between gap-3 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-5 text-center shrink-0">
                        <span className="text-xs font-semibold text-zinc-500 group-hover:hidden">
                          {(idx + 1).toString().padStart(2, '0')}
                        </span>
                        <Play className="w-3.5 h-3.5 text-white fill-current mx-auto hidden group-hover:block" />
                      </div>

                      <div className="w-10 h-10 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                        {getThumb(t) ? (
                          <img src={getThumb(t)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <Music className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold text-white group-hover:text-emerald-300 truncate tracking-tight transition-colors">
                          {t.title}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-normal">
                          {t.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {t.duration_text && t.duration_text !== '--:--' && (
                        <span className="text-xs font-semibold text-zinc-400">
                          {t.duration_text}
                        </span>
                      )}
                      {onAddToQueue && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddToQueue(t)
                          }}
                          className="p-1.5 rounded-full text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/15 opacity-80 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Add to priority queue"
                        >
                          <ListPlus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
