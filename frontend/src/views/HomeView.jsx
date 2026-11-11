import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Play, Users, RefreshCw, Sparkles, Shuffle, Search, Music, Disc, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import { navigate } from '../ui/router'
import { Art, Avatar, Chip, ChipRow, IconButton, LikedTile, SectionHeader, Collage, Spinner, artUrl, TrackRow } from '../ui/primitives'
import { MediaCard } from '../ui/AppContext'
import { getInitialDiscoveryBlocks, fetchListenTogetherFeed, advanceRotationCursor, directSearchStandalone, isValidMusicTrack, THIRTY_MINUTES_MS } from '../standaloneApi'

export const MOODS = [
  { id: 'chill', label: 'Chill', query: 'Chill relaxing mellow acoustic songs playlist', color: 'from-teal-600/40 to-black' },
  { id: 'focus', label: 'Focus', query: 'Deep focus instrumental beats study playlist', color: 'from-indigo-600/40 to-black' },
  { id: 'workout', label: 'Workout', query: 'High energy workout motivation songs gym playlist', color: 'from-rose-600/40 to-black' },
  { id: 'party', label: 'Party', query: 'Party dance hits club pop playlist', color: 'from-amber-600/40 to-black' },
  { id: 'romance', label: 'Romance', query: 'Romantic love songs acoustic indie playlist', color: 'from-pink-600/40 to-black' },
  { id: 'feelgood', label: 'Feel good', query: 'Happy feel good upbeat songs playlist', color: 'from-yellow-600/40 to-black' },
  { id: 'sad', label: 'Sad', query: 'Sad emotional acoustic heartbreak songs playlist', color: 'from-blue-600/40 to-black' },
  { id: 'sleep', label: 'Sleep', query: 'Calm ambient sleep music peaceful piano playlist', color: 'from-slate-700/40 to-black' },
  { id: 'hindi', label: 'Hindi', query: 'Latest Hindi Bollywood indie hits playlist', color: 'from-orange-600/40 to-black' },
  { id: 'lofi', label: 'Lo-fi', query: 'Lofi hip hop chill study beats playlist', color: 'from-purple-600/40 to-black' }
]

