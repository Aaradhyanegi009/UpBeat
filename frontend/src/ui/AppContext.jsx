import React, { createContext, useContext } from 'react'
import { ListEnd, ListPlus, ListMusic, Download, Radio, User, Heart, Trash2, CircleCheck, Play } from 'lucide-react'
import { TrackRow, Art } from './primitives'

/**
 * Everything a screen needs to act on songs, provided once by App.
 * Shape (all optional except the basics):
 *   currentTrack, isPlaying, isFav(track), downloadedIds:Set,
 *   playTrack(track, list), toggleFav(track), playNext(track), addToQueue(track),
 *   openAddToPlaylist(track), download(track), startRadio(track), goToArtist(name)
 */
export const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

export function sameTrack(a, b) {
  if (!a || !b) return false
  if (a.video_id && b.video_id) return a.video_id === b.video_id
  return a.title === b.title && a.artist === b.artist
}

export function primaryArtist(artist = '') {
  return String(artist).split(/,|&| feat\.| ft\.| x /i)[0].trim()
}

/** Standard ⋯ menu for a song. `extra` items are appended (e.g. "Remove from playlist"). */
export function useTrackMenu() {
  const app = useApp()
  return (track, extra = []) => {
    if (!app || !track) return []
    const downloaded = track.video_id && app.downloadedIds?.has(track.video_id)
    const liked = app.isFav?.(track)
    return [
      { label: 'Play next', icon: ListEnd, onClick: () => app.playNext(track) },
      { label: 'Add to queue', icon: ListPlus, onClick: () => app.addToQueue(track) },
      { label: 'Add to playlist…', icon: ListMusic, onClick: () => app.openAddToPlaylist(track) },
      { divider: true },
      { label: liked ? 'Remove from liked' : 'Like', icon: Heart, onClick: () => app.toggleFav(track) },
      downloaded
        ? { label: 'Downloaded', icon: CircleCheck, onClick: () => {} }
        : { label: 'Download', icon: Download, onClick: () => app.download(track) },
      { label: 'Start radio', icon: Radio, onClick: () => app.startRadio(track) },
      track.artist ? { label: `Go to ${primaryArtist(track.artist)}`, icon: User, onClick: () => app.goToArtist(primaryArtist(track.artist)) } : null,
      ...(extra.length ? [{ divider: true }, ...extra] : [])
    ].filter(Boolean)
  }
}

/** Track row wired to the app: plays within `list`, shows like/download state and the ⋯ menu. */
export function SongRow({ track, list, index = 0, showIndex = false, extraMenu = [], artSize = 52, trailing, showFav = true }) {
  const app = useApp()
  const menuFor = useTrackMenu()
  if (!app) return null
  const isCurrent = sameTrack(app.currentTrack, track)
  return (
    <TrackRow
      track={track}
      index={index}
      showIndex={showIndex}
      isCurrent={isCurrent}
      isPlaying={isCurrent && app.isPlaying}
      isFav={app.isFav(track)}
      downloaded={Boolean(track.video_id && app.downloadedIds?.has(track.video_id))}
      onPlay={() => app.playTrack(track, list || [track])}
      onToggleFav={() => app.toggleFav(track)}
      menuItems={menuFor(track, extraMenu)}
      artSize={artSize}
      trailing={trailing}
      showFav={showFav}
    />
  )
}

/** Square card for mixes, charts and playlists. */
export function MediaCard({ title, subtitle, track, src, label, onOpen, onPlay, round = false, className = '' }) {
  return (
    <div className={`group min-w-0 ${className}`}>
      <div className="relative">
        <button type="button" onClick={onOpen} className="block w-full cursor-pointer" aria-label={`Open ${title}`}>
          <Art track={track} src={src} round={round} className="w-full aspect-square !rounded-2xl" />
          {label && (
            <>
              <span className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
              <span className="absolute left-3 bottom-3 text-lg font-extrabold tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">{label}</span>
            </>
          )}
        </button>
        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${title}`}
            title={`Play ${title}`}
            className="absolute right-2.5 bottom-2.5 w-11 h-11 rounded-full bg-white text-[#0A0A0B] items-center justify-center shadow-xl hidden lg:flex opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus:opacity-100 transition-all cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
        )}
      </div>
      <button type="button" tabIndex={-1} onClick={onOpen} className="block w-full text-left cursor-pointer">
        <div className="mt-2.5 text-[15px] font-bold truncate">{title}</div>
        {subtitle && <div className="text-[13px] text-t2 mt-0.5 truncate">{subtitle}</div>}
      </button>
    </div>
  )
}

export { Trash2 }
