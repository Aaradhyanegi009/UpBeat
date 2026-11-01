import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Play, Pause, ExternalLink, Loader2, Music,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Heart, Info, KeyRound,
  ListMusic, ListPlus, Disc, Sparkles, Download, Check, MoreVertical, Radio, Volume2, LayoutGrid, Table,
  Shuffle, RotateCcw, RefreshCw, Flame, Globe, Dna, Clock
} from 'lucide-react'
import {
  getTrackDownloadUrl,
  getAudioSource,
  getInitialDiscoveryBlocks,
  fetchListenTogetherFeed,
  rerollDiscoveryBlock,
  loadBlockTracks,
  fisherYatesShuffle
} from '../standaloneApi'
import { saveTrackOffline, createOfflineAudioUrl, getDownloadedVideoIds, subscribeOfflineChanges } from '../offlineStorage'

const DEFAULT_SEED_IDS = new Set([
  'F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE',
  'CXDUXjsU5ao', 'TCd6PfxOy0Y', 'QpxFcMYRV08'
])

export default function PlaylistView({
  playlist,
  currentTrack,
  isPlaying,
  selectedModel,
  isResolvingBatch,
  isTrackFavorite,
  onToggleFavorite,
  onPlayTrack,
  onPushToSafari,
  onPlayNext,
  onAddToQueue,
  isGenerating,
  isSearching,
  isLoadingPlaylistBrowse,
  onSelectMatchedPlaylist,
  onSelectYoutubeResults,
  onSelectDirectSongs,
  onGenerateDefault,
  onSelectStarter,
  needsSetup,
  onOpenSettings,
  googleUser,
  favorites = [],
  extractedTracks = [],
  offlineTracks = [],
  tasteDna = null,
  timeInfo = null,
  onShufflePlayBlock = null,
  onShufflePlayAll = null
}) {
  const [viewMode, setViewMode] = useState('grid') // 'grid' (YouTube Music Quick picks) vs 'table'
  const [downloadingVid, setDownloadingVid] = useState(null)
  const [downloadedVid, setDownloadedVid] = useState(null)
  const [downloadedSet, setDownloadedSet] = useState(new Set())
  const [activeMenuIdx, setActiveMenuIdx] = useState(null)

  // Dynamic 8-9 Listen Together Discovery Blocks (initialized with instant fallback so shelf never stays empty)
  const [discoveryBlocks, setDiscoveryBlocks] = useState(() => getInitialDiscoveryBlocks())
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false)
  const [rerollingBlockId, setRerollingBlockId] = useState(null)

  const gridScrollRef = useRef(null)
  const tier1ScrollRef = useRef(null)
  const tier2ScrollRef = useRef(null)

  // Aggregate user's real personal tracks (excluding default seed placeholders)
  const userPersonalTracks = useMemo(() => {
    const out = []
    const seen = new Set()
    const customSeeds = (extractedTracks || []).filter((t) => !DEFAULT_SEED_IDS.has(t?.video_id))
    for (const t of [...(favorites || []), ...(offlineTracks || []), ...customSeeds]) {
      if (!t) continue
      const key = t.video_id || `${t.title || ''}::${t.artist || ''}`.toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
    return out
  }, [favorites, offlineTracks, extractedTracks])

  // Load and subscribe to dynamic 8-9 discovery blocks
  useEffect(() => {
    let active = true
    fetchListenTogetherFeed({
      userTracks: userPersonalTracks,
      tasteDna,
      timeInfo
    }).then((blocks) => {
      if (active && Array.isArray(blocks) && blocks.length > 0) {
        setDiscoveryBlocks(blocks)
      }
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [userPersonalTracks, tasteDna, timeInfo])

  // Subscribe to offline download status
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

  const handleRefreshFeed = async () => {
    setIsRefreshingFeed(true)
    try {
      const fresh = await fetchListenTogetherFeed({
        userTracks: userPersonalTracks,
        tasteDna,
        forceRefresh: true,
        timeInfo
      })
      if (Array.isArray(fresh) && fresh.length > 0) {
        setDiscoveryBlocks(fresh)
      }
    } catch {} finally {
      setIsRefreshingFeed(false)
    }
  }

  const handleRerollBlock = async (blockId, e) => {
    if (e) e.stopPropagation()
    setRerollingBlockId(blockId)
    try {
      const updated = await rerollDiscoveryBlock(blockId, {
        userTracks: userPersonalTracks,
        tasteDna,
        timeInfo
      })
      if (updated) {
        setDiscoveryBlocks((prev) =>
          prev.map((b) => (b.id === blockId ? updated : b))
        )
      }
    } catch {} finally {
      setRerollingBlockId(null)
    }
  }

  const handleSelectBlock = (block) => {
    if (!block) return
    if (onSelectStarter && block.query) {
      onSelectStarter(block.query)
      return
    }
    if (block.browse_id && onSelectMatchedPlaylist) {
      onSelectMatchedPlaylist(block)
    }
  }

  const handleShuffleBlock = (block, e) => {
    if (e) e.stopPropagation()
    if (onShufflePlayBlock) {
      onShufflePlayBlock(block)
    } else {
      handleSelectBlock(block)
    }
  }

  const handleDownloadTrack = async (track, e) => {
    if (e) e.stopPropagation()
    if (!track || !track.video_id) return
    const vid = track.video_id
    setDownloadingVid(vid)
    try {
      await saveTrackOffline(track)
      const title = (track.title || 'Track').replace(/[\\/*?:"<>|]/g, '').trim()
      const artist = (track.artist || '').replace(/[\\/*?:"<>|]/g, '').trim()
      const cleanFileName = artist && !title.toLowerCase().includes(artist.toLowerCase())
        ? `${artist} - ${title}.m4a`
        : `${title}.m4a`

      let blobUrl = null
      try {
        blobUrl = await createOfflineAudioUrl(vid)
      } catch {}

      let downloadUrl = blobUrl || getTrackDownloadUrl(track)
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

  const scrollContainer = (ref, direction) => {
    if (ref.current) {
      const scrollAmount = ref.current.clientWidth * 0.75
      ref.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  const tier1Blocks = useMemo(() => discoveryBlocks.filter((b) => b.tier === 1), [discoveryBlocks])
  const tier2Blocks = useMemo(() => discoveryBlocks.filter((b) => b.tier === 2), [discoveryBlocks])
  const isNewUser = userPersonalTracks.length <= 5

  // Loading Skeleton State
  if (isGenerating || isSearching) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center select-none bg-transparent min-h-[400px]">
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center mb-4 shadow-xl">
          <Loader2 className={`w-6 h-6 animate-spin ${isSearching ? 'text-rose-400' : 'text-purple-400'}`} />
        </div>
        <p className="text-base font-semibold text-[var(--text-primary)] tracking-tight">
          {isSearching ? 'Searching tracks & stream feeds...' : 'Curating Sonic Profile & Stream Resolution...'}
        </p>
        <p className="text-xs font-medium text-[var(--text-secondary)] mt-1.5">
          {isSearching ? 'Resolving highest audio quality' : `Model: ${selectedModel}`}
        </p>
      </div>
    )
  }

  const tracks = playlist?.tracks || []
  const isDirectSearch = Boolean(playlist?.is_direct_search)
  const matchedPlaylists = playlist?.matched_playlists || []
  const youtubeResults = playlist?.youtube_results || []
  const songResults = playlist?.song_results || []
  const activeSource = playlist?.active_source || (youtubeResults.length > 0 ? 'youtube' : 'songs')
  const activeBrowseId = playlist?.active_browse_id || ''

  return (
    <div
      className="w-full flex flex-col bg-transparent pb-[130px] select-none transition-colors"
      onClick={() => setActiveMenuIdx(null)}
    >
      {/* 1. Header: Quick picks with Spatial Breathing Room & Universal Shuffle */}
      <div className="px-5 sm:px-8 lg:px-10 pt-4 pb-2 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5 min-w-0">
            {googleUser?.picture ? (
              <img
                src={googleUser.picture}
                alt=""
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border border-[var(--border-subtle)] shrink-0 shadow-sm"
              />
            ) : (
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-tr from-rose-500 via-purple-600 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-rose-600/20 shrink-0">
                {(googleUser?.name || 'A')[0].toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <h1 className="text-[1.35rem] sm:text-[1.5rem] lg:text-[1.75rem] font-bold text-[var(--text-primary)] tracking-tight truncate">
                {tracks.length > 0 ? 'Quick picks' : 'Home Discovery'}
              </h1>
              <p className="text-[0.82rem] text-[var(--text-secondary)] truncate max-w-lg mt-0.5">
                {playlist?.playlist_title || playlist?.subtitle || 'Selected based on your listening taste & sonic profile'}
              </p>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Play All Button */}
            {tracks.length > 0 && (
              <button
                onClick={() => onPlayTrack(tracks[0], 0)}
                className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-semibold text-xs transition-transform cursor-pointer shadow-md active:scale-95 hover:opacity-90"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                <span>Play All</span>
              </button>
            )}

            {/* Universal Shuffle Play Button (Pillar 4) */}
            {tracks.length > 0 && onShufflePlayAll && (
              <button
                onClick={() => onShufflePlayAll(tracks)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[var(--surface-hover)] hover:bg-[var(--border-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)] font-semibold text-xs transition-all cursor-pointer shadow-sm active:scale-95"
                title="Shuffle play all tracks"
              >
                <Shuffle className="w-3.5 h-3.5 text-rose-500" />
                <span className="hidden xs:inline">Shuffle</span>
              </button>
            )}

            {/* Layout Mode Toggle (Grid vs Table) */}
            {tracks.length > 0 && (
              <div className="hidden md:flex items-center bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                    viewMode === 'grid' ? 'bg-[var(--border-strong)] text-[var(--text-primary)] font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Quick picks 4-Row Grid View"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                    viewMode === 'table' ? 'bg-[var(--border-strong)] text-[var(--text-primary)] font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Detailed Table View"
                >
                  <Table className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Carousel Navigation Arrows */}
            {tracks.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => scrollContainer(gridScrollRef, 'left')}
                  className="w-8 h-8 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                  title="Previous picks"
                  aria-label="Scroll left"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => scrollContainer(gridScrollRef, 'right')}
                  className="w-8 h-8 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                  title="Next picks"
                  aria-label="Scroll right"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Direct Search Subtabs */}
        {isDirectSearch && (youtubeResults.length > 0 || songResults.length > 0 || matchedPlaylists.length > 0) && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
            {youtubeResults.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectYoutubeResults && onSelectYoutubeResults()}
                className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                  activeSource === 'youtube'
                    ? 'bg-rose-500/20 border-rose-500/60 text-rose-300 font-semibold'
                    : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Play className="w-3 h-3 text-rose-400 fill-rose-400" />
                <span>Videos ({youtubeResults.length})</span>
              </button>
            )}

            {songResults.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectDirectSongs && onSelectDirectSongs()}
                className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                  activeSource === 'songs'
                    ? 'bg-purple-500/20 border-purple-500/60 text-purple-300 font-semibold'
                    : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Disc className="w-3 h-3 text-purple-400" />
                <span>Songs ({songResults.length})</span>
              </button>
            )}

            {matchedPlaylists.map((pl) => {
              const isActivePl = activeSource === 'playlist' && activeBrowseId === pl.browse_id
              return (
                <button
                  key={pl.browse_id}
                  type="button"
                  onClick={() => onSelectMatchedPlaylist && onSelectMatchedPlaylist(pl)}
                  className={`px-3.5 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                    isActivePl
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-semibold'
                      : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <ListMusic className="w-3 h-3 text-emerald-400" />
                  <span className="truncate max-w-[180px]">{pl.title}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 2. CENTERPIECE: The YouTube Music 4-Row Multi-Column Grid */}
      {tracks.length > 0 && (
        viewMode === 'grid' ? (
          <div
            ref={gridScrollRef}
            className="px-5 sm:px-8 lg:px-10 py-3 overflow-x-auto no-scrollbar scroll-smooth"
          >
            <div className="grid grid-rows-4 grid-flow-col gap-x-5 sm:gap-x-7 gap-y-3 w-max">
              {tracks.map((track, idx) => {
                const isSelected = currentTrack && (
                  (currentTrack.video_id && currentTrack.video_id === track.video_id) ||
                  (currentTrack.title === track.title && currentTrack.artist === track.artist)
                )
                const isThisPlaying = isSelected && isPlaying
                const thumbUrl = track.thumbnail || (track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg` : '')
                const isFav = isTrackFavorite ? isTrackFavorite(track) : false
                const isDownloaded = track.video_id ? downloadedSet.has(track.video_id) : false
                const isDownloading = track.video_id && downloadingVid === track.video_id

                return (
                  <div
                    key={idx}
                    onClick={() => onPlayTrack(track, idx)}
                    className={`group flex items-center justify-between gap-3.5 py-2.5 px-3.5 sm:py-3 sm:px-4 rounded-[16px] transition-all cursor-pointer min-h-[64px] sm:min-h-[72px] w-[310px] sm:w-[360px] lg:w-[390px] border ${
                      isSelected
                        ? 'bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-950/20 scale-[1.01]'
                        : 'bg-[var(--bg-card)] hover:bg-[var(--surface-hover)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {/* Left: Artwork with Hover Play Triangle Overlay */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-[12px] bg-zinc-900 border border-[var(--border-subtle)] overflow-hidden shrink-0 relative shadow-sm">
                        {thumbUrl ? (
                          <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                            <Music className="w-5 h-5" />
                          </div>
                        )}

                        <div className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${
                          isSelected || isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          {isThisPlaying ? (
                            <div className="flex items-end gap-0.5 h-3.5">
                              <span className="w-1 bg-white animate-[bounce_0.6s_ease-in-out_infinite] h-full" />
                              <span className="w-1 bg-white animate-[bounce_0.6s_ease-in-out_infinite_0.2s] h-2/3" />
                              <span className="w-1 bg-white animate-[bounce_0.6s_ease-in-out_infinite_0.4s] h-4/5" />
                            </div>
                          ) : (
                            <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                          )}
                        </div>
                      </div>

                      {/* Middle: Title & Artist / Details with clean 4px-6px gap */}
                      <div className="min-w-0">
                        <div className={`text-[0.95rem] sm:text-[1rem] font-semibold tracking-tight truncate leading-snug transition-colors ${
                          isSelected ? 'text-rose-400 font-bold' : 'text-[var(--text-primary)] group-hover:text-rose-400'
                        }`}>
                          {track.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-[0.82rem] text-[var(--text-secondary)] font-medium truncate mt-1">
                          <span className="truncate">{track.artist}</span>
                          {track.duration_text && (
                            <>
                              <span className="text-[var(--text-muted)]">•</span>
                              <span className="text-[0.78rem] text-[var(--text-muted)] shrink-0">{track.duration_text}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Hover Actions */}
                    <div
                      className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onToggleFavorite && onToggleFavorite(track)}
                        title={isFav ? 'Remove from Liked' : 'Add to Liked'}
                        className="p-1.5 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                      </button>

                      {onAddToQueue && (
                        <button
                          onClick={() => onAddToQueue(track)}
                          title="Add to Playback Queue"
                          className="p-1.5 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        >
                          <ListPlus className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={(e) => handleDownloadTrack(track, e)}
                        title={isDownloaded ? 'Downloaded Offline' : 'Save Track Offline'}
                        disabled={isDownloading}
                        className="p-1.5 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                        ) : isDownloaded || downloadedVid === track.video_id ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>

                      <div className="relative">
                        <button
                          onClick={() => setActiveMenuIdx(activeMenuIdx === idx ? null : idx)}
                          className="p-1.5 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {activeMenuIdx === idx && (
                          <div className="absolute right-0 top-8 z-30 w-44 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl py-1 text-xs">
                            <button
                              onClick={() => {
                                onPlayNext && onPlayNext(track)
                                setActiveMenuIdx(null)
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center gap-2"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Play next</span>
                            </button>
                            <button
                              onClick={() => {
                                onAddToQueue && onAddToQueue(track)
                                setActiveMenuIdx(null)
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center gap-2"
                            >
                              <ListPlus className="w-3.5 h-3.5" />
                              <span>Add to queue</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Table View */
          <div className="px-5 sm:px-8 lg:px-10 py-3 overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                  <th className="py-2.5 px-3 font-semibold w-12">#</th>
                  <th className="py-2.5 px-3 font-semibold">Title</th>
                  <th className="py-2.5 px-3 font-semibold">Artist</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Time</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track, idx) => (
                  <tr
                    key={idx}
                    onClick={() => onPlayTrack(track, idx)}
                    className="hover:bg-[var(--surface-hover)] border-b border-[var(--border-subtle)] transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-3 text-[var(--text-muted)] font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-[var(--text-primary)]">{track.title}</td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]">{track.artist}</td>
                    <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-mono">{track.duration_text || '--:--'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite && onToggleFavorite(track) }}
                        className="p-1 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-rose-400"
                      >
                        <Heart className={`w-3.5 h-3.5 ${isTrackFavorite && isTrackFavorite(track) ? 'fill-rose-500 text-rose-500' : ''}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* 3. Dynamic "Listen together" / Discovery Engine (8–9 Live Blocks) */}
      <div className="px-5 sm:px-8 lg:px-10 pt-8 sm:pt-10 flex flex-col gap-6">
        {/* Section Header */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-rose-500 font-bold px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/20">
                LIVE DISCOVERY
              </span>
              <span className="text-xs text-[var(--text-muted)] font-medium">8–9 Live Streams</span>
            </div>
            <h2 className="text-[1.35rem] sm:text-[1.5rem] font-bold text-[var(--text-primary)] tracking-tight">
              Listen together
            </h2>
            <p className="text-[0.82rem] text-[var(--text-secondary)] mt-0.5">
              Regional daily charts & personalized Sonic DNA streams tailored to your taste profile
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh Feed Button */}
            <button
              onClick={handleRefreshFeed}
              disabled={isRefreshingFeed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-all cursor-pointer active:scale-95 shadow-xs"
              title="Refresh feed with fresh rotation & live tracks"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingFeed ? 'animate-spin text-rose-500' : 'text-zinc-400'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Carousel navigation controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollContainer(tier1ScrollRef, 'left')}
                className="w-8 h-8 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title="Previous charts"
                aria-label="Scroll charts left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scrollContainer(tier1ScrollRef, 'right')}
                className="w-8 h-8 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title="Next charts"
                aria-label="Scroll charts right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tier 1 Shelf: 4 Mandatory Regional & Viral Chart Blocks */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span>Regional & Global Daily Charts (Tier 1)</span>
            </span>
          </div>

          <div
            ref={tier1ScrollRef}
            className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 scroll-smooth snap-x snap-mandatory"
          >
            {tier1Blocks.map((block) => {
              const isRerolling = rerollingBlockId === block.id
              return (
                <div
                  key={block.id}
                  onClick={() => handleSelectBlock(block)}
                  className="group relative w-[160px] sm:w-[172px] md:w-[220px] h-48 sm:h-52 rounded-[18px] squircle-card overflow-hidden cursor-pointer shrink-0 snap-start transition-all duration-300 hover:scale-[1.02] shadow-xl"
                >
                  <img
                    src={block.thumbnail}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-65"
                    loading="lazy"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t ${block.color} via-black/45`} />
                  
                  {/* Card Content Overlay */}
                  <div className="absolute inset-0 p-4 flex flex-col justify-between z-10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-white font-bold px-2 py-0.5 rounded-full bg-white/20 border border-white/20 backdrop-blur-md">
                        {block.badge}
                      </span>

                      {/* Reroll Button (Pillar 4) */}
                      <button
                        onClick={(e) => handleRerollBlock(block.id, e)}
                        disabled={isRerolling}
                        title="Randomize / Reroll block"
                        className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 border border-white/20 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-90"
                      >
                        <RotateCcw className={`w-3 h-3 ${isRerolling ? 'animate-spin text-rose-400' : ''}`} />
                      </button>
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-white group-hover:text-rose-300 transition-colors truncate drop-shadow-sm">
                          {block.title}
                        </h3>
                        <p className="text-[11px] text-zinc-300 mt-0.5 truncate drop-shadow-sm">
                          {block.subtitle}
                        </p>
                      </div>

                      {/* Shuffle Play & Direct Play buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => handleShuffleBlock(block, e)}
                          title="Shuffle Play Station"
                          className="w-8 h-8 rounded-full bg-black/60 hover:bg-rose-600 text-white flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-95"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectBlock(block)
                          }}
                          title="Play Station"
                          className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center transition-all shadow-md hover:scale-110 active:scale-95 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tier 2 Shelf: 4-5 Personalized Sonic DNA Blocks */}
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Dna className="w-3.5 h-3.5 text-purple-500" />
              <span>Personalized Sonic DNA & Taste Streams (Tier 2)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollContainer(tier2ScrollRef, 'left')}
                className="w-7 h-7 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title="Previous personal streams"
                aria-label="Scroll personal streams left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => scrollContainer(tier2ScrollRef, 'right')}
                className="w-7 h-7 rounded-full border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title="Next personal streams"
                aria-label="Scroll personal streams right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* New User Guidance Banner if <= 5 songs */}
          {isNewUser && (
            <div className="px-4 py-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-purple-300">
                <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
                <span>Heart your first 5 tracks to fully unlock your personalized Sonic Archetype & Deep Cut blocks!</span>
              </div>
            </div>
          )}

          <div
            ref={tier2ScrollRef}
            className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 scroll-smooth snap-x snap-mandatory"
          >
            {tier2Blocks.map((block) => {
              const isRerolling = rerollingBlockId === block.id
              return (
                <div
                  key={block.id}
                  onClick={() => handleSelectBlock(block)}
                  className="group relative w-[160px] sm:w-[172px] md:w-[220px] h-48 sm:h-52 rounded-[18px] squircle-card overflow-hidden cursor-pointer shrink-0 snap-start transition-all duration-300 hover:scale-[1.02] shadow-xl"
                >
                  <img
                    src={block.thumbnail}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-65"
                    loading="lazy"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t ${block.color} via-black/45`} />
                  
                  {/* Card Content Overlay */}
                  <div className="absolute inset-0 p-4 flex flex-col justify-between z-10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-white font-bold px-2 py-0.5 rounded-full bg-white/20 border border-white/20 backdrop-blur-md">
                        {block.badge}
                      </span>

                      {/* Reroll Button (Pillar 4) */}
                      <button
                        onClick={(e) => handleRerollBlock(block.id, e)}
                        disabled={isRerolling}
                        title="Randomize / Reroll block"
                        className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 border border-white/20 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-90"
                      >
                        <RotateCcw className={`w-3 h-3 ${isRerolling ? 'animate-spin text-rose-400' : ''}`} />
                      </button>
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors truncate drop-shadow-sm">
                          {block.title}
                        </h3>
                        <p className="text-[11px] text-zinc-300 mt-0.5 truncate drop-shadow-sm">
                          {block.subtitle}
                        </p>
                      </div>

                      {/* Shuffle Play & Direct Play buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => handleShuffleBlock(block, e)}
                          title="Shuffle Play Station"
                          className="w-8 h-8 rounded-full bg-black/60 hover:bg-purple-600 text-white flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-95"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectBlock(block)
                          }}
                          title="Play Station"
                          className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center transition-all shadow-md hover:scale-110 active:scale-95 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
