import React, { useState, useEffect } from 'react'
import {
  RefreshCw, ExternalLink, Search, Music, Heart, Play, Pause,
  Sparkles, Download, Check, Loader2, ListPlus, Activity,
  Sliders, Zap, ShieldCheck, Flame, Compass, ChevronRight, Disc, X, Trash2, RotateCcw
} from 'lucide-react'
import { getTrackDownloadUrl, getAudioSource } from '../standaloneApi'
import { saveTrackOffline, createOfflineAudioUrl, getDownloadedVideoIds, subscribeOfflineChanges } from '../offlineStorage'
import { Youtube } from './YouTubeTasteSyncModal'
import { GoogleIcon } from './GoogleAuthModal'

export default function SonicDnaView({
  mode = 'dna',
  currentTrack,
  isPlaying = false,
  tasteDna,
  extractedTracks = [],
  favorites = [],
  isTrackFavorite,
  onToggleFavorite,
  onCurateFromFavorites,
  onSyncFavorites,
  onSyncSafari,
  isSyncing,
  onPlayTrack,
  onPushToSafari,
  onCurateSimilar,
  onPlayNext,
  onAddToQueue,
  onAddSeedTrack,
  onAddMultipleSeedTracks,
  onAnalyzeTaste,
  hasBackend = false,
  googleUser,
  onOpenGoogleModal,
  onSyncYouTubeLikes,
  isSyncingLikes = false,
  onClearSeeds,
  onResetTasteDna
}) {
  const [filter, setFilter] = useState('')
  const [downloadingVid, setDownloadingVid] = useState(null)
  const [downloadedVid, setDownloadedVid] = useState(null)
  const [downloadedSet, setDownloadedSet] = useState(new Set())
  const [queueMenuIdx, setQueueMenuIdx] = useState(null)

  useEffect(() => {
    let active = true
    const updateIds = async () => {
      const ids = await getDownloadedVideoIds()
      if (active) setDownloadedSet(ids)
    }
    updateIds()
    const unsub = subscribeOfflineChanges(() => updateIds())
    return () => {
      active = false
      unsub()
    }
  }, [])

  const handleDownloadTrack = async (t, e) => {
    e.stopPropagation()
    if (!t) return
    const vid = t.video_id
    if (!vid) return

    setDownloadingVid(vid)
    try {
      // 1. Save directly to client IndexedDB offline storage
      await saveTrackOffline(t)

      // 2. Also trigger native file download
      const title = (t.title || 'Track').replace(/[\\/*?:"<>|]/g, '').trim()
      const artist = (t.artist || '').replace(/[\\/*?:"<>|]/g, '').trim()
      const cleanFileName = artist && !title.toLowerCase().includes(artist.toLowerCase())
        ? `${artist} - ${title}.m4a`
        : `${title}.m4a`

      let blobUrl = null
      try {
        blobUrl = await createOfflineAudioUrl(vid)
      } catch {}

      let downloadUrl = blobUrl || getTrackDownloadUrl(t)
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

      setDownloadedVid(vid)
      setTimeout(() => setDownloadedVid(null), 2200)
    } catch (err) {
      console.error('Download error:', err)
    } finally {
      setDownloadingVid(null)
    }
  }

  // 1. FAVORITES MEMORY VIEW (Matches Downloads UI/UX)
  if (mode === 'favorites') {
    const filteredFavs = favorites.filter((t) => {
      if (!filter.trim()) return true
      const q = filter.toLowerCase()
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q)
      )
    })

    return (
      <div
        className="flex-1 flex flex-col min-h-0 bg-transparent overflow-y-auto overflow-x-hidden select-none gpu-scroll"
        onClick={() => setQueueMenuIdx(null)}
      >
        {/* Sticky Header (Exact match to Downloads section) */}
        <div className="px-3.5 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-500 shrink-0">
                  <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
                </div>
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                  Favourites
                </h1>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
                  {favorites.length}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-normal truncate">
                <Heart className="w-3 h-3 text-rose-400 shrink-0" />
                <span className="truncate">
                  {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'} • Saved in your profile
                </span>
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {favorites.length > 0 && onCurateFromFavorites && (
                <button
                  onClick={onCurateFromFavorites}
                  title="Generate a fresh playlist inspired by your hearted songs"
                  className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-md shadow-white/10"
                >
                  <Sparkles className="w-3.5 h-3.5 text-rose-600 fill-rose-600 shrink-0" />
                  <span>Curate Mix</span>
                </button>
              )}
            </div>
          </div>

          {/* Search & Filter Bar */}
          {favorites.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search favourite songs by title, artist..."
                  className="w-full bg-white/[0.06] border border-white/10 focus:border-rose-500/50 rounded-full pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-400 font-medium focus:outline-none transition-colors"
                />
                {filter && (
                  <button
                    onClick={() => setFilter('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white cursor-pointer"
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
          {favorites.length === 0 ? (
            <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/10 rounded-3xl bg-[#0c0c12]/40 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-500 mb-4 shadow-xl">
                <Heart className="w-8 h-8 text-rose-400" />
              </div>
              <h3 className="text-base font-bold text-white tracking-tight mb-1.5">
                No songs hearted yet
              </h3>
              <p className="text-xs text-zinc-400 max-w-xs">
                Tap the heart icon on any track while listening to save it here for instant access and AI curation.
              </p>
            </div>
          ) : filteredFavs.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-xs font-medium">
              No favourite songs match "{filter}"
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
                      <th className="py-2.5 px-4">Artist</th>
                      <th className="py-2.5 px-4 w-32">Style</th>
                      <th className="py-2.5 px-4 w-44 text-right pr-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-xs">
                    {filteredFavs.map((t, idx) => {
                      const thumb = t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
                      const isCur = currentTrack && currentTrack.video_id && currentTrack.video_id === t.video_id
                      const isCurPlaying = isCur && isPlaying
                      const isDl = downloadedSet.has(t.video_id) || downloadedVid === t.video_id

                      return (
                        <tr
                          key={t.video_id || idx}
                          onClick={() => onPlayTrack(t, idx, filteredFavs)}
                          className={`group hover:bg-white/[0.04] transition-colors cursor-pointer fast-row ${
                            isCur ? 'bg-rose-500/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-4 text-center text-xs font-semibold text-zinc-500">
                            {isCurPlaying ? (
                              <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5 mx-auto">
                                <span className="w-1 bg-rose-400 rounded-full animate-[bounce_0.8s_infinite_100ms] h-full" />
                                <span className="w-1 bg-rose-400 rounded-full animate-[bounce_0.8s_infinite_300ms] h-2/3" />
                                <span className="w-1 bg-rose-400 rounded-full animate-[bounce_0.8s_infinite_200ms] h-4/5" />
                              </div>
                            ) : (
                              <span className="group-hover:hidden">{(idx + 1).toString().padStart(2, '0')}</span>
                            )}
                            <Play className={`w-3.5 h-3.5 text-white fill-current mx-auto hidden ${!isCurPlaying ? 'group-hover:block' : ''}`} />
                          </td>
                          <td className="py-2.5 px-4 max-w-md">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden shrink-0 shadow-xs">
                                {thumb ? (
                                  <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                                ) : (
                                  <Music className="w-4 h-4 text-zinc-500 m-auto mt-3" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className={`font-bold text-xs sm:text-sm truncate tracking-tight transition-colors ${isCur ? 'text-rose-300' : 'text-white group-hover:text-rose-300'}`}>
                                  {t.title}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-zinc-400 truncate max-w-[200px] font-medium">
                            {t.artist}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/[0.04] text-zinc-300 border border-white/10">
                              {t.vibe || 'Favorite'}
                            </span>
                          </td>
                          <td
                            className="py-2.5 px-4 text-right pr-6"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setQueueMenuIdx(queueMenuIdx === `fav-d-${idx}` ? null : `fav-d-${idx}`)
                                  }}
                                  title="Queue options"
                                  className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                    queueMenuIdx === `fav-d-${idx}` ? 'text-sky-400 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300'
                                  }`}
                                >
                                  <ListPlus className="w-3.5 h-3.5" />
                                </button>
                                {queueMenuIdx === `fav-d-${idx}` && (
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
                                onClick={() => onToggleFavorite && onToggleFavorite(t)}
                                title="Remove from Favorites memory"
                                className="p-1.5 rounded-full hover:bg-white/10 text-rose-400 transition-colors cursor-pointer"
                              >
                                <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                              </button>
                              {onCurateSimilar && (
                                <button
                                  onClick={() => onCurateSimilar(t)}
                                  title="Curate a playlist around this song"
                                  className="px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Curate</span>
                                </button>
                              )}
                              <button
                                onClick={(e) => handleDownloadTrack(t, e)}
                                disabled={downloadingVid === t.video_id}
                                title={downloadingVid === t.video_id ? 'Downloading...' : isDl ? 'Downloaded (Offline ready)' : 'Download Track'}
                                className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                  isDl ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                                }`}
                              >
                                {downloadingVid === t.video_id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                ) : isDl ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {hasBackend && (
                                <button
                                  onClick={() => onPushToSafari(t)}
                                  title="Open in Safari"
                                  className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Touch Card List (Exact match to Downloads section) */}
              <div className="md:hidden flex flex-col gap-2">
                {filteredFavs.map((t, idx) => {
                  const thumb = t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
                  const isCur = currentTrack && currentTrack.video_id && currentTrack.video_id === t.video_id
                  const isCurPlaying = isCur && isPlaying
                  const isDl = downloadedSet.has(t.video_id) || downloadedVid === t.video_id

                  return (
                    <div
                      key={t.video_id || idx}
                      onClick={() => onPlayTrack(t, idx, filteredFavs)}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 fast-row ${
                        isCur
                          ? 'bg-rose-500/15 border-rose-500/40 shadow-lg shadow-rose-950/20 backdrop-blur-xl'
                          : 'bg-[#0c0c12]/75 border-white/[0.08] hover:bg-white/[0.07] backdrop-blur-md'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="relative w-12 h-12 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-500">
                              <Music className="w-5 h-5" />
                            </div>
                          )}
                          {isCurPlaying && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-bold tracking-tight truncate ${isCur ? 'text-rose-300' : 'text-white'}`}>
                            {t.title}
                          </div>
                          <div className="text-xs text-zinc-400 truncate mt-0.5 font-normal">
                            {t.artist}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1 font-medium truncate">
                            <span>{t.duration_text || 'Saved'}</span>
                            <span>•</span>
                            <span className="text-rose-400 font-bold truncate">{t.vibe || 'Favourite'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setQueueMenuIdx(queueMenuIdx === `fav-m-${idx}` ? null : `fav-m-${idx}`)
                            }}
                            className={`p-2 rounded-full cursor-pointer transition-colors ${
                              queueMenuIdx === `fav-m-${idx}` ? 'text-sky-300 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300 hover:bg-white/10'
                            }`}
                            title="Queue options"
                          >
                            <ListPlus className="w-4 h-4" />
                          </button>
                          {queueMenuIdx === `fav-m-${idx}` && (
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

                        {onCurateSimilar && (
                          <button
                            onClick={() => onCurateSimilar(t)}
                            title="Curate similar songs"
                            className="p-2 rounded-full text-emerald-400 hover:bg-emerald-500/15 transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          onClick={(e) => handleDownloadTrack(t, e)}
                          disabled={downloadingVid === t.video_id}
                          title={downloadingVid === t.video_id ? 'Downloading...' : isDl ? 'Downloaded' : 'Download Track'}
                          className={`p-2 rounded-full transition-colors cursor-pointer ${
                            isDl ? 'text-emerald-400' : 'text-zinc-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {downloadingVid === t.video_id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                          ) : isDl ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => onToggleFavorite && onToggleFavorite(t)}
                          className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-full cursor-pointer transition-colors"
                          title="Remove from Favourites"
                        >
                          <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
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

  // 2. YOUTUBE & SEEDS LIBRARY VIEW (Matches Downloads UI/UX)
  if (mode === 'library') {
    const filteredTracks = extractedTracks.filter((t) => {
      if (!filter.trim()) return true
      const q = filter.toLowerCase()
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q)
      )
    })

    return (
      <div
        className="flex-1 flex flex-col min-h-0 bg-transparent overflow-y-auto overflow-x-hidden select-none gpu-scroll"
        onClick={() => setQueueMenuIdx(null)}
      >
        {/* Sticky Header (Exact match to Downloads section) */}
        <div className="px-3.5 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center text-sky-400 shrink-0">
                  <Disc className="w-4 h-4 text-sky-400" />
                </div>
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                  Seeds & Library
                </h1>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
                  {extractedTracks.length}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-normal truncate">
                <Disc className="w-3 h-3 text-sky-400 shrink-0" />
                <span className="truncate">
                  {extractedTracks.length} {extractedTracks.length === 1 ? 'track' : 'tracks'} • Seed tracks powering your mixes
                </span>
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {onSyncFavorites && (
                <button
                  onClick={onSyncFavorites}
                  disabled={isSyncing}
                  title="Analyze your Liked songs in Favorites and curate a fresh playlist"
                  className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-md shadow-white/10 disabled:opacity-50"
                >
                  <Heart className={`w-3.5 h-3.5 fill-rose-600 text-rose-600 shrink-0 ${isSyncing ? 'animate-pulse' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Sync Liked'}</span>
                </button>
              )}

              {onClearSeeds && extractedTracks.length > 0 && (
                <button
                  onClick={onClearSeeds}
                  title="Clear all seed tracks from your Library"
                  className="p-2 rounded-full text-zinc-400 hover:text-rose-400 hover:bg-white/10 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Search & Filter Bar */}
          {extractedTracks.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search library songs by title, artist..."
                  className="w-full bg-white/[0.06] border border-white/10 focus:border-sky-500/50 rounded-full pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-400 font-medium focus:outline-none transition-colors"
                />
                {filter && (
                  <button
                    onClick={() => setFilter('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white cursor-pointer"
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
          {extractedTracks.length === 0 ? (
            <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/10 rounded-3xl bg-[#0c0c12]/40 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-500 mb-4 shadow-xl">
                <Disc className="w-8 h-8 text-sky-400" />
              </div>
              <h3 className="text-base font-bold text-white tracking-tight mb-1.5">
                Your Library starts fresh
              </h3>
              <p className="text-xs text-zinc-400 max-w-xs">
                Play or heart tracks to automatically build your seed library and train your personal taste profile.
              </p>
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-xs font-medium">
              No library tracks match "{filter}"
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
                      <th className="py-2.5 px-4">Channel / Artist</th>
                      <th className="py-2.5 px-4 w-44 text-right pr-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-xs">
                    {filteredTracks.map((t, idx) => {
                      const thumb = t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
                      const isFav = isTrackFavorite ? isTrackFavorite(t) : false
                      const isCur = currentTrack && currentTrack.video_id && currentTrack.video_id === t.video_id
                      const isCurPlaying = isCur && isPlaying
                      const isDl = downloadedSet.has(t.video_id) || downloadedVid === t.video_id

                      return (
                        <tr
                          key={t.video_id || idx}
                          onClick={() => onPlayTrack(t, idx, filteredTracks)}
                          className={`group hover:bg-white/[0.04] transition-colors cursor-pointer fast-row ${
                            isCur ? 'bg-sky-500/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-4 text-center text-xs font-semibold text-zinc-500">
                            {isCurPlaying ? (
                              <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5 mx-auto">
                                <span className="w-1 bg-sky-400 rounded-full animate-[bounce_0.8s_infinite_100ms] h-full" />
                                <span className="w-1 bg-sky-400 rounded-full animate-[bounce_0.8s_infinite_300ms] h-2/3" />
                                <span className="w-1 bg-sky-400 rounded-full animate-[bounce_0.8s_infinite_200ms] h-4/5" />
                              </div>
                            ) : (
                              <span className="group-hover:hidden">{(idx + 1).toString().padStart(2, '0')}</span>
                            )}
                            <Play className={`w-3.5 h-3.5 text-white fill-current mx-auto hidden ${!isCurPlaying ? 'group-hover:block' : ''}`} />
                          </td>
                          <td className="py-2.5 px-4 max-w-md">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden shrink-0 shadow-xs">
                                {thumb ? (
                                  <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                                ) : (
                                  <Music className="w-4 h-4 text-zinc-500 m-auto mt-3" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className={`font-bold text-xs sm:text-sm truncate tracking-tight transition-colors ${isCur ? 'text-sky-300' : 'text-white group-hover:text-sky-300'}`}>
                                  {t.title}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-zinc-400 truncate max-w-[200px] font-medium">
                            {t.artist}
                          </td>
                          <td
                            className="py-2.5 px-4 text-right pr-6"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setQueueMenuIdx(queueMenuIdx === `lib-d-${idx}` ? null : `lib-d-${idx}`)
                                  }}
                                  title="Queue options"
                                  className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                    queueMenuIdx === `lib-d-${idx}` ? 'text-sky-400 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300'
                                  }`}
                                >
                                  <ListPlus className="w-3.5 h-3.5" />
                                </button>
                                {queueMenuIdx === `lib-d-${idx}` && (
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
                                onClick={() => onToggleFavorite && onToggleFavorite(t)}
                                title={isFav ? 'Saved in Favorites memory' : 'Save to Favorites memory'}
                                className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                  isFav ? 'text-rose-400' : 'text-zinc-400 hover:text-rose-300'
                                }`}
                              >
                                <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                              </button>
                              {onCurateSimilar && (
                                <button
                                  onClick={() => onCurateSimilar(t)}
                                  title="Curate a playlist around this song"
                                  className="px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Curate</span>
                                </button>
                              )}
                              <button
                                onClick={(e) => handleDownloadTrack(t, e)}
                                disabled={downloadingVid === t.video_id}
                                title={downloadingVid === t.video_id ? 'Downloading...' : isDl ? 'Downloaded (Offline ready)' : 'Download Track'}
                                className={`p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                                  isDl ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                                }`}
                              >
                                {downloadingVid === t.video_id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                ) : isDl ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {hasBackend && (
                                <button
                                  onClick={() => onPushToSafari(t)}
                                  title="Open in Safari"
                                  className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Touch Card List (Exact match to Downloads section) */}
              <div className="md:hidden flex flex-col gap-2">
                {filteredTracks.map((t, idx) => {
                  const thumb = t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
                  const isFav = isTrackFavorite ? isTrackFavorite(t) : false
                  const isCur = currentTrack && currentTrack.video_id && currentTrack.video_id === t.video_id
                  const isCurPlaying = isCur && isPlaying
                  const isDl = downloadedSet.has(t.video_id) || downloadedVid === t.video_id

                  return (
                    <div
                      key={t.video_id || idx}
                      onClick={() => onPlayTrack(t, idx, filteredTracks)}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 fast-row ${
                        isCur
                          ? 'bg-sky-500/15 border-sky-500/40 shadow-lg shadow-sky-950/20 backdrop-blur-xl'
                          : 'bg-[#0c0c12]/75 border-white/[0.08] hover:bg-white/[0.07] backdrop-blur-md'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="relative w-12 h-12 rounded-2xl bg-zinc-900 overflow-hidden shrink-0 border border-white/10 shadow-xs">
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-500">
                              <Music className="w-5 h-5" />
                            </div>
                          )}
                          {isCurPlaying && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-bold tracking-tight truncate ${isCur ? 'text-sky-300' : 'text-white'}`}>
                            {t.title}
                          </div>
                          <div className="text-xs text-zinc-400 truncate mt-0.5 font-normal">
                            {t.artist}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1 font-medium truncate">
                            <span>{t.duration_text || 'Seed'}</span>
                            <span>•</span>
                            <span className="text-sky-400 font-bold truncate">{t.vibe || 'Library'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setQueueMenuIdx(queueMenuIdx === `lib-m-${idx}` ? null : `lib-m-${idx}`)
                            }}
                            className={`p-2 rounded-full cursor-pointer transition-colors ${
                              queueMenuIdx === `lib-m-${idx}` ? 'text-sky-300 bg-sky-500/20' : 'text-zinc-400 hover:text-sky-300 hover:bg-white/10'
                            }`}
                            title="Queue options"
                          >
                            <ListPlus className="w-4 h-4" />
                          </button>
                          {queueMenuIdx === `lib-m-${idx}` && (
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

                        {onCurateSimilar && (
                          <button
                            onClick={() => onCurateSimilar(t)}
                            title="Curate similar songs"
                            className="p-2 rounded-full text-emerald-400 hover:bg-emerald-500/15 transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          onClick={(e) => handleDownloadTrack(t, e)}
                          disabled={downloadingVid === t.video_id}
                          title={downloadingVid === t.video_id ? 'Downloading...' : isDl ? 'Downloaded' : 'Download Track'}
                          className={`p-2 rounded-full transition-colors cursor-pointer ${
                            isDl ? 'text-emerald-400' : 'text-zinc-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {downloadingVid === t.video_id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                          ) : isDl ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => onToggleFavorite && onToggleFavorite(t)}
                          className={`p-2 rounded-full cursor-pointer transition-colors ${
                            isFav ? 'text-rose-400 hover:bg-rose-500/20' : 'text-zinc-400 hover:text-rose-300 hover:bg-white/10'
                          }`}
                          title={isFav ? 'Saved in Favourites' : 'Save to Favourites'}
                        >
                          <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
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

  // 3. MODERN INTERACTIVE SONIC TASTE STUDIO
  const allTracks = favorites.length > 0 ? favorites : extractedTracks
  const artists = Array.from(new Set(allTracks.map((t) => t.artist).filter(Boolean)))
  const topArtists = (tasteDna?.key_artists && tasteDna.key_artists.length)
    ? tasteDna.key_artists
    : (tasteDna?.top_artists && tasteDna.top_artists.length)
    ? tasteDna.top_artists
    : (artists.length ? artists.slice(0, 5) : [])

  const isHighEnergy = allTracks.some((t) => /rock|epic|metal|hyper|phonk|battle|dance/i.test(`${t.title} ${t.artist}`))
  const isMelancholic = allTracks.some((t) => /slow|acoustic|indie|lofi|rain|dark|ambient|chill/i.test(`${t.title} ${t.artist}`))

  const derivedArchetype = tasteDna?.archetype || (
    isHighEnergy ? 'High-Impact Sonic Voyager' :
    isMelancholic ? 'Atmospheric & Ethereal Connoisseur' :
    allTracks.length > 0 ? 'Melodic Audio Explorer' :
    (googleUser?.name ? `${googleUser.name}'s Sonic Canvas` : 'Uncharted Sonic Explorer')
  )

  const derivedSummary = tasteDna?.summary || (
    allTracks.length > 0
      ? `Your profile is driven by ${allTracks.length} tracks, blending ${topArtists.length ? topArtists.slice(0, 2).join(' and ') : 'diverse melodies'} with rich musical textures, dynamic rhythms, and personal listening habits.`
      : (googleUser?.name
          ? `Welcome ${googleUser.name}! Your unique taste profile will evolve dynamically with every song you listen to, search, or heart. Connect your seeds or explore music to build your mix.`
          : 'Your taste profile evolves dynamically with every song you listen to, heart, or search. Search for your favorite songs or connect Google to unlock personalized mixes.')
  )

  const rawGenres = (tasteDna?.primary_genres && tasteDna.primary_genres.length)
    ? tasteDna.primary_genres
    : (allTracks.length > 0
        ? (isHighEnergy
            ? ['Alternative Rock', 'Soundtrack', 'Electronic Melodic', 'Dynamic Beats']
            : ['Indie & Alternative', 'Melodic Pop', 'Atmospheric Ambient', 'Acoustic Harmonies'])
        : ['Global Pop & Hits', 'Indie & Alternative', 'Electronic & Chill', 'Acoustic Harmonies'])

  const genrePills = rawGenres.map((g, idx) => ({
    name: g,
    pct: [42, 28, 18, 12][idx] || 15
  }))

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden bg-transparent select-none gpu-scroll" onClick={() => setQueueMenuIdx(null)}>
      {/* Sticky Translucent Top Header (Matches Downloads Section) */}
      <div className="px-3.5 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
            Taste Profile
          </h1>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
            {allTracks.length} Signals
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onSyncFavorites && (
            <button
              onClick={onSyncFavorites}
              disabled={isSyncing}
              title="Analyze your Liked songs in Favorites and curate a fresh playlist"
              className="px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs text-rose-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95 disabled:opacity-50 shrink-0"
            >
              <Heart className={`w-3.5 h-3.5 fill-rose-400 text-rose-400 shrink-0 ${isSyncing ? 'animate-pulse' : ''}`} />
              <span className="hidden xs:inline">{isSyncing ? 'Syncing...' : 'Sync Liked'}</span>
            </button>
          )}

          <button
            onClick={() => onAnalyzeTaste && onAnalyzeTaste()}
            disabled={isSyncing}
            title="Re-run deep musical taste analysis with Gemini"
            className="px-3 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs text-emerald-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95 disabled:opacity-50 shrink-0"
          >
            <Sparkles className={`w-3.5 h-3.5 text-emerald-400 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Analyze</span>
          </button>

          {onResetTasteDna && (tasteDna || allTracks.length > 0) && (
            <button
              onClick={onResetTasteDna}
              title="Reset Taste DNA profile"
              className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer active:scale-95 shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-3.5 sm:p-6 max-w-4xl w-full mx-auto flex flex-col gap-4 sm:gap-6">
        {/* Main Archetype Hero Card */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0c0c12]/75 backdrop-blur-xl p-5 sm:p-7 shadow-xl">
          {/* Archetype Title & Summary */}
          <div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white leading-tight">
              {googleUser?.name ? `${googleUser.name} • ${derivedArchetype}` : derivedArchetype}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300/90 mt-2.5 leading-relaxed font-normal max-w-2xl">
              {derivedSummary}
            </p>
          </div>

          {/* 1-Tap Curate from DNA Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mt-6 pt-5 border-t border-white/10">
            {onCurateFromFavorites && (
              <button
                onClick={onCurateFromFavorites}
                className="px-4 py-3 sm:py-2.5 rounded-2xl bg-white text-black hover:bg-zinc-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-white/10 active:scale-95"
              >
                <Sparkles className="w-4 h-4 fill-black shrink-0" />
                <span>Curate My DNA Mix (0 AI Tokens)</span>
              </button>
            )}

            <button
              onClick={() => onCurateSimilar && favorites[0] && onCurateSimilar(favorites[0])}
              disabled={!favorites.length}
              className="px-4 py-3 sm:py-2.5 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs sm:text-sm text-white font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 active:scale-95"
            >
              <Compass className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Explore Boundaries</span>
            </button>
          </div>
        </div>

        {/* Google & YouTube Sync Status Card */}
        <div className="p-5 sm:p-6 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <GoogleIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                  {googleUser ? `Connected: ${googleUser.name}` : 'Connect Google & YouTube'}
                </span>
                {googleUser && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                    ONLINE
                  </span>
                )}
              </div>
              {googleUser?.email && (
                <p className="text-xs text-zinc-400 truncate mt-0.5 font-normal">
                  {googleUser.email}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {googleUser ? (
              <button
                onClick={onSyncYouTubeLikes}
                disabled={isSyncingLikes}
                className="w-full sm:w-auto px-4 py-2.5 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-semibold text-rose-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 active:scale-95"
              >
                {isSyncingLikes ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                ) : (
                  <Youtube className="w-3.5 h-3.5 text-rose-400" />
                )}
                <span>Sync YouTube Likes</span>
              </button>
            ) : (
              <button
                onClick={onOpenGoogleModal}
                className="w-full sm:w-auto px-4 py-2.5 rounded-2xl bg-white hover:bg-zinc-200 text-black text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-95"
              >
                <GoogleIcon className="w-3.5 h-3.5" />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </div>

        {/* Genre Affinity Breakdown */}
        <div className="p-5 sm:p-6 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                <Disc className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                Genre Affinity
              </h3>
            </div>
            <span className="text-xs font-semibold text-zinc-400 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 shrink-0">
              {genrePills.length} Styles
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {genrePills.map((g, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-emerald-500/40 transition-colors"
              >
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-bold text-white tracking-tight truncate mr-2">{g.name}</span>
                  <span className="text-xs text-emerald-300 font-bold shrink-0">{g.pct}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/50 border border-white/10 overflow-hidden">
                  <div
                    style={{ width: `${g.pct}%` }}
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Influences & Artists */}
        <div className="p-5 sm:p-6 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                <Music className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                Key Anchoring Artists
              </h3>
            </div>
            <span className="text-xs font-semibold text-zinc-400 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 shrink-0">
              Influences
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {topArtists.length > 0 ? (
              topArtists.map((a, idx) => (
                <div
                  key={idx}
                  onClick={() => onCurateSimilar && onCurateSimilar({ title: 'Mix', artist: a })}
                  className="p-3 px-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-emerald-500/40 flex items-center justify-between gap-3 transition-all cursor-pointer group active:scale-98"
                  title={`Curate mix inspired by ${a}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white/[0.06] group-hover:bg-emerald-500/20 border border-white/10 flex items-center justify-center shrink-0 transition-colors">
                      <Music className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <span className="font-semibold text-xs sm:text-sm text-zinc-100 group-hover:text-white truncate">
                      {a}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400 group-hover:text-emerald-300 shrink-0 whitespace-nowrap flex items-center gap-1">
                    <span>Curate</span>
                    <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-400 font-normal py-2 col-span-2">
                No anchoring artists yet. Heart songs or add seeds to populate your key artists.
              </p>
            )}
          </div>
        </div>

        {/* Top 4 Anchor Songs (The actual songs shaping this profile) */}
        {allTracks.length > 0 && (
          <div className="p-5 sm:p-6 rounded-3xl bg-[#0c0c12]/75 backdrop-blur-xl border border-white/[0.08] shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center shrink-0">
                  <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                  Core Profile Tracks
                </h3>
              </div>
              <span className="text-xs font-semibold text-zinc-400 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 shrink-0">
                {allTracks.length} Tracks
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {allTracks.slice(0, 4).map((t, idx) => {
                const thumb = t.thumbnail || (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : '')
                return (
                  <div
                    key={idx}
                    onClick={() => onPlayTrack(t, idx)}
                    className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-emerald-500/30 flex items-center justify-between gap-3 transition-all cursor-pointer group shadow-xs active:scale-98"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-black/50 border border-white/10 overflow-hidden shrink-0 relative">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-5 h-5 text-zinc-500 m-auto mt-3.5" />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-emerald-300 transition-colors tracking-tight">
                          {t.title}
                        </div>
                        <div className="text-[11px] sm:text-xs text-zinc-400 truncate mt-0.5 font-normal">
                          {t.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {onCurateSimilar && (
                        <button
                          onClick={() => onCurateSimilar(t)}
                          title="Curate similar vibe"
                          className="p-2 rounded-full text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/15 border border-transparent hover:border-emerald-500/30 transition-all cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
