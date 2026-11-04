import React, { useMemo, useState } from 'react'
import { Plus, Search, Heart, Download, Sparkles, Users, Pin, Trash2, X, Music, History, CircleCheck, Radio } from 'lucide-react'
import { Chip, ChipRow, IconButton, LikedTile, Collage, EmptyState, Art, Avatar } from '../ui/primitives'
import { SongRow, primaryArtist } from '../ui/AppContext'

export const LIBRARY_FILTERS = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'liked', label: 'Liked' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'artists', label: 'Artists' },
  { id: 'history', label: 'History' }
]

const KIND_META = {
  mix: { label: 'AI mix', icon: Sparkles, accent: true },
  foryou: { label: 'Made for you', icon: Sparkles, accent: true },
  user: { label: 'Playlist', icon: null },
  chart: { label: 'Chart', icon: null },
  playlist: { label: 'Playlist', icon: null },
  radio: { label: 'Radio', icon: Radio },
  jam: { label: 'Saved from a Jam', icon: Users }
}

function matches(t, q) {
  if (!q) return true
  const s = `${t.title || ''} ${t.artist || ''}`.toLowerCase()
  return s.includes(q.toLowerCase())
}

export default function LibraryView({
  isDesktop,
  filter = 'playlists',
  setFilter,
  favorites = [],
  offlineTracks = [],
  offlineStats,
  saved = [],
  history = [],
  downloadedIds,
  onOpenSaved,
  onOpenLiked,
  onOpenDownloads,
  onNewPlaylist,
  onDeleteDownload,
  onGoToArtist
}) {
  const [q, setQ] = useState('')
  const [showFind, setShowFind] = useState(false)

  const artists = useMemo(() => {
    const counts = new Map()
    for (const t of [...favorites, ...history]) {
      const name = primaryArtist(t.artist || '')
      if (!name || name.length > 40) continue
      const entry = counts.get(name) || { name, count: 0, track: t }
      entry.count += 1
      counts.set(name, entry)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 60)
  }, [favorites, history])

  const savedFiltered = saved.filter((c) => !q || (c.title || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-5 lg:px-8 pb-10 w-full max-w-[1100px]">
      <div className="flex items-center justify-between h-14 mt-1">
        <h1 className="text-[30px] font-extrabold tracking-[-0.025em]">Library</h1>
        <div className="flex gap-1">
          <IconButton label={showFind ? 'Close search' : 'Search your library'} variant="filled" onClick={() => { setShowFind((s) => !s); setQ('') }}>
            {showFind ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
          </IconButton>
          <IconButton label="New playlist" variant="filled" onClick={onNewPlaylist}>
            <Plus className="w-5 h-5" />
          </IconButton>
        </div>
      </div>

      {showFind && (
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find in your library"
          aria-label="Find in your library"
          className="mt-3 w-full h-11 rounded-xl bg-s2 px-4 text-[15px] font-semibold placeholder:text-t3 placeholder:font-medium focus:outline-none focus:ring-1 focus:ring-white/20"
        />
      )}

      <ChipRow className="mt-3.5">
        {LIBRARY_FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      <div className="mt-4">
        {filter === 'playlists' && (
          <div className="flex flex-col gap-1.5">
            {!q && (
              <>
                <LibRow onClick={onOpenLiked} art={<LikedTile className="w-14 h-14" />} title="Liked songs" sub={<><Pin className="w-3.5 h-3.5" />Pinned · {favorites.length} songs</>} />
                <LibRow
                  onClick={onOpenDownloads}
                  art={
                    <div className="w-14 h-14 rounded-xl bg-s2 flex items-center justify-center text-live shrink-0">
                      <Download className="w-6 h-6" />
                    </div>
                  }
                  title="Downloads"
                  sub={<><Pin className="w-3.5 h-3.5" />{offlineTracks.length} songs{offlineStats?.formattedSize ? ` · ${offlineStats.formattedSize}` : ''}</>}
                />
              </>
            )}
            {savedFiltered.map((c) => {
              const meta = KIND_META[c.kind] || KIND_META.playlist
              const allDown = c.tracks?.length > 0 && c.tracks.every((t) => t.video_id && downloadedIds?.has(t.video_id))
              return (
                <LibRow
                  key={c.id}
                  onClick={() => onOpenSaved(c)}
                  art={<Collage tracks={c.tracks || []} cover={c.cover} className="w-14 h-14" />}
                  title={c.title}
                  sub={
                    <>
                      <span className={`inline-flex items-center gap-1 ${meta.accent ? 'text-accent font-bold' : ''}`}>
                        {meta.icon && <meta.icon className="w-3.5 h-3.5" />}
                        {meta.label}
                      </span>
                      <span>· {c.tracks?.length || 0} songs</span>
                    </>
                  }
                  trailing={allDown ? <CircleCheck className="w-5 h-5 text-live shrink-0" aria-label="Downloaded" /> : null}
                />
              )
            })}
            {saved.length === 0 && !q && (
              <p className="text-sm text-t2 mt-4 leading-relaxed">
                Save AI mixes, charts and playlists with the <span className="text-t1 font-bold">+</span> button on their page, or tap the + above to start your own playlist.
              </p>
            )}
          </div>
        )}

        {filter === 'liked' &&
          (favorites.length === 0 ? (
            <EmptyState icon={Heart} title="No liked songs yet" body="Tap the heart on any song to keep it here." />
          ) : (
            favorites.filter((t) => matches(t, q)).map((t, i, arr) => <SongRow key={`${t.video_id}-${i}`} track={t} list={arr} index={i} />)
          ))}

        {filter === 'downloads' &&
          (offlineTracks.length === 0 ? (
            <EmptyState icon={Download} title="Nothing downloaded" body="Download songs or whole playlists to play them without a connection." />
          ) : (
            <>
              <p className="text-[13px] text-t2 mb-2">
                {offlineTracks.length} songs{offlineStats?.formattedSize ? ` · ${offlineStats.formattedSize} on this device` : ''}
              </p>
              {offlineTracks.filter((t) => matches(t, q)).map((t, i, arr) => (
                <SongRow
                  key={`${t.video_id}-${i}`}
                  track={t}
                  list={arr}
                  index={i}
                  extraMenu={[{ label: 'Remove download', icon: Trash2, danger: true, onClick: () => onDeleteDownload(t) }]}
                />
              ))}
            </>
          ))}

        {filter === 'artists' &&
          (artists.length === 0 ? (
            <EmptyState icon={Music} title="No artists yet" body="Artists you like and play show up here." />
          ) : (
            <div className={isDesktop ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5' : 'flex flex-col gap-1.5'}>
              {artists
                .filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()))
                .map((a) =>
                  isDesktop ? (
                    <button key={a.name} type="button" onClick={() => onGoToArtist(a.name)} className="text-left cursor-pointer group">
                      <Art track={a.track} round className="w-full aspect-square" />
                      <div className="mt-2.5 text-[15px] font-bold truncate">{a.name}</div>
                      <div className="text-[13px] text-t2">Artist</div>
                    </button>
                  ) : (
                    <LibRow key={a.name} onClick={() => onGoToArtist(a.name)} art={<Art track={a.track} round className="w-14 h-14" />} title={a.name} sub="Artist" />
                  )
                )}
            </div>
          ))}

        {filter === 'history' &&
          (history.length === 0 ? (
            <EmptyState icon={History} title="Nothing played yet" body="Songs you play will show up here." />
          ) : (
            history.filter((t) => matches(t, q)).map((t, i, arr) => <SongRow key={`${t.video_id}-${i}`} track={t} list={arr} index={i} />)
          ))}
      </div>
    </div>
  )
}

function LibRow({ onClick, art, title, sub, trailing }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 min-h-[68px] py-1.5 px-2 -mx-2 rounded-xl hover:bg-white/[0.04] text-left cursor-pointer"
    >
      {art}
      <span className="flex-1 min-w-0">
        <span className="block text-base font-bold truncate">{title}</span>
        <span className="text-[13px] text-t2 mt-0.5 flex items-center gap-1.5 truncate">{sub}</span>
      </span>
      {trailing}
    </button>
  )
}

export { Avatar }
