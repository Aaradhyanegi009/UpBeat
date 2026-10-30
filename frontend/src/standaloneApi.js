// UpBeat platform layer.
// - Desktop / PWA served by the Mac backend: talk to same-origin `/api`.
// - Android APK (Capacitor): talk to a configured Mac server URL if set; otherwise run the
//   fully standalone engine (Gemini direct + YouTube Music search + direct audio streams).
//   Native HTTP (CapacitorHttp) is enabled in capacitor.config.json, which lets `fetch`
//   reach music.youtube.com / youtube.com without browser CORS restrictions.

const MODEL_ALIASES = {
  'gemini-4-argon': 'gemini-robotics-er-2-preview',
  'gemini-er-2-flash': 'gemini-robotics-er-2-preview'
}
const LOW_THINKING_MODELS = new Set(['gemini-3.8-flash', 'gemini-3.7-flash'])
const ZERO_BUDGET_MODELS = new Set(['gemini-2.5-flash', 'gemini-robotics-er-2-preview'])

// ---------------------------------------------------------------------------
// Platform + settings
// ---------------------------------------------------------------------------

export function isNativeApp() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

export function getStoredApiKey() {
  return localStorage.getItem('upbeat_gemini_api_key') || ''
}

export function setStoredApiKey(key) {
  localStorage.setItem('upbeat_gemini_api_key', (key || '').trim())
}

export function getStoredServerUrl() {
  return (localStorage.getItem('upbeat_server_url') || '').trim().replace(/\/+$/, '')
}

export function setStoredServerUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`
  localStorage.setItem('upbeat_server_url', u)
}

/** True when a Mac backend is reachable in principle (same-origin web, or configured URL in the APK). */
export function hasBackend() {
  if (!isNativeApp()) return true
  return Boolean(getStoredServerUrl())
}

/** Open URL in Android native external browser/app or web new tab */
export function openExternalUrl(url) {
  if (!url) return
  const safeUrl = String(url).trim()
  if (!safeUrl) return

  // 1. Android Native Capacitor Bridge
  if (typeof window !== 'undefined' && window.UpBeatNative && typeof window.UpBeatNative.openExternalUrl === 'function') {
    try {
      window.UpBeatNative.openExternalUrl(safeUrl)
      return
    } catch {}
  }

  // 2. Web browser fallback: open in new tab
  try {
    const win = window.open(safeUrl, '_blank', 'noopener,noreferrer')
    if (!win) {
      const a = document.createElement('a')
      a.href = safeUrl
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  } catch {
    window.location.href = safeUrl
  }
}

/** Base for backend API calls. */
export function getApiBase() {
  const custom = getStoredServerUrl()
  if (custom) return `${custom}/api`
  return '/api'
}

export function apiUrl(path) {
  return `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Proxy-aware Innertube API request.
 * - In Capacitor native app (Android): direct fetch uses CapacitorHttp to bypass CORS.
 * - In browser / PWA (iPhone, Mac, Windows): routes via `/api/innertube` (Vercel Edge or Mac backend)
 *   to avoid browser CORS blocks.
 */
