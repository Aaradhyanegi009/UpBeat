import React, { useState, useEffect, useMemo } from 'react'
import {
  DownloadCloud, Play, Pause, Trash2, Search, HardDrive,
  WifiOff, Wifi, Sparkles, Heart, RefreshCw, FileAudio, Check, AlertCircle, Folder, ListPlus
} from 'lucide-react'
import {
  getOfflineTracks, deleteOfflineTrack, clearAllOfflineTracks,
  formatBytes, getOfflineStorageStats, isOfflineModeActive,
  setOfflineModeActive, subscribeOfflineChanges
} from '../offlineStorage'
import { getTrackDownloadUrl, hasBackend, getApiBase } from '../standaloneApi'

export default function OfflineView({
  currentTrack,
  isPlaying,
  onPlayTrack,
  onNavigateTab,
  onPlayNext,
  onAddToQueue
}) {
  const [tracks, setTracks] = useState([])
  const [stats, setStats] = useState({ count: 0, totalBytes: 0, formattedSize: '0 B' })
  const [searchQuery, setSearchQuery] = useState('')
  const [offlineMode, setOfflineMode] = useState(() => isOfflineModeActive())
  const [confirmClear, setConfirmClear] = useState(false)
  const [isDeletingId, setIsDeletingId] = useState(null)
  const [queueMenuIdx, setQueueMenuIdx] = useState(null)

  // Reload tracks and stats
  const reloadOfflineData = async () => {
    const list = await getOfflineTracks()
    const st = await getOfflineStorageStats()
    setTracks(list)
    setStats(st)
  }

  useEffect(() => {
    reloadOfflineData()
    const unsubscribe = subscribeOfflineChanges(() => {
      reloadOfflineData()
      setOfflineMode(isOfflineModeActive())
    })
    return () => unsubscribe()
  }, [])

  const handleToggleOfflineMode = () => {
    const next = !offlineMode
    setOfflineMode(next)
    setOfflineModeActive(next)
  }

  const handleDelete = async (videoId, e) => {
    if (e) e.stopPropagation()
    setIsDeletingId(videoId)
    try {
      await deleteOfflineTrack(videoId)
      await reloadOfflineData()
    } finally {
      setIsDeletingId(null)
    }
  }

  const handleClearAll = async () => {
    await clearAllOfflineTracks()
    setConfirmClear(false)
    await reloadOfflineData()
  }

  const handlePlayAll = () => {
    if (!filteredTracks.length) return
    onPlayTrack(filteredTracks[0], 0, filteredTracks)
  }

  const handleShuffle = () => {
    if (!filteredTracks.length) return
    const shuffled = [...filteredTracks].sort(() => Math.random() - 0.5)
    onPlayTrack(shuffled[0], 0, shuffled)
  }

  const handleReDownload = (track, e) => {
    if (e) e.stopPropagation()
    const url = getTrackDownloadUrl(track)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${track.artist || ''} - ${track.title || 'Track'}.m4a`
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      try { document.body.removeChild(a) } catch {}
    }, 1000)
  }

  const handleOpenDownloadsFolder = async () => {
    if (hasBackend()) {
      try {
        await fetch(`${getApiBase()}/open-downloads`, { method: 'POST' })
      } catch (err) {
        console.error('Failed to open downloads folder:', err)
      }
    }
  }

  const filteredTracks = useMemo(() => {
    if (!searchQuery.trim()) return tracks
    const q = searchQuery.toLowerCase().trim()
    return tracks.filter((t) =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.artist && t.artist.toLowerCase().includes(q)) ||
      (t.vibe && t.vibe.toLowerCase().includes(q))
    )
  }, [tracks, searchQuery])

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Recent'
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent overflow-y-auto overflow-x-hidden select-none gpu-scroll">
      {/* Sticky Header */}
      <div className="px-3.5 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                <DownloadCloud className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Downloads
              </h1>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {stats.count}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-normal">
              <HardDrive className="w-3 h-3 text-zinc-500" />
              <span>{stats.count} {stats.count === 1 ? 'track' : 'tracks'} • {stats.formattedSize} stored locally</span>
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {tracks.length > 0 && (
              <>
                <button
                  onClick={handleShuffle}
                  className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-md shadow-white/10"
                  title="Shuffle offline songs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
                  <span>Shuffle</span>
                </button>

                {confirmClear ? (
                  <div className="flex items-center gap-1 bg-[#201014] border border-rose-500/40 rounded-full p-1">
                    <button
                      onClick={handleClearAll}
                      className="px-2.5 py-1 text-[11px] text-rose-300 hover:text-rose-100 font-bold cursor-pointer"
                    >
                      Confirm Clear
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-1 text-[11px] text-zinc-400 hover:text-white cursor-pointer font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="p-2 rounded-full text-zinc-400 hover:text-rose-400 hover:bg-white/10 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                    title="Clear all offline storage"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}

            {hasBackend() && (
              <button
                onClick={handleOpenDownloadsFolder}
                className="hidden sm:flex px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs text-zinc-300 hover:text-white items-center gap-1.5 transition-colors cursor-pointer font-medium"
                title="Open UpBeat downloads folder in macOS Finder"
              >
                <Folder className="w-3.5 h-3.5 text-sky-400" />
                <span>Folder</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter Bar */}
        {tracks.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search downloaded songs by title, artist..."
                className="w-full bg-white/[0.06] border border-white/10 focus:border-emerald-500/50 rounded-full pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-400 font-medium focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Track List Content */}
      <div className="p-4 sm:p-6 flex-1 min-h-0">
        {tracks.length === 0 ? (
          /* Empty State */
          <div className="h-full min-h-[380px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/10 rounded-3xl bg-[#0c0c12]/40 backdrop-blur-md">
            <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-500 mb-4 shadow-xl">
              <DownloadCloud className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-white tracking-tight mb-1.5">
              No offline songs saved yet
            </h3>
            <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
              {onNavigateTab && (
                <>
                  <button
                    onClick={() => onNavigateTab('curator')}
                    className="px-5 py-2.5 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-white/10 active:scale-95"
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-black" />
                    <span>Browse Curator</span>
                  </button>
                  <button
                    onClick={() => onNavigateTab('favorites')}
                    className="px-5 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white flex items-center gap-2 transition-colors cursor-pointer active:scale-95"
                  >
                    <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
                    <span>View Liked Songs</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 text-xs font-medium">
            No downloaded songs match "{searchQuery}"
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0c0c12]/75 backdrop-blur-xl shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-xs font-semibold text-zinc-400 bg-[#0c0c12]/80 backdrop-blur-md">
                    <th className="py-2.5 px-4 w-12 text-center">#</th>
                    <th className="py-2.5 px-4">Track</th>
                    <th className="py-2.5 px-4 w-28">Duration</th>
                    <th className="py-2.5 px-4 w-32">Storage</th>
                    <th className="py-2.5 px-4 w-28">Saved</th>
                    <th className="py-2.5 px-4 w-28 text-right pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-xs">
                  {filteredTracks.map((t, idx) => {
                    const isCur = currentTrack && currentTrack.video_id === t.video_id
                    const isCurPlaying = isCur && isPlaying

                    return (
                      <tr
                        key={t.video_id || idx}
                        onClick={() => onPlayTrack(t, idx, filteredTracks)}
                        className={`group hover:bg-white/[0.04] transition-colors cursor-pointer fast-row ${
                          isCur ? 'bg-emerald-500/10' : ''
                        }`}
                      >
                        {/* Index / Play Status */}
                        <td className="py-2.5 px-4 text-center text-xs font-semibold text-zinc-500">
                          {isCurPlaying ? (
                            <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5 mx-auto">
                              <span className="w-1 bg-emerald-400 rounded-full animate-[bounce_0.8s_infinite_100ms] h-full" />
                              <span className="w-1 bg-emerald-400 rounded-full animate-[bounce_0.8s_infinite_300ms] h-2/3" />
                              <span className="w-1 bg-emerald-400 rounded-full animate-[bounce_0.8s_infinite_200ms] h-4/5" />
                            </div>
                          ) : (
                            <span className="group-hover:hidden">{(idx + 1).toString().padStart(2, '0')}</span>
                          )}
                          <Play className={`w-3.5 h-3.5 text-white fill-current mx-auto hidden ${!isCurPlaying ? 'group-hover:block' : ''}`} />
                        </td>

                        {/* Title & Artist & Artwork */}
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                              {t.thumbnail ? (
                                <img
                                  src={t.thumbnail}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                                  <FileAudio className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className={`font-bold text-xs sm:text-sm truncate tracking-tight transition-colors ${isCur ? 'text-emerald-300' : 'text-white group-hover:text-emerald-300'}`}>
                                {t.title}
                              </div>
                              <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-normal">
                                {t.artist}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Duration */}
                        <td className="py-2.5 px-4 text-zinc-400 font-semibold">
                          {t.duration_text || '--:--'}
                        </td>

                        {/* Size */}
                        <td className="py-2.5 px-4">
                          <span className="text-xs font-bold text-emerald-400">
                            {formatBytes(t.size)}
                          </span>
                        </td>

                        {/* Date Added */}
                        <td className="py-2.5 px-4 text-zinc-400 font-medium">
                          {formatDate(t.downloadedAt)}
                        </td>

                        {/* Action Buttons */}
                        <td className="py-2.5 px-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setQueueMenuIdx(queueMenuIdx === `off-d-${idx}` ? null : `off-d-${idx}`)
                                }}
                                title="Queue options"
                                className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                  queueMenuIdx === `off-d-${idx}` ? 'text-sky-400 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300'
                                }`}
                              >
                                <ListPlus className="w-3.5 h-3.5" />
                              </button>
                              {queueMenuIdx === `off-d-${idx}` && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute right-0 bottom-full mb-1 w-36 py-1 bg-[#14141c] border border-white/10 rounded-2xl shadow-2xl z-40 text-xs font-semibold text-left animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl"
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onPlayNext && onPlayNext(t)
                                      setQueueMenuIdx(null)
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-white flex items-center gap-2 cursor-pointer"
                                  >
                                    <span className="text-sky-400 font-bold">⚡</span>
                                    <span>Play Next</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onAddToQueue && onAddToQueue(t)
                                      setQueueMenuIdx(null)
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-zinc-300 hover:text-white flex items-center gap-2 cursor-pointer"
                                  >
                                    <span className="text-emerald-400 font-bold">+</span>
                                    <span>Add to Queue</span>
                                  </button>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={(e) => handleReDownload(t, e)}
                              title="Save copy to Downloads folder"
                              className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            >
                              <DownloadCloud className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(t.video_id, e)}
                              disabled={isDeletingId === t.video_id}
                              title="Delete from offline storage"
                              className="p-1.5 rounded-full hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Touch Card List */}
            <div className="md:hidden flex flex-col gap-2">
              {filteredTracks.map((t, idx) => {
                const isCur = currentTrack && currentTrack.video_id === t.video_id
                const isCurPlaying = isCur && isPlaying

                return (
                  <div
                    key={t.video_id || idx}
                    onClick={() => onPlayTrack(t, idx, filteredTracks)}
                    className={`p-3 sm:p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 fast-row ${
                      isCur
                        ? 'bg-emerald-500/15 border-emerald-500/40 shadow-lg shadow-emerald-950/20 backdrop-blur-xl'
                        : 'bg-[#0c0c12]/75 border-white/[0.08] hover:bg-white/[0.07] backdrop-blur-md'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-12 h-12 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                        {t.thumbnail ? (
                          <img
                            src={t.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <FileAudio className="w-5 h-5" />
                          </div>
                        )}
                        {isCurPlaying && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className={`text-sm font-bold tracking-tight truncate ${isCur ? 'text-emerald-300' : 'text-white'}`}>
                          {t.title}
                        </div>
                        <div className="text-xs text-zinc-400 truncate mt-0.5 font-normal">
                          {t.artist}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1 font-medium">
                          <span>{t.duration_text || '--:--'}</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-bold">{formatBytes(t.size)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setQueueMenuIdx(queueMenuIdx === `off-m-${idx}` ? null : `off-m-${idx}`)
                          }}
                          className={`p-2 rounded-full cursor-pointer transition-colors ${
                            queueMenuIdx === `off-m-${idx}` ? 'text-sky-300 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300 hover:bg-white/10'
                          }`}
                          title="Queue options"
                        >
                          <ListPlus className="w-4 h-4" />
                        </button>
                        {queueMenuIdx === `off-m-${idx}` && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 bottom-full mb-1 w-36 py-1 bg-[#14141c] border border-white/10 rounded-2xl shadow-2xl z-40 text-xs font-semibold text-left animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl"
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onPlayNext && onPlayNext(t)
                                setQueueMenuIdx(null)
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-white/10 text-white flex items-center gap-2 cursor-pointer"
                            >
                              <span className="text-sky-400 font-bold">⚡</span>
                              <span>Play Next</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onAddToQueue && onAddToQueue(t)
                                setQueueMenuIdx(null)
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-white/10 text-zinc-300 hover:text-white flex items-center gap-2 cursor-pointer"
                            >
                              <span className="text-emerald-400 font-bold">+</span>
                              <span>Add to Queue</span>
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onPlayTrack(t, idx, filteredTracks)
                        }}
                        className={`p-2 rounded-full cursor-pointer transition-all active:scale-95 ${
                          isCurPlaying
                            ? 'bg-emerald-500 text-black'
                            : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                        }`}
                      >
                        {isCurPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      <button
                        onClick={(e) => handleDelete(t.video_id, e)}
                        disabled={isDeletingId === t.video_id}
                        className="p-2 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/20 rounded-full cursor-pointer transition-colors"
                        title="Delete track"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
