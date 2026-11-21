/**
 * YouTube Music (WEB_REMIX) & YouTube WEB Innertube search, playlist browsing, and official charts.
 */
import { callInnertube } from "./platformConfig.js"
import { isValidMusicTrack } from "./musicFilter.js"

// ---------------------------------------------------------------------------
// YouTube Music search (WEB_REMIX Innertube) — native HTTP in the APK
// ---------------------------------------------------------------------------

export const YTM_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20260918.01.00', hl: 'en', gl: 'IN' }
}
const BLOCKED_META = [
  'Episode', 'Podcast', 'Release - Topic', 'Lights on the Ceiling',
  'Tutorial', 'Lecture', 'Course', 'Chapter', 'Syllabus', 'Unboxing',
  'Gameplay', 'Walkthrough', 'Vlog', 'Review', 'Reaction', 'Animation Meme'
]
const searchCache = new Map()
const directSearchCache = new Map()
const playlistBrowseCache = new Map()

const PLAYLIST_KEYWORDS = [
  'playlist', 'new ', 'latest', 'top ', 'best ', 'hits', 'hitlist',
  'songs', 'ost', 'soundtrack', '2024', '2025', '2026', 'collection',
  'mix', 'chart', 'trending', 'essentials'
]

export function* findNodes(obj, key) {
  if (Array.isArray(obj)) {
    for (const it of obj) yield* findNodes(it, key)
  } else if (obj && typeof obj === 'object') {
    if (key in obj) yield obj[key]
    for (const v of Object.values(obj)) yield* findNodes(v, key)
  }
}

function extractColText(colObj, rendererKey) {
  return (colObj?.[rendererKey]?.text?.runs || []).map((r) => r.text || '').join('').trim()
}

export async function browsePlaylistStandalone(browseId, playlistTitle = '', playlistSubtitle = '', maxTracks = 35) {
  if (!browseId) return []
  const cached = playlistBrowseCache.get(browseId)
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.tracks

  try {
    const resp = await callInnertube('browse', { context: YTM_CONTEXT, browseId }, 'music')
    if (!resp.ok) return []
    const data = await resp.json()
    const tracks = []
    const seenVids = new Set()

    for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
      const vid = item?.playlistItemData?.videoId
      if (!vid || vid.length !== 11 || seenVids.has(vid)) continue

      const cols = (item.flexColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFlexColumnRenderer'))
      const fixed = (item.fixedColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFixedColumnRenderer'))

      const title = cols[0] || ''
      const artist = cols[1] || 'Unknown Artist'
      const extra = cols[2] || ''
      if (!title || BLOCKED_META.some((b) => artist.includes(b))) continue

      let dur = ''
      if (fixed[0] && /^\d{1,2}:\d{2}(:\d{2})?$/.test(fixed[0])) {
        dur = fixed[0]
      } else {
        const m = [...cols, ...fixed].join(' ').match(/\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b/)
        if (m) dur = m[1]
      }

      seenVids.add(vid)
      const reasonParts = []
      if (extra) reasonParts.push(extra)
      if (playlistTitle) reasonParts.push(`Featured in ${playlistTitle}`)
      const reason = reasonParts.length ? reasonParts.join(' • ') : 'Featured track from official playlist'

      const trackObj = {
        title,
        artist,
        video_id: vid,
        fallback_ids: [],
        duration_text: dur,
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        match_tier: 'Direct Match',
        reason,
        why_it_fits: reason,
        vibe: 'Playlist'
      }
      if (!isValidMusicTrack(trackObj)) continue
      tracks.push(trackObj)
      if (tracks.length >= maxTracks) break
    }

    playlistBrowseCache.set(browseId, { tracks, ts: Date.now() })
    return tracks
  } catch {
    return []
  }
}

const YT_WEB_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20260918.01.00', hl: 'en', gl: 'IN' }
}
const YTM_SONGS_PARAM = 'EgWKAQIIAWoKEAkQBRAKEAMQBA=='
const STOPWORDS = new Set(['songs', 'song', 'music', 'the', 'a', 'an', 'of', 'and', 'best', 'top', 'new', 'latest', 'playlist', 'mix', 'for', 'to', 'in'])

const trackMetaCache = new Map()

export async function fetchTrackExtendedMeta(videoId) {
  if (!videoId || videoId.length !== 11) return null
  if (trackMetaCache.has(videoId)) return trackMetaCache.get(videoId)

  try {
    const res = await callInnertube('player', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20260918.01.00' } },
      videoId
    }, 'youtube')
    if (!res.ok) return null
    const data = await res.json()
    const mf = data?.microformat?.playerMicroformatRenderer
    const vdetails = data?.videoDetails
    const rawDate = mf?.publishDate || mf?.uploadDate || ''
    let releaseDate = ''
    if (rawDate) {
      try {
        const d = new Date(rawDate)
        if (!isNaN(d.getTime())) {
          releaseDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        }
      } catch {}
    }
    const meta = {
      releaseDate,
      rawDate,
      author: vdetails?.author || '',
      viewCount: vdetails?.viewCount ? Number(vdetails.viewCount).toLocaleString() : '',
      category: mf?.category || ''
    }
    trackMetaCache.set(videoId, meta)
    return meta
  } catch {
    return null
  }
}

