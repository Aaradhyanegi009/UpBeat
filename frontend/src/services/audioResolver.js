/**
 * Audio stream resolution across Mac backend proxy and direct ANDROID/IOS Innertube clients.
 */
import { apiUrl, callInnertube, hasBackend } from "./platformConfig.js"
import { parseYtmSongs, ytmSearchRaw } from "./innertubeClient.js"

/** Parse "m:ss", "h:mm:ss", or numeric seconds into whole seconds. */
export function parseDurationText(str) {
  if (!str) return 0
  if (typeof str === "number" && isFinite(str) && str > 0) return Math.round(str)
  if (typeof str !== "string" || str === "--:--") return 0
  const clean = str.trim()
  if (/^\d+$/.test(clean)) return parseInt(clean, 10)
  const parts = clean.split(":").map(Number)
  if (parts.some((n) => isNaN(n))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
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
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000
const prewarmedSet = new Set()
const prewarmedInFlight = new Map()

/** Returns a non-expired cached audio source entry from memory, or null. */
export function getCachedAudioSource(videoId) {
  if (!videoId || typeof videoId !== 'string') return null
  const cached = streamCache.get(videoId)
  if (!cached) return null
  if (Date.now() - cached.ts >= STREAM_CACHE_TTL_MS) {
    streamCache.delete(videoId)
    prewarmedSet.delete(videoId)
    return null
  }
  return cached
}

/** Clears cached stream URL & prewarm state for a videoId (e.g. after 403/premature EOF). */
export function invalidateCachedAudioSource(videoId) {
  if (!videoId || typeof videoId !== 'string') return
  streamCache.delete(videoId)
  prewarmedSet.delete(videoId)
}

/** Returns { url, duration, video_id } for a video id (works in the APK without the Mac). */
export async function resolveStandaloneAudio(videoId, track = null) {
  if (!videoId) return null
  const cached = getCachedAudioSource(videoId)
  if (cached) return cached

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

      // ANDROID adaptiveFormats require a poToken (403 past ~10s without one), whereas ANDROID progressive (itag 18)
      // streams the full track reliably without poToken.
      const prog18 = progressive.find((f) => f.itag === 18) || progressive[0]
      const chosen = prog18 || adaptive[0]
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
        for (const client of [ANDROID_PLAYER_CLIENT, IOS_PLAYER_CLIENT]) {
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

            const chosen = (progressive.find((f) => f.itag === 18) || progressive[0]) || adaptive[0]
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

/**
 * Pre-warms the full audio source in the background before playback transitions.
 * Accepts either a videoId string or a track object `{ video_id, title, artist, duration_text }`.
 */
export function prewarmTrack(trackOrVideoId) {
  const isTrackObj = Boolean(trackOrVideoId && typeof trackOrVideoId === 'object')
  const trackObj = isTrackObj ? trackOrVideoId : null
  const videoId = isTrackObj ? trackOrVideoId.video_id : trackOrVideoId
  if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) {
    return Promise.resolve(null)
  }

  const cached = getCachedAudioSource(videoId)
  if (cached) return Promise.resolve(cached)

  if (prewarmedInFlight.has(videoId)) {
    return prewarmedInFlight.get(videoId)
  }

  if (prewarmedSet.has(videoId)) {
    return Promise.resolve(null)
  }

  const promise = (async () => {
    try {
      const entry = await getAudioSource(videoId, trackObj)
      prewarmedSet.add(videoId)
      if (prewarmedSet.size > 100) {
        const first = prewarmedSet.values().next().value
        prewarmedSet.delete(first)
      }
      return entry || null
    } catch {
      return null
    } finally {
      prewarmedInFlight.delete(videoId)
    }
  })()

  prewarmedInFlight.set(videoId, promise)
  return promise
}

/** Audio source for the player: Mac backend proxy when available, otherwise direct standalone stream. */
export async function getAudioSource(videoId, track = null) {
  if (!videoId) return null

  // 1. Memory cache hit (< 1ms)
  const cached = getCachedAudioSource(videoId)
  if (cached) {
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
