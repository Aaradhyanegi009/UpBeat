import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Play, Pause, ExternalLink, Loader2, Music,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Heart, Info, KeyRound,
  ListMusic, ListPlus, Disc, Sparkles, Download, Check, MoreVertical, Radio, Volume2, LayoutGrid, Table
} from 'lucide-react'
import { getTrackDownloadUrl, getAudioSource, fetchOfficialYoutubeCharts, DEFAULT_YT_CHARTS_STATIONS } from '../standaloneApi'
import { saveTrackOffline, createOfflineAudioUrl, getDownloadedVideoIds, subscribeOfflineChanges } from '../offlineStorage'

const DEFAULT_SEED_IDS = new Set([
  'F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE',
  'CXDUXjsU5ao', 'TCd6PfxOy0Y', 'QpxFcMYRV08'
])

const GENERIC_CHANNELS = new Set([
  'jusa music', '7clouds', 't-series', 'sony music india', 'zee music company',
  'yrf', 'tips official', 'speed records', 'youtube', 'unknown artist',
  'oaf', 'annapurna films', 'saregama music', 'eros now music'
])

const GENERIC_VIBES = new Set([
  'yt music', 'youtube', 'playlist', 'direct match', 'song', 'video'
])

const STATION_COLORS = [
  'from-amber-600/40 to-black',
  'from-emerald-600/40 to-black',
  'from-cyan-600/40 to-black',
  'from-purple-600/40 to-black',
  'from-rose-600/40 to-black',
  'from-indigo-600/40 to-black'
]

function trackArtwork(track) {
  if (!track) return ''
  if (track.video_id && track.video_id.length === 11) {
    return `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg`
  }
  return track.thumbnail || ''
}

function extractPrimaryArtist(track) {
  if (!track) return ''
  let rawArtist = (track.artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim()
  const rawTitle = (track.title || '').trim()

  if ((!rawArtist || GENERIC_CHANNELS.has(rawArtist.toLowerCase())) && rawTitle.includes(' - ')) {
    const candidate = rawTitle.split(' - ')[0].replace(/^#VIDEO\s*\|\s*/i, '').trim()
    if (candidate && candidate.length >= 2 && candidate.length <= 32) {
      rawArtist = candidate
    }
  }
  if (!rawArtist || GENERIC_CHANNELS.has(rawArtist.toLowerCase())) return ''

  const primary = rawArtist
    .split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,\s*/i)[0]
    .replace(/\([^)]*\)/g, '')
    .trim()

  return primary.length >= 2 && primary.length <= 28 ? primary : ''
}

