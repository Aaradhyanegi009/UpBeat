export const config = {
  runtime: 'edge',
}

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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
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

      const chosen =
        adaptive.find((f) => f.itag === 140) ||
        adaptive.find((f) => (f.mimeType || '').includes('mp4a.40.2')) ||
        adaptive.find((f) => f.itag === 251) ||
        progressive.find((f) => f.itag === 18) ||
        adaptive[0] ||
        progressive[0]

      if (chosen?.url) {
        const durationSec =
          Number(data?.videoDetails?.lengthSeconds || 0) ||
          Math.round(Number(chosen.approxDurationMs || 0) / 1000) ||
          0

        return new Response(
          JSON.stringify({
            video_id: videoId,
            duration: durationSec,
            duration_text: formatSeconds(durationSec),
            url: `/api/audio?id=${videoId}`,
            direct_stream_url: chosen.url,
            title: data?.videoDetails?.title || '',
            artist: data?.videoDetails?.author || '',
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=2700',
            },
          }
        )
      }
    } catch {}
  }

  return new Response(JSON.stringify({ error: 'Stream resolution failed' }), {
    status: 404,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
