import React, { useEffect, useRef, useState } from 'react'
import { Search, X, Sparkles, ChevronRight, Clock, ListMusic } from 'lucide-react'
import { Chip, ChipRow, SectionHeader, EmptyState, Spinner, IconButton, artUrl } from '../ui/primitives'
import { SongRow, MediaCard } from '../ui/AppContext'
import { MOODS } from './HomeView'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'videos', label: 'Videos' }
]

export function SearchField({ value, onChange, onSubmit, onClear, autoFocus = false, inputRef, placeholder = 'Songs, artists, or a vibe', className = '', onFocus, kbdHint }) {
  return (
    <form
      role="search"
      className={`h-12 rounded-2xl lg:rounded-full bg-s2 flex items-center gap-3 pl-4 pr-1.5 ring-1 ring-transparent focus-within:ring-white/20 transition-shadow ${className}`}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(value)
      }}
    >
      <Search className="w-5 h-5 text-t2 shrink-0" />
      <label className="sr-only" htmlFor="ub-search">
        Search
      </label>
      <input
        id="ub-search"
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-base font-semibold placeholder:text-t3 placeholder:font-medium focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <IconButton label="Clear search" size={36} onClick={onClear}>
          <X className="w-[18px] h-[18px]" />
        </IconButton>
      ) : (
        kbdHint && <kbd className="font-sans text-xs font-semibold text-t2 bg-s3 rounded-md px-2 py-0.5 mr-2">{kbdHint}</kbd>
      )}
    </form>
  )
}

export default function SearchView({
  isDesktop,
  query,
  setQuery,
  results,
  searching,
  recentSearches = [],
  onClearRecent,
  onSubmit,
  onMakeMix,
  onOpenPlaylist,
  onMood
}) {
  const [filter, setFilter] = useState('all')
  const inputRef = useRef(null)
  const q = query.trim()

  useEffect(() => setFilter('all'), [results?.search_query])

  const songs = results?.song_results?.length ? results.song_results : results?.tracks || []
  const playlists = results?.matched_playlists || []
  const videos = (results?.youtube_results || []).filter((v) => !songs.some((s) => s.video_id === v.video_id))
  const hasResults = songs.length || playlists.length || videos.length
  const isStale = results?.search_query && results.search_query.toLowerCase() !== q.toLowerCase()

  return (
    <div className="px-5 lg:px-8 pb-10 w-full max-w-[1400px] mx-auto">
      {!isDesktop && (
        <>
          <h1 className="text-[30px] font-extrabold tracking-[-0.025em] mt-4">Search</h1>
          <SearchField
            className="mt-4"
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            onSubmit={onSubmit}
            onClear={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          />
        </>
      )}

      {!q ? (
        <>
          {recentSearches.length > 0 && (
            <>
              <SectionHeader title="Recent searches" action="Clear" onAction={onClearRecent} className={isDesktop ? 'mt-4' : 'mt-6'} />
              <div className="flex flex-col">
                {recentSearches.slice(0, 6).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setQuery(r)}
                    className="flex items-center gap-3.5 h-12 px-2 -mx-2 rounded-xl hover:bg-white/[0.04] text-left cursor-pointer"
                  >
                    <Clock className="w-5 h-5 text-t3 shrink-0" />
                    <span className="text-[15px] font-semibold truncate">{r}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <SectionHeader title="Browse moods" className={recentSearches.length || !isDesktop ? undefined : 'mt-4'} />
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
            {MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMood(m)}
                className="h-[72px] rounded-2xl bg-s1 hover:bg-s2 px-4 text-left text-[17px] font-extrabold tracking-tight cursor-pointer transition-colors"
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onMakeMix(q)}
            className="w-full mt-5 flex items-center gap-3.5 p-3.5 pr-3 rounded-[18px] bg-[color-mix(in_srgb,var(--accent)_12%,var(--s1))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-left cursor-pointer hover:brightness-110 transition"
          >
            <span className="w-11 h-11 rounded-xl bg-accent text-on-accent flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-bold truncate">Make a mix from “{q}”</span>
              <span className="block text-[13px] text-t2 mt-0.5">AI picks 20 songs with this sound</span>
            </span>
            <ChevronRight className="w-5 h-5 text-t2 shrink-0" />
          </button>

          {(hasResults || searching) && (
            <ChipRow className="mt-4">
              {FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </Chip>
              ))}
            </ChipRow>
          )}

          {!hasResults && (searching || !results || isStale) ? (
            <div className="flex items-center gap-2.5 text-sm font-semibold text-t2 mt-8">
              <Spinner className="w-4 h-4" />
              Searching…
            </div>
          ) : !hasResults ? (
            <EmptyState icon={Search} title={`No results for “${q}”`} body="Check the spelling, or let the AI make a mix from it above." />
          ) : (
            <div className={`transition-opacity ${isStale || searching ? 'opacity-60' : ''}`}>
              {(filter === 'all' || filter === 'songs') && songs.length > 0 && (
                <>
                  <SectionHeader title="Songs" action={filter === 'all' && songs.length > 5 ? 'See all' : null} onAction={() => setFilter('songs')} />
                  {(filter === 'all' ? songs.slice(0, 5) : songs).map((t, i) => (
                    <SongRow key={`${t.video_id}-${i}`} track={t} list={songs} index={i} />
                  ))}
                </>
              )}

              {(filter === 'all' || filter === 'playlists') && playlists.length > 0 && (
                <>
                  <SectionHeader title="Playlists" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
                    {playlists.map((pl) => (
                      <MediaCard
                        key={pl.browse_id}
                        title={pl.title}
                        subtitle={pl.subtitle}
                        src={artUrl({ thumbnail: pl.thumbnail })}
                        onOpen={() => onOpenPlaylist(pl)}
                      />
                    ))}
                  </div>
                </>
              )}

              {(filter === 'all' || filter === 'videos') && videos.length > 0 && (
                <>
                  <SectionHeader title="Videos" action={filter === 'all' && videos.length > 4 ? 'See all' : null} onAction={() => setFilter('videos')} />
                  {(filter === 'all' ? videos.slice(0, 4) : videos).map((t, i) => (
                    <SongRow key={`${t.video_id}-v${i}`} track={t} list={videos} index={i} />
                  ))}
                </>
              )}

              {filter === 'playlists' && playlists.length === 0 && (
                <EmptyState icon={ListMusic} title="No playlists for this search" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