function runsText(obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (obj.simpleText) return obj.simpleText
  return (obj.runs || []).map((r) => r.text || '').join('')
}

function queryTokens(q) {
  const toks = q.toLowerCase().match(/[a-z0-9]+/g) || []
  const core = toks.filter((t) => !STOPWORDS.has(t))
  return core.length ? core : toks
}

function relevance(text, tokens) {
  if (!tokens.length) return 0
  const t = text.toLowerCase()
  return tokens.filter((tok) => t.includes(tok)).length / tokens.length
}

const VARIANT_RULES = [
  /\b(remix|re-mix|remixed|bootleg|vip\s+mix|club\s+mix|extended\s+mix|dj\s+mix|rework)\b/i,
  /\b(slowed|reverb|s\s*\+\s*r|daycore)\b/i,
  /\b(sped\s*up|speed\s*up|nightcore)\b/i,
  /\b(8d|16d|3d\s+audio|bass\s+boosted|sub\s+boosted)\b/i,
  /\b(lo-?fi|chill\s+mix|study\s+beats)\b/i,
  /\b(cover|covered\s+by|karaoke|instrumental|backing\s+track|tribute|parody|piano\s+version|guitar\s+version|acoustic\s+version|orchestral\s+version|lullaby|8-?bit|ringtone|ai\s+cover)\b/i
]

const EXPLICIT_PLAYLIST_INTENT_REGEX = /\b(playlist|playlists|chart|charts|billboard|top\s+\d+|hitlist|countdown|best\s+of|essentials|soundtrack|ost)\b/i

export function parsePlayCount(text = '') {
  const m = String(text || '').match(/([\d.,]+)\s*([kKmMbB])?\s*(?:plays?|views?)\b/)
  if (!m) return 0
  const num = parseFloat(m[1].replace(/,/g, ''))
  if (!isFinite(num) || num <= 0) return 0
  const unit = (m[2] || '').toLowerCase()
  const mult = unit === 'b' ? 1e9 : unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1
  return Math.round(num * mult)
}

export function isUnrequestedVariant(track, query = '') {
  if (!track) return false
  const q = String(query || '')
  const haystack = `${track.title || ''} ${track.artist || ''}`
  return VARIANT_RULES.some((rule) => !rule.test(q) && rule.test(haystack))
}

export function canonicalArtistName(artist = '') {
  return String(artist || '')
    .replace(/\s*-\s*Topic\b/gi, '')
    .replace(/\b(?:VEVO|Official)\b/gi, '')
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx)\s*/i)[0]
    .trim()
    .toLowerCase()
}

export function canonicalSongTitle(title = '') {
  const raw = String(title || '')
  let cleaned = raw
    .replace(/(\([^)]*\)|\[[^\]]*\])/g, ' ')
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$/i, '')
    .replace(/\s*[-–—|:]\s*(?:official|lyric|lyrics|audio|music\s+video|video|visualizer|remaster(?:ed)?|single|live|topic|full\s+song|hd|4k).*$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!cleaned) {
    cleaned = raw
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }
  return cleaned
}

export function scoreDirectSearchTrack(track, query = '', consensusArtists = new Set(), orderIdx = 0) {
  if (!track) return -1000
  const qNorm = canonicalSongTitle(query)
  const qRawLower = String(query || '').trim().toLowerCase()
  const tTitle = canonicalSongTitle(track.title)
  const tArtist = canonicalArtistName(track.artist)
  const tokens = queryTokens(String(query || ''))

  let score = 0
  if (qNorm && tTitle === qNorm) score += 120
  else if (qNorm && tTitle && (tTitle.startsWith(qNorm) || qNorm.startsWith(tTitle))) score += 65

  if (qNorm && tTitle && tArtist && qRawLower.includes(tTitle) && qRawLower.includes(tArtist)) {
    score += 140
  }
  if (tArtist && qNorm && (tArtist === qNorm || tArtist.includes(qNorm) || qNorm.includes(tArtist))) {
    score += 75
  }

  score += relevance(`${tTitle} ${tArtist}`, tokens) * 50
  if (track.vibe === 'YT Music') score += 30
  if (tArtist && consensusArtists.has(tArtist)) score += 35
  score += Math.min(35, Math.log10((track.play_count_num || 0) + 1) * 4.5)
  score += Math.max(0, 12 - orderIdx * 0.6)

  if (/\b(?:official\s+(?:video|audio|music\s+video)|lyric\s+video)\b/i.test(track.title || '')) {
    score -= 2
  }
  if (isUnrequestedVariant(track, query)) score -= 250
  return score
}