function buildDynamicStations(userTracks, tasteDna, chartStations) {
  const charts = chartStations?.length ? chartStations : DEFAULT_YT_CHARTS_STATIONS

  // New user threshold: if user does not have more than 5 songs, sync Official YouTube Charts
  if (!userTracks || userTracks.length <= 5) {
    return charts
  }

  const artists = []
  const artistArt = new Map() // artist -> artwork of the user's own track by that artist
  const vibes = []
  const vibeArt = new Map()
  const seenVibes = new Set()

  if (Array.isArray(tasteDna?.primary_genres)) {
    for (const g of tasteDna.primary_genres) {
      const cleanG = String(g || '').trim()
      if (cleanG && !seenVibes.has(cleanG.toLowerCase())) {
        seenVibes.add(cleanG.toLowerCase())
        vibes.push(cleanG)
      }
    }
  }

  for (const t of userTracks) {
    const art = extractPrimaryArtist(t)
    const key = art.toLowerCase()
    if (art && !artistArt.has(key)) {
      artistArt.set(key, trackArtwork(t))
      artists.push(art)
    }
    const v = String(t?.vibe || '').trim()
    const vKey = v.toLowerCase()
    if (v && !GENERIC_VIBES.has(vKey)) {
      if (!seenVibes.has(vKey)) {
        seenVibes.add(vKey)
        vibes.push(v)
      }
      if (!vibeArt.has(vKey)) vibeArt.set(vKey, trackArtwork(t))
    }
  }

  // Keep every card visually distinct: never reuse the same artwork twice
  const usedArt = new Set()
  const pickArt = (...candidates) => {
    for (const c of candidates) {
      if (c && !usedArt.has(c)) {
        usedArt.add(c)
        return c
      }
    }
    for (const t of userTracks) {
      const c = trackArtwork(t)
      if (c && !usedArt.has(c)) {
        usedArt.add(c)
        return c
      }
    }
    return candidates.find(Boolean) || charts[0]?.thumbnail || ''
  }
  const artOf = (name) => artistArt.get((name || '').toLowerCase())

  const dynamic = []
  const push = (station) => {
    dynamic.push({ ...station, color: STATION_COLORS[dynamic.length % STATION_COLORS.length] })
  }

  if (artists.length >= 2) {
    push({
      id: `dyn_artists_1_${artists[0]}_${artists[1]}`,
      title: `${artists[0]} & ${artists[1]}`,
      subtitle: `${vibes[0] || 'Essential Mix'} • ${vibes[1] || 'Favorites Radio'}`,
      query: `${artists[0]} ${artists[1]} best songs mix`,
      thumbnail: pickArt(artOf(artists[0]), artOf(artists[1]))
    })
  } else if (artists.length === 1) {
    push({
      id: `dyn_artist_solo_${artists[0]}`,
      title: `${artists[0]} Radio`,
      subtitle: `${vibes[0] || 'Top Favorites'} • Personalized Mix`,
      query: `${artists[0]} best songs mix`,
      thumbnail: pickArt(artOf(artists[0]))
    })
  }

  if (artists.length >= 4) {
    push({
      id: `dyn_artists_2_${artists[2]}_${artists[3]}`,
      title: `${artists[2]} & ${artists[3]}`,
      subtitle: `${vibes[1] || 'Liked Rotation'} • Curated Flow`,
      query: `${artists[2]} ${artists[3]} hit songs mix`,
      thumbnail: pickArt(artOf(artists[2]), artOf(artists[3]))
    })
  }

  if (vibes.length >= 2) {
    const seedArtists = artists.slice(0, 2).join(' ')
    push({
      id: `dyn_vibe_${vibes[0]}_${vibes[1]}`,
      title: `${vibes[0]} & ${vibes[1]}`,
      subtitle: tasteDna?.archetype ? `${tasteDna.archetype} • Sonic DNA` : `Custom Vibe • ${artists[0] || 'Curated'}`,
      query: `${vibes[0]} ${vibes[1]} ${seedArtists} best tracks`,
      thumbnail: pickArt(vibeArt.get(vibes[0].toLowerCase()), vibeArt.get(vibes[1].toLowerCase()))
    })
  }

  if (artists.length >= 6) {
    push({
      id: `dyn_artists_3_${artists[4]}_${artists[5]}`,
      title: `${artists[4]} & ${artists[5]}`,
      subtitle: `${vibes[2] || 'Discovery Mix'} • Similar Artists`,
      query: `${artists[4]} ${artists[5]} popular songs radio`,
      thumbnail: pickArt(artOf(artists[4]), artOf(artists[5]))
    })
  }

  if (artists.length >= 8) {
    push({
      id: `dyn_artists_4_${artists[6]}_${artists[7]}`,
      title: `${artists[6]} & ${artists[7]}`,
      subtitle: `${vibes[3] || 'On Repeat'} • Heavy Rotation`,
      query: `${artists[6]} ${artists[7]} top tracks playlist`,
      thumbnail: pickArt(artOf(artists[6]), artOf(artists[7]))
    })
  }

  for (const chart of charts.slice(0, 2)) {
    dynamic.push(chart)
  }

  return dynamic.length >= 3 ? dynamic : charts
}