export async function callInnertube(endpoint, payload, service = 'music') {
  const host = service === 'youtube' ? 'https://www.youtube.com' : 'https://music.youtube.com'

  if (isNativeApp()) {
    return fetch(`${host}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }

  try {
    const proxyRes = await fetch(apiUrl('/innertube'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        body: payload,
        service
      })
    })
    if (proxyRes.ok) return proxyRes
  } catch {}

  // Fallback to direct fetch
  return fetch(`${host}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

/** True if the app can curate right now (backend available or Gemini key saved). */
export function isConfigured() {
  return hasBackend() || Boolean(getStoredApiKey())
}

// ---------------------------------------------------------------------------
// Gemini (direct)
// ---------------------------------------------------------------------------

function cleanJsonText(raw) {
  let s = (raw || '').trim()
  if (s.startsWith('```json')) s = s.slice(7)
  else if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  return JSON.parse(s.trim())
}

function describeError(status, model) {
  if (status === 429) return `Free-tier quota reached (HTTP 429) on ${model}`
  if (status === 503) return `High server demand (HTTP 503) on ${model}`
  if (status === 400 || status === 403) return `API key rejected (HTTP ${status}) on ${model}`
  if (status === 404) return `Model unavailable (HTTP 404): ${model}`
  return `HTTP ${status} on ${model}`
}

async function callGeminiDirect(modelId, prompt, apiKey) {
  const endpoint = MODEL_ALIASES[modelId] || modelId
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpoint}:generateContent?key=${encodeURIComponent(apiKey)}`

  const generationConfig = { temperature: 0.55 }
  if (!endpoint.includes('gemma')) generationConfig.responseMimeType = 'application/json'
  if (ZERO_BUDGET_MODELS.has(endpoint) || endpoint.includes('2.5-flash')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  } else if (LOW_THINKING_MODELS.has(endpoint)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'LOW' }
  } else if (endpoint.includes('gemini-3') || endpoint.includes('flash-lite') || endpoint.includes('gemma-4')) {
    generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
  })
  if (!resp.ok) {
    const err = new Error(describeError(resp.status, modelId))
    err.status = resp.status
    throw err
  }

  const body = await resp.json()
  const parts = body?.candidates?.[0]?.content?.parts || []
  let text = ''
  for (const p of parts) if (p.text && !p.thought) text += p.text
  if (!text && parts.length > 0) text = parts[parts.length - 1].text || ''

  let parsed = cleanJsonText(text)
  if (Array.isArray(parsed)) parsed = { tracks: parsed }
  return parsed
}

export async function generateWithDirectGemini(prompt, preferredModel = 'gemini-3.8-flash') {
  const apiKey = getStoredApiKey()
  if (!apiKey) {
    throw new Error('Add your Gemini API key in Settings (key icon) to curate on this device.')
  }

  const pool = [
    preferredModel,
    'gemini-3.8-flash',
    'gemini-4-argon',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemma-4-26b-a4b-it'
  ]
  const seen = new Set()
  const candidates = pool.filter((m) => {
    const ep = MODEL_ALIASES[m] || m
    if (seen.has(ep)) return false
    seen.add(ep)
    return true
  })

  const attempts = []
  let primaryReason = ''
  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i]
    const t0 = performance.now()
    try {
      const res = await callGeminiDirect(m, prompt, apiKey)
      const latency = Math.round(performance.now() - t0)
      attempts.push({ model: m, status: 'ok', latency_ms: latency })
      return {
        ...res,
        requested_model: preferredModel,
        used_model: m,
        is_fallback: i > 0,
        latency_ms: latency,
        model_attempts: attempts,
        fallback_reason: i > 0 ? primaryReason : '',
        fallback_note: i > 0 ? `${primaryReason} -> generated by ${m}` : ''
      }
    } catch (err) {
      const reason = err.message || `Error on ${m}`
      attempts.push({ model: m, status: 'error', reason, latency_ms: Math.round(performance.now() - t0) })
      if (i === 0) primaryReason = reason
      // An invalid key will fail on every model; stop early.
      if (err.status === 400 || err.status === 403) throw new Error(reason)
    }
  }
  throw new Error(`All Gemini models failed (${primaryReason})`)
}

// ---------------------------------------------------------------------------
// YouTube Music search (WEB_REMIX Innertube) — native HTTP in the APK
// ---------------------------------------------------------------------------

const YTM_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20260918.01.00', hl: 'en', gl: 'IN' }
}
const BLOCKED_META = ['Episode', 'Podcast', 'Release - Topic', 'Lights on the Ceiling']
const searchCache = new Map()
const directSearchCache = new Map()
const playlistBrowseCache = new Map()

const PLAYLIST_KEYWORDS = [
  'playlist', 'new ', 'latest', 'top ', 'best ', 'hits', 'hitlist',
  'songs', 'ost', 'soundtrack', '2024', '2025', '2026', 'collection',
  'mix', 'chart', 'trending', 'essentials'
]

function* findNodes(obj, key) {
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

      tracks.push({
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
      })
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
      videos.push({
        title: runsText(v.title),
        artist: runsText(v.ownerText) || runsText(v.longBylineText) || 'YouTube',
        video_id: vid,
        fallback_ids: [],
        duration_text: dur,
        release_date: published || '',
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${vid}`,
        match_tier: 'Direct Match',
        reason: meta,
        why_it_fits: meta,
        vibe: 'YouTube'
      })
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
        playlists.push({
          browse_id: `VL${pid}`,
          title,
          subtitle: owner ? `YouTube Playlist • ${owner}` : 'YouTube Playlist',
          thumbnail: '',
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

async function ytmSearchRaw(query, songsOnly) {
  const body = { context: YTM_CONTEXT, query }
  if (songsOnly) body.params = YTM_SONGS_PARAM
  try {
    const r = await callInnertube('search', body, 'music')
    return r.ok ? await r.json() : {}
  } catch {
    return {}
  }
}

function parseYtmSongs(data) {
  const out = []
  const seen = new Set()
  for (const item of findNodes(data, 'musicResponsiveListItemRenderer')) {
    const vid = item?.playlistItemData?.videoId
    if (!vid || vid.length !== 11 || seen.has(vid)) continue
    const cols = (item.flexColumns || []).map((c) => extractColText(c, 'musicResponsiveListItemFlexColumnRenderer'))
    if (!cols[0]) continue
    const meta = cols[1] || ''
    const plays = cols[2] || ''
    if (BLOCKED_META.some((b) => meta.includes(b))) continue
    const parts = meta.split('•').map((s) => s.trim()).filter(Boolean)
    if (parts[0] === 'Song' || parts[0] === 'Video') parts.shift()
    let dur = ''
    if (parts.length && /^\d{1,2}:\d{2}(:\d{2})?$/.test(parts[parts.length - 1])) dur = parts.pop()
    const album = parts[1] || ''
    const yearMatch = meta.match(/\b(19\d\d|20\d\d)\b/)
    const release_date = yearMatch ? yearMatch[0] : (parts[2] || '')
    const bits = []
    if (album && album.toLowerCase() !== cols[0].toLowerCase()) bits.push(`Album: ${album}`)
    if (plays) bits.push(plays)
    const reason = bits.length ? bits.join(' • ') : 'YouTube Music song'
    seen.add(vid)
    out.push({
      title: cols[0],
      artist: parts[0] || 'Unknown Artist',
      video_id: vid,
      fallback_ids: [],
      duration_text: dur,
      release_date,
      thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${vid}`,
      match_tier: 'Direct Match',
      reason,
      why_it_fits: reason,
      vibe: 'YT Music'
    })
    if (out.length >= 25) break
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
    out.push({
      browse_id: bid,
      title: cols[0],
      subtitle: meta,
      thumbnail: '',
      is_editorial: meta.includes('YouTube Music') || bid.startsWith('VLRDCLAK'),
      source: 'ytmusic'
    })
  }
  return out
}

/**
 * Zero-token direct search that mirrors youtube.com:
 * - Primary list = YouTube search results in YouTube's exact order.
 * - YT Music songs + only *relevant* playlists available as 1-tap alternatives.
 * - Playlists are auto-loaded only when the query explicitly says "playlist".
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
  const youtubeResults = yt.videos.slice(0, 40)
  const ytmSongs = parseYtmSongs(ytmSongsRaw)
  const ytmPlaylists = parseYtmPlaylists(ytmAllRaw)

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

  const wantsPlaylist = mode === 'playlists' || (mode === 'auto' && qClean.toLowerCase().includes('playlist'))

  let activeSource = 'youtube'
  let activeBrowseId = ''
  let tracks = youtubeResults
  let playlistTitle = `"${qClean}"`
  let vibe = `YouTube results : ${youtubeResults.length} videos`

  if (mode === 'songs' && ytmSongs.length) {
    activeSource = 'songs'
    tracks = ytmSongs
    vibe = `YouTube results : ${ytmSongs.length} videos`
  } else if (wantsPlaylist && matchedPlaylists.length) {
    const top = matchedPlaylists[0]
    const plTracks = await browsePlaylistStandalone(top.browse_id, top.title, top.subtitle)
    if (plTracks.length) {
      tracks = plTracks
      activeSource = 'playlist'
      activeBrowseId = top.browse_id
      playlistTitle = top.title
      vibe = `YouTube results : ${plTracks.length} videos`
    }
  }

  if (!tracks.length) {
    tracks = ytmSongs
    activeSource = 'songs'
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
    youtube_results: youtubeResults,
    song_results: ytmSongs,
    tracks
  }
  directSearchCache.set(cacheKey, { data: payload, ts: Date.now() })
  return payload
}

async function ytmSearchItems(query) {
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
    const items = await ytmSearchItems(query)
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

// ---------------------------------------------------------------------------
// Direct audio stream resolution (Innertube player, ANDROID + IOS clients)
// ---------------------------------------------------------------------------

const ANDROID_PLAYER_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
  osName: 'Android',
  osVersion: '14',
  androidSdkVersion: 34,
  hl: 'en',
  gl: 'US'
}

const IOS_PLAYER_CLIENT = {
  clientName: 'IOS',
  clientVersion: '20.10.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iPhone',
  osVersion: '18.3.2.22D82',
  hl: 'en',
  gl: 'US'
}

const streamCache = new Map()

/** Returns { url, duration } for a video id (works in the APK without the Mac). */
export async function resolveStandaloneAudio(videoId) {
  if (!videoId) return null
  const cached = streamCache.get(videoId)
  if (cached && Date.now() - cached.ts < 25 * 60 * 1000) return cached

  for (const client of [ANDROID_PLAYER_CLIENT, IOS_PLAYER_CLIENT]) {
    try {
      const resp = await callInnertube('player', {
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
      }, 'youtube')
      if (!resp.ok) continue
      const data = await resp.json()
      if (data?.playabilityStatus?.status !== 'OK') continue

      // Prefer progressive formats (itag 18) first because Android WebView <audio>
      // probes without a Range header, which returns 200 OK on progressive formats
      // (whereas adaptiveFormats returns 403 without a Range header).
      const progressive = (data?.streamingData?.formats || []).filter((f) => f.url)
      const adaptive = (data?.streamingData?.adaptiveFormats || [])
        .filter((f) => f.url && (f.mimeType || '').startsWith('audio/mp4'))
        .sort((a, b) => {
          // Deprioritize HE-AAC (mp4a.40.5 / itag 139 / itag 599) to avoid the SBR 2x duration bug in WebKit/Chromium
          const aIsHe = (a.mimeType || '').includes('mp4a.40.5') || a.itag === 139 || a.itag === 599
          const bIsHe = (b.mimeType || '').includes('mp4a.40.5') || b.itag === 139 || b.itag === 599
          if (aIsHe !== bIsHe) return aIsHe ? 1 : -1
          return (b.bitrate || 0) - (a.bitrate || 0)
        })

      // ANDROID adaptiveFormats require a poToken (403 without one), whereas ANDROID progressive (itag 18)
      // and IOS adaptiveFormats work directly without poToken.
      const chosen = client.clientName === 'ANDROID' ? (progressive[0] || adaptive[0]) : (adaptive[0] || progressive[0])
      if (!chosen?.url) continue

      const duration =
        Number(data?.videoDetails?.lengthSeconds || 0) ||
        Math.round(Number(chosen.approxDurationMs || 0) / 1000) ||
        0

      const entry = { url: chosen.url, duration, ts: Date.now() }
      streamCache.set(videoId, entry)
      return entry
    } catch {}
  }
  return null
}

/** Audio source for the player: Mac backend proxy when available, otherwise direct stream. */
export async function getAudioSource(videoId, track = null) {
  if (hasBackend()) {
    try {
      const qParams = new URLSearchParams()
      if (track?.title) qParams.set('title', track.title)
      if (track?.artist) qParams.set('artist', track.artist)
      const expDur = parseDurationText(track?.duration_text) || Number(track?.duration || 0)
      if (expDur > 0) qParams.set('expected_duration', String(expDur))
      const qs = qParams.toString() ? `?${qParams.toString()}` : ''

      const resp = await fetch(apiUrl(`/audio-info/${videoId}${qs}`))
      if (resp.ok) {
        const info = await resp.json()
        return {
          url: apiUrl(`/audio/${videoId}${qs}`),
          duration: Number(info?.duration || 0)
        }
      }
    } catch {}
    // If Mac backend fails (e.g. yt-dlp bot challenge/login-required), try direct Innertube player
    const standalone = await resolveStandaloneAudio(videoId)
    if (standalone?.url) return standalone
    return null
  }
  return resolveStandaloneAudio(videoId)
}

export function getTrackDownloadUrl(track) {
  if (!track || !track.video_id) return ''
  const title = (track.title || 'Track').replace(/[\\/*?:"<>|]/g, '').trim()
  const artist = (track.artist || '').replace(/[\\/*?:"<>|]/g, '').trim()
  if (hasBackend()) {
    return apiUrl(`/download/${track.video_id}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`)
  }
  return ''
}

// ---------------------------------------------------------------------------
// Standalone curation
// ---------------------------------------------------------------------------

export async function curateStandalone({ mood_prompt, energy_level = 78, count = 8, model_name = 'gemini-3.8-flash', favorites = [] }) {
  // Ground the model in real catalog results for the query
  let catalogBlock = ''
  try {
    const catalog = (await ytmSearchItems(mood_prompt)).slice(0, 12)
    if (catalog.length) {
      catalogBlock =
        'Verified YouTube Music tracks matching the query (use as ground truth where relevant):\n' +
        catalog.map((c) => `- "${c.title}" by ${c.artist}`).join('\n') +
        '\n\n'
    }
  } catch {}

  const favBlock = favorites.length
    ? 'Listener favorites (use only for general mood prompts, never to dilute a specific franchise/artist request):\n' +
      favorites.slice(0, 8).map((f) => `- ${f.title} by ${f.artist}`).join('\n') +
      '\n\n'
    : ''

  const prompt = `You are an expert musicologist and playlist curator for UpBeat.

${catalogBlock}${favBlock}User Request:
- Prompt: "${mood_prompt}"
- Target Intensity: ${energy_level}/100
- Track Count: ${count}

STRICT RULES:
1. If the prompt names a specific anime, movie, game, franchise, or artist (e.g. "monogatari bests", "ramayan movie song"), 100% of tracks MUST belong to that exact franchise/artist. Never mix unrelated shows. Use real, canonical song titles only.
2. Otherwise, curate tracks that genuinely match the mood and intensity.
3. "reason": 8-13 words describing the music itself (instrumentation, vocals, rhythm, atmosphere). Never write meta-talk like "appeals to the user".
4. "search_query": exact title + artist + series/album so YouTube Music finds the official audio.

Return ONLY a valid JSON object:
{
  "playlist_title": "string",
  "subtitle": "string",
  "vibe_description": "string",
  "tracks": [
    {
      "title": "string",
      "artist": "string",
      "search_query": "string",
      "match_tier": "Direct Match | Close Fit | Exploratory",
      "reason": "string",
      "detail": "string (1 sentence)",
      "vibe": "string (1-2 words)",
      "energy": 78
    }
  ]
}`

  const res = await generateWithDirectGemini(prompt, model_name)
  const tracks = Array.isArray(res.tracks) ? res.tracks : []
  const tierOrder = { 'Direct Match': 0, 'Close Fit': 1, Exploratory: 2 }

  const resolved = await Promise.all(
    tracks.map(async (t) => {
      const q = t.search_query || `${t.title} ${t.artist}`
      const found = await searchYouTubeStandalone(q)
      const tier = tierOrder[t.match_tier] !== undefined ? t.match_tier : 'Direct Match'
      if (found) return { ...t, match_tier: tier, ...found, duration_text: found.duration_text || '' }
      return { ...t, match_tier: tier, video_id: '', fallback_ids: [], duration_text: '', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` }
    })
  )

  // Never play the same video twice in one playlist
  const used = new Set()
  for (const tr of resolved) {
    if (tr.video_id && used.has(tr.video_id)) {
      const alt = (tr.fallback_ids || []).find((id) => !used.has(id))
      if (alt) {
        tr.video_id = alt
        tr.thumbnail = `https://i.ytimg.com/vi/${alt}/hqdefault.jpg`
        tr.url = `https://www.youtube.com/watch?v=${alt}`
      }
    }
    if (tr.video_id) used.add(tr.video_id)
  }

  resolved.sort((a, b) => (tierOrder[a.match_tier] ?? 0) - (tierOrder[b.match_tier] ?? 0))
  return { ...res, tracks: resolved }
}

export function formatDurationSeconds(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remSec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`
  }
  return `${m}:${remSec.toString().padStart(2, '0')}`
}

/**
 * Searches YouTube Music and returns a list of matching tracks for adding seeds.
 */
export async function searchYouTubeMusicList(query) {
  if (!query || !query.trim()) return []
  try {
    const items = await ytmSearchItems(query)
    return items.map((it) => ({
      video_id: it.video_id,
      title: it.title || 'Unknown Title',
      artist: it.artist || 'Unknown Artist',
      thumbnail: `https://i.ytimg.com/vi/${it.video_id}/hqdefault.jpg`,
      duration_text: it.duration_text || '',
      url: `https://www.youtube.com/watch?v=${it.video_id}`
    }))
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
        return res.tracks
      }
    }

    // Fallback: direct search for the query / title
    const searchRes = await directSearchStandalone(urlOrQuery, 'songs')
    if (searchRes && searchRes.tracks && searchRes.tracks.length) {
      return searchRes.tracks
    }
    return []
  } catch (err) {
    console.error('importYouTubePlaylistStandalone error:', err)
    return []
  }
}

