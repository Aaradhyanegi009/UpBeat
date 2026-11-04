import React, { useEffect, useMemo, useState } from 'react'
import { Play, Users, RefreshCw, Sparkles, Shuffle } from 'lucide-react'
import { Art, Avatar, Chip, ChipRow, IconButton, LikedTile, SectionHeader, Collage, Spinner, artUrl } from '../ui/primitives'
import { MediaCard } from '../ui/AppContext'
import { getInitialDiscoveryBlocks, fetchListenTogetherFeed, advanceRotationCursor } from '../standaloneApi'

export const MOODS = [
  { id: 'chill', label: 'Chill', query: 'Chill relaxing mellow songs playlist' },
  { id: 'focus', label: 'Focus', query: 'Deep focus instrumental beats playlist' },
  { id: 'workout', label: 'Workout', query: 'High energy workout motivation songs playlist' },
  { id: 'party', label: 'Party', query: 'Party dance hits playlist' },
  { id: 'romance', label: 'Romance', query: 'Romantic love songs playlist' },
  { id: 'feelgood', label: 'Feel good', query: 'Happy feel good songs playlist' },
  { id: 'sad', label: 'Sad', query: 'Sad emotional songs playlist' },
  { id: 'sleep', label: 'Sleep', query: 'Calm sleep music playlist' },
  { id: 'hindi', label: 'Hindi', query: 'Latest Hindi hits playlist' },
  { id: 'lofi', label: 'Lo-fi', query: 'Lofi hip hop chill beats playlist' }
]

export default function HomeView({
  isDesktop,
  user,
  userTracks,
  tasteDna,
  timeInfo,
  recents = [],
  friends = [],
  onOpenProfile,
  onOpenFriends,
  onOpenRecent,
  onOpenBlock,
  onPlayBlock,
  onMood,
  onListenAlong
}) {
  const [blocks, setBlocks] = useState(() => getInitialDiscoveryBlocks())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let alive = true
    fetchListenTogetherFeed({ userTracks, tasteDna, timeInfo })
      .then((b) => alive && Array.isArray(b) && b.length && setBlocks(b))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userTracks, tasteDna, timeInfo])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const fresh = await fetchListenTogetherFeed({
        userTracks,
        tasteDna,
        timeInfo,
        forceRefresh: true,
        rotationIndex: advanceRotationCursor(1)
      })
      if (Array.isArray(fresh) && fresh.length) setBlocks(fresh)
    } catch {} finally {
      setRefreshing(false)
    }
  }

  const charts = useMemo(() => blocks.filter((b) => b.tier === 1), [blocks])
  const personal = useMemo(() => blocks.filter((b) => b.tier === 2), [blocks])
  const featured = personal[0]
  const moreForYou = personal.slice(1)
  const listening = friends.filter((f) => f.online && f.currentTrack)
  const onlineCount = friends.filter((f) => f.online).length

  return (
    <div className="px-5 lg:px-8 pb-10 max-w-[1400px] mx-auto w-full">
      {!isDesktop && (
        <div className="flex items-center justify-between h-14 mt-1">
          <button type="button" onClick={onOpenProfile} aria-label="Your profile" className="cursor-pointer rounded-full">
            <Avatar name={user?.name || 'You'} picture={user?.picture} size={40} />
          </button>
          <IconButton label={onlineCount ? `Friends, ${onlineCount} online` : 'Friends'} variant="filled" onClick={onOpenFriends} className="relative">
            <Users className="w-5 h-5" />
            {onlineCount > 0 && <span className="absolute right-2 bottom-2 w-2.5 h-2.5 rounded-full bg-live ring-2 ring-[#1C1C1F]" />}
          </IconButton>
        </div>
      )}

      <ChipRow className={isDesktop ? 'mt-2' : 'mt-3'}>
        <Chip active>For you</Chip>
        {MOODS.map((m) => (
          <Chip key={m.id} onClick={() => onMood(m)}>
            {m.label}
          </Chip>
        ))}
      </ChipRow>

      {featured && (
        <FeaturedCard block={featured} isDesktop={isDesktop} onOpen={() => onOpenBlock(featured)} onPlay={() => onPlayBlock(featured, false)} onShuffle={() => onPlayBlock(featured, true)} />
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
        <>
          <div className="flex items-baseline justify-between mt-8 mb-3.5">
            <h2 className="text-xl font-extrabold tracking-[-0.015em]">Made for you</h2>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="text-sm font-semibold text-t2 hover:text-t1 inline-flex items-center gap-1.5 cursor-pointer"
            >
              {refreshing ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              New picks
            </button>
          </div>
          <CardRow isDesktop={isDesktop}>
            {moreForYou.map((b) => (
              <MediaCard
                key={b.id}
                title={b.title}
                subtitle={b.subtitle}
                src={artUrl({ thumbnail: b.thumbnail })}
                onOpen={() => onOpenBlock(b)}
                onPlay={() => onPlayBlock(b, false)}
              />
            ))}
          </CardRow>
        </>
      )}

      {charts.length > 0 && (
        <>
          <SectionHeader title="Top charts" />
          <CardRow isDesktop={isDesktop}>
            {charts.map((b) => (
              <MediaCard
                key={b.id}
                title={b.title}
                subtitle={b.subtitle}
                label={chartLabel(b)}
                src={artUrl({ thumbnail: b.thumbnail })}
                onOpen={() => onOpenBlock(b)}
                onPlay={() => onPlayBlock(b, false)}
              />
            ))}
          </CardRow>
        </>
      )}
    </div>
  )
}

function chartLabel(block) {
  const t = `${block.badge || ''} ${block.title || ''}`.toLowerCase()
  if (t.includes('india') && t.includes('trend')) return 'Viral'
  if (t.includes('india')) return 'India'
  if (t.includes('japan')) return 'Japan'
  if (t.includes('us ')) return 'US'
  if (t.includes('global') || t.includes('international')) return 'Global'
  return block.badge || ''
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

function FeaturedCard({ block, isDesktop, onOpen, onPlay, onShuffle }) {
  const img = artUrl({ thumbnail: block.thumbnail })
  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-s1 mt-5 cursor-pointer ${isDesktop ? 'h-[248px]' : 'h-[208px]'}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={`Open ${block.title}`}
    >
      <img src={img} alt="" className="absolute inset-[-60px] w-[calc(100%+120px)] h-[calc(100%+120px)] max-w-none object-cover blur-[36px] saturate-[1.2] brightness-[0.8]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgba(10,10,11,0.92)] via-[rgba(10,10,11,0.6)] to-[rgba(10,10,11,0.25)]" />
      <img
        src={img}
        alt=""
        className={`absolute rounded-2xl object-cover shadow-[0_16px_40px_rgba(0,0,0,0.5)] ${isDesktop ? 'right-8 top-7 w-48 h-48' : 'right-5 top-6 w-[116px] h-[116px]'}`}
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
