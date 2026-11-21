export const config = {
  runtime: 'edge',
}

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const CACHE_TTL_MS = 45 * 60 * 1000 // 45 minutes max fallback TTL
const MAX_STREAM_CACHE = 200

// In-memory cache in Edge worker (0ms hit for subsequent byte ranges and prewarmed songs)
const streamCache = new Map() // videoId -> { streamUrl, userAgent, mimeType, contentLength, approxDurationMs, expiresAt, ts }

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.60.19',
  osName: 'Android',
  osVersion: '14',
  androidSdkVersion: 34,
  hl: 'en',
  gl: 'US',
}

const IOS_PLAYER_CLIENT = {
  clientName: 'IOS',
  clientVersion: '19.45.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iPhone',
  osVersion: '18.1.1',
  hl: 'en',
  gl: 'US',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Track-Duration, Content-Disposition',
}

function extractVideoId(reqUrl) {
  const urlObj = new URL(reqUrl, 'http://localhost')
  const fromQuery = urlObj.searchParams.get('id') || urlObj.searchParams.get('video_id')
  if (fromQuery) return { videoId: fromQuery.trim(), urlObj }
  const parts = urlObj.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('audio')
  const fromPath = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : ''
  return { videoId: fromPath.trim(), urlObj }
}

function computeStreamExpiresAt(streamUrl, nowMs = Date.now()) {
  const defaultExp = nowMs + CACHE_TTL_MS
  try {
    const expParam = new URL(streamUrl).searchParams.get('expire')
    if (expParam && /^\d+$/.test(expParam)) {
      const expMs = Number(expParam) * 1000 - 60000
      if (expMs > 0) return Math.min(defaultExp, expMs)
    }
  } catch {}
  return defaultExp
}

function pickBestAudioFormat(adaptiveFormats = [], progressiveFormats = []) {
  const adaptive = adaptiveFormats.filter(
    (f) => f?.url && (f.mimeType || '').startsWith('audio/')
  )
  const progressive = progressiveFormats.filter((f) => f?.url)
  const nonHeM4a = adaptive
    .filter(
      (f) =>
        (f.mimeType || '').includes('audio/mp4') &&
        f.itag !== 139 &&
        f.itag !== 599 &&
        !(f.mimeType || '').includes('mp4a.40.5')
    )
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))

  return (
    nonHeM4a.find((f) => f.itag === 140) ||
    nonHeM4a.find((f) => (f.mimeType || '').includes('mp4a.40.2')) ||
    nonHeM4a[0] ||
    adaptive.find((f) => f.itag === 251) ||
    progressive.find((f) => f.itag === 18) ||
    adaptive.find((f) => f.itag !== 139 && f.itag !== 599 && !(f.mimeType || '').includes('mp4a.40.5')) ||
    progressive[0] ||
    adaptive[0] ||
    null
  )
}

function setCachedStream(videoId, entry) {
  if (streamCache.size >= MAX_STREAM_CACHE) {
    const oldestKey = streamCache.keys().next().value
    if (oldestKey !== undefined) streamCache.delete(oldestKey)
  }
  streamCache.set(videoId, entry)
}

async function resolveStreamUrl(videoId) {
  if (!VIDEO_ID_REGEX.test(videoId || '')) return null

  const now = Date.now()
  const cached = streamCache.get(videoId)
  if (cached) {
    const exp = cached.expiresAt || cached.ts + CACHE_TTL_MS
    if (now < exp) {
      return cached
    }
    streamCache.delete(videoId)
  }

  // Fast unthrottled clients: try ANDROID_VR first, then IOS fallback
  const clients = [
    {
      client: ANDROID_VR_CLIENT,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Quest 3 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.35.48.568434778 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36',
    },
    {
      client: IOS_PLAYER_CLIENT,
      userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_1 like Mac OS X; US)',
    },
  ]

  for (const { client, userAgent } of clients) {
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
        body: JSON.stringify({
          context: { client },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(8000),
      })

      if (!resp.ok) continue
      const data = await resp.json()
      if (data?.playabilityStatus?.status !== 'OK') continue

      const chosen = pickBestAudioFormat(
        data?.streamingData?.adaptiveFormats || [],
        data?.streamingData?.formats || []
      )

      if (chosen?.url) {
        const nowMs = Date.now()
        const expiresAt = computeStreamExpiresAt(chosen.url, nowMs)
        const entry = {
          streamUrl: chosen.url,
          userAgent,
          mimeType: chosen.mimeType ? chosen.mimeType.split(';')[0] : 'audio/mp4',
          contentLength: chosen.contentLength || null,
          approxDurationMs: chosen.approxDurationMs || (data?.videoDetails?.lengthSeconds ? Number(data.videoDetails.lengthSeconds) * 1000 : 0),
          expiresAt,
          ts: nowMs,
        }
        if (expiresAt > nowMs) {
          setCachedStream(videoId, entry)
        }
        return entry
      }
    } catch {}
  }

  return null
}