/**
 * Analyzes seed tracks and hearted favorites to produce a rich Sonic Taste DNA profile.
 * Works on Android / mobile without needing a Mac host or Safari.
 */
export async function analyzeTasteDnaStandalone(tracks) {
  if (!tracks || !tracks.length) return null

  const trackListStr = tracks
    .slice(0, 15)
    .map((t) => `"${t.title}" by ${t.artist}`)
    .join(', ')

  if (isConfigured()) {
    try {
      const prompt = `Analyze this user's music taste based purely on their actual favorite and seed tracks:
${trackListStr}

Determine their authentic listener archetype, genres, and key artists based ONLY on the musical styles and artists in their list above.

Return JSON with this exact schema:
{
  "archetype": "A creative 2-4 word listener archetype tailored specifically to their artists and songs (e.g. 'Melodic Pop Harmonist', 'High-Octane Rock Voyager', 'Soulful Urban Rhythmist', 'Electronic Sound Architect')",
  "summary": "A rich 2-3 sentence paragraph analyzing their musical preferences, mood, timbre, and emotional dynamics.",
  "sonic_attributes": {
    "tempo": "A tempo range e.g. '115-135 BPM'",
    "electronic_balance": 55
  },
  "primary_genres": ["3-5 genre strings reflecting the specific genres of their tracks above"],
  "key_artists": ["3-5 distinct artist strings based directly on the tracks above"]
}`
      const res = await generateWithDirectGemini(prompt, 'gemini-3.8-flash')
      if (res && res.archetype) {
        return res
      }
    } catch (e) {
      console.warn('Gemini taste analysis fallback:', e)
    }
  }

  // Heuristic Sonic DNA generation if Gemini is offline
  const artists = Array.from(new Set(tracks.map((t) => t.artist).filter(Boolean)))
  const topArtists = artists.slice(0, 4)
  const isHighEnergy = tracks.some((t) => /rock|epic|metal|hyper|phonk|battle|dance|club|party/i.test(`${t.title} ${t.artist}`))
  const isAtmospheric = tracks.some((t) => /theme|lofi|piano|acoustic|synth|vibe|ambient|slow|chill/i.test(`${t.title} ${t.artist}`))

  let archetype = 'Eclectic Audio Connoisseur'
  if (isHighEnergy) archetype = 'High-Octane Sonic Voyager'
  else if (isAtmospheric) archetype = 'Atmospheric Soundscape Curator'

  const leadArtists = topArtists.length ? topArtists.slice(0, 2).join(' and ') : 'diverse musical styles'

  return {
    archetype,
    summary: `Drawn to dynamic melodies, evocative vocals, and rhythmic harmony. Their taste profile bridges ${leadArtists} with rich musical textures and memorable hooks.`,
    sonic_attributes: {
      tempo: isHighEnergy ? '130-160 BPM' : '110-135 BPM',
      electronic_balance: isHighEnergy ? 70 : 45
    },
    primary_genres: isHighEnergy
      ? ['Alternative Rock', 'Electronic Beats', 'High-Energy Pop', 'Dynamic Rhythms']
      : ['Indie & Alternative', 'Contemporary Pop', 'Atmospheric Ambient', 'Acoustic Melodies'],
    key_artists: topArtists.length ? topArtists : artists.slice(0, 3)
  }
}

