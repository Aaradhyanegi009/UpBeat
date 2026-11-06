import React, { useEffect, useState } from 'react'
import { House, Search, Music, Sparkles, Library, Plus, ChevronLeft, ChevronRight, Users, Download, Settings, PanelLeftClose } from 'lucide-react'
import { Avatar, IconButton, LikedTile, Collage, Chip } from './primitives'
import { SearchField } from '../views/SearchView'
import { useMediaQuery } from './router'

/** Exact original UpBeat dark-squircle + white outlined beamed eighth note logo */
export function UpBeatLogo({ size = 32, className = '' }) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-[9px] bg-gradient-to-b from-[#1C1E26] to-[#0B0C10] border border-white/15 shadow-md overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {!imgFailed ? (
        <img
          src="/icon-192.png"
          alt="UpBeat"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <svg viewBox="0 0 24 24" className="w-[62%] h-[62%] text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      )}
    </span>
  )
}

export const TABS = [
  { id: 'home', path: '/', label: 'Home', icon: House },
  { id: 'search', path: '/search', label: 'Search', icon: Search },
  { id: 'create', path: '/create', label: 'Create', icon: Sparkles },
  { id: 'library', path: '/library', label: 'Library', icon: Library }
]

/** Phone: solid tab bar fixed to the bottom edge. */
export function TabBar({ activeTab, onSelect }) {
  return (
    <nav aria-label="Main" className="shrink-0 bg-[#0E0E10] border-t border-white/[0.08] pb-safe z-30">
      <div className="grid grid-cols-4 h-[64px] px-2">
        {TABS.map((t) => {
          const on = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t)}
              aria-current={on ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold cursor-pointer ${on ? 'text-t1' : 'text-t3'}`}
            >
              <span className={`w-[60px] h-8 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-s3 text-t1' : ''}`}>
                <t.icon className="w-6 h-6" strokeWidth={on ? 2.25 : 2} />
              </span>
              {t.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Desktop: left column with navigation and the library list. */
export function SideNav({
  activeTab,
  onSelect,
  saved = [],
  favoritesCount = 0,
  downloadsCount = 0,
  activeCollectionId,
  playingCollectionId,
  onOpenSaved,
  onOpenLiked,
  onOpenDownloads,
  onNewPlaylist,
  libFilter,
  setLibFilter,
  onCollapseSidebar
}) {
  const items = saved.filter((c) => libFilter === 'all' || (libFilter === 'mixes' ? ['mix', 'foryou'].includes(c.kind) : !['mix', 'foryou'].includes(c.kind)))
  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1 select-none">
      <div className="rounded-[14px] bg-bg p-3 shrink-0">
        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-3.5">
          <div className="flex items-center">
            <UpBeatLogo size={32} />
          </div>
          {onCollapseSidebar && (
            <button
              type="button"
              onClick={onCollapseSidebar}
              title="Close sidebar (⌘B)"
              aria-label="Close sidebar"
              className="h-8 px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-t2 hover:text-t1 inline-flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer active:scale-95"
            >
              <PanelLeftClose className="w-4 h-4" />
              <span className="hidden xl:inline text-[11px]">Hide</span>
            </button>
          )}
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {TABS.filter((t) => t.id !== 'library').map((t) => {
            const on = activeTab === t.id
            const kbd = t.id === 'search' ? '⌘K' : t.id === 'create' ? '⌘N' : null
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                aria-current={on ? 'page' : undefined}
                className={`h-11 px-3 rounded-[10px] flex items-center gap-3.5 text-[15px] font-bold cursor-pointer transition-colors ${on ? 'bg-s2 text-t1' : 'text-t2 hover:text-t1'}`}
              >
                <t.icon className="w-[22px] h-[22px]" />
                {t.label}
                {kbd && <kbd className="ml-auto font-sans text-xs font-semibold text-t3 bg-s2 rounded-md px-1.5 py-0.5">{kbd}</kbd>}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="rounded-[14px] bg-bg flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between pl-4 pr-2 pt-3 pb-2">
          <button
            type="button"
            onClick={() => onSelect(TABS[3])}
            className={`flex items-center gap-3 text-[15px] font-bold cursor-pointer ${activeTab === 'library' ? 'text-t1' : 'text-t2 hover:text-t1'}`}
          >
            <Library className="w-[22px] h-[22px]" />
            Your library
          </button>
          <IconButton label="New playlist" size={36} onClick={onNewPlaylist}>
            <Plus className="w-5 h-5" />
          </IconButton>
        </div>
        <div className="flex gap-1.5 px-3 pb-2.5">
          {[
            { id: 'all', label: 'All' },
            { id: 'playlists', label: 'Playlists' },
            { id: 'mixes', label: 'AI mixes' }
          ].map((f) => (
            <Chip key={f.id} active={libFilter === f.id} onClick={() => setLibFilter(f.id)} className="!h-8 !px-3 !text-[13px]">
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <SideItem onClick={onOpenLiked} art={<LikedTile className="w-12 h-12 !rounded-[10px]" />} title="Liked songs" sub={`${favoritesCount} songs`} active={activeCollectionId === 'liked'} />
          <SideItem
            onClick={onOpenDownloads}
            art={
              <div className="w-12 h-12 rounded-[10px] bg-s2 flex items-center justify-center text-live shrink-0">
                <Download className="w-5 h-5" />
              </div>
            }
            title="Downloads"
            sub={`${downloadsCount} songs`}
            active={activeCollectionId === 'downloads'}
          />
          {items.map((c) => (
            <SideItem
              key={c.id}
              onClick={() => onOpenSaved(c)}
              art={<Collage tracks={c.tracks || []} cover={c.cover} className="w-12 h-12 !rounded-[10px]" />}
              title={c.title}
              sub={`${{ mix: 'AI mix', foryou: 'Made for you', chart: 'Chart', radio: 'Radio' }[c.kind] || 'Playlist'} · ${c.tracks?.length || 0} songs`}
              active={activeCollectionId === c.id}
              playing={playingCollectionId === c.id}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SideItem({ onClick, art, title, sub, active, playing }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 min-h-[60px] px-2 rounded-[10px] text-left cursor-pointer transition-colors ${active ? 'bg-s2' : 'hover:bg-white/[0.04]'}`}
    >
      {art}
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-bold truncate ${playing ? 'text-t1 font-extrabold' : ''}`}>{title}</span>
        <span className="block text-[13px] text-t2 truncate">{sub}</span>
      </span>
    </button>
  )
}

/** Desktop: bar at the top of the centre column. */
export function TopBar({
  query,
  setQuery,
  onSearchFocus,
  onSearchSubmit,
  searchInputRef,
  user,
  onOpenProfile,
  onOpenSettings,
  friends = [],
  incomingCount = 0,
  jamActive = false,
  onOpenFriends,
  sidebarOpen = true,
  onToggleSidebar
}) {
  const online = friends.filter((f) => f.online)
  const compact = !useMediaQuery('(min-width: 1280px)')
  const [searchOpen, setSearchOpen] = useState(false)
  const showField = !compact || searchOpen || !!query

  useEffect(() => {
    if (!compact) return undefined
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') setSearchOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compact])

  return (
    <div className="flex items-center gap-3 px-7 py-4">
      <IconButton label="Back" variant="filled" size={36} onClick={() => window.history.back()}>
        <ChevronLeft className="w-5 h-5" />
      </IconButton>
      <IconButton label="Forward" variant="filled" size={36} onClick={() => window.history.forward()}>
        <ChevronRight className="w-5 h-5" />
      </IconButton>
      {showField ? (
        <SearchField
          className="flex-[0_1_460px] min-w-0"
          inputRef={searchInputRef}
          value={query}
          onChange={setQuery}
          autoFocus={compact}
          onFocus={onSearchFocus}
          onBlur={() => setSearchOpen(false)}
          onSubmit={onSearchSubmit}
          onClear={() => setQuery('')}
          placeholder="Search, or describe a vibe to make a mix"
          kbdHint={compact ? undefined : '⌘K'}
        />
      ) : (
        <IconButton
          label="Search"
          variant="filled"
          size={44}
          onClick={() => {
            setSearchOpen(true)
            onSearchFocus?.()
          }}
        >
          <Search className="w-5 h-5" />
        </IconButton>
      )}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onOpenFriends}
        className="h-11 pl-2 pr-4 rounded-full bg-s2 hover:bg-s3 flex items-center gap-2.5 text-sm font-bold whitespace-nowrap shrink-0 cursor-pointer"
      >
        {online.length > 0 ? (
          <span className="flex">
            {online.slice(0, 3).map((f, i) => (
              <Avatar key={f.friendCode} name={f.name} picture={f.picture} size={30} className={`ring-2 ring-[#1C1C1F] ${i ? '-ml-2' : ''}`} />
            ))}
          </span>
        ) : (
          <span className="relative w-[30px] h-[30px] rounded-full bg-s3 flex items-center justify-center">
            <Users className="w-4 h-4" />
            {(jamActive || incomingCount > 0) && (
              <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#1C1C1F] ${jamActive ? 'bg-live' : 'bg-accent'}`} />
            )}
          </span>
        )}
        {jamActive
          ? 'Jam · live'
          : incomingCount > 0
          ? `${incomingCount} request${incomingCount > 1 ? 's' : ''}`
          : online.length > 0
          ? `${online.length} friend${online.length > 1 ? 's' : ''} online`
          : 'Friends'}
      </button>
      <IconButton label="Settings" variant="filled" size={44} onClick={onOpenSettings}>
        <Settings className="w-5 h-5" />
      </IconButton>
      <button type="button" onClick={onOpenProfile} aria-label="Your taste profile" className="rounded-full cursor-pointer">
        <Avatar name={user?.name || 'You'} picture={user?.picture} size={40} />
      </button>
    </div>
  )
}
