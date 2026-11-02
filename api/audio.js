export const config = {
  runtime: 'edge',
}

// In-memory cache in Edge worker (0ms hit for subsequent byte ranges and prewarmed songs)
const streamCache = new Map() // videoId -> { streamUrl, mimeType, contentLength, approxDurationMs, ts }
const CACHE_TTL_MS = 45 * 60 * 1000 // 45 minutes

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
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
}

async function resolveStreamUrl(videoId) {
  if (!videoId || videoId.length !== 11) return null

  const cached = streamCache.get(videoId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached
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
      })

      if (!resp.ok) continue
      const data = await resp.json()
      if (data?.playabilityStatus?.status !== 'OK') continue

      const adaptive = (data?.streamingData?.adaptiveFormats || []).filter(
        (f) => f.url && (f.mimeType || '').startsWith('audio/')
      )
      const progressive = (data?.streamingData?.formats || []).filter((f) => f.url)

      // Format 140 (AAC LC ~128kbps, mp4a.40.2) has the smallest initial MP4 moov atom
      // and starts instantly across Chrome, Safari (macOS/iOS), and Android WebView.
      const chosen =
        adaptive.find((f) => f.itag === 140) ||
        adaptive.find((f) => (f.mimeType || '').includes('mp4a.40.2')) ||
        adaptive.find((f) => f.itag === 251) ||
        progressive.find((f) => f.itag === 18) ||
        adaptive[0] ||
        progressive[0]

      if (chosen?.url) {
        const entry = {
          streamUrl: chosen.url,
          mimeType: chosen.mimeType ? chosen.mimeType.split(';')[0] : 'audio/mp4',
          contentLength: chosen.contentLength || null,
          approxDurationMs: chosen.approxDurationMs || (data?.videoDetails?.lengthSeconds ? data.videoDetails.lengthSeconds * 1000 : 0),
          ts: Date.now(),
        }
        streamCache.set(videoId, entry)
        return entry
      }
    } catch {}
  }

  return null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    })
  }

  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('id') || searchParams.get('video_id')

  if (!videoId || videoId.length !== 11) {
    return new Response(JSON.stringify({ error: 'Missing or invalid 11-character video ID' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Pre-warming endpoint: resolves and caches the stream URL in the Edge worker
  if (searchParams.get('prewarm') === '1') {
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
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  let entry = await resolveStreamUrl(videoId)

  if (!entry?.streamUrl) {
    return new Response(JSON.stringify({ error: 'No stream available for track' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Extract browser's Range request header (default to bytes=0- for instant start)
  const incomingRange = req.headers.get('range') || 'bytes=0-'

  try {
    let upstreamRes = await fetch(entry.streamUrl, {
      headers: {
        'Range': incomingRange,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    // If upstream expired (403/410), invalidate cache and re-resolve once
    if (upstreamRes.status === 403 || upstreamRes.status === 410) {
      streamCache.delete(videoId)
      entry = await resolveStreamUrl(videoId)
      if (entry?.streamUrl) {
        upstreamRes = await fetch(entry.streamUrl, {
          headers: {
            'Range': incomingRange,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        })
      }
    }

    const responseHeaders = new Headers(CORS_HEADERS)
    responseHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || entry.mimeType || 'audio/mp4')
    responseHeaders.set('Accept-Ranges', 'bytes')
    responseHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')

    const contentRange = upstreamRes.headers.get('content-range')
    if (contentRange) responseHeaders.set('Content-Range', contentRange)

    const contentLength = upstreamRes.headers.get('content-length')
    if (contentLength) responseHeaders.set('Content-Length', contentLength)

    // Stream ReadableStream body directly to client with zero memory buffering
    return new Response(upstreamRes.body, {
      status: upstreamRes.status === 206 ? 206 : 200,
      headers: responseHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Stream fetch error' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
}
