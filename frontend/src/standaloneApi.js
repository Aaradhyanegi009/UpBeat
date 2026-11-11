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

export const COMEDY_PODCAST_REGEX = /\b(stand\s*up|standup|comedy|comedian|aakash\s*gupta|ashish\s*solanki|gaurav\s*kapoor|ravi\s*gupta|prashasti\s*singh|shreeja\s*chaturvedi|comic|samay\s*raina|zakir\s*khan|abhishek\s*upmanyu|bassi|anubhav\s*singh|munawar|harsh\s*gujral|biswa|kanan|kenny\s*sebastian|latent|india's\s*got\s*latent|roast|crowd\s*work|open\s*mic|funny|joke|jokes|laugh|skit|parody|podcast|interview|episode|ep\s*\d+|talk\s*show|storytime|reaction|review|vlogs?|vlog|unboxing)\b/i

export const DEVOTIONAL_RELIGIOUS_REGEX = /\b(bhajan|aarti|aartiyan|chalisa|mantra|stotra|stotram|shloka|sampoorna|serenity|devotion|hanuman|shiv|shiva|krishna|ram\s*bhajan|ganesh|durga|mata|kirtan|satsang|devotional|bhakti|gurbani|shabad|qawwali|naat|tilawat|t-series\s*bhakti|sanskar|aastha|spiritual|meditation\s*chant|om\s*namah|amritwani|sundarkand|bhagavad\s*gita|krishna\s*bhajan|shree\s*krishna|hare\s*rama|hare\s*krishna|radhe\s*radhe|radha\s*krishna|mahadev|har\s*har\s*mahadev|jaap|namokar|guru\s*granth\s*sahib|waheguru)\b/i

export const NON_MUSIC_GENERAL_REGEX = /\b(minecraft|gameplay|walkthrough|let's\s*play|bgmi|pubg|valorant|stream|highlights|tutorial|lecture|course|gate|jee|neet|dsa|leetcode|codeforces|coding|programming|how\s*to|explained|documentary|news|breaking|shorts|#shorts|status|whatsapp\s*status|ringtone|teaser|trailer|making\s*of|behind\s*the\s*scenes|full\s*movie|scene|kids?\s*music|nursery\s*rhymes?|cocomelon|lullab(?:y|ies)|baby\s*songs?|children'?s?\s*(?:song|music|rhyme))\b/i

export const STRICT_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

export const NON_MUSIC_REGEX = /\b(laplace|laplacian|fourier|calculus|derivative|derivatives|differentiation|integral|integrals|integration|differential equations?|ode|pde|linear algebra|matrices|matrix|eigenvalues?|eigenvectors?|trigonometry|geometry|theorems?|proofs?|derivations?|physics|quantum|thermodynamics|electromagnetism|kinematics|optics|chemistry|organic chemistry|biology|biochemistry|anatomy|genetics|engineering|mechanical|electrical|civil|electronics|aerospace|computer science|data structures|algorithms|dsa|leetcode|competitive programming|coding|programming|python|javascript|c\+\+|java programming|tutorials?|courses?|crash course|lectures?|class \d+|lesson \d+|chapter \d+|syllabus|semester|curriculum|solved problems?|numerical problems?|question paper|mcqs?|gate exam|jee mains?|jee advanced|neet exam|upsc|ncert|cbse|icse|khan academy|3blue1brown|mit opencourseware|nptel|stanford|harvard|coursera|udemy|edx|unacademy|physics wallah|geeksforgeeks|freecodecamp|gate smashers|neso academy|apna college|codewithharry|chai aur code|youtuber|youtubers|vlogs?|vlogger|vlogging|daily vlog|mrbeast|pewdiepie|carryminati|sidemen|dude perfect|logan paul|jake paul|markiplier|jacksepticeye|technoblade|dream|ssundee|dantdm|mark rober|veritasium|vsauce|kurzgesagt|pranks?|challenges?|24 hours in|last to leave|q&a|qna|ask me anything|ama|mukbang|eating show|try not to laugh|storytime|confessions?|exposed|drama|roast show|alien|puppet|comedy skit|skits?|podcasts?|interview|unboxing|tech review|phone review|setup tour|room tour|desk tour|pc build|what's in my bag|what's on my phone|day in the life|morning routine|night routine|grwm|get ready with me|tier list|tier ranking|funny moments|bloopers?|fails compilation|meme compilation|reaction|reacts|reacting to|first time hearing|first time watching|stand up comedy|standup comedy|improv comedy|open mic|ted talk|tedx|keynote|webinar|conference talk|official trailer|teaser trailer|movie trailer|trailer \d|movie scene|deleted scene|full movie|short film|documentary|docuseries|how to (?:make|cook|bake|code|build|draw|play|fix|install|use|do|start|solve|pass)|diy|life hacks?|tips (?:and|&) tricks|video essay|asmr|whispering|audiobooks?|read aloud|gym workout|yoga routine|cardio workout|abs workout|gameplay|walkthrough|playthrough|let's play|lets play|speedrun|speed run|no commentary|longplay|bedwars|skyblock|minecraft|roblox|fortnite|valorant|pubg|apex legends|gta v|gta 5|call of duty|warzone|counter strike|csgo|cs2|league of legends|genshin impact|live stream|livestream|twitch vod|stream highlights?)\b/i

/**
 * Filter for valid pure music artist names (rejecting comedy, devotional, lectures, or channels).
 */
export function isStrictArtistName(name) {
  if (!name || typeof name !== 'string') return false
  const n = name.trim()
  if (n.length < 2 || n.length > 50) return false
  if (COMEDY_PODCAST_REGEX.test(n) || DEVOTIONAL_RELIGIOUS_REGEX.test(n) || NON_MUSIC_GENERAL_REGEX.test(n) || NON_MUSIC_REGEX.test(n)) return false
  return true
}

/**
 * UpBeat v7.5.1 Ironclad Music Filter:
 * Rejects stand-up comedy, podcasts, devotional/bhajan videos, gaming clips, educational lectures,
 * view counts/subscriber counts mistakenly parsed as artist, invalid video IDs, and clips <75s or >420s.
 */
export function isStrictMusicTrack(track) {
  if (!track || typeof track !== 'object') return false
  const title = (track.title || '').trim()
  const artist = (track.artist || '').trim()
  if (!title || !artist) return false

  // Reject view counts, subscriber counts, or relative dates captured as artist
  if (/^\d+[\d.,]*\s*[kKmMbB]?\s*(?:views?|subscribers?|watching|likes?)?$/i.test(artist)) return false
  if (/^(?:\d+\s*(?:views?|subscribers?|ago)|streamed|youtube|unknown)$/i.test(artist)) return false

  // Strict 11-char videoId check
  const vid = track.video_id || track.videoId
  if (vid && !STRICT_VIDEO_ID_REGEX.test(vid)) {
    return false
  }

  const textToScan = `${title} ${artist}`
  if (COMEDY_PODCAST_REGEX.test(textToScan)) return false
  if (DEVOTIONAL_RELIGIOUS_REGEX.test(textToScan)) return false
  if (NON_MUSIC_GENERAL_REGEX.test(textToScan)) return false
  if (NON_MUSIC_REGEX.test(textToScan)) return false

  let sec = 0
  if (typeof track.duration === 'number' && track.duration > 0) {
    sec = track.duration
  } else if (typeof track.duration_seconds === 'number' && track.duration_seconds > 0) {
    sec = track.duration_seconds
  } else if (track.duration_text && typeof track.duration_text === 'string') {
    const parts = track.duration_text.split(':').map((p) => parseInt(p, 10))
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      sec = parts[0] * 60 + parts[1]
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
  }

  // Reject duration <75s (1:15) or >420s (7:00) when duration is known
  if (sec > 0 && (sec < 75 || sec > 420)) {
    return false
  }

  return true
}

// Full backward compatibility for callers of isValidMusicTrack
export const isValidMusicTrack = isStrictMusicTrack

/**
 * One-time startup storage sanitizer:
 * Strips out polluted non-music / comedy / devotional tracks from localStorage.
 */
export function sanitizeLocalMusicLibrary() {
  if (typeof window === 'undefined' || !window.localStorage) return
  const listKeys = [
    'argon_favs_v2',
    'argon_seeds_v2',
    'upbeat_liked_songs',
    'upbeat_history',
    'upbeat_history_v1',
    'upbeat_taste_seeds',
    'upbeat_favorites_v1',
    'upbeat_extracted_tracks_v1',
    'upbeat_playback_queue'
  ]

  for (const k of listKeys) {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((item) => isStrictMusicTrack(item))
        localStorage.setItem(k, JSON.stringify(cleaned))
      }
    } catch {}
  }

  // Sanitize recents and recent mixes
  try {
    const rawRecents = localStorage.getItem('upbeat_recents_v1')
    if (rawRecents) {
      const recents = JSON.parse(rawRecents)
      if (Array.isArray(recents)) {
        const cleaned = recents.filter((r) => {
          const t = `${r?.title || ''} ${r?.collection?.title || ''}`
          if (COMEDY_PODCAST_REGEX.test(t) || DEVOTIONAL_RELIGIOUS_REGEX.test(t) || NON_MUSIC_GENERAL_REGEX.test(t)) return false
          if (Array.isArray(r.tracks) && r.tracks.length > 0) {
            r.tracks = r.tracks.filter(isStrictMusicTrack)
          }
          return true
        })
        localStorage.setItem('upbeat_recents_v1', JSON.stringify(cleaned))
      }
    }
  } catch {}

  try {
    const rawMixes = localStorage.getItem('upbeat_mixes_v1')
    if (rawMixes) {
      const mixes = JSON.parse(rawMixes)
      if (Array.isArray(mixes)) {
        const cleaned = mixes.filter((m) => {
          const t = m?.title || ''
          if (COMEDY_PODCAST_REGEX.test(t) || DEVOTIONAL_RELIGIOUS_REGEX.test(t) || NON_MUSIC_GENERAL_REGEX.test(t)) return false
          if (Array.isArray(m.tracks) && m.tracks.length > 0) {
            m.tracks = m.tracks.filter(isStrictMusicTrack)
          }
          return true
        })
        localStorage.setItem('upbeat_mixes_v1', JSON.stringify(cleaned))
      }
    }
  } catch {}

  // Sanitize Taste DNA artists
  try {
    const rawDna = localStorage.getItem('argon_dna_v2')
    if (rawDna) {
      const dna = JSON.parse(rawDna)
      if (dna && Array.isArray(dna.top_artists)) {
        dna.top_artists = dna.top_artists.filter(isStrictArtistName)
      }
      localStorage.setItem('argon_dna_v2', JSON.stringify(dna))
    }
  } catch {}

  try {
    sessionStorage.removeItem('upbeat_discovery_feed_cache_v7')
    sessionStorage.removeItem('upbeat_discovery_feed_cache_v6')
    localStorage.removeItem('upbeat_discovery_cache')
  } catch {}
}

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
    const trackObj = {
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

  // Generalize playlist showcase: Auto-load matched playlist for explicit playlist mode,
  // chart/billboard/curated intents, or when high-relevance playlist matches exist from the get-go.
  const isPlaylistIntent =
    mode === 'playlists' ||
    (mode === 'auto' &&
      (/\b(playlist|chart|billboard|top|hits|daily|trending|countdown|best of|essentials|soundtrack)\b/i.test(qClean) ||
        (matchedPlaylists.length > 0 && matchedPlaylists[0].relevance >= 0.5)))

  const cleanYtmSongs = ytmSongs.filter(isValidMusicTrack)
  const cleanYtVideos = youtubeResults.filter(isValidMusicTrack)

  // Default to verified songs (YouTube Music), strictly avoiding random non-music YouTuber videos
  let activeSource = cleanYtmSongs.length > 0 ? 'songs' : (cleanYtVideos.length > 0 ? 'youtube' : 'songs')
  let activeBrowseId = ''
  let tracks = cleanYtmSongs.length > 0 ? cleanYtmSongs : cleanYtVideos
  let playlistTitle = `"${qClean}"`
  let vibe = cleanYtmSongs.length > 0
    ? `Music tracks : ${cleanYtmSongs.length} songs`
    : `Music tracks : ${cleanYtVideos.length} songs`

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
  } else if (mode === 'songs' && cleanYtmSongs.length) {
    activeSource = 'songs'
    tracks = cleanYtmSongs
    vibe = `Music tracks : ${cleanYtmSongs.length} songs`
  }

  if (!tracks.length) {
    tracks = cleanYtmSongs.length ? cleanYtmSongs : cleanYtVideos
    activeSource = cleanYtmSongs.length ? 'songs' : 'youtube'
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
    song_results: cleanYtmSongs,
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

/** Returns { url, duration, video_id } for a video id (works in the APK without the Mac). */
export async function resolveStandaloneAudio(videoId, track = null) {
  if (!videoId) return null
  const cached = streamCache.get(videoId)
  if (cached && Date.now() - cached.ts < 25 * 60 * 1000) return cached

  let lastTitle = (track?.title || '').trim()
  let lastArtist = (track?.artist || '').trim()

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
      if (data?.videoDetails?.title && !lastTitle) lastTitle = data.videoDetails.title
      if (data?.videoDetails?.author && !lastArtist) lastArtist = data.videoDetails.author

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

      const entry = { url: chosen.url, duration, video_id: videoId, ts: Date.now() }
      streamCache.set(videoId, entry)
      return entry
    } catch {}
  }

  // Automatic recovery for restricted songs (age-restricted / login-required):
  // Resolve an unblocked official alternative on YouTube Music
  const query = `${lastTitle} ${lastArtist}`.trim()
  if (query) {
    try {
      const searchRes = await ytmSearchRaw(query, true)
      const candidateSongs = parseYtmSongs(searchRes)
      for (const cand of candidateSongs) {
        if (!cand?.video_id || cand.video_id === videoId) continue
        for (const client of [IOS_PLAYER_CLIENT, ANDROID_PLAYER_CLIENT]) {
          try {
            const resp = await callInnertube('player', {
              context: { client },
              videoId: cand.video_id,
              contentCheckOk: true,
              racyCheckOk: true
            }, 'youtube')
            if (!resp.ok) continue
            const data = await resp.json()
            if (data?.playabilityStatus?.status !== 'OK') continue

            const progressive = (data?.streamingData?.formats || []).filter((f) => f.url)
            const adaptive = (data?.streamingData?.adaptiveFormats || [])
              .filter((f) => f.url && (f.mimeType || '').startsWith('audio/mp4'))
              .sort((a, b) => {
                const aIsHe = (a.mimeType || '').includes('mp4a.40.5') || a.itag === 139 || a.itag === 599
                const bIsHe = (b.mimeType || '').includes('mp4a.40.5') || b.itag === 139 || b.itag === 599
                if (aIsHe !== bIsHe) return aIsHe ? 1 : -1
                return (b.bitrate || 0) - (a.bitrate || 0)
              })

            const chosen = client.clientName === 'ANDROID' ? (progressive[0] || adaptive[0]) : (adaptive[0] || progressive[0])
            if (!chosen?.url) continue

            const duration =
              Number(data?.videoDetails?.lengthSeconds || 0) ||
              Math.round(Number(chosen.approxDurationMs || 0) / 1000) ||
              0

            const entry = { url: chosen.url, duration, video_id: cand.video_id, ts: Date.now() }
            streamCache.set(videoId, entry)
            streamCache.set(cand.video_id, entry)
            return entry
          } catch {}
        }
      }
    } catch {}
  }

  return null
}