// ---------------------------------------------------------------------------
// v5.0 Live Synced Lyrics Engine (LRCLIB + LRC Parser)
// ---------------------------------------------------------------------------

const _lyricsCache = new Map()

const RECORD_LABEL_PATTERNS = /^(yrf|t-series|tseries|sony\s*music.*|zee\s*music.*|tips\s*official.*|saregama.*|speed\s*records.*|eros\s*now.*|aditya\s*music.*|think\s*music.*|lahari\s*music.*|desimelodies|hombale\s*films|vyrl\s*originals|jusa\s*music|crunchyroll.*|aniplex.*|unknown\s*artist|upbeat\s*curator)$/i

/**
 * Cleans noisy YouTube video titles and channel names into accurate song + artist queries.
 */
export function cleanTrackMetadataForLyrics(rawTitle = '', rawArtist = '') {
  let title = String(rawTitle || '').trim()
  let artist = String(rawArtist || '').trim()

  // Extract Japanese/CJK quoted title if present e.g. Renai Circulation「恋愛サーキュレーション」
  const cjkBracketMatch = title.match(/^(.*?)\s*「([^」]+)」/)
  if (cjkBracketMatch && cjkBracketMatch[1].trim().length >= 3) {
    title = cjkBracketMatch[1].trim()
  }

  // Strip 【...】 and [...] noise
  title = title
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*(official|video|audio|lyric|hd|4k|hq|mv|full|visualizer|remaster|ost|sub|esp|eng)[^\]]*\]/gi, ' ')
    .replace(/\([^)]*(official|video|audio|lyric|hd|4k|hq|mv|full\s*song|full\s*video|visualizer|remaster|from\s+["']|feat\.?|ft\.?|prod\.?)[^)]*\)/gi, ' ')

  // If pipe-separated (e.g. "Ainvayi Ainvayi - Full Song | Band Baaja Baaraat | Ranveer Singh"),
  // pick the first meaningful segment
  if (title.includes('|')) {
    const parts = title.split('|').map((p) => p.trim()).filter(Boolean)
    const firstGood = parts.find((p) => !/^(full\s*(video\s*)?song|lyric(al)?\s*video|official\s*(music\s*)?video|audio\s*song)$/i.test(p))
    if (firstGood) title = firstGood
  }

  // Remove trailing/inline "- Full Song", "- Full Video", "Lyrical:", etc.
  title = title
    .replace(/\b(full\s*(video\s*)?song|lyrical\s*(video)?|video\s*song|official\s*(music\s*)?video|official\s*audio)\b/gi, ' ')
    .replace(/歌ってみた/g, ' ')
    .replace(/\s*[-–—:]+\s*$/g, '')
    .replace(/^\s*[-–—:]+\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Clean artist name
  artist = artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\bOfficial\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Check if title itself is "Artist - Song"
  let coreTitle = title
  let extractedArtist = ''
  if (title.includes(' - ')) {
    const [left, ...rest] = title.split(' - ')
    const right = rest.join(' - ').trim()
    if (left && right && right.length >= 2) {
      // If left matches artist or artist is a label/unknown, treat right as coreTitle
      if (
        !artist ||
        RECORD_LABEL_PATTERNS.test(artist) ||
        left.toLowerCase().includes(artist.toLowerCase()) ||
        artist.toLowerCase().includes(left.toLowerCase())
      ) {
        extractedArtist = left.trim()
        coreTitle = right
      } else {
        coreTitle = right
      }
    }
  }

  // Strip feat./ft. from coreTitle
  coreTitle = coreTitle.replace(/\s+(feat\.?|ft\.?)\s+.*$/i, '').trim()

  const effectiveArtist = RECORD_LABEL_PATTERNS.test(artist)
    ? extractedArtist
    : (artist || extractedArtist)

  return {
    cleanTitle: title,
    coreTitle: coreTitle || title,
    cleanArtist: effectiveArtist
  }
}

/**
 * Parses standard LRC format `[mm:ss.xx] Lyric text` into sorted `{ time, text, isInstrumental }[]`.
 */
export function parseLrcLyrics(lrcText = '') {
  if (!lrcText || typeof lrcText !== 'string') return []

  const rawLines = lrcText.split(/\r?\n/)
  let offsetSec = 0
  const parsed = []

  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const line of rawLines) {
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (offsetMatch) {
      offsetSec = parseInt(offsetMatch[1], 10) / 1000
      continue
    }

    const matches = [...line.matchAll(timeRegex)]
    if (!matches.length) continue

    const text = line.replace(timeRegex, '').trim()

    for (const m of matches) {
      const mins = parseInt(m[1], 10)
      const secs = parseInt(m[2], 10)
      let frac = 0
      if (m[3]) {
        const fracStr = m[3].padEnd(3, '0').slice(0, 3)
        frac = parseInt(fracStr, 10) / 1000
      }
      const time = Math.max(0, mins * 60 + secs + frac - offsetSec)
      parsed.push({ time, text })
    }
  }

  parsed.sort((a, b) => a.time - b.time)

  // Filter empty lines, converting long instrumental gaps (>= 7s) into a subtle musical note indicator
  const result = []
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i]
    const next = parsed[i + 1]
    if (!cur.text) {
      if (next && next.time - cur.time >= 7 && result.length > 0 && !result[result.length - 1].isInstrumental) {
        result.push({ time: cur.time, text: '♪', isInstrumental: true })
      }
      continue
    }
    const isMusicalNote = /^[♪♫♬~\s]+$/.test(cur.text)
    result.push({
      time: cur.time,
      text: isMusicalNote ? '♪' : cur.text,
      isInstrumental: isMusicalNote
    })
  }

  // If the first vocal line starts after 5 seconds, prepend an intro indicator at 0:00
  if (result.length > 0 && result[0].time >= 5.0 && !result[0].isInstrumental) {
    result.unshift({ time: 0, text: '♪', isInstrumental: true })
  }

  return result
}

