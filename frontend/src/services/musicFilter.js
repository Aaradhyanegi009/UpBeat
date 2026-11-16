/**
 * Pure music validation rules and local library sanitization.
 */

import {
  COMEDY_PODCAST_REGEX,
  DEVOTIONAL_RELIGIOUS_REGEX,
  NON_MUSIC_GENERAL_REGEX,
  STRICT_VIDEO_ID_REGEX,
  NON_MUSIC_REGEX,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  INVALID_ARTIST_NUMERIC_REGEX,
  INVALID_ARTIST_GENERIC_REGEX
} from '../config/musicFilters.js'

export {
  COMEDY_PODCAST_REGEX,
  DEVOTIONAL_RELIGIOUS_REGEX,
  NON_MUSIC_GENERAL_REGEX,
  STRICT_VIDEO_ID_REGEX,
  NON_MUSIC_REGEX
}

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
 * UpBeat Ironclad Music Filter:
 * Rejects stand-up comedy, podcasts, devotional/bhajan videos, gaming clips, educational lectures,
 * view counts/subscriber counts mistakenly parsed as artist, invalid video IDs, and clips <75s or >420s.
 */
export function isStrictMusicTrack(track) {
  if (!track || typeof track !== 'object') return false
  const title = (track.title || '').trim()
  const artist = (track.artist || '').trim()
  if (!title || !artist) return false

  // Reject view counts, subscriber counts, or relative dates captured as artist
  if (INVALID_ARTIST_NUMERIC_REGEX.test(artist)) return false
  if (INVALID_ARTIST_GENERIC_REGEX.test(artist)) return false

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
  if (sec > 0 && (sec < MIN_DURATION_SEC || sec > MAX_DURATION_SEC)) {
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