const streamUrlCache = new Map()
const prewarmedSet = new Set()

/**
 * Pre-warms the audio stream in the background before the user even finishes clicking.
 */
export function prewarmTrack(videoId) {
  if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) return
  if (prewarmedSet.has(videoId)) return
  prewarmedSet.add(videoId)

  if (prewarmedSet.size > 100) {
    const first = prewarmedSet.values().next().value
    prewarmedSet.delete(first)
  }

  try {
    resolveStandaloneAudio(videoId).catch(() => {})
  } catch {}
}

/** Audio source for the player: Mac backend proxy when available, otherwise direct standalone stream. */
export async function getAudioSource(videoId, track = null) {
  if (!videoId) return null

  // 1. Memory cache hit (< 1ms)
  const cached = streamCache.get(videoId)
  if (cached && Date.now() - cached.ts < 25 * 60 * 1000) {
    return cached
  }

  // 2. Mac backend configured:
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
        const entry = {
          url: apiUrl(`/audio/${videoId}${qs}`),
          duration: Number(info?.duration || 0),
          video_id: info?.video_id || info?.resolved_video_id || videoId,
          ts: Date.now(),
        }
        streamCache.set(videoId, entry)
        return entry
      }
    } catch {}
    // If Mac backend fails (e.g. yt-dlp bot challenge/login-required), try direct Innertube player
    const standalone = await resolveStandaloneAudio(videoId, track)
    if (standalone?.url) {
      streamCache.set(videoId, standalone)
      return standalone
    }
    return null
  }

  // 3. Standalone direct Innertube stream resolution (APK, macOS native app, Web):
  return resolveStandaloneAudio(videoId, track)
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