async function queryLrclib(query) {
  if (!query || !query.trim()) return []
  const q = query.trim()

  // 1. Direct LRCLIB CORS request (fast on Web, Mac, iPhone, Android)
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) return data
    }
  } catch {}

  // 2. Backend proxy fallback
  try {
    const res = await fetch(apiUrl(`/lyrics?q=${encodeURIComponent(q)}`))
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) return data
    }
  } catch {}

  return []
}

function scoreLyricsCandidate(item, coreTitle, cleanArtist, targetDuration) {
  if (!item) return -999
  if (!item.syncedLyrics && !item.plainLyrics) return -999

  let score = 0
  if (item.syncedLyrics) score += 100
  else if (item.plainLyrics) score += 25

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u0900-\u097F\u3040-\u30FF\u4E00-\u9FAF]+/g, ' ').trim()
  const candTitle = norm(item.trackName || item.name)
  const candArtist = norm(item.artistName)
  const targetTitle = norm(coreTitle)
  const targetArt = norm(cleanArtist)

  if (candTitle && targetTitle) {
    if (candTitle === targetTitle) score += 50
    else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) score += 30
  }

  if (candArtist && targetArt) {
    const artTokens = targetArt.split(/\s+/).filter((w) => w.length > 2)
    if (candArtist === targetArt || candArtist.includes(targetArt) || targetArt.includes(candArtist)) {
      score += 35
    } else if (artTokens.some((tok) => candArtist.includes(tok))) {
      score += 20
    }
  }

  if (targetDuration > 15 && item.duration > 15) {
    const diff = Math.abs(item.duration - targetDuration)
    if (diff <= 3) score += 45
    else if (diff <= 8) score += 30
    else if (diff <= 16) score += 15
    else if (diff <= 30) score += 0
    else score -= 25
  }

  return score
}

