export const config = {
  runtime: 'edge',
}

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

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
  'Access-Control-Allow-Headers': 'Content-Type',
}

function formatSeconds(sec) {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function extractVideoId(reqUrl) {
  const urlObj = new URL(reqUrl, 'http://localhost')
  const fromQuery = urlObj.searchParams.get('id') || urlObj.searchParams.get('video_id')
  if (fromQuery) return { videoId: fromQuery.trim(), urlObj }
  const parts = urlObj.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('audio-info')
  const fromPath = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : ''
  return { videoId: fromPath.trim(), urlObj }
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
        const durationSec =
          Number(data?.videoDetails?.lengthSeconds || 0) ||
          Math.round(Number(chosen.approxDurationMs || 0) / 1000) ||
          0

        const fwdParams = new URLSearchParams()
        for (const key of ['title', 'artist', 'expected_duration']) {
          const val = urlObj.searchParams.get(key)
          if (val) fwdParams.set(key, val)
        }
        const qs = fwdParams.toString() ? `?${fwdParams.toString()}` : ''

        const body = req.method === 'HEAD'
          ? null
          : JSON.stringify({
              video_id: videoId,
              resolved_video_id: videoId,
              original_video_id: videoId,
              duration: durationSec,
              duration_text: formatSeconds(durationSec),
              url: `/api/audio/${videoId}${qs}`,
              direct_stream_url: chosen.url,
              title: data?.videoDetails?.title || '',
              artist: data?.videoDetails?.author || '',
            })

        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=2700',
          },
        })
      }
    } catch {}
  }

  return new Response(req.method === 'HEAD' ? null : JSON.stringify({ error: 'Stream resolution failed' }), {
    status: 404,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
