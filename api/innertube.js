export const config = {
  runtime: 'edge',
}

const ALLOWED_ENDPOINTS = new Set(['search', 'browse', 'next', 'player'])
const ALLOWED_SERVICES = new Set(['music', 'youtube'])

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

  let data
  try {
    data = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return new Response(JSON.stringify({ error: 'Payload must be a JSON object' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const endpoint = String(data.endpoint || '').trim()
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return new Response(JSON.stringify({ error: 'Unsupported Innertube endpoint' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const service = String(data.service || 'music').trim()
  if (!ALLOWED_SERVICES.has(service)) {
    return new Response(JSON.stringify({ error: 'Unsupported Innertube service' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const body = data.body === undefined ? {} : data.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: 'Innertube request body must be a JSON object' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
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
      signal: AbortSignal.timeout(15000),
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
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  }
}
