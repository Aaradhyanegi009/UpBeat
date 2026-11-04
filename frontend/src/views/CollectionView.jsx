import React from 'react'
import { Play, Shuffle, Plus, Check, Download, Users, Share2, Sparkles, Pencil, RefreshCw, ListMusic, CircleCheck } from 'lucide-react'
import { Collage, IconButton, Chip, ChipRow, PageHeader, EmptyState, LikedTile, ActionMenu, Spinner } from '../ui/primitives'
import { SongRow } from '../ui/AppContext'

const KIND_LABEL = {
  mix: 'AI mix',
  foryou: 'Made for you',
  chart: 'Chart',
  playlist: 'Playlist',
  user: 'Your playlist',
  radio: 'Radio',
  liked: 'Liked songs',
  downloads: 'Downloads',
  songs: 'Songs',
  jam: 'Saved from a Jam'
}

export const TWEAKS = ['More energy', 'Calmer', 'Fewer vocals', 'Newer songs', 'Deeper cuts']

function parseDuration(text = '') {
  const parts = String(text).split(':').map((n) => parseInt(n, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function formatTotal(tracks = []) {
  const secs = tracks.reduce((sum, t) => sum + parseDuration(t.duration_text), 0)
  if (!secs) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h ? `${h} hr ${m} min` : `${m} min`
}

export default function CollectionView({
  collection,
  loading = false,
  loadingLabel = 'Loading…',
  isDesktop,
  isSaved = false,
  canSave = true,
  onToggleSave,
  onPlay,
  onDownloadAll,
  downloadState,
  onShare,
  onStartJam,
  onTweak,
  onEditPrompt,
  onBack,
  moreItems = [],
  trackMenuExtra
}) {
  const tracks = collection?.tracks || []
  const kind = collection?.kind || 'playlist'
  const title = collection?.title || collection?.playlist_title || ''
  const total = formatTotal(tracks)
  const allDownloaded = downloadState?.allDone

  const header = (
    <div className={isDesktop ? 'flex items-end gap-7 px-8 pt-4 pb-6' : 'flex flex-col items-center text-center px-5 pt-1'}>
      {kind === 'liked' ? (
        <LikedTile className={isDesktop ? 'w-52 h-52 !rounded-3xl' : 'w-44 h-44 !rounded-3xl'} />
      ) : (
        <Collage
          tracks={tracks}
          cover={collection?.cover}
          className={`${isDesktop ? 'w-52 h-52' : 'w-44 h-44'} !rounded-[20px] shadow-[0_24px_60px_rgba(0,0,0,0.55)]`}
        />
      )}
      <div className={isDesktop ? 'min-w-0 pb-1' : 'mt-5 w-full'}>
        <div className={`flex items-center gap-1.5 text-sm text-t2 ${isDesktop ? '' : 'justify-center'}`}>
          <span className="inline-flex items-center gap-1 font-bold text-t1">
            {kind === 'mix' && <Sparkles className="w-3.5 h-3.5" />}
            {KIND_LABEL[kind] || 'Playlist'}
          </span>
          {tracks.length > 0 && <span>· {tracks.length} songs</span>}
          {total && <span>· {total}</span>}
        </div>
        <h1 className={`font-extrabold tracking-[-0.025em] leading-tight mt-1.5 ${isDesktop ? 'text-5xl line-clamp-2' : 'text-[26px]'}`}>{title}</h1>
        {collection?.subtitle && kind !== 'mix' && (
          <p className={`text-sm text-t2 mt-2 ${isDesktop ? 'max-w-2xl' : ''} line-clamp-2`}>{collection.subtitle}</p>
        )}
        {collection?.prompt && (
          <div className={`mt-3.5 inline-flex items-center gap-2 max-w-full h-9 pl-3.5 pr-1 rounded-full bg-s1 text-[13px] text-t2`}>
            <span className="truncate text-t1">“{collection.prompt}”</span>
            {onEditPrompt && (
              <IconButton label="Edit prompt" size={30} onClick={onEditPrompt}>
                <Pencil className="w-3.5 h-3.5" />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const actions = (
    <div className={`flex items-center ${isDesktop ? 'px-8 gap-2' : 'px-3 mt-3.5'}`}>
      {isDesktop && (
        <>
          <PlayButton disabled={!tracks.length} onClick={() => onPlay(false)} big />
          <IconButton label="Shuffle play" disabled={!tracks.length} onClick={() => onPlay(true)}>
            <Shuffle className="w-[22px] h-[22px]" />
          </IconButton>
        </>
      )}
      {canSave && onToggleSave && (
        <IconButton label={isSaved ? 'Remove from library' : 'Save to library'} onClick={onToggleSave} disabled={!tracks.length}>
          {isSaved ? (
            <span className="w-6 h-6 rounded-full bg-accent text-on-accent inline-flex items-center justify-center">
              <Check className="w-4 h-4" strokeWidth={3} />
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full ring-2 ring-current inline-flex items-center justify-center text-accent">
              <Plus className="w-4 h-4" strokeWidth={3} />
            </span>
          )}
        </IconButton>
      )}
      {onDownloadAll && (
        <IconButton
          label={allDownloaded ? 'All songs downloaded' : downloadState?.busy ? `Downloading ${downloadState.done}/${downloadState.total}` : 'Download all'}
          onClick={onDownloadAll}
          disabled={!tracks.length || downloadState?.busy}
        >
          {downloadState?.busy ? (
            <span className="relative inline-flex">
              <Spinner className="w-5 h-5" />
            </span>
          ) : allDownloaded ? (
            <CircleCheck className="w-6 h-6 text-live" />
          ) : (
            <Download className="w-[22px] h-[22px]" />
          )}
        </IconButton>
      )}
      {onStartJam && (
        <IconButton label="Listen together (start a Jam)" onClick={onStartJam} disabled={!tracks.length}>
          <Users className="w-[22px] h-[22px]" />
        </IconButton>
      )}
      {onShare && (
        <IconButton label="Share" onClick={onShare} disabled={!tracks.length}>
          <Share2 className="w-[22px] h-[22px]" />
        </IconButton>
      )}
      {moreItems.length > 0 && <ActionMenu items={moreItems} label="More options" buttonSize={44} />}
      {!isDesktop && (
        <>
          <span className="flex-1" />
          <IconButton label="Shuffle play" disabled={!tracks.length} onClick={() => onPlay(true)} className="mr-1.5">
            <Shuffle className="w-[22px] h-[22px]" />
          </IconButton>
          <PlayButton disabled={!tracks.length} onClick={() => onPlay(false)} />
        </>
      )}
    </div>
  )

  return (
    <div className="pb-10 w-full">
      {!isDesktop && <PageHeader title="" onBack={onBack} />}
      {header}
      {actions}

      {kind === 'mix' && onTweak && tracks.length > 0 && !loading && (
        <div className={isDesktop ? 'px-8 mt-5' : 'px-5 mt-4'}>
          <ChipRow>
            <span className="h-9 inline-flex items-center gap-1.5 text-sm font-semibold text-t2 shrink-0 pr-1">
              <RefreshCw className="w-4 h-4" />
              Tweak
            </span>
            {TWEAKS.map((t) => (
              <Chip key={t} onClick={() => onTweak(t)}>
                {t}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      <div className={isDesktop ? 'px-8 mt-5' : 'px-5 mt-4'}>
        {loading ? (
          <LoadingRows label={loadingLabel} />
        ) : tracks.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title={kind === 'user' ? 'This playlist is empty' : 'Nothing here yet'}
            body={kind === 'user' ? 'Use “Add to playlist…” from any song’s menu to fill it.' : 'Try another mix, chart or search.'}
          />
        ) : (
          <div>
            {tracks.map((t, i) => (
              <SongRow
                key={`${t.video_id || t.title}-${i}`}
                track={t}
                list={tracks}
                index={i}
                showIndex={isDesktop}
                artSize={isDesktop ? 44 : 52}
                extraMenu={trackMenuExtra ? trackMenuExtra(t, i) : []}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlayButton({ onClick, disabled, big = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Play"
      title="Play"
      className={`rounded-full bg-white text-[#0A0A0B] flex items-center justify-center shrink-0 hover:scale-105 transition-transform cursor-pointer disabled:opacity-40 ${big ? 'w-14 h-14 mr-1' : 'w-14 h-14'}`}
    >
      <Play className="w-6 h-6 fill-current ml-0.5" />
    </button>
  )
}

function LoadingRows({ label }) {
  return (
    <div aria-busy="true">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-t2 mb-4">
        <Spinner className="w-4 h-4" />
        {label}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 h-16">
          <div className="w-[52px] h-[52px] rounded-xl bg-s1 animate-pulse" />
          <div className="flex-1">
            <div className="h-3.5 rounded bg-s1 w-1/2 animate-pulse" />
            <div className="h-3 rounded bg-s1 w-1/3 mt-2 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}