export function deduplicateSearchSongs(tracks = [], query = '', consensusArtists = new Set()) {
  const scored = tracks
    .map((t, idx) => ({ track: t, score: scoreDirectSearchTrack(t, query, consensusArtists, idx), idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)

  const result = []
  const byTitleKey = new Map()
  const seenIds = new Set()

  for (const { track } of scored) {
    if (!track?.video_id || seenIds.has(track.video_id)) continue
    if (!isValidMusicTrack(track) || isUnrequestedVariant(track, query)) continue

    const titleKey = canonicalSongTitle(track.title) || track.video_id
    const tArtist = canonicalArtistName(track.artist)

    if (byTitleKey.has(titleKey)) {
      const primary = byTitleKey.get(titleKey)
      const primaryArtist = canonicalArtistName(primary.artist)
      const sameArtist =
        !tArtist ||
        !primaryArtist ||
        tArtist === primaryArtist ||
        primaryArtist.includes(tArtist) ||
        tArtist.includes(primaryArtist)
      if (sameArtist && !primary.fallback_ids.includes(track.video_id)) {
        primary.fallback_ids.push(track.video_id)
      }
      seenIds.add(track.video_id)
      continue
    }

    const cloned = {
      ...track,
      fallback_ids: Array.isArray(track.fallback_ids) ? [...track.fallback_ids] : []
    }
    seenIds.add(track.video_id)
    byTitleKey.set(titleKey, cloned)
    result.push(cloned)
  }

  return result
}

async function fetchYtmWatchRadio(videoId, maxItems = 20) {
  if (!videoId || videoId.length !== 11) return []
  try {
    const resp = await callInnertube('next', {
      context: YTM_CONTEXT,
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true
    }, 'music')
    if (!resp.ok) return []
    const data = await resp.json()
    const out = []
    const seen = new Set([videoId])
    for (const item of findNodes(data, 'playlistPanelVideoRenderer')) {
      const vid = item?.videoId
      if (!vid || vid.length !== 11 || seen.has(vid)) continue
      seen.add(vid)
      const title = runsText(item.title)
      const artist = runsText(item.shortBylineText) || runsText(item.longBylineText) || 'Unknown Artist'
      const dur = runsText(item.lengthText)
      const trackObj = {
        title,
        artist,
        video_id: vid,
        fallback_ids: [],
        duration_text: dur,
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        match_tier: 'Similar Vibe',
        reason: 'Similar vibe',
        why_it_fits: 'Similar vibe',
        vibe: 'YT Music'
      }
      if (!isValidMusicTrack(trackObj) || isUnrequestedVariant(trackObj, '')) continue
      out.push(trackObj)
      if (out.length >= maxItems) break
    }
    return out
  } catch {
    return []
  }
}

/** Same results, same order as typing the query on youtube.com. */
async function ytWebSearch(query, pages = 2) {
  const videos = []
  const playlists = []
  const seenV = new Set()
  const seenP = new Set()
  let body = { context: YT_WEB_CONTEXT, query }

  for (let page = 0; page < pages; page++) {
    let data
    try {
      const r = await callInnertube('search', body, 'youtube')
      if (!r.ok) break
      data = await r.json()
    } catch {
      break
    }

    for (const v of findNodes(data, 'videoRenderer')) {
      const vid = v.videoId
      const dur = runsText(v.lengthText)
      if (!vid || vid.length !== 11 || seenV.has(vid) || !dur) continue // skip live streams
      seenV.add(vid)
      const views = runsText(v.shortViewCountText) || runsText(v.viewCountText)
      const published = runsText(v.publishedTimeText)
      const meta = [views, published].filter(Boolean).join(' • ') || 'YouTube search result'
      const trackObj = {
        title: runsText(v.title),
        artist: runsText(v.ownerText) || runsText(v.longBylineText) || 'YouTube',
        video_id: vid,
        fallback_ids: [],
        duration_text: dur,
        release_date: published || '',
        play_count_num: parsePlayCount(views),
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        match_tier: 'Direct Match',
        reason: meta,
        why_it_fits: meta,
        vibe: 'YouTube'
      }
      if (!isValidMusicTrack(trackObj)) continue
      videos.push(trackObj)
    }

    for (const lk of findNodes(data, 'lockupViewModel')) {
      if (lk.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') continue
      const pid = lk.contentId || ''
      if (!pid || pid.startsWith('RD') || seenP.has(pid)) continue
      seenP.add(pid)
      const md = lk?.metadata?.lockupMetadataViewModel || {}
      const title = md?.title?.content || ''
      let owner = ''
      for (const row of md?.metadata?.contentMetadataViewModel?.metadataRows || []) {
        for (const part of row.metadataParts || []) {
          const txt = part?.text?.content || ''
          if (txt && txt !== 'Playlist' && !owner) owner = txt
        }
      }
      if (title) {
        const imgSources =
          lk?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources ||
          lk?.contentImage?.thumbnailViewModel?.image?.sources ||
          []
        playlists.push({
          browse_id: `VL${pid}`,
          title,
          subtitle: owner ? `YouTube Playlist • ${owner}` : 'YouTube Playlist',
          thumbnail: imgSources.length ? imgSources[imgSources.length - 1].url || '' : '',
          is_editorial: false,
          source: 'youtube'
        })
      }
    }

    const tokens = [...findNodes(data, 'continuationCommand')].map((c) => c?.token).filter(Boolean)
    if (!tokens.length) break
    body = { context: YT_WEB_CONTEXT, continuation: tokens[0] }
  }
  return { videos, playlists }
}

export async function ytmSearchRaw(query, songsOnly) {
  const body = { context: YTM_CONTEXT, query }
  if (songsOnly) body.params = YTM_SONGS_PARAM
  try {
    const r = await callInnertube('search', body, 'music')
    return r.ok ? await r.json() : {}
  } catch {
    return {}
  }
}

export function parseYtmSongs(data) {
  const out = []
  const seen = new Set()
  for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
    const vid = item?.playlistItemData?.videoId
    if (!vid || vid.length !== 11 || seen.has(vid)) continue
    const cols = (item.flexColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFlexColumnRenderer'))
    const fixed = (item.fixedColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFixedColumnRenderer'))
    if (!cols[0]) continue
    const meta = cols[1] || ''
    const plays = cols[2] || ''
    if (BLOCKED_META.some((b) => meta.includes(b))) continue
    const parts = meta.split('•').map((s) => s.trim()).filter(Boolean)
    if (parts[0] === 'Song' || parts[0] === 'Video') parts.shift()
    let dur = ''
    if (fixed[0] && /^\d{1,2}:\d{2}(:\d{2})?$/.test(fixed[0])) {
      dur = fixed[0]
    } else if (parts.length && /^\d{1,2}:\d{2}(:\d{2})?$/.test(parts[parts.length - 1])) {
      dur = parts.pop()
    } else {
      const m = [...cols, ...fixed].join(' ').match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)
      if (m) dur = m[1]
    }
    const album = parts[1] && !/\b(?:plays?|views?)\b/i.test(parts[1]) ? parts[1] : ''
    const yearMatch = meta.match(/\b(19\d\d|20\d\d)\b/)
    const release_date = yearMatch ? yearMatch[0] : (parts[2] && !/\b(?:plays?|views?)\b/i.test(parts[2]) ? parts[2] : '')
    const bits = []
    if (album && album.toLowerCase() !== cols[0].toLowerCase()) bits.push(`Album: ${album}`)
    if (plays) bits.push(plays)
    const reason = bits.length ? bits.join(' • ') : 'YouTube Music song'
    const trackObj = {
      title: cols[0],
      artist: parts[0] || 'Unknown Artist',
      video_id: vid,
      fallback_ids: [],
      duration_text: dur,
      release_date,
      play_count_num: parsePlayCount(`${meta} ${plays}`),
      thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${vid}`,
      match_tier: 'Direct Match',
      reason,
      why_it_fits: reason,
      vibe: 'YT Music'
    }
    if (!isValidMusicTrack(trackObj)) continue
    seen.add(vid)
    out.push(trackObj)
    if (out.length >= 25) break
  }

  // Cross-populate fallback_ids among songs with matching titles
  for (let i = 0; i < out.length; i++) {
    const tA = out[i]
    const cleanA = (tA.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const fallbacks = []
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue
      const tB = out[j]
      const cleanB = (tB.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (cleanA && cleanB && (cleanA.includes(cleanB) || cleanB.includes(cleanA))) {
        if (tB.video_id && !fallbacks.includes(tB.video_id)) {
          fallbacks.push(tB.video_id)
        }
      }
    }
    tA.fallback_ids = fallbacks
  }

  return out
}

function parseYtmPlaylists(data) {
  const out = []
  const seen = new Set()
  for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
    const bid = item?.navigationEndpoint?.browseEndpoint?.browseId || ''
    if (!bid.startsWith('VL') || seen.has(bid)) continue
    const cols = (item.flexColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFlexColumnRenderer'))
    if (!cols[0]) continue
    const meta = cols[1] || 'Playlist'
    seen.add(bid)
    const thumbs = item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
    out.push({
      browse_id: bid,
      title: cols[0],
      subtitle: meta,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url || '' : '',
      is_editorial: meta.includes('YouTube Music') || bid.startsWith('VLRDCLAK'),
      source: 'ytmusic'
    })
  }
  return out
}

async function withTimeout(promise, ms, fallback = []) {
  let timerId
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise((resolve) => {
        timerId = setTimeout(() => resolve(fallback), ms)
      })
    ])
  } finally {
    if (timerId) clearTimeout(timerId)
  }
}

export function buildCuratedSongResults(rankedSongs = [], sameArtistTracks = [], watchRadioTracks = [], query = '', maxTracks = 25) {
  if (!rankedSongs.length) return []
  const topSong = { ...rankedSongs[0], match_tier: 'Best Match' }
  const topArtist = canonicalArtistName(topSong.artist)
  const out = [topSong]
  const seenIds = new Set([topSong.video_id])
  const byTitleKey = new Map([[canonicalSongTitle(topSong.title) || topSong.video_id, topSong]])

  const tryAppend = (rawTrack, reasonLabel) => {
    if (!rawTrack?.video_id || seenIds.has(rawTrack.video_id)) return false
    if (!isValidMusicTrack(rawTrack) || isUnrequestedVariant(rawTrack, query)) return false
    const tKey = canonicalSongTitle(rawTrack.title) || rawTrack.video_id
    const tArtist = canonicalArtistName(rawTrack.artist)
    if (byTitleKey.has(tKey)) {
      const existing = byTitleKey.get(tKey)
      const exArtist = canonicalArtistName(existing.artist)
      if (!tArtist || !exArtist || tArtist === exArtist || exArtist.includes(tArtist) || tArtist.includes(exArtist)) {
        if (!existing.fallback_ids.includes(rawTrack.video_id)) {
          existing.fallback_ids.push(rawTrack.video_id)
        }
      }
      seenIds.add(rawTrack.video_id)
      return false
    }
    const entry = {
      ...rawTrack,
      fallback_ids: Array.isArray(rawTrack.fallback_ids) ? [...rawTrack.fallback_ids] : [],
      reason: rawTrack.reason && rawTrack.reason !== 'Similar vibe' ? rawTrack.reason : reasonLabel,
      why_it_fits: reasonLabel || rawTrack.why_it_fits || rawTrack.reason
    }
    seenIds.add(entry.video_id)
    byTitleKey.set(tKey, entry)
    out.push(entry)
    return true
  }

  const cleanArtistPool = sameArtistTracks.filter((t) => {
    const tArt = canonicalArtistName(t?.artist)
    return !topArtist || !tArt || tArt === topArtist || tArt.includes(topArtist) || topArtist.includes(tArt)
  })

  // Interleave same-artist hits and Watch Radio vibe-matched songs so results #2..#25
  // showcase both the primary artist's catalog and sonically similar tracks
  const maxLen = Math.max(cleanArtistPool.length, watchRadioTracks.length)
  for (let i = 0; i < maxLen && out.length < maxTracks; i++) {
    if (i < cleanArtistPool.length && out.length < maxTracks) {
      tryAppend(cleanArtistPool[i], topSong.artist ? `More by ${topSong.artist}` : 'Similar artist')
    }
    if (i < watchRadioTracks.length && out.length < maxTracks) {
      tryAppend(watchRadioTracks[i], `Similar vibe to ${topSong.title}`)
    }
  }

  for (let i = 1; i < rankedSongs.length && out.length < maxTracks; i++) {
    tryAppend(rankedSongs[i], rankedSongs[i].reason || 'Related match')
  }

  return out.slice(0, maxTracks)
}

/**
 * Zero-token direct search combining YouTube Music songs, watch-radio vibe expansion,
 * and playlists with strict deduplication and unrequested derivative filtering.
 */
export async function directSearchStandalone(query, mode = 'auto') {
  const qClean = (query || '').trim()
  if (!qClean) {
    return { playlist_title: 'Direct Search', tracks: [], matched_playlists: [], song_results: [], youtube_results: [] }
  }

  const cacheKey = `${qClean.toLowerCase()}::${mode}`
  const cached = directSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < 20 * 60 * 1000) return cached.data

  const [yt, ytmSongsRaw, ytmAllRaw] = await Promise.all([
    ytWebSearch(qClean, 2),
    ytmSearchRaw(qClean, true),
    ytmSearchRaw(qClean, false)
  ])
  let youtubeResults = yt.videos.slice(0, 40)
  let ytmSongs = parseYtmSongs(ytmSongsRaw)
  let ytmPlaylists = parseYtmPlaylists(ytmAllRaw)

  // Query Simplification Fallback: if over-constrained query yielded 0 tracks, retry with core keywords
  if (youtubeResults.length === 0 && ytmSongs.length === 0) {
    const strippedQuery = qClean
      .replace(/\b(radio playlist|top charting rotation|latest hits|trending viral|essential mix|rotation|fresh picks 2026)\b/gi, '')
      .trim()
    const fallbackTokens = queryTokens(strippedQuery)
    if (fallbackTokens.length > 0) {
      const simplifiedQuery = fallbackTokens.slice(0, 3).join(' ')
      if (simplifiedQuery && simplifiedQuery !== qClean.toLowerCase()) {
        try {
          const [ytFallback, ytmFallbackRaw] = await Promise.all([
            ytWebSearch(simplifiedQuery, 2),
            ytmSearchRaw(simplifiedQuery, true)
          ])
          if (ytFallback.videos?.length) youtubeResults = ytFallback.videos.slice(0, 40)
          const parsedSongs = parseYtmSongs(ytmFallbackRaw)
          if (parsedSongs.length) ytmSongs = parsedSongs
        } catch {}
      }
    }
  }

  const tokens = queryTokens(qClean)
  const seenTitles = new Set()
  const matchedPlaylists = []
  for (const pl of [...yt.playlists, ...ytmPlaylists]) {
    const key = pl.title.trim().toLowerCase()
    if (seenTitles.has(key)) continue
    const score = relevance(pl.title, tokens)
    if (score < 0.5) continue // drop unrelated "suggested" playlists
    seenTitles.add(key)
    matchedPlaylists.push({ ...pl, relevance: Math.round(score * 100) / 100 })
  }
  matchedPlaylists.sort((a, b) => b.relevance - a.relevance) // stable: keeps YouTube order on ties
  matchedPlaylists.splice(6)

  const hasExplicitPlaylistWords = EXPLICIT_PLAYLIST_INTENT_REGEX.test(qClean)
  const isPlaylistIntent = mode === 'playlists' || (mode === 'auto' && hasExplicitPlaylistWords)

  const validYtm = ytmSongs.filter(isValidMusicTrack)
  const validYt = youtubeResults.filter(isValidMusicTrack)

  // Build artist consensus across YouTube Music & YouTube Web top results
  const ytmTopArtists = new Set(validYtm.slice(0, 3).map((t) => canonicalArtistName(t.artist)).filter(Boolean))
  const ytTopArtists = new Set(validYt.slice(0, 3).map((t) => canonicalArtistName(t.artist)).filter(Boolean))
  const consensusArtists = new Set([...ytmTopArtists].filter((a) => ytTopArtists.has(a)))
  const qNormTitle = canonicalSongTitle(qClean)
  if (validYtm[0] && canonicalSongTitle(validYtm[0].title) === qNormTitle) {
    const a0 = canonicalArtistName(validYtm[0].artist)
    if (a0) consensusArtists.add(a0)
  }

  const cleanYtVideos = deduplicateSearchSongs(validYt, qClean, consensusArtists)
  const rankedSongs = deduplicateSearchSongs([...validYtm, ...validYt], qClean, consensusArtists)

  let finalSongs = rankedSongs
  if (!isPlaylistIntent && !hasExplicitPlaylistWords && rankedSongs.length > 0 && rankedSongs[0].video_id) {
    const topSong = rankedSongs[0]
    const topArtistRaw = String(topSong.artist || '').split(/,|&|\bfeat\.?|\bft\.?/i)[0].trim()
    const topArtistNorm = canonicalArtistName(topArtistRaw)
    const shouldFetchArtistSongs =
      topArtistNorm &&
      topArtistNorm !== 'unknown artist' &&
      topArtistNorm !== 'youtube' &&
      topArtistNorm !== qNormTitle

    const [watchRadioTracks, sameArtistTracks] = await Promise.all([
      withTimeout(fetchYtmWatchRadio(topSong.video_id, 20), 2800, []),
      shouldFetchArtistSongs
        ? withTimeout(ytmSearchRaw(`${topArtistRaw} top songs`, true).then(parseYtmSongs), 2800, [])
        : Promise.resolve([])
    ])

    finalSongs = buildCuratedSongResults(rankedSongs, sameArtistTracks, watchRadioTracks, qClean, 25)
  }

  // Default to curated, deduplicated song results (top match #1 + artist/vibe tracks)
  let activeSource = finalSongs.length > 0 ? 'songs' : (cleanYtVideos.length > 0 ? 'youtube' : 'songs')
  let activeBrowseId = ''
  let tracks = finalSongs.length > 0 ? finalSongs : cleanYtVideos
  let playlistTitle = `"${qClean}"`
  let vibe = tracks.length > 0
    ? `Music tracks : ${tracks.length} songs`
    : 'No matching tracks'

  if (isPlaylistIntent && matchedPlaylists.length) {
    const top = matchedPlaylists[0]
    const plTracks = await browsePlaylistStandalone(top.browse_id, top.title, top.subtitle)
    const cleanPlTracks = plTracks.filter(isValidMusicTrack)
    if (cleanPlTracks.length) {
      tracks = cleanPlTracks
      activeSource = 'playlist'
      activeBrowseId = top.browse_id
      playlistTitle = top.title
      vibe = `Curated playlist : ${cleanPlTracks.length} tracks`
    }
  } else if (mode === 'songs' && finalSongs.length) {
    activeSource = 'songs'
    tracks = finalSongs
    vibe = `Music tracks : ${finalSongs.length} songs`
  }

  if (!tracks.length) {
    tracks = finalSongs.length ? finalSongs : cleanYtVideos
    activeSource = finalSongs.length ? 'songs' : 'youtube'
  }

  const payload = {
    playlist_title: playlistTitle,
    subtitle: vibe,
    vibe_description: vibe,
    curator_note: vibe,
    used_model: 'direct-search (0 tokens)',
    requested_model: 'direct-search',
    is_fallback: false,
    is_direct_search: true,
    search_query: qClean,
    active_source: activeSource,
    active_browse_id: activeBrowseId,
    matched_playlists: matchedPlaylists,
    youtube_results: cleanYtVideos,
    song_results: finalSongs,
    tracks
  }
  directSearchCache.set(cacheKey, { data: payload, ts: Date.now() })
  return payload
}

export async function ytmSearchItems(query) {
  const resp = await callInnertube('search', { context: YTM_CONTEXT, query }, 'music')
  if (!resp.ok) return []
  const data = await resp.json()
  const out = []
  for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
    const vid = item?.playlistItemData?.videoId
    if (!vid || vid.length !== 11) continue
    const cols = (item.flexColumns || []).map((c) =>
      (c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map((r) => r.text || '').join('').trim()
    )
    const fixed = (item.fixedColumns || []).map((c) =>
      (c?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || []).map((r) => r.text || '').join('').trim()
    )
    const meta = cols[1] || ''
    if (BLOCKED_META.some((b) => meta.includes(b))) continue
    const metaParts = meta.split('•').map((s) => s.trim()).filter(Boolean)
    let dur = ''
    if (fixed[0] && /^\d{1,2}:\d{2}(:\d{2})?$/.test(fixed[0])) {
      dur = fixed[0]
    } else {
      const m = [...cols, ...fixed].join(' ').match(/\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b/)
      if (m) dur = m[1]
    }
    if (!out.some((o) => o.video_id === vid)) {
      out.push({ title: cols[0] || '', artist: metaParts[1] || meta, video_id: vid, duration_text: dur })
    }
  }
  return out
}

export async function searchYouTubeStandalone(query) {
  const key = query.trim().toLowerCase()
  if (searchCache.has(key)) return searchCache.get(key)
  try {
    let items = []
    try {
      items = await ytmSearchItems(query)
    } catch {}
    if (!items.length) {
      try {
        const webRes = await ytWebSearch(query, 1)
        items = webRes?.videos || []
      } catch {}
    }
    if (!items.length) return null
    const vid = items[0].video_id
    const res = {
      video_id: vid,
      fallback_ids: items.slice(1, 4).map((i) => i.video_id),
      duration_text: items[0].duration_text || '',
      thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${vid}`
    }
    searchCache.set(key, res)
    return res
  } catch {
    return null
  }
}

/**
 * Searches YouTube Music and returns a list of matching tracks for adding seeds.
 */
export async function searchYouTubeMusicList(query) {
  if (!query || !query.trim()) return []
  try {
    const items = await ytmSearchItems(query)
    return items
      .map((it) => ({
        video_id: it.video_id,
        title: it.title || 'Unknown Title',
        artist: it.artist || 'Unknown Artist',
        thumbnail: `https://i.ytimg.com/vi/${it.video_id}/hqdefault.jpg`,
        duration_text: it.duration_text || '',
        url: `https://www.youtube.com/watch?v=${it.video_id}`
      }))
      .filter(isValidMusicTrack)
  } catch (err) {
    console.error('searchYouTubeMusicList error:', err)
    return []
  }
}

/**
 * Imports tracks from a YouTube or YouTube Music playlist / mix URL.
 */
export async function importYouTubePlaylistStandalone(urlOrQuery) {
  if (!urlOrQuery) return []
  try {
    let browseId = null
    const listMatch = urlOrQuery.match(/[?&]list=([^&]+)/)
    if (listMatch) {
      browseId = listMatch[1].startsWith('VL') ? listMatch[1] : `VL${listMatch[1]}`
    }

    if (browseId) {
      const res = await browsePlaylistStandalone(browseId)
      if (res && res.tracks && res.tracks.length) {
        return res.tracks.filter(isValidMusicTrack)
      }
    }

    // Fallback: direct search for the query / title
    const searchRes = await directSearchStandalone(urlOrQuery, 'songs')
    if (searchRes && searchRes.tracks && searchRes.tracks.length) {
      return searchRes.tracks.filter(isValidMusicTrack)
    }
    return []
  } catch (err) {
    console.error('importYouTubePlaylistStandalone error:', err)
    return []
  }
}


// ---------------------------------------------------------------------------
// Official YouTube Music Charts Sync (FEmusic_charts)
// Thumbnails are live: each station uses the current #1 track's artwork from the
// chart itself (falls back to YouTube's official chart cover art).
// ---------------------------------------------------------------------------

const STATION_COLORS = [
  'from-rose-600/40 to-black',
  'from-amber-600/40 to-black',
  'from-indigo-600/40 to-black',
  'from-cyan-600/40 to-black',
  'from-purple-600/40 to-black',
  'from-emerald-600/40 to-black'
]

export const DEFAULT_YT_CHARTS_STATIONS = [
  {
    id: 'yt_chart_trending_in',
    browse_id: 'VLOLAK5uy_lSTp1DIuzZBUyee3kDsXwPgP25WdfwB40',
    title: 'Trending 20 India',
    subtitle: 'Chart • YouTube Charts',
    query: 'Trending 20 India latest hit songs',
    thumbnail: 'https://yt3.googleusercontent.com/WI2UEaJBjl5bvSz12by1__hO_EZNyuyTChu9LfuQ9J__PtSx17FT5p8kDV4BKBmCnEb2pkkmhS0=s576',
    color: STATION_COLORS[0]
  },
  {
    id: 'yt_chart_weekly_hindi',
    browse_id: 'VLPL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX',
    title: 'Top Weekly Hindi',
    subtitle: 'Chart • YouTube Charts',
    query: 'Top Weekly Hindi songs latest Bollywood chartbusters',
    thumbnail: 'https://yt3.googleusercontent.com/1n6BXDFo06jkTV1M-PIKTVzWnJ0G2bO1dEULK8hd696MNPmKbCufOLTJKyNn_vw1CZp5A7-y5A=s576',
    color: STATION_COLORS[1]
  },
  {
    id: 'yt_chart_weekly_intl',
    browse_id: 'VLPL4fGSI1pDJn49TUu37nJoN2QTeYuRwmNv',
    title: 'Top Weekly International',
    subtitle: 'Chart • YouTube Charts',
    query: 'Top Weekly International global pop hits',
    thumbnail: 'https://yt3.googleusercontent.com/L9VXOyadNeUOMdulaFpShmaUd2uZzwxX-kp75nxYbkC83hKSfsSZ60sxD--nnyB1gbhpT1dNjrt_=s576',
    color: STATION_COLORS[2]
  },
  {
    id: 'yt_chart_daily_top',
    browse_id: 'VLPL4fGSI1pDJn5oibdgJt8Hy0-dr2B7kSs2',
    title: 'Daily Top Music Videos',
    subtitle: 'Chart • YouTube Charts',
    query: 'Daily Top Music Videos India trending hits',
    thumbnail: 'https://yt3.googleusercontent.com/sKX7k9NOsv3uxZiNZS3oVEsQvL7t9hVD-8mNtFsYeX3b7e5Txi3MmIkg4uFQkEyDfGv5xlg2Yxg=s576',
    color: STATION_COLORS[3]
  },
  {
    id: 'yt_chart_released',
    browse_id: 'VLRDCLAK5uy_ksEjgm3H_7zOJ_RHzRjN1wY-_FFcs7aAU',
    title: 'RELEASED: Fresh Hits',
    subtitle: 'Official • YouTube Music',
    query: 'New music releases latest hits official playlist',
    thumbnail: 'https://yt3.googleusercontent.com/lOelGF98ZubR8vIHHka6or5abqPOhGlLsLQgwUoXTfpWW8lNLMWh35e8Y7o4_Dx6AkJgsdC1trMzIqo=w544-h544-l90-rj',
    color: STATION_COLORS[4]
  },
  {
    id: 'yt_chart_top100',
    browse_id: 'VLPL4fGSI1pDJn40WjZ6utkIuj2rNg-7iGsq',
    title: 'Top 100 Music Videos',
    subtitle: 'Chart • YouTube Charts',
    query: 'Top 100 Music Videos India official chart',
    thumbnail: 'https://yt3.googleusercontent.com/QCTBEmkHpNlVAUXqZxRnA3pBDjOHVu6hYOC4ohJxahRsBk1Ipq12UckceblwYonwGwWCgaph5lJp=s576',
    color: STATION_COLORS[5]
  }
]

const CHARTS_CACHE_KEY = 'upbeat_yt_charts_cache_v2'
let _chartsMemoryCache = null

/** Returns the current #1 track's artwork URL for a chart/playlist, or '' on failure. */
async function fetchChartTopArtwork(browseId) {
  try {
    const resp = await callInnertube('browse', { context: YTM_CONTEXT, browseId }, 'music')
    if (!resp.ok) return ''
    const data = await resp.json()
    for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
      const vid = item?.playlistItemData?.videoId
      if (vid && vid.length === 11) return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
    }
  } catch {}
  return ''
}

async function withLiveArtwork(stations) {
  const arts = await Promise.all(stations.map((s) => (s.browse_id ? fetchChartTopArtwork(s.browse_id) : '')))
  return stations.map((s, i) => (arts[i] ? { ...s, thumbnail: arts[i], cover: s.thumbnail } : s))
}

export async function fetchOfficialYoutubeCharts() {
  if (_chartsMemoryCache && Date.now() - _chartsMemoryCache.ts < 60 * 60 * 1000) {
    return _chartsMemoryCache.stations
  }

  try {
    const raw = localStorage.getItem(CHARTS_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.stations?.length >= 4 && Date.now() - (parsed.ts || 0) < 2 * 60 * 60 * 1000) {
        _chartsMemoryCache = parsed
        return parsed.stations
      }
    }
  } catch {}

  try {
    let liveCharts = []
    const resp = await callInnertube('browse', { context: YTM_CONTEXT, browseId: 'FEmusic_charts' }, 'music')
    if (resp.ok) {
      const data = await resp.json()
      const seenIds = new Set()
      const blockedRegional = /bhojpuri|haryanvi|telugu|tamil/i

      for (const r of findNodes(data, 'musicTwoRowItemRenderer')) {
        const bid = r?.navigationEndpoint?.browseEndpoint?.browseId || ''
        if (!bid.startsWith('VL') || seenIds.has(bid)) continue
        const rawTitle = (r.title?.runs || []).map((x) => x.text || '').join('').trim()
        const rawSub = (r.subtitle?.runs || []).map((x) => x.text || '').join('').trim()
        if (!rawTitle || blockedRegional.test(rawTitle)) continue

        seenIds.add(bid)
        const cleanTitle = rawTitle
          .replace(/^Top Weekly Videos\s+/i, 'Top Weekly ')
          .replace(/\s+-\s+India$/i, '')
          .trim()
        const cover = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
        const fallback = DEFAULT_YT_CHARTS_STATIONS.find((d) => d.browse_id === bid)

        liveCharts.push({
          id: `yt_chart_${bid}`,
          browse_id: bid,
          title: cleanTitle,
          subtitle: rawSub || 'Chart • YouTube Charts',
          query: `${cleanTitle} official YouTube chart songs`,
          thumbnail: cover || fallback?.thumbnail || DEFAULT_YT_CHARTS_STATIONS[0].thumbnail,
          color: STATION_COLORS[liveCharts.length % STATION_COLORS.length]
        })
        if (liveCharts.length >= 6) break
      }

      if (liveCharts.length < 6 && !seenIds.has(DEFAULT_YT_CHARTS_STATIONS[4].browse_id)) {
        liveCharts.push({ ...DEFAULT_YT_CHARTS_STATIONS[4], color: STATION_COLORS[liveCharts.length % STATION_COLORS.length] })
      }
    }

    const base = liveCharts.length >= 4 ? liveCharts : DEFAULT_YT_CHARTS_STATIONS
    const finalStations = await withLiveArtwork(base)
    _chartsMemoryCache = { stations: finalStations, ts: Date.now() }
    try {
      localStorage.removeItem('upbeat_yt_charts_cache_v1')
      localStorage.setItem(CHARTS_CACHE_KEY, JSON.stringify(_chartsMemoryCache))
    } catch {}
    return finalStations
  } catch {
    return DEFAULT_YT_CHARTS_STATIONS
  }
}