function parseTotalLengthFromContentRange(contentRange) {
  if (!contentRange || !contentRange.includes('/')) return null
  const totalPart = contentRange.split('/').pop().trim()
  return /^\d+$/.test(totalPart) ? totalPart : null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    })
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { videoId, urlObj } = extractVideoId(req.url)

  if (!VIDEO_ID_REGEX.test(videoId)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid 11-character video ID' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Pre-warming endpoint: resolves and caches the stream URL in the Edge worker
  if (urlObj.searchParams.get('prewarm') === '1') {
    const entry = await resolveStreamUrl(videoId)
    if (entry) {
      return new Response(JSON.stringify({ ok: true, prewarmed: true, videoId }), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=2700',
        },
      })
    }
    return new Response(JSON.stringify({ ok: false, error: 'Could not prewarm stream' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  let entry = await resolveStreamUrl(videoId)

  if (!entry?.streamUrl) {
    return new Response(req.method === 'HEAD' ? null : JSON.stringify({ error: 'No stream available for track' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  const clientRange = req.headers.get('range')
  const hasClientRange = Boolean(clientRange)
  const upstreamRange = req.method === 'HEAD' ? (clientRange || 'bytes=0-1') : (clientRange || 'bytes=0-')

  try {
    let upstreamRes = await fetch(entry.streamUrl, {
      headers: {
        Range: upstreamRange,
        'User-Agent': entry.userAgent,
      },
      signal: AbortSignal.timeout(10000),
    })

    // If upstream expired (403/410), invalidate cache and re-resolve once
    if (upstreamRes.status === 403 || upstreamRes.status === 410) {
      await upstreamRes.body?.cancel?.().catch(() => {})
      streamCache.delete(videoId)
      entry = await resolveStreamUrl(videoId)
      if (!entry?.streamUrl) {
        return new Response(req.method === 'HEAD' ? null : JSON.stringify({ error: 'Stream expired and unavailable' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        })
      }
      upstreamRes = await fetch(entry.streamUrl, {
        headers: {
          Range: upstreamRange,
          'User-Agent': entry.userAgent,
        },
        signal: AbortSignal.timeout(10000),
      })
    }

    if (!upstreamRes.ok) {
      await upstreamRes.body?.cancel?.().catch(() => {})
      if (upstreamRes.status === 403 || upstreamRes.status === 410) {
        streamCache.delete(videoId)
      }
      const errStatus = upstreamRes.status === 416 ? 416 : upstreamRes.status === 404 ? 404 : 502
      return new Response(
        req.method === 'HEAD' ? null : JSON.stringify({ error: `Upstream audio fetch failed (${upstreamRes.status})` }),
        {
          status: errStatus,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      )
    }

    const responseHeaders = new Headers(CORS_HEADERS)
    responseHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || entry.mimeType || 'audio/mp4')
    responseHeaders.set('Accept-Ranges', 'bytes')
    responseHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
    if (entry.approxDurationMs > 0) {
      responseHeaders.set('X-Track-Duration', String(Math.round(Number(entry.approxDurationMs) / 1000)))
    }

    const contentRange = upstreamRes.headers.get('content-range')
    const totalLength = parseTotalLengthFromContentRange(contentRange) || (entry.contentLength ? String(entry.contentLength) : null)

    if (req.method === 'HEAD') {
      await upstreamRes.body?.cancel?.().catch(() => {})
      if (hasClientRange && upstreamRes.status === 206) {
        if (contentRange) responseHeaders.set('Content-Range', contentRange)
        const cl = upstreamRes.headers.get('content-length')
        if (cl) responseHeaders.set('Content-Length', cl)
        return new Response(null, { status: 206, headers: responseHeaders })
      }
      if (totalLength) responseHeaders.set('Content-Length', totalLength)
      return new Response(null, { status: 200, headers: responseHeaders })
    }

    if (hasClientRange && upstreamRes.status === 206) {
      if (contentRange) responseHeaders.set('Content-Range', contentRange)
      const contentLength = upstreamRes.headers.get('content-length')
      if (contentLength) responseHeaders.set('Content-Length', contentLength)
      return new Response(upstreamRes.body, {
        status: 206,
        headers: responseHeaders,
      })
    }

    // Client did not send Range: only return 200 when full content starts at byte 0
    const contentLength = upstreamRes.headers.get('content-length') || totalLength
    if (contentLength) responseHeaders.set('Content-Length', contentLength)

    return new Response(upstreamRes.body, {
      status: 200,
      headers: responseHeaders,
    })
  } catch (err) {
    return new Response(
      req.method === 'HEAD' ? null : JSON.stringify({ error: err.message || 'Stream fetch error' }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }
    )
  }
}
