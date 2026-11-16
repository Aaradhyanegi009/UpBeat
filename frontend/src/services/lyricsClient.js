/**
 * Synced lyrics lookup (LRCLIB + backend fallback) and LRC timestamp parser.
 */
import { apiUrl } from "./platformConfig.js"

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