// ---------------------------------------------------------------------------
// Universal Fisher-Yates Queue & Track Shuffle
// ---------------------------------------------------------------------------
export function fisherYatesShuffle(array) {
  if (!Array.isArray(array)) return []
  const copy = [...array]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// ---------------------------------------------------------------------------
// UpBeat v5.5 Dynamic "Listen Together" / Home Discovery Engine (8–9 Live Blocks)
// ---------------------------------------------------------------------------
const ROTATION_CURSOR_KEY = 'upbeat_made_for_you_rotation_idx'
const DISCOVERY_FEED_CACHE_KEY = 'upbeat_discovery_blocks_v632'
const DISCOVERY_FEED_CACHE_TTL = 3 * 60 * 1000 // 3-minute stale-while-revalidate TTL
let _discoveryFeedMemoryCache = null

export function getRotationCursor() {
  try {
    const raw = localStorage.getItem(ROTATION_CURSOR_KEY) || sessionStorage.getItem(ROTATION_CURSOR_KEY)
    const val = parseInt(raw || '0', 10)
    return isNaN(val) ? 0 : val
  } catch {
    return 0
  }
}

export function advanceRotationCursor(delta = 1) {
  try {
    const cur = getRotationCursor()
    const next = (cur + delta) % 1000000
    localStorage.setItem(ROTATION_CURSOR_KEY, String(next))
    sessionStorage.setItem(ROTATION_CURSOR_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

const DYNAMIC_ROTATION_TAGS = [
  'latest hits',
  'trending viral',
  'top charting rotation',
  'essential mix',
  'heavy rotation radio',
  'fresh picks 2026'
]

function getRandomRotationTag() {
  return DYNAMIC_ROTATION_TAGS[Math.floor(Math.random() * DYNAMIC_ROTATION_TAGS.length)]
}

export const DEFAULT_SEED_IDS = new Set([
  'F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE',
  'CXDUXjsU5ao', 'TCd6PfxOy0Y', 'QpxFcMYRV08'
])

// Mood/Vibe presets that cycle dynamically across rotations
const MOOD_VIBE_PRESETS = [
  { name: 'Eclectic Pop & Indie', desc: 'Alternative pop and melodic hooks', query: 'indie pop alternative sound vibes mix', color: 'from-cyan-600/40 to-black' },
  { name: 'Late Night Synth & Alt', desc: 'Nocturnal synths and introspective beats', query: 'late night synthwave alternative electro chill mix', color: 'from-violet-600/40 to-black' },
  { name: 'High-Energy Drive & Beats', desc: 'Punchy basslines and driving percussion', query: 'high energy electronic bass driving beat playlist', color: 'from-emerald-600/40 to-black' },
  { name: 'Acoustic & Melodic Warmth', desc: 'Warm guitars and intimate acoustic melodies', query: 'acoustic guitar warm emotional melody tracks', color: 'from-amber-600/40 to-black' },
  { name: 'Hypnotic R&B & Nu-Soul', desc: 'Lush neo-soul chords and smooth vocals', query: 'smooth modern r&b neo soul grooves playlist', color: 'from-rose-600/40 to-black' },
  { name: 'Cinematic Soundscapes & Media', desc: 'Dramatic atmospheric arrangements', query: 'cinematic instrumental dramatic soundtrack hits', color: 'from-sky-600/40 to-black' },
  { name: 'Sun-Drenched Summer Anthems', desc: 'Feel-good rhythms and bright chords', query: 'feel good upbeat sunny day indie dance pop', color: 'from-yellow-600/40 to-black' },
  { name: 'Moody Lo-Fi & Downtempo', desc: 'Relaxed chillhop textures and steady groove', query: 'lofi downtempo chill atmospheric study beats', color: 'from-indigo-600/40 to-black' }
]

// UpBeat v7.5.1 Curated Starter Rotations (7 Structured Mood/Language & Library Mixes, zero gym/lofi/comedy)
const STARTER_ROTATION_CYCLES = [
  [
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Joji The Weeknd Keshi Cigarettes After Sex Billie Eilish chill late night vibes songs playlist -comedy -podcast',
      thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: 'YOASOBI Kenshi Yonezu Ado Eve King Gnu LiSA Fujii Kaze official anime jpop songs playlist -shorts',
      thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: 'Arijit Singh Prateek Kuhad Anuv Jain The Local Train Mitraz Aditya Rikhari soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy',
      thumbnail: 'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: 'Post Malone The Weeknd Maroon 5 Coldplay Imagine Dragons Dua Lipa Arctic Monkeys top western pop rock songs playlist -podcast',
      thumbnail: 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Coldplay Imagine Dragons The Weeknd Post Malone official songs radio playlist',
      thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      isNewUserSeed: true,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: 'Dua Lipa Harry Styles The Weeknd Post Malone heavy rotation pop hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg',
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: 'Arctic Monkeys The Neighbourhood Kendrick Lamar deep cuts alternative songs playlist',
      thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg',
      color: 'from-cyan-600/40 to-black'
    }
  ],
  [
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Lana Del Rey Cigarettes After Sex Joji Keshi late night dream pop chill hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg',
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: 'Fujii Kaze Radwimps YOASOBI Kenshi Yonezu anime soundtrack hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: 'Prateek Kuhad Jasleen Royal Anuv Jain The Local Train modern acoustic hindi indie playlist',
      thumbnail: 'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: 'Dua Lipa Elton John Harry Styles Bruno Mars Anderson Paak western pop anthems playlist',
      thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Maroon 5 Charlie Puth Shawn Mendes Ed Sheeran essential pop radio playlist',
      thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg',
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      isNewUserSeed: true,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: 'Post Malone Swae Lee Kendrick Lamar SZA melodic hip hop and pop playlist',
      thumbnail: 'https://i.ytimg.com/vi/T6eK-2OQtew/maxresdefault.jpg',
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: 'Billie Eilish Finneas Taylor Swift Gracie Abrams acoustic storytelling hits',
      thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
      color: 'from-cyan-600/40 to-black'
    }
  ]
]

/**
 * Fetches related/radio companion tracks for anchor songs using Innertube automix (v1/next)
 * or targeted search fallback, filtered by isValidMusicTrack.
 */
export async function fetchRelatedCompanionTracks(anchorTracks = [], targetCount = 10) {
  if (!Array.isArray(anchorTracks) || anchorTracks.length === 0) return []

  const companions = []
  const seenVids = new Set(anchorTracks.map((a) => a.video_id).filter(Boolean))

  for (const anchor of anchorTracks) {
    if (companions.length >= targetCount) break
    const vid = anchor?.video_id
    if (!vid || vid.length !== 11) continue

    // 1. Try Innertube /next automix endpoint (native YouTube Music radio companion)
    try {
      const resp = await callInnertube('next', {
        context: YTM_CONTEXT,
        videoId: vid,
        playlistId: `RDAMVM${vid}`,
        isAudioOnly: true
      }, 'music')

      if (resp.ok) {
        const data = await resp.json()
        for (const item of findNodes(data, 'playlistPanelVideoRenderer')) {
          if (companions.length >= targetCount) break
          const candVid = item.videoId
          if (!candVid || candVid.length !== 11 || seenVids.has(candVid)) continue

          const title = item.title?.runs?.[0]?.text || ''
          const artist = item.shortBylineText?.runs?.[0]?.text || item.longBylineText?.runs?.[0]?.text || ''
          const duration_text = item.lengthText?.runs?.[0]?.text || ''
          const thumb = item.thumbnail?.thumbnails?.[item.thumbnail.thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${candVid}/hqdefault.jpg`

          const candTrack = {
            video_id: candVid,
            title,
            artist,
            duration_text,
            thumbnail: thumb,
            source: 'radio_companion'
          }

          if (isValidMusicTrack(candTrack)) {
            seenVids.add(candVid)
            companions.push(candTrack)
          }
        }
      }
    } catch {}

    // 2. Fallback to targeted search if next returned fewer than 3 companions for this anchor
    if (companions.length < targetCount) {
      try {
        const searchQ = anchor.artist && anchor.title
          ? `${anchor.artist} ${anchor.title} similar songs`
          : `${anchor.artist || anchor.title} radio mix songs`
        const searchRes = await directSearchStandalone(searchQ, 'songs')
        for (const cand of (searchRes?.tracks || [])) {
          if (companions.length >= targetCount) break
          if (!cand?.video_id || seenVids.has(cand.video_id)) continue
          if (isValidMusicTrack(cand)) {
            seenVids.add(cand.video_id)
            companions.push({ ...cand, source: 'radio_companion' })
          }
        }
      } catch {}
    }
  }

  return companions
}

/**
 * Builds the hybrid "Rediscover Favorites Mix" card:
 * Unbiased Fisher-Yates shuffle of user Liked Songs / Favourites (~50%)
 * interleaved with dynamically fetched related companion tracks (~50%).
 */
export async function buildHybridRediscoverBlock({
  userTracks = [],
  usedCoverUrls = new Set(),
  rotationIndex = 0,
  forceShuffle = false
} = {}) {
  // Aggregate user tracks: passed userTracks + localStorage favorites and seeds
  const pool = []
  const seen = new Set()

  const addTracks = (list) => {
    if (!Array.isArray(list)) return
    for (const t of list) {
      if (!t?.video_id || seen.has(t.video_id) || DEFAULT_SEED_IDS.has(t.video_id)) continue
      if (isValidMusicTrack(t)) {
        seen.add(t.video_id)
        pool.push(t)
      }
    }
  }

  addTracks(userTracks)
  try {
    const rawFavs = localStorage.getItem('upbeat_favorites_v1')
    if (rawFavs) addTracks(JSON.parse(rawFavs))
  } catch {}
  try {
    const rawSeeds = localStorage.getItem('upbeat_extracted_tracks_v1')
    if (rawSeeds) addTracks(JSON.parse(rawSeeds))
  } catch {}

  const hasUserLibrary = pool.length >= 3

  let coreAnchors = []
  let companionTracks = []

  if (hasUserLibrary) {
    // True Fisher-Yates Shuffle on entire user favorites pool
    const shuffledPool = fisherYatesShuffle([...pool])
    // Select 6 to 8 Core Anchor Tracks
    const anchorCount = Math.min(8, Math.max(6, Math.floor(shuffledPool.length / 2)))
    coreAnchors = shuffledPool.slice(0, anchorCount)

    // Pick 2 to 3 anchors to fetch related radio companions
    const queryAnchors = fisherYatesShuffle([...coreAnchors]).slice(0, Math.min(3, coreAnchors.length))
    try {
      companionTracks = await fetchRelatedCompanionTracks(queryAnchors, 10)
    } catch {}
  } else {
    // Brand new user fallback: curated starter anchors
    const starterSeeds = [
      { video_id: 'ApXoWvfEYVU', title: 'Sunflower', artist: 'Post Malone, Swae Lee', duration_text: '2:38', thumbnail: 'https://i.ytimg.com/vi/ApXoWvfEYVU/hqdefault.jpg' },
      { video_id: '34Na4j8AVgA', title: 'Starboy', artist: 'The Weeknd, Daft Punk', duration_text: '3:50', thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg' },
      { video_id: '09R8_2nJtjg', title: 'Sugar', artist: 'Maroon 5', duration_text: '3:55', thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg' },
      { video_id: 'V1Pl8CzNzCw', title: 'Birds of a Feather', artist: 'Billie Eilish', duration_text: '3:18', thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/hqdefault.jpg' },
      { video_id: 'TUVcZfQe-Kw', title: 'Levitating', artist: 'Dua Lipa', duration_text: '3:23', thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg' },
      { video_id: 'dvgZkm1xWPE', title: 'Viva La Vida', artist: 'Coldplay', duration_text: '4:02', thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/hqdefault.jpg' }
    ]
    coreAnchors = fisherYatesShuffle(starterSeeds).slice(0, 4)
    try {
      companionTracks = await fetchRelatedCompanionTracks(coreAnchors.slice(0, 2), 8)
    } catch {}
  }

  // Interleave Shuffled Liked Songs (~50%) and Related Companions (~50%)
  const interleaved = []
  const maxLen = Math.max(coreAnchors.length, companionTracks.length)
  const finalSeen = new Set()

  for (let i = 0; i < maxLen; i++) {
    if (i < coreAnchors.length && !finalSeen.has(coreAnchors[i].video_id)) {
      interleaved.push({ ...coreAnchors[i], isAnchorFavorite: true })
      finalSeen.add(coreAnchors[i].video_id)
    }
    if (i < companionTracks.length && !finalSeen.has(companionTracks[i].video_id)) {
      interleaved.push({ ...companionTracks[i], isCompanionTrack: true })
      finalSeen.add(companionTracks[i].video_id)
    }
  }

  // If we still have remaining liked tracks from the pool, append up to 24 tracks total
  if (interleaved.length < 16 && pool.length > coreAnchors.length) {
    for (const t of pool) {
      if (interleaved.length >= 24) break
      if (!finalSeen.has(t.video_id)) {
        interleaved.push({ ...t, isAnchorFavorite: true })
        finalSeen.add(t.video_id)
      }
    }
  }

  // Determine dynamic cover thumbnail based on lead track (avoiding collision with adjacent cards)
  const thumbPool = []
  for (const t of interleaved) {
    const candidateThumb = t.video_id
      ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg`
      : t.thumbnail || ''
    if (candidateThumb && !thumbPool.includes(candidateThumb)) {
      thumbPool.push(candidateThumb)
    }
  }

  let chosenThumb = ''
  const startIdx = thumbPool.length ? rotationIndex % thumbPool.length : 0
  for (let i = 0; i < thumbPool.length; i++) {
    const candidateThumb = thumbPool[(startIdx + i) % thumbPool.length]
    if (candidateThumb && !usedCoverUrls.has(candidateThumb)) {
      chosenThumb = candidateThumb
      break
    }
  }
  if (!chosenThumb) {
    chosenThumb = thumbPool[0] || interleaved[0]?.thumbnail || 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'
  }
  usedCoverUrls.add(chosenThumb)

  const leadSongTitle = interleaved[0]?.title || 'Favorites'
  const anchorArtist = coreAnchors[0]?.artist || 'Curated'

  return {
    id: 'block_rediscover',
    tier: 2,
    title: 'Rediscover Favorites Mix',
    subtitle: hasUserLibrary ? 'Shuffled favorites & related radio' : 'Essential favorites & related radio',
    badge: 'Rediscover',
    query: `${anchorArtist} ${leadSongTitle} favorites radio mix`,
    preloadedTracks: interleaved,
    thumbnail: chosenThumb,
    thumbnailPool: thumbPool.length ? thumbPool : [chosenThumb],
    color: 'from-purple-600/40 to-black',
    isHybridRediscover: true
  }
}

export const AVAILABLE_CHARTS = [
  {
    id: 'block_india_top_daily',
    tier: 1,
    title: 'India Top Daily Chart',
    subtitle: 'Top Charting Hits Across India Today',
    badge: 'India Chart',
    flag: '🇮🇳',
    regionKey: 'india',
    browse_id: 'VLOLAK5uy_lSTp1DIuzZBUyee3kDsXwPgP25WdfwB40',
    query: 'Trending 20 India top daily chart hit songs playlist',
    color: 'from-amber-600/40 to-black'
  },
  {
    id: 'block_india_trendy',
    tier: 1,
    title: 'India Trendy Songs',
    subtitle: 'Viral Indian Reels, Indie & Bollywood Heat',
    badge: 'Trending Heat',
    flag: '🇮🇳',
    regionKey: 'india',
    browse_id: 'VLPL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX',
    query: 'viral trending songs reels Bollywood Punjabi indie hits playlist',
    color: 'from-emerald-600/40 to-black'
  },
  {
    id: 'block_global_top_daily',
    tier: 1,
    title: 'Global Top 50 Daily Chart',
    subtitle: 'Most Played Songs Worldwide Today',
    badge: 'Global Chart',
    flag: '🌎',
    regionKey: 'global',
    browse_id: 'VLPL4fGSI40qSUHh345w2bH37X8Y5lQ2VzF4',
    query: 'Global Top 50 daily chart hits playlist',
    color: 'from-cyan-600/40 to-black'
  },
  {
    id: 'block_us_top_daily',
    tier: 1,
    title: 'US Top Daily Chart',
    subtitle: 'Billboard Hot 100 & US Top 50 Daily Hits',
    badge: 'US Chart',
    flag: '🇺🇸',
    regionKey: 'us',
    browse_id: 'VLPL4fGSI40qSUHnL3G30wzCvhLqLqBw8Fw_',
    query: 'Billboard Hot 100 US top daily chart hits playlist',
    color: 'from-blue-600/40 to-black'
  },
  {
    id: 'block_uk_top_daily',
    tier: 1,
    title: 'UK Top Daily Chart',
    subtitle: 'Official UK Top 40 & British Daily Chart',
    badge: 'UK Chart',
    flag: '🇬🇧',
    regionKey: 'uk',
    browse_id: 'VLPL4fGSI40qSUEq8sS2e293D6fR0PqHwKz',
    query: 'Official UK Top 40 singles chart daily hits playlist',
    color: 'from-violet-600/40 to-black'
  },
  {
    id: 'block_japan_top_daily',
    tier: 1,
    title: 'Japan Top Daily Chart',
    subtitle: 'J-Pop, Anime & Tokyo Hot 100 Daily Chart',
    badge: 'Japan Chart',
    flag: '🇯🇵',
    regionKey: 'japan',
    browse_id: 'VLPL4fGSI1pDJn43_Z-8f0nJ0Fp_b5sT6',
    query: 'Tokyo Hot 100 J-Pop anime daily top chart hits playlist',
    color: 'from-rose-600/40 to-black'
  },
  {
    id: 'block_viral_top_daily',
    tier: 1,
    title: 'Global Viral Daily Hits',
    subtitle: 'Trending TikTok, Reels & Viral Daily Tracks',
    badge: 'Viral Chart',
    flag: '🔥',
    regionKey: 'viral',
    browse_id: 'VLPL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX',
    query: 'viral trending songs reels TikTok hits playlist',
    color: 'from-pink-600/40 to-black'
  },
  {
    id: 'block_kpop_top_daily',
    tier: 1,
    title: 'K-Pop Top Daily Chart',
    subtitle: 'Top K-Pop, Idol & Asian Hot 50 Daily',
    badge: 'K-Pop Chart',
    flag: '🇰🇷',
    regionKey: 'kpop',
    browse_id: 'VLPL4fGSI40qSUHfCj3c4sJ4Xj5g1B6KqV4F',
    query: 'K-Pop top daily chart hits newjeans bts blackpink playlist',
    color: 'from-fuchsia-600/40 to-black'
  },
  {
    id: 'block_latin_top_daily',
    tier: 1,
    title: 'Latin Top Daily Chart',
    subtitle: 'Reggaeton, Latin Pop & Hot Daily Rhythms',
    badge: 'Latin Chart',
    flag: '🌴',
    regionKey: 'latin',
    browse_id: 'VLPL4fGSI40qSUFa1B5mB3Fj8M4Z2vY5lX1K',
    query: 'Latin top daily chart hits Bad Bunny Shakira reggaeton playlist',
    color: 'from-orange-600/40 to-black'
  }
]

const CHART_THUMB_POOLS = {
  us: [
    'https://i.ytimg.com/vi/eVli-tstM5E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V9PVRfjEBTI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg',
    'https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/H5v3kku4y6Q/maxresdefault.jpg'
  ],
  india: [
    'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/RLzC55ai0eo/maxresdefault.jpg',
    'https://i.ytimg.com/vi/VAdGW7QDJiU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/VuG7ge_8I2Y/maxresdefault.jpg',
    'https://i.ytimg.com/vi/SlPhMPnQ58k/maxresdefault.jpg'
  ],
  japan: [
    'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dy90tA3TT1c/maxresdefault.jpg',
    'https://i.ytimg.com/vi/mLW35YMzELE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/by4SYYWlhEs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/x8VYWazR5mE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/GJI4Gv7NbmE/maxresdefault.jpg'
  ],
  viral: [
    'https://i.ytimg.com/vi/LK7-_dgAVQE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/k3g_WjLCsXM/maxresdefault.jpg',
    'https://i.ytimg.com/vi/XTp5jaRU3Ws/maxresdefault.jpg',
    'https://i.ytimg.com/vi/nCD2hj6zJEc/maxresdefault.jpg',
    'https://i.ytimg.com/vi/muds1gFUTN8/maxresdefault.jpg',
    'https://i.ytimg.com/vi/6d5SS0gS5bU/maxresdefault.jpg'
  ],
  global: [
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/H5v3kku4y6Q/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'
  ],
  uk: [
    'https://i.ytimg.com/vi/JGwWNGJdvx8/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg',
    'https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/eVli-tstM5E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/YQHsXMglC9A/maxresdefault.jpg'
  ],
  kpop: [
    'https://i.ytimg.com/vi/js1CtxSY38I/maxresdefault.jpg',
    'https://i.ytimg.com/vi/gdZLi9oWNZg/maxresdefault.jpg',
    'https://i.ytimg.com/vi/2S24h70Qi3o/maxresdefault.jpg',
    'https://i.ytimg.com/vi/armNy0vT12E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/pG6iaOMV46I/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TQTlCHxyuu8/maxresdefault.jpg'
  ],
  latin: [
    'https://i.ytimg.com/vi/b8m9zhNA4Ao/maxresdefault.jpg',
    'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg',
    'https://i.ytimg.com/vi/CocEMWdc7Ck/maxresdefault.jpg',
    'https://i.ytimg.com/vi/p38Hgze4k7E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/qj3P_B8Z5dE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/wXhTHyIgQ_U/maxresdefault.jpg'
  ]
}

export function resolveRankedChartBlocks(cursor = 0) {
  let preferredChartIds = []
  try {
    const rawChartPrefs = localStorage.getItem('upbeat_chart_prefs_v1')
    if (rawChartPrefs) preferredChartIds = JSON.parse(rawChartPrefs)
  } catch {}

  let genres = []
  let artists = []
  try {
    const rawTaste = localStorage.getItem('upbeat_taste_prefs_v1')
    if (rawTaste) {
      const parsed = JSON.parse(rawTaste)
      genres = parsed.genres || []
      artists = parsed.artists || []
    }
  } catch {}

  const scoreMap = new Map()
  AVAILABLE_CHARTS.forEach((chart, idx) => {
    let score = 100 - idx
    if (preferredChartIds.length > 0) {
      const prefIdx = preferredChartIds.indexOf(chart.id)
      if (prefIdx !== -1) {
        score += 500 - prefIdx * 25
      }
    } else {
      // Inferred preferences from user genres and artists
      const isDesi = genres.some((g) => ['bollywood', 'punjabi'].includes(g)) ||
        artists.some((a) => /arijit|atif|diljit|karan|pritam|shreya|jubin|anuv|sidhu|badshah/i.test(a))
      const isJapanese = genres.includes('jpop') ||
        artists.some((a) => /yoasobi|kenshi|fujii|higuchi|lisa|radwimps|sawano/i.test(a))
      const isKpop = genres.includes('kpop') ||
        artists.some((a) => /bts|blackpink|newjeans|stray|twice|jungkook/i.test(a))
      const isLatin = genres.includes('latin') ||
        artists.some((a) => /bad bunny|shakira|karol|balvin|peso pluma/i.test(a))
      const isWestern = genres.some((g) => ['pop', 'hiphop', 'rock', 'electronic'].includes(g))

      if (isDesi && (chart.id === 'block_india_top_daily' || chart.id === 'block_india_trendy')) {
        score += 300
      }
      if (isJapanese && chart.id === 'block_japan_top_daily') {
        score += 350
      }
      if (isKpop && chart.id === 'block_kpop_top_daily') {
        score += 350
      }
      if (isLatin && chart.id === 'block_latin_top_daily') {
        score += 350
      }
      if (isWestern && (chart.id === 'block_global_top_daily' || chart.id === 'block_us_top_daily' || chart.id === 'block_uk_top_daily')) {
        score += 150
      }
    }
    scoreMap.set(chart.id, score)
  })

  const sorted = [...AVAILABLE_CHARTS].sort((a, b) => scoreMap.get(b.id) - scoreMap.get(a.id))
  // Return top 7 daily charts (at least 6-7 charts)
  const selectedCharts = sorted.slice(0, 7)

  return selectedCharts.map((c) => {
    const pool = CHART_THUMB_POOLS[c.regionKey] || CHART_THUMB_POOLS.global
    const thumb = pool[cursor % pool.length]
    return {
      ...c,
      thumbnail: thumb,
      thumbnailPool: pool
    }
  })
}

export function getInitialDiscoveryBlocks() {
  const cursor = getRotationCursor()
  const starterCycle = STARTER_ROTATION_CYCLES[cursor % STARTER_ROTATION_CYCLES.length]
  const rankedCharts = resolveRankedChartBlocks(cursor)

  return [
    ...rankedCharts,
    ...starterCycle
  ]
}

export const THIRTY_MINUTES_MS = 30 * 60 * 1000 // 1,800,000ms
let hasBootRefreshedThisSession = false

export async function fetchListenTogetherFeed({
  userTracks = [],
  tasteDna = null,
  forceRefresh = false,
  timeInfo = null,
  rotationIndex = undefined
} = {}) {
  const now = Date.now()
  const lastRefresh = Number(localStorage.getItem('upbeat_last_discovery_refresh') || 0)
  const isColdBoot = !hasBootRefreshedThisSession
  const hasExpired = now - lastRefresh >= THIRTY_MINUTES_MS

  if (isColdBoot) {
    hasBootRefreshedThisSession = true
    advanceRotationCursor(1)
  }

  // 30-minute + Cold-Boot Cache Lifecycle
  if (!forceRefresh && !hasExpired && !isColdBoot) {
    if (_discoveryFeedMemoryCache && _discoveryFeedMemoryCache.blocks?.length >= 14 && now - (_discoveryFeedMemoryCache.ts || 0) < THIRTY_MINUTES_MS) {
      return _discoveryFeedMemoryCache.blocks
    }
    try {
      const raw = sessionStorage.getItem(DISCOVERY_FEED_CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.blocks?.length >= 14 && now - (parsed.ts || 0) < THIRTY_MINUTES_MS) {
          _discoveryFeedMemoryCache = parsed
          return parsed.blocks
        }
      }
    } catch {}
  }

  const cursor = typeof rotationIndex === 'number' ? rotationIndex : getRotationCursor()

  // 1. Determine User Profile Readiness with strict music filter
  const validUserTracks = (userTracks || []).filter(
    (t) => t?.title && t?.artist && !DEFAULT_SEED_IDS.has(t?.video_id) && isStrictMusicTrack(t)
  )

  // Map each unique clean artist to their tracks and high-res artwork pool
  const artistMap = new Map()
  for (const t of validUserTracks) {
    const rawArtist = (t.artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim()
    const cleanArt = rawArtist.split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,\s*/i)[0].trim()
    if (
      cleanArt &&
      cleanArt.length >= 2 &&
      !/^\d+[\d.,]*\s*[kKmMbB]?\s*(?:views?|subscribers?|watching|likes?)?$/i.test(cleanArt) &&
      !/^(?:\d+\s*(?:views?|subscribers?|ago)|streamed|youtube|unknown)$/i.test(cleanArt) &&
      !NON_MUSIC_REGEX.test(cleanArt) &&
      !COMEDY_PODCAST_REGEX.test(cleanArt) &&
      !DEVOTIONAL_RELIGIOUS_REGEX.test(cleanArt)
    ) {
      const key = cleanArt.toLowerCase()
      const thumb = t.video_id
        ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg`
        : t.thumbnail || ''
      if (!artistMap.has(key)) {
        artistMap.set(key, { name: cleanArt, tracks: [], thumb, thumbs: [] })
      }
      const entry = artistMap.get(key)
      entry.tracks.push(t)
      if (thumb && !entry.thumbs.includes(thumb)) entry.thumbs.push(thumb)
      if (!entry.thumb && thumb) entry.thumb = thumb
    }
  }

  // Also include user's preferred artists from onboarding/settings if library has few items
  try {
    const rawTaste = localStorage.getItem('upbeat_taste_prefs_v1')
    if (rawTaste) {
      const parsed = JSON.parse(rawTaste)
      for (const aName of parsed.artists || []) {
        const cleanA = aName.trim()
        const key = cleanA.toLowerCase()
        if (
          cleanA &&
          !artistMap.has(key) &&
          !NON_MUSIC_REGEX.test(cleanA) &&
          !COMEDY_PODCAST_REGEX.test(cleanA) &&
          !DEVOTIONAL_RELIGIOUS_REGEX.test(cleanA)
        ) {
          artistMap.set(key, { name: cleanA, tracks: [], thumb: '', thumbs: [] })
        }
      }
    }
  } catch {}

  const artists = Array.from(artistMap.values())
  const isNewUser = artists.length < 2

  // Tier 1 — 7 Ranked Regional & Global Daily Chart Blocks based on User Preferences
  const tier1Blocks = resolveRankedChartBlocks(cursor)
  const usedCoverUrls = new Set(tier1Blocks.map((b) => b.thumbnail))

  // Group A: 4 Personalized Mood & Language Mixes
  // 1. Chill & Late Night Vibes (Badge: CHILL MIX)
  const chillArtists = artists
    .filter((a) => /joji|keshi|cigarettes|billie|finneas|kuhad|the weeknd|charlie|lana|laufey/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const chillQuery = chillArtists.length
    ? `${chillArtists.join(' ')} Joji Keshi Cigarettes After Sex chill late night vibes songs playlist -comedy -podcast`
    : 'Joji The Weeknd Keshi Cigarettes After Sex Billie Eilish chill late night vibes songs playlist -comedy -podcast'
  const chillPool = [
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg'
  ]

  // 2. J-Pop & Anime Essentials (Badge: J-POP & ANIME)
  const jpopArtists = artists
    .filter((a) => /yoasobi|kenshi|ado|eve|sawano|lisa|fujii|king gnu|radwimps|vaundy/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const jpopQuery = jpopArtists.length
    ? `${jpopArtists.join(' ')} YOASOBI Kenshi Yonezu Ado official anime jpop songs playlist -shorts`
    : 'YOASOBI Kenshi Yonezu Ado Eve King Gnu LiSA Fujii Kaze official anime jpop songs playlist -shorts'
  const jpopPool = [
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg'
  ]

  // 3. Hindi Indie & Bollywood Vibe (Badge: HINDI MIX)
  const hindiArtists = artists
    .filter((a) => /anuv|kuhad|local train|arijit|pritam|vishal|shekhar|mitraz|rikhari|atif|jasleen/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const hindiQuery = hindiArtists.length
    ? `${hindiArtists.join(' ')} Arijit Singh Prateek Kuhad Anuv Jain soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy`
    : 'Arijit Singh Prateek Kuhad Anuv Jain The Local Train Mitraz Aditya Rikhari soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy'
  const hindiPool = [
    'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'
  ]

  // 4. English Pop & Alt Anthems (Badge: ENGLISH MIX)
  const westernArtists = artists
    .filter((a) => /post malone|the weeknd|maroon 5|arctic monkeys|imagine dragons|dua lipa|travis scott|coldplay|swift|styles/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const westernQuery = westernArtists.length
    ? `${westernArtists.join(' ')} Post Malone The Weeknd Coldplay Imagine Dragons top western pop rock songs playlist -podcast`
    : 'Post Malone The Weeknd Maroon 5 Coldplay Imagine Dragons Dua Lipa Arctic Monkeys top western pop rock songs playlist -podcast'
  const westernPool = [
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg'
  ]

  // Group B: 3 Personal Library & Similar-to-What-You-Hear Mixes
  // 5. Rediscover Favorites Mix (Badge: REDISCOVER)
  const rediscoverBlock = await buildHybridRediscoverBlock({
    userTracks: validUserTracks,
    usedCoverUrls,
    rotationIndex: cursor,
    forceShuffle: forceRefresh
  })

  // 6. On Repeat & Similar Vibes (Badge: HEAVY ROTATION)
  const recentTrack = validUserTracks[0] || null
  const onRepeatQuery = recentTrack
    ? `${recentTrack.artist} ${recentTrack.title} radio songs playlist -comedy -podcast -bhajan`
    : 'Dua Lipa Post Malone The Weeknd Harry Styles heavy rotation pop hits playlist'
  const onRepeatThumb = (recentTrack?.thumbnail && !recentTrack.thumbnail.includes('default'))
    ? recentTrack.thumbnail
    : 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'

  // 7. Sonic DNA Radar (Badge: TASTE RADAR)
  const topCoreArtists = artists.slice(0, 3).map((a) => a.name)
  const radarQuery = topCoreArtists.length
    ? `${topCoreArtists.join(' ')} deep cuts rare tracks official songs playlist -comedy -podcast -bhajan`
    : 'Arctic Monkeys The Neighbourhood Kendrick Lamar deep cuts alternative songs playlist'
  const radarThumb = 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg'

  const tier2Blocks = [
    {
      id: 'block_chill_late_night',
      tier: 2,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: chillQuery,
      thumbnail: chillPool[cursor % chillPool.length],
      thumbnailPool: chillPool,
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: jpopQuery,
      thumbnail: jpopPool[cursor % jpopPool.length],
      thumbnailPool: jpopPool,
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: hindiQuery,
      thumbnail: hindiPool[cursor % hindiPool.length],
      thumbnailPool: hindiPool,
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: westernQuery,
      thumbnail: westernPool[cursor % westernPool.length],
      thumbnailPool: westernPool,
      color: 'from-purple-600/40 to-black'
    },
    rediscoverBlock,
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: onRepeatQuery,
      thumbnail: onRepeatThumb,
      thumbnailPool: [onRepeatThumb, 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'],
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: radarQuery,
      thumbnail: radarThumb,
      thumbnailPool: [radarThumb, 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'],
      color: 'from-cyan-600/40 to-black'
    }
  ]

  const allBlocks = [...tier1Blocks, ...tier2Blocks]
  _discoveryFeedMemoryCache = { blocks: allBlocks, isNewUser, ts: now }
  try {
    sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
    localStorage.setItem('upbeat_last_discovery_refresh', String(now))
  } catch {}

  return allBlocks
}

export async function rerollDiscoveryBlock(blockId, { userTracks = [], tasteDna = null, timeInfo = null } = {}) {
  const currentFeed = _discoveryFeedMemoryCache?.blocks || []
  const existingIdx = currentFeed.findIndex((b) => b.id === blockId)
  if (existingIdx === -1) return null

  // 1. Rediscover Mix: Trigger freshly shuffled favorites + newly fetched companion radio tracks (< 1s)
  if (blockId === 'block_rediscover') {
    const usedCovers = new Set(currentFeed.filter((b) => b.id !== blockId).map((b) => b.thumbnail))
    const nextCursor = advanceRotationCursor(1)
    const freshRediscover = await buildHybridRediscoverBlock({
      userTracks,
      usedCoverUrls: usedCovers,
      forceShuffle: true,
      rotationIndex: nextCursor
    })
    currentFeed[existingIdx] = freshRediscover
    _discoveryFeedMemoryCache = { blocks: currentFeed, ts: Date.now() }
    try {
      sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
    } catch {}
    return freshRediscover
  }

  // 2. Other Tier 2 & Tier 1 blocks: Advance cursor and query fresh candidate tracks/artwork
  const block = { ...currentFeed[existingIdx] }
  advanceRotationCursor(1)
  block.query = `${block.query.replace(/\s+(latest hits|trending viral|top charting rotation|essential mix|heavy rotation radio|fresh picks 2026)/g, '')} ${getRandomRotationTag()}`

  try {
    const freshRes = await directSearchStandalone(block.query, 'songs')
    const candidateTracks = freshRes?.tracks || []
    if (candidateTracks.length > 0) {
      const topThumb = candidateTracks[0]?.thumbnail || (candidateTracks[0]?.video_id ? `https://i.ytimg.com/vi/${candidateTracks[0].video_id}/hqdefault.jpg` : '')
      if (topThumb) block.thumbnail = topThumb
      block.preloadedTracks = candidateTracks
    }
  } catch {}

  currentFeed[existingIdx] = block
  _discoveryFeedMemoryCache = { blocks: currentFeed, ts: Date.now() }
  try {
    sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
  } catch {}

  return block
}

export async function loadBlockTracks(block) {
  if (!block) return []
  if (block.preloadedTracks && block.preloadedTracks.length > 0) {
    return block.preloadedTracks.filter(isStrictMusicTrack)
  }

  // Hybrid rediscover mix on-demand generation
  if (block.id === 'block_rediscover' || block.id === 'block_rediscover_favorites') {
    const hybrid = await buildHybridRediscoverBlock()
    if (hybrid?.preloadedTracks?.length > 0) {
      return hybrid.preloadedTracks.filter(isStrictMusicTrack)
    }
  }

  // 1. Direct search (fastest, most reliable across all environments)
  if (block.query) {
    try {
      const res = await directSearchStandalone(block.query, 'songs')
      if (res?.tracks?.length > 0) return res.tracks.filter(isStrictMusicTrack)
    } catch {}
  }

  // 2. Playlist browse fallback
  if (block.browse_id) {
    try {
      const plTracks = await browsePlaylistStandalone(block.browse_id, block.title, block.subtitle)
      if (plTracks && plTracks.length > 0) return plTracks.filter(isStrictMusicTrack)
    } catch {}
  }

  return []
}