export default function HomeView({
  isDesktop,
  user,
  userTracks,
  tasteDna,
  timeInfo,
  recents = [],
  friends = [],
  incomingCount = 0,
  jamActive = false,
  currentTrack = null,
  isPlaying = false,
  onOpenProfile,
  onOpenFriends,
  onOpenSettings,
  onOpenRecent,
  onOpenBlock,
  onPlayBlock,
  onMood,
  onPlayTrack,
  onListenAlong
}) {
  const [activeMood, setActiveMood] = useState('for_you')
  const [blocks, setBlocks] = useState(() => getInitialDiscoveryBlocks())
  const [refreshing, setRefreshing] = useState(false)
  const pinnedCoversRef = useRef({})

  // Mood-specific live data state
  const [moodData, setMoodData] = useState({})
  const [moodLoading, setMoodLoading] = useState(false)
  const autoRefreshTimerRef = useRef(null)

  // Load / update personalized discovery blocks strictly ONCE ON MOUNT
  useEffect(() => {
    let alive = true
    fetchListenTogetherFeed({ userTracks, tasteDna })
      .then((b) => alive && Array.isArray(b) && b.length && setBlocks(b))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // "For you" live refresh / rotation function
  const refreshForYou = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    pinnedCoversRef.current = {}
    try {
      const fresh = await fetchListenTogetherFeed({
        userTracks,
        tasteDna,
        forceRefresh: true,
        rotationIndex: advanceRotationCursor(1)
      })
      if (Array.isArray(fresh) && fresh.length) setBlocks(fresh)
    } catch {} finally {
      if (manual) setRefreshing(false)
    }
  }, [userTracks, tasteDna])

  // Fetch or refresh data for an active mood
  const refreshMood = useCallback(async (moodId, force = false) => {
    const moodObj = MOODS.find((m) => m.id === moodId)
    if (!moodObj) return

    if (!force && moodData[moodId]?.tracks?.length > 0) return

    setMoodLoading(true)
    try {
      const [songRes, plRes] = await Promise.all([
        directSearchStandalone(moodObj.query, 'songs').catch(() => null),
        directSearchStandalone(moodObj.query, 'playlists').catch(() => null)
      ])

      const cleanTracks = (songRes?.tracks || songRes?.song_results || [])
        .filter(isValidMusicTrack)
        .sort(() => Math.random() - 0.5)

      const cleanPlaylists = (plRes?.playlists || plRes?.tracks || [])

      setMoodData((prev) => ({
        ...prev,
        [moodId]: {
          tracks: cleanTracks,
          playlists: cleanPlaylists,
          fetchedAt: Date.now()
        }
      }))
    } catch {} finally {
      setMoodLoading(false)
    }
  }, [moodData])

  // Automatically refresh and update the active section on a 30-minute interval
  useEffect(() => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current)

    autoRefreshTimerRef.current = setInterval(() => {
      if (activeMood === 'for_you') {
        refreshForYou(false)
      } else {
        refreshMood(activeMood, true)
      }
    }, THIRTY_MINUTES_MS)

    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current)
    }
  }, [activeMood, refreshForYou, refreshMood])

  // Handle mood selection
  const handleSelectMood = (moodId) => {
    if (moodId === activeMood) {
      // Tapping already active chip rotates/refreshes immediately!
      if (moodId === 'for_you') refreshForYou(true)
      else refreshMood(moodId, true)
      return
    }
    setActiveMood(moodId)
    if (moodId !== 'for_you') {
      refreshMood(moodId, false)
    }
  }

  const charts = useMemo(() => blocks.filter((b) => b.tier === 1), [blocks])
  const personal = useMemo(() => blocks.filter((b) => b.tier === 2), [blocks])
  const featured = personal[0]
  const moreForYou = personal // Render all 7 structured Made for you playlists in the slider
  const listening = friends.filter((f) => f.online && f.currentTrack)
  const onlineCount = friends.filter((f) => f.online).length

  // Resolve and permanently pin high-res cover thumbnails to prevent 15-second flicker
  const blockThumbMap = useMemo(() => {
    const used = new Set()
    const out = {}
    const all = [featured, ...moreForYou, ...charts].filter(Boolean)
    all.forEach((b, idx) => {
      if (pinnedCoversRef.current[b.id]) {
        out[b.id] = pinnedCoversRef.current[b.id]
        used.add(pinnedCoversRef.current[b.id])
        return
      }

      const pool = []
      const addUrl = (u) => {
        const hi = artUrl(u, true)
        if (hi && !pool.includes(hi)) pool.push(hi)
      }
      for (const u of b.thumbnailPool || []) addUrl(u)
      for (const t of b.preloadedTracks || []) addUrl(t)
      if (b.thumbnail) addUrl(b.thumbnail)

      let chosen = ''
      if (pool.length > 0) {
        for (let i = 0; i < pool.length; i++) {
          const cand = pool[(idx + i) % pool.length]
          if (!used.has(cand)) {
            chosen = cand
            break
          }
        }
        if (!chosen) chosen = pool[0]
      } else {
        chosen = artUrl({ thumbnail: b.thumbnail }, true)
      }
      if (chosen) {
        used.add(chosen)
        pinnedCoversRef.current[b.id] = chosen
      }
      out[b.id] = chosen
    })
    return out
  }, [featured, moreForYou, charts])

  const activeMoodObj = MOODS.find((m) => m.id === activeMood)
  const activeMoodContent = activeMood !== 'for_you' ? moodData[activeMood] : null

  return (
    <div className="px-5 lg:px-8 pb-10 max-w-[1400px] mx-auto w-full">
      {!isDesktop && (
        <div className="flex items-center justify-between h-14 mt-1">
          <button type="button" onClick={onOpenProfile} aria-label="Your profile" className="cursor-pointer rounded-full">
            <Avatar name={user?.name || 'You'} picture={user?.picture} size={40} />
          </button>
          <div className="flex items-center gap-2">
            <IconButton label={onlineCount ? `Friends, ${onlineCount} online` : 'Friends'} variant="filled" onClick={onOpenFriends} className="relative">
              <Users className="w-5 h-5" />
              {(onlineCount > 0 || jamActive || incomingCount > 0) && (
                <span className={`absolute right-2 bottom-2 w-2.5 h-2.5 rounded-full ring-2 ring-[#1C1C1F] ${jamActive || onlineCount > 0 ? 'bg-live' : 'bg-accent'}`} />
              )}
            </IconButton>
            <IconButton label="Settings" variant="filled" onClick={onOpenSettings || (() => navigate('/settings'))}>
              <Settings className="w-5 h-5" />
            </IconButton>
          </div>
        </div>
      )}

      {/* Dynamic Filter Chips with Auto-Refresh */}
      <ChipRow className={isDesktop ? 'mt-2' : 'mt-3'}>
        <Chip active={activeMood === 'for_you'} onClick={() => handleSelectMood('for_you')}>
          For you
        </Chip>
        {MOODS.map((m) => (
          <Chip key={m.id} active={activeMood === m.id} onClick={() => handleSelectMood(m.id)}>
            {m.label}
          </Chip>
        ))}
      </ChipRow>

      {/* =====================================================================
          VIEW A: FOR YOU (Personalized Mixes, Recents, Friends & Top Charts)
          ===================================================================== */}
      {activeMood === 'for_you' ? (
        <>
          {featured && (
            <FeaturedCard
              block={featured}
              thumbSrc={blockThumbMap[featured.id]}
              isDesktop={isDesktop}
              onOpen={() => onOpenBlock(featured)}
              onPlay={() => onPlayBlock(featured, false)}
              onShuffle={() => onPlayBlock(featured, true)}
            />
          )}

          {recents.length > 0 && (
            <>
              <SectionHeader title="Jump back in" />
              <div className={`grid gap-2 ${isDesktop ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
                {recents.slice(0, isDesktop ? 8 : 6).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onOpenRecent(item)}
                    className="flex items-center gap-2.5 h-14 lg:h-16 bg-s1 hover:bg-s2 rounded-xl overflow-hidden text-left pr-2.5 cursor-pointer transition-colors"
                  >
                    {item.kind === 'liked' ? (
                      <LikedTile className="!rounded-none h-full aspect-square" />
                    ) : item.tracks?.length >= 4 ? (
                      <Collage tracks={item.tracks} className="!rounded-none h-full aspect-square" />
                    ) : (
                      <Art track={item.track} src={item.cover} className="!rounded-none h-full aspect-square" />
                    )}
                    <span className="text-sm font-bold truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {listening.length > 0 && (
            <>
              <SectionHeader title="Friends listening" action="See all" onAction={onOpenFriends} />
              <div className={`grid gap-2 ${isDesktop ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {listening.slice(0, 4).map((f) => (
                  <div key={f.friendCode} className="flex items-center gap-3 p-3 rounded-2xl bg-s1">
                    <Avatar name={f.name} picture={f.picture} size={44} live />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold truncate">{f.name}</div>
                      <div className="text-[13px] text-t2 truncate">
                        {f.currentTrack.title}
                        {f.currentTrack.artist ? ` · ${f.currentTrack.artist}` : ''}
                      </div>
                    </div>
                    <Chip variant="ghost" onClick={() => onListenAlong(f)}>
                      Listen along
                    </Chip>
                  </div>
                ))}
              </div>
            </>
          )}

          {moreForYou.length > 0 && (
            <PlaylistSlider
              title="Made for you"
              action={
                <>
                  {refreshing ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>New picks</span>
                </>
              }
              onAction={() => refreshForYou(true)}
              actionDisabled={refreshing}
            >
              {moreForYou.map((b) => (
                <MediaCard
                  key={b.id}
                  title={b.title}
                  subtitle={b.subtitle}
                  label={b.badge}
                  src={blockThumbMap[b.id] || artUrl({ thumbnail: b.thumbnail }, true)}
                  onOpen={() => onOpenBlock(b)}
                  onPlay={() => onPlayBlock(b, false)}
                />
              ))}
            </PlaylistSlider>
          )}

          {charts.length > 0 && (
            <PlaylistSlider title="Daily Top Charts">
              {charts.map((b) => (
                <MediaCard
                  key={b.id}
                  title={b.title}
                  subtitle={b.subtitle}
                  label={chartLabel(b)}
                  src={blockThumbMap[b.id] || artUrl({ thumbnail: b.thumbnail }, true)}
                  onOpen={() => onOpenBlock(b)}
                  onPlay={() => onPlayBlock(b, false)}
                />
              ))}
            </PlaylistSlider>
          )}
        </>
      ) : (
        /* =====================================================================
           VIEW B: DYNAMIC MOOD FEED (Chill, Focus, Workout, Party, etc.)
           Constantly updated & refreshed on demand or automatically
           ===================================================================== */
        <div className="pt-2 animate-in fade-in duration-300">
          {/* Mood Hero Banner */}
          <div
            className={`relative overflow-hidden rounded-3xl bg-gradient-to-r ${activeMoodObj?.color || 'from-teal-600/40 to-black'} p-6 sm:p-8 mt-5 border border-white/10`}
          >
            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold tracking-[0.1em] uppercase text-white/60 inline-flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  Live Mood Stream
                </span>
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">{activeMoodObj?.label} Flow</h1>
                <p className="text-sm sm:text-base text-white/75 mt-1 max-w-lg">
                  {activeMoodContent?.tracks?.length
                    ? `${activeMoodContent.tracks.length} fresh handpicked songs & playlists constantly updated`
                    : 'Curating dynamic soundscapes in real time…'}
                </p>
              </div>

              <div className="flex items-center gap-2 mt-2 sm:mt-0">
                <button
                  type="button"
                  onClick={() => {
                    const block = {
                      id: `mood_${activeMood}`,
                      title: `${activeMoodObj.label} Mix`,
                      subtitle: `${activeMoodObj.label} Flow`,
                      query: activeMoodObj.query,
                      preloadedTracks: activeMoodContent?.tracks || []
                    }
                    onPlayBlock(block, false)
                  }}
                  disabled={!activeMoodContent?.tracks?.length}
                  className="h-12 px-6 rounded-full bg-white text-[#0A0A0B] text-sm font-extrabold inline-flex items-center gap-2 shadow-lg hover:scale-105 transition-transform cursor-pointer disabled:opacity-40"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  Play mix
                </button>

                <IconButton
                  label="Shuffle mood"
                  variant="filled"
                  size={48}
                  disabled={!activeMoodContent?.tracks?.length}
                  onClick={() => {
                    const block = {
                      id: `mood_${activeMood}`,
                      title: `${activeMoodObj.label} Mix`,
                      subtitle: `${activeMoodObj.label} Flow`,
                      query: activeMoodObj.query,
                      preloadedTracks: activeMoodContent?.tracks || []
                    }
                    onPlayBlock(block, true)
                  }}
                >
                  <Shuffle className="w-5 h-5" />
                </IconButton>

                <button
                  type="button"
                  onClick={() => refreshMood(activeMood, true)}
                  disabled={moodLoading}
                  className="h-12 px-4 rounded-full bg-white/10 hover:bg-white/15 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {moodLoading ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  <span>New picks</span>
                </button>
              </div>
            </div>
          </div>

          {/* Mood Songs Section */}
          <div className="mt-8">
            <div className="flex items-baseline justify-between mb-3.5">
              <h2 className="text-xl font-extrabold tracking-[-0.015em] flex items-center gap-2">
                <Music className="w-5 h-5 text-accent" />
                <span>Popular in {activeMoodObj?.label}</span>
              </h2>
              <button
                type="button"
                onClick={() => onMood?.(activeMoodObj)}
                className="text-sm font-semibold text-t2 hover:text-t1 cursor-pointer"
              >
                Open collection →
              </button>
            </div>

            {moodLoading && !activeMoodContent?.tracks?.length ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-t2">
                <Spinner className="w-6 h-6" />
                <span className="text-sm font-semibold">Updating {activeMoodObj?.label} selection…</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {(activeMoodContent?.tracks || []).slice(0, 10).map((t, idx) => (
                  <TrackRow
                    key={t.video_id || `${t.title}-${idx}`}
                    track={t}
                    index={idx}
                    isCurrent={currentTrack?.video_id === t.video_id}
                    isPlaying={isPlaying && currentTrack?.video_id === t.video_id}
                    onPlay={() => onPlayTrack?.(t, activeMoodContent.tracks)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Curated Mood Playlists */}
          {activeMoodContent?.playlists?.length > 0 && (
            <div className="mt-8">
              <SectionHeader title={`${activeMoodObj?.label} Playlists & Radios`} />
              <CardRow isDesktop={isDesktop}>
                {activeMoodContent.playlists.slice(0, 6).map((pl, idx) => (
                  <MediaCard
                    key={pl.browse_id || pl.video_id || idx}
                    title={pl.title}
                    subtitle={pl.subtitle || `${activeMoodObj?.label} Playlist`}
                    src={artUrl({ thumbnail: pl.thumbnail })}
                    onOpen={() => onMood?.({ ...activeMoodObj, query: `${pl.title} playlist` })}
                    onPlay={() => {
                      const block = {
                        id: `pl_${pl.browse_id || idx}`,
                        title: pl.title,
                        subtitle: pl.subtitle,
                        query: `${pl.title} playlist`,
                        thumbnail: pl.thumbnail
                      }
                      onPlayBlock(block, false)
                    }}
                  />
                ))}
              </CardRow>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function chartLabel(block) {
  const t = `${block.badge || ''} ${block.title || ''}`.toLowerCase()
  if (t.includes('india') && t.includes('trend')) return 'Viral'
  if (t.includes('india')) return 'India'
  if (t.includes('japan')) return 'Japan'
  if (t.includes('us ') || t.includes('billboard') || t.includes('united states')) return 'US'
  if (t.includes('uk ') || t.includes('british')) return 'UK'
  if (t.includes('kpop') || t.includes('k-pop')) return 'K-Pop'
  if (t.includes('latin')) return 'Latin'
  if (t.includes('viral')) return 'Viral'
  if (t.includes('global') || t.includes('international') || t.includes('worldwide')) return 'Global'
  return block.badge || 'Chart'
}

function PlaylistSlider({ title, action, onAction, actionDisabled, children }) {
  const sliderRef = useRef(null)
  const scrollLeft = () => {
    if (sliderRef.current) sliderRef.current.scrollBy({ left: -440, behavior: 'smooth' })
  }
  const scrollRight = () => {
    if (sliderRef.current) sliderRef.current.scrollBy({ left: 440, behavior: 'smooth' })
  }

  return (
    <div className="mt-8 mb-3">
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="text-xl font-extrabold tracking-[-0.015em]">{title}</h2>
        <div className="flex items-center gap-2">
          {action && (
            <button
              type="button"
              onClick={onAction}
              disabled={actionDisabled}
              className="text-sm font-semibold text-t2 hover:text-t1 inline-flex items-center gap-1.5 cursor-pointer mr-2 disabled:opacity-40"
            >
              {action}
            </button>
          )}
          {/* Subtle translucent glass < and > scroll arrow buttons for Desktop */}
          <button
            type="button"
            onClick={scrollLeft}
            aria-label="Scroll left"
            className="hidden sm:inline-flex w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-t1 items-center justify-center transition-all cursor-pointer backdrop-blur-md border border-white/[0.08]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={scrollRight}
            aria-label="Scroll right"
            className="hidden sm:inline-flex w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-t1 items-center justify-center transition-all cursor-pointer backdrop-blur-md border border-white/[0.08]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={sliderRef} className="playlist-slider-track">
        {React.Children.map(children, (child) => (
          <div className="playlist-slider-item">
            {child}
          </div>
        ))}
      </div>
    </div>
  )
}

function CardRow({ isDesktop, children }) {
  if (isDesktop) {
    return <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-5">{children}</div>
  }
  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-5 px-5 snap-x snap-mandatory">
      {React.Children.map(children, (child) => (
        <div className="w-[42vw] max-w-[180px] shrink-0 snap-start">{child}</div>
      ))}
      <span className="w-1 shrink-0" aria-hidden="true" />
    </div>
  )
}

function FeaturedCard({ block, thumbSrc, isDesktop, onOpen, onPlay, onShuffle }) {
  const img = thumbSrc || artUrl({ thumbnail: block.thumbnail }, true)
  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-s1 mt-5 cursor-pointer ${isDesktop ? 'h-[248px]' : 'h-[208px]'}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={`Open ${block.title}`}
    >
      <Art src={img} hi className="!rounded-none ! absolute inset-[-60px] w-[calc(100%+120px)] h-[calc(100%+120px)] max-w-none blur-[36px] saturate-[1.2] brightness-[0.8]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgba(10,10,11,0.92)] via-[rgba(10,10,11,0.6)] to-[rgba(10,10,11,0.25)]" />
      <Art
        src={img}
        hi
        className={`!absolute !rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.5)] ${isDesktop ? 'right-8 top-7 w-48 h-48' : 'right-5 top-6 w-[116px] h-[116px]'}`}
      />
      <div className={`absolute inset-0 flex flex-col ${isDesktop ? 'p-7 pr-64' : 'p-5 pr-[150px]'}`}>
        <span className="text-xs font-bold tracking-[0.1em] uppercase text-t2 inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          Made for you
        </span>
        <h3 className={`font-extrabold tracking-[-0.02em] mt-2 mb-1 leading-tight line-clamp-2 ${isDesktop ? 'text-4xl' : 'text-2xl'}`}>{block.title}</h3>
        <p className={`text-white/75 leading-snug line-clamp-2 ${isDesktop ? 'text-[15px] max-w-sm' : 'text-sm'}`}>{block.subtitle}</p>
        <div className="mt-auto flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
            aria-label={`Play ${block.title}`}
            className="w-[52px] h-[52px] rounded-full bg-white text-[#0A0A0B] flex items-center justify-center mr-1.5 cursor-pointer hover:scale-105 transition-transform"
          >
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </button>
          <IconButton
            label="Shuffle play"
            onClick={(e) => {
              e.stopPropagation()
              onShuffle()
            }}
          >
            <Shuffle className="w-5 h-5" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
