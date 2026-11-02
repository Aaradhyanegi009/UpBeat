export const config = {
  runtime: 'edge',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const data = await req.json()
    const endpoint = data.endpoint || ''
    const body = data.body || {}
    const service = data.service || 'music'

    const host = service === 'youtube' ? 'https://www.youtube.com' : 'https://music.youtube.com'
    const targetUrl = `${host}/youtubei/v1/${endpoint}?prettyPrint=false`

    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        Referer: host,
      },
      body: JSON.stringify(body),
    })

    const resData = await upstreamRes.text()

    return new Response(resData, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Innertube edge proxy error' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  }
}