/**
 * Resolves time-synced (or plain) lyrics for a track.
 * Returns `{ synced: boolean, lines: { time: number, text: string, isInstrumental?: boolean }[], plainText: string, sourceTrack?: string, sourceArtist?: string } | null`
 */
export async function fetchTrackLyrics(track, durationSec = 0) {
  if (!track || !track.title) return null

  const cacheKey = track.video_id || `${track.title}|${track.artist || ''}`
  if (_lyricsCache.has(cacheKey)) {
    return _lyricsCache.get(cacheKey)
  }

  const { cleanTitle, coreTitle, cleanArtist } = cleanTrackMetadataForLyrics(track.title, track.artist)
  const primaryQuery = cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())
    ? `${coreTitle} ${cleanArtist}`
    : cleanTitle

  let candidates = await queryLrclib(primaryQuery)
  const hasSyncedInPrimary = candidates.some((c) => Boolean(c?.syncedLyrics))

  // Fallback search using just coreTitle if primary query returned no synced lyrics
  if (!hasSyncedInPrimary && coreTitle && coreTitle.toLowerCase() !== primaryQuery.toLowerCase()) {
    const fallbackCandidates = await queryLrclib(coreTitle)
    candidates = [...candidates, ...fallbackCandidates]
  }

  // Secondary fallback: if cleanTitle had multiple words before a dash or pipe, try the first segment
  if (!candidates.length && cleanTitle !== coreTitle) {
    const altCandidates = await queryLrclib(cleanTitle)
    candidates = [...candidates, ...altCandidates]
  }

  if (!candidates.length) {
    _lyricsCache.set(cacheKey, null)
    return null
  }

  // Rank candidates
  let best = null
  let bestScore = -999
  for (const item of candidates) {
    const sc = scoreLyricsCandidate(item, coreTitle, cleanArtist, durationSec)
    if (sc > bestScore) {
      bestScore = sc
      best = item
    }
  }

  if (!best || bestScore < 0) {
    _lyricsCache.set(cacheKey, null)
    return null
  }

  if (best.syncedLyrics) {
    const lines = parseLrcLyrics(best.syncedLyrics)
    if (lines.length > 0) {
      const result = {
        synced: true,
        lines,
        plainText: best.plainLyrics || lines.map((l) => l.text).join('\n'),
        sourceTrack: best.trackName || best.name || coreTitle,
        sourceArtist: best.artistName || cleanArtist
      }
      _lyricsCache.set(cacheKey, result)
      return result
    }
  }

  if (best.plainLyrics) {
    const plainLines = String(best.plainLyrics)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l, idx, arr) => l !== '' || (idx > 0 && arr[idx - 1] !== ''))
    const result = {
      synced: false,
      lines: plainLines.map((text, idx) => ({ time: idx, text })),
      plainText: best.plainLyrics,
      sourceTrack: best.trackName || best.name || coreTitle,
      sourceArtist: best.artistName || cleanArtist
    }
    _lyricsCache.set(cacheKey, result)
    return result
  }

  _lyricsCache.set(cacheKey, null)
  return null
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