function cleanMusicalRationale(text) {
  if (!text) return 'Selected for its harmonic and rhythmic alignment.'
  let s = text.split(/(?<=[.!?])\s+/)[0] || text
  s = s
    .replace(/,?\s*appealing to the user'?s? (broader )?(interest|taste|history|appreciation)[^.]*/i, '')
    .replace(/,?\s*(which )?(aligns|fitting|matching|connecting|echoing) (with )?the user'?s? [^.]*/i, '')
    .replace(/^This (iconic |classic )?track /i, '')
  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1)
    if (!/[.!?]$/.test(s)) s += '.'
  }
  return s
}

function extraDetail(track) {
  if (track.detail) return track.detail
  if (!track.reason) return ''
  const parts = track.reason.split(/(?<=[.!?])\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : ''
}

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
  tasteDna = null
}) {
  const [viewMode, setViewMode] = useState('grid') // 'grid' (YouTube Music Quick picks) vs 'table'
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [showModelDetails, setShowModelDetails] = useState(false)
  const [downloadingVid, setDownloadingVid] = useState(null)
  const [downloadedVid, setDownloadedVid] = useState(null)
  const [downloadedSet, setDownloadedSet] = useState(new Set())
  const [activeMenuIdx, setActiveMenuIdx] = useState(null)
  const [chartStations, setChartStations] = useState(DEFAULT_YT_CHARTS_STATIONS)
  const gridScrollRef = useRef(null)
  const stationScrollRef = useRef(null)

  useEffect(() => {
    let active = true
    fetchOfficialYoutubeCharts().then((charts) => {
      if (active && Array.isArray(charts) && charts.length > 0) {
        setChartStations(charts)
      }
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Aggregate user's real curated/personal tracks (excluding default seed placeholders)
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

  const dynamicStations = useMemo(
    () => buildDynamicStations(userPersonalTracks, tasteDna, chartStations),
    [userPersonalTracks, tasteDna, chartStations]
  )

  const handleSelectStation = (station) => {
    if (!station) return
    if (station.browse_id && onSelectMatchedPlaylist) {
      onSelectMatchedPlaylist(station)
      return
    }
    if (onSelectStarter && station.query) {
      onSelectStarter(station.query)
    }
  }

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

  const handleDownloadTrack = async (track, e) => {
    if (e) e.stopPropagation()
    if (!track) return
    const vid = track.video_id
    if (!vid) return

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

  const scrollGrid = (direction) => {
    if (gridScrollRef.current) {
      const scrollAmount = gridScrollRef.current.clientWidth * 0.8
      gridScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  const scrollStations = (direction) => {
    if (stationScrollRef.current) {
      const scrollAmount = stationScrollRef.current.clientWidth * 0.75
      stationScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  // Loading Skeleton State
  if (isGenerating || isSearching) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center select-none bg-transparent min-h-[400px]">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-4 shadow-xl">
          <Loader2 className={`w-6 h-6 animate-spin ${isSearching ? 'text-rose-400' : 'text-purple-400'}`} />
        </div>
        <p className="text-base font-semibold text-white tracking-tight">
          {isSearching ? 'Searching tracks & videos...' : 'Curating Sonic Profile & Stream Resolution...'}
        </p>
        <p className="text-xs font-medium text-zinc-400 mt-1.5">
          {isSearching ? 'Resolving highest audio quality' : `Model: ${selectedModel}`}
        </p>
      </div>
    )
  }

  // Empty State / Starter Station Grid
  if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col p-4 sm:p-8 select-none bg-transparent">
        {/* Quick picks Header for Starter Recommendations */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-rose-600/20">
              {googleUser?.name ? googleUser.name[0].toUpperCase() : 'U'}
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Quick picks</h2>
              <p className="text-xs text-zinc-400">Start radio from any vibe or genre below</p>
            </div>
          </div>
        </div>

        {/* Curated Stations Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {dynamicStations.map((station) => (
            <div
              key={station.id}
              onClick={() => handleSelectStation(station)}
              className="group relative h-44 rounded-3xl overflow-hidden cursor-pointer border border-white/10 hover:border-white/30 transition-all shadow-xl hover:shadow-2xl hover:scale-[1.01]"
            >
              <img
                src={station.thumbnail}
                alt=""
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-60"
              />
              <div className={`absolute inset-0 bg-gradient-to-t ${station.color} via-black/40`} />
              
              <div className="absolute inset-0 p-5 flex flex-col justify-between">
                <span className="text-[11px] font-bold tracking-tight text-white px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 w-fit">
                  Radio Station
                </span>
                
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-white group-hover:text-rose-200 transition-colors tracking-tight truncate">
                      {station.title}
                    </h3>
                    <p className="text-xs text-zinc-300 mt-1 font-medium truncate">{station.subtitle}</p>
                  </div>

                  <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center opacity-90 group-hover:opacity-100 group-hover:scale-110 transition-all shadow-lg shadow-black/40 shrink-0 ml-2">
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {needsSetup && onOpenSettings && (
          <div className="p-5 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-4 max-w-xl backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white tracking-tight">Gemini AI Key Setup</p>
                <p className="text-xs text-zinc-400 mt-0.5">Configure your Gemini API key for custom prompt curation.</p>
              </div>
            </div>
            <button
              onClick={onOpenSettings}
              className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold shrink-0 cursor-pointer shadow-md transition-all active:scale-95"
            >
              Configure
            </button>
          </div>
        )}
      </div>
    )
  }

  const tracks = playlist.tracks || []
  const isDirectSearch = Boolean(playlist.is_direct_search)
  const matchedPlaylists = playlist.matched_playlists || []
  const youtubeResults = playlist.youtube_results || []
  const songResults = playlist.song_results || []
  const activeSource = playlist.active_source || (youtubeResults.length > 0 ? 'youtube' : 'songs')
  const activeBrowseId = playlist.active_browse_id || ''

  return (
    <div
      className="w-full flex flex-col bg-transparent pb-28 sm:pb-24 select-none"
      onClick={() => setActiveMenuIdx(null)}
    >
      {/* 1. Header: YouTube Music "Quick picks" with Carousel Controls */}
      <div className="px-3.5 sm:px-6 pt-4 pb-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {/* User Profile Avatar / Circular Icon */}
            {googleUser?.picture ? (
              <img
                src={googleUser.picture}
                alt=""
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover border border-white/20 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-rose-500 via-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs sm:text-sm font-bold shadow-md shadow-rose-600/20 shrink-0">
                {(googleUser?.name || 'A')[0].toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight truncate">
                Quick picks
              </h1>
              <p className="text-xs text-zinc-400 truncate max-w-lg">
                {playlist.playlist_title || playlist.subtitle || 'Selected based on your listening taste'}
              </p>
            </div>
          </div>

          {/* Right Header Controls: Carousel Arrows & Layout Toggle & Play All */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Play All Button */}
            <button
              onClick={() => onPlayTrack(tracks[0], 0)}
              className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors cursor-pointer shadow-sm active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
              <span>Play All</span>
            </button>

            {/* Layout Mode Toggle (Grid vs Table) */}
            <div className="hidden md:flex items-center bg-white/[0.06] border border-white/[0.08] rounded-full p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-white/20 text-white' : 'text-zinc-400 hover:text-white'
                }`}
                title="Quick picks 4-Row Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'table' ? 'bg-white/20 text-white' : 'text-zinc-400 hover:text-white'
                }`}
                title="Detailed Table View"
              >
                <Table className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Carousel Navigation Arrows (< >) Matching Screenshot */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollGrid('left')}
                className="w-8 h-8 rounded-full border border-white/20 hover:border-white/50 hover:bg-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer"
                title="Previous picks"
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scrollGrid('right')}
                className="w-8 h-8 rounded-full border border-white/20 hover:border-white/50 hover:bg-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer"
                title="Next picks"
                aria-label="Scroll right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Direct Search Subtabs: YouTube, Songs, Playlists */}
        {isDirectSearch && (youtubeResults.length > 0 || songResults.length > 0 || matchedPlaylists.length > 0) && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
            {youtubeResults.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectYoutubeResults && onSelectYoutubeResults()}
                className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                  activeSource === 'youtube'
                    ? 'bg-rose-500/20 border-rose-500/60 text-rose-300 font-semibold'
                    : 'bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white'
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
                className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                  activeSource === 'songs'
                    ? 'bg-purple-500/20 border-purple-500/60 text-purple-300 font-semibold'
                    : 'bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white'
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
                  className={`px-3 py-1 rounded-full text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border ${
                    isActivePl
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-semibold'
                      : 'bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white'
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
      {viewMode === 'grid' ? (
        <div
          ref={gridScrollRef}
          className="px-3.5 sm:px-6 py-2 overflow-x-auto no-scrollbar scroll-smooth"
        >
          <div className="grid grid-rows-4 grid-flow-col gap-x-5 sm:gap-x-7 gap-y-2.5 w-max">
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
                  className={`group flex items-center justify-between gap-3 p-2 pr-3.5 rounded-2xl transition-all cursor-pointer w-[310px] sm:w-[360px] lg:w-[390px] border ${
                    isSelected
                      ? 'bg-white/[0.12] border-rose-500/40 shadow-lg shadow-rose-950/30 scale-[1.01]'
                      : 'bg-white/[0.035] hover:bg-white/[0.08] border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  {/* Left: Artwork with Hover Play Triangle Overlay */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/10 overflow-hidden shrink-0 relative shadow-sm">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500">
                          <Music className="w-5 h-5" />
                        </div>
                      )}

                      {/* Overlaid Play/Pause Status */}
                      <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
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

                    {/* Middle: Title & Artist / Details */}
                    <div className="min-w-0">
                      <div className={`text-sm font-bold tracking-tight truncate transition-colors ${
                        isSelected ? 'text-rose-300' : 'text-white group-hover:text-rose-300'
                      }`}>
                        {track.title}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium truncate mt-0.5">
                        <span className="truncate">{track.artist}</span>
                        {track.duration_text && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-xs font-semibold text-zinc-400 shrink-0">{track.duration_text}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Hover Actions (Like, Add to Queue, Download, More) */}
                  <div
                    className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Like / Heart */}
                    <button
                      onClick={() => onToggleFavorite && onToggleFavorite(track)}
                      title={isFav ? 'Remove from Liked' : 'Add to Liked'}
                      className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                    </button>

                    {/* Add to Queue */}
                    {onAddToQueue && (
                      <button
                        onClick={() => onAddToQueue(track)}
                        title="Add to Playback Queue"
                        className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                    )}

                    {/* Download Offline */}
                    <button
                      onClick={(e) => handleDownloadTrack(track, e)}
                      title={isDownloaded ? 'Downloaded Offline' : 'Save Track Offline'}
                      disabled={isDownloading}
                      className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      ) : isDownloaded || downloadedVid === track.video_id ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>

                    {/* 3-dots more menu */}
                    <div className="relative">
                      <button
                        onClick={() => setActiveMenuIdx(activeMenuIdx === idx ? null : idx)}
                        className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeMenuIdx === idx && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-8 z-30 w-44 bg-[#141418] border border-white/10 rounded-xl p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in duration-100"
                        >
                          {onPlayNext && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onPlayNext(track)
                                setActiveMenuIdx(null)
                              }}
                              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10 hover:text-white flex items-center gap-2 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Play next</span>
                            </button>
                          )}
                          {track.url && (
                            <a
                              href={track.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setActiveMenuIdx(null)}
                              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10 hover:text-white flex items-center gap-2 cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Open on YouTube</span>
                            </a>
                          )}
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
        /* 3. Detailed Table View (For inspecting AI musical connections) */
        <div className="px-3.5 sm:px-6 py-2 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-xs font-semibold text-zinc-400">
                <th className="py-2.5 px-3 w-10">#</th>
                <th className="py-2.5 px-3">Title & Artist</th>
                <th className="py-2.5 px-3 hidden md:table-cell">Musical Connection</th>
                <th className="py-2.5 px-3 w-20 text-right">Duration</th>
                <th className="py-2.5 px-3 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tracks.map((track, idx) => {
                const isSelected = currentTrack && (
                  (currentTrack.video_id && currentTrack.video_id === track.video_id) ||
                  (currentTrack.title === track.title && currentTrack.artist === track.artist)
                )
                const isThisPlaying = isSelected && isPlaying
                const thumbUrl = track.thumbnail || (track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg` : '')
                const isFav = isTrackFavorite ? isTrackFavorite(track) : false

                return (
                  <tr
                    key={idx}
                    onClick={() => onPlayTrack(track, idx)}
                    className={`group transition-colors cursor-pointer ${
                      isSelected ? 'bg-white/[0.1] text-rose-300' : 'hover:bg-white/[0.06] text-zinc-300'
                    }`}
                  >
                    <td className="py-3 px-3 text-xs font-semibold text-zinc-500">
                      {isThisPlaying ? (
                        <Volume2 className="w-4 h-4 text-rose-400 animate-pulse" />
                      ) : (
                        <span>{(idx + 1).toString().padStart(2, '0')}</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-3">
                        <img src={thumbUrl} alt="" className="w-10 h-10 rounded-2xl object-cover bg-zinc-900 border border-white/10" />
                        <div>
                          <p className="font-bold text-white tracking-tight">{track.title}</p>
                          <p className="text-zinc-400 text-[11px] font-normal">{track.artist}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 hidden md:table-cell text-zinc-400 text-xs font-normal">
                      {cleanMusicalRationale(track.reason)}
                    </td>
                    <td className="py-3 px-3 text-xs font-semibold text-right text-zinc-400">
                      {track.duration_text || '--:--'}
                    </td>
                    <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onToggleFavorite && onToggleFavorite(track)}
                          className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
                        >
                          <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                        </button>
                        <button
                          onClick={(e) => handleDownloadTrack(track, e)}
                          className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. "Listen together" / Curated Stations Carousel (Matches Screenshot Second Section!) */}
      <div className="px-3.5 sm:px-6 pt-8 pb-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold block mb-0.5">
              STATION
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Listen together
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => scrollStations('left')}
              className="w-8 h-8 rounded-full border border-white/20 hover:border-white/50 hover:bg-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer"
              title="Previous stations"
              aria-label="Scroll stations left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scrollStations('right')}
              className="w-8 h-8 rounded-full border border-white/20 hover:border-white/50 hover:bg-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition-all cursor-pointer"
              title="Next stations"
              aria-label="Scroll stations right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          ref={stationScrollRef}
          className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 scroll-smooth"
        >
          {dynamicStations.map((station) => (
            <div
              key={station.id}
              onClick={() => handleSelectStation(station)}
              className="group relative w-64 sm:w-72 h-44 rounded-2xl overflow-hidden cursor-pointer shrink-0 border border-white/[0.08] hover:border-white/30 transition-all shadow-xl"
            >
              <img
                src={station.thumbnail}
                alt=""
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-60"
              />
              <div className={`absolute inset-0 bg-gradient-to-t ${station.color} via-black/40`} />
              
              <div className="absolute inset-0 p-4 flex flex-col justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/90 font-bold px-2 py-0.5 rounded-full bg-white/20 border border-white/20 w-fit backdrop-blur-xs">
                  Station
                </span>
                
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white group-hover:text-rose-300 transition-colors truncate">
                      {station.title}
                    </h3>
                    <p className="text-[11px] text-zinc-300 mt-0.5 truncate">{station.subtitle}</p>
                  </div>

                  <div className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:scale-105 transition-all shadow-md shadow-white/30 shrink-0 ml-2">
                    <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
