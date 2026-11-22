/**
 * UpBeat Windows Desktop Internal Microserver
 * Lightweight, zero-dependency Node.js HTTP server.
 * Serves the UpBeat frontend assets and proxies YouTube Music/Innertube,
 * LRCLIB lyrics, downloads, and high-performance audio streams directly on Windows.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { URL } = require('url')

const DEFAULT_PORT = 48173
const PORT_FALLBACK_COUNT = 3
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const ALLOWED_INNERTUBE_ENDPOINTS = new Set(['search', 'browse', 'next', 'player'])
const ALLOWED_SERVICES = new Set(['music', 'youtube'])
const MAX_JSON_BODY_BYTES = 1024 * 1024 // 1 MB
const UPSTREAM_TIMEOUT_MS = 10000 // 10 seconds
const MAX_STREAM_CACHE_SIZE = 200
const MAX_LYRICS_CACHE_SIZE = 500
const LYRICS_CACHE_HIT_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const LYRICS_CACHE_MISS_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_SOCIAL_KEYS = 500
const CACHE_TTL_MS = 45 * 60 * 1000

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm'
}

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

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.60.19',
  osName: 'Android',
  osVersion: '14',
  androidSdkVersion: 34,
  hl: 'en',
  gl: 'US'
}

const ANDROID_PLAYER_UA =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US; Pixel 8 Build/UQ1A.240205.004) gzip'

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const streamCache = new Map()
const socialMailbox = new Map()
const socialPresence = new Map()
const jamRooms = new Map()

function isAllowedCorsOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false
  const trimmed = origin.trim()
  return (
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(trimmed) ||
    /^capacitor:\/\/localhost$/i.test(trimmed) ||
    /^file:\/\//i.test(trimmed)
  )
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin
  let allowed = true
  if (origin) {
    if (isAllowedCorsOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    } else {
      allowed = false
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Accept')
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Accept-Ranges, Content-Disposition'
  )
  return allowed
}

function sendJson(res, statusCode, payload, { closeConnection = false } = {}) {
  if (res.headersSent) return
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (closeConnection || statusCode === 413) {
    headers.Connection = 'close'
  }
  res.writeHead(statusCode, headers)
  res.end(JSON.stringify(payload), () => {
    if (closeConnection || statusCode === 413) {
      try { res.socket?.destroySoon?.() } catch {}
    }
  })
}

function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    let finished = false

    const fail = (statusCode, message) => {
      if (finished) return
      finished = true
      reject(Object.assign(new Error(message), { statusCode }))
    }

    req.on('data', (chunk) => {
      if (finished) return
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        chunks.length = 0
        req.pause()
        fail(413, 'Payload exceeds maximum allowed size (1MB)')
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (finished) return
      finished = true
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        const parsed = JSON.parse(raw || '{}')
        resolve(parsed)
      } catch {
        reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }))
      }
    })

    req.on('error', (err) => {
      fail(400, err?.message || 'Request stream error')
    })
  })
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function isCacheEntryExpired(entry) {
  if (!entry || !entry.streamUrl) return true
  if (Date.now() - entry.ts >= CACHE_TTL_MS) return true
  try {
    const u = new URL(entry.streamUrl)
    const exp = Number(u.searchParams.get('expire') || 0)
    if (exp > 0 && Date.now() / 1000 >= exp - 60) {
      return true
    }
  } catch {}
  return false
}

function setStreamCacheEntry(videoId, entry) {
  if (!videoId || !entry) return
  if (streamCache.has(videoId)) {
    streamCache.delete(videoId)
  }
  while (streamCache.size >= MAX_STREAM_CACHE_SIZE) {
    const oldestKey = streamCache.keys().next().value
    if (oldestKey === undefined) break
    streamCache.delete(oldestKey)
  }
  streamCache.set(videoId, entry)
}

function boundMapSize(map, maxKeys = MAX_SOCIAL_KEYS) {
  while (map.size > maxKeys) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  { abortAfterHeaders = false } = {}
) {
  const controller = new AbortController()
  const externalSignal = options.signal
  const onExternalAbort = () => controller.abort(externalSignal?.reason || new Error('Aborted'))
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`Upstream timeout after ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal })
    if (abortAfterHeaders) {
      clearTimeout(timer)
    }
    return { resp, controller, cleanup: () => {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    } }
  } catch (err) {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    throw err
  }
}

async function resolveStreamUrl(videoId, { bypassCache = false } = {}) {
  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) return null

  if (!bypassCache) {
    const cached = streamCache.get(videoId)
    if (cached && !isCacheEntryExpired(cached)) {
      // Refresh LRU position
      streamCache.delete(videoId)
      streamCache.set(videoId, cached)
      return cached
    }
    if (cached) {
      streamCache.delete(videoId)
    }
  } else {
    streamCache.delete(videoId)
  }

  const clients = [
    {
      client: ANDROID_PLAYER_CLIENT,
      userAgent: ANDROID_PLAYER_UA
    },
    {
      client: IOS_PLAYER_CLIENT,
      userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; US)'
    },
    {
      client: ANDROID_VR_CLIENT,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Quest 3 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.35.48.568434778 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36'
    }
  ]

  for (const { client, userAgent } of clients) {
    let cleanup = () => {}
    try {
      const result = await fetchWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent
          },
          body: JSON.stringify({
            context: { client },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true
          })
        },
        UPSTREAM_TIMEOUT_MS
      )
      cleanup = result.cleanup
      const resp = result.resp

      if (!resp.ok) continue
      const data = await resp.json()
      if (data?.playabilityStatus?.status !== 'OK') continue

      const adaptive = (data?.streamingData?.adaptiveFormats || []).filter(
        (f) => f.url && (f.mimeType || '').startsWith('audio/')
      )
      const progressive = (data?.streamingData?.formats || []).filter((f) => f.url)

      const chosen =
        progressive.find((f) => f.itag === 18) ||
        progressive[0] ||
        adaptive.find((f) => f.itag === 140) ||
        adaptive.find((f) => (f.mimeType || '').includes('mp4a.40.2')) ||
        adaptive.find((f) => f.itag === 251) ||
        adaptive[0] ||
        null

      if (chosen?.url) {
        const rawMime = chosen.mimeType ? chosen.mimeType.split(';')[0] : 'audio/mp4'
        const entry = {
          streamUrl: chosen.url,
          userAgent,
          mimeType: rawMime.includes('mp4') ? 'audio/mp4' : rawMime,
          contentLength: chosen.contentLength ? Number(chosen.contentLength) : null,
          duration:
            Number(data?.videoDetails?.lengthSeconds || 0) ||
            Math.round((chosen.approxDurationMs || 0) / 1000),
          video_id: videoId,
          ts: Date.now()
        }
        setStreamCacheEntry(videoId, entry)
        return entry
      }
    } catch {
      // Try next player client
    } finally {
      cleanup()
    }
  }
  return null
}

function sanitizeDownloadFilename(title, artist) {
  const cleanTitle = String(title || 'Track')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/*?:"<>|]/g, '')
    .trim() || 'Track'
  const cleanArtist = String(artist || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/*?:"<>|]/g, '')
    .trim()

  if (cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
    return `${cleanArtist} - ${cleanTitle}.m4a`
  }
  return `${cleanTitle}.m4a`
}

function makeContentDisposition(filename) {
  const clean = String(filename || 'track.m4a').replace(/[\r\n]/g, '')
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

async function proxyUpstreamMedia({ videoId, req, res, rangeHeader = null, extraHeaders = {}, errorAsJson = false }) {
  const sendNotFound = (msg) => {
    if (errorAsJson) sendJson(res, 404, { error: msg })
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(msg)
    }
  }

  let stream = await resolveStreamUrl(videoId)
  if (!stream?.streamUrl) {
    sendNotFound('Stream not found')
    return
  }

  const clientAbortController = new AbortController()
  const abortUpstream = () => {
    if (!clientAbortController.signal.aborted) {
      clientAbortController.abort(new Error('Client disconnected'))
    }
  }
  req.on('aborted', abortUpstream)
  res.on('close', () => {
    if (!res.writableEnded) abortUpstream()
  })

  const openUpstream = async (targetStream) => {
    const upstreamHeaders = { 'User-Agent': targetStream.userAgent || DESKTOP_CHROME_UA }
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader
    }
    return fetchWithTimeout(
      targetStream.streamUrl,
      {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        signal: clientAbortController.signal
      },
      UPSTREAM_TIMEOUT_MS,
      { abortAfterHeaders: true }
    )
  }

  let handle = null
  try {
    handle = await openUpstream(stream)
    if (handle.resp.status === 403 || handle.resp.status === 410) {
      try { await handle.resp.body?.cancel?.() } catch {}
      handle.cleanup()
      streamCache.delete(videoId)

      stream = await resolveStreamUrl(videoId, { bypassCache: true })
      if (!stream?.streamUrl) {
        sendNotFound('Audio stream expired and could not be refreshed')
        return
      }
      handle = await openUpstream(stream)
    }

    const upstreamResp = handle.resp
    const resHeaders = {
      'Content-Type': upstreamResp.headers.get('content-type') || stream.mimeType || 'audio/mp4',
      'Accept-Ranges': 'bytes',
      ...extraHeaders
    }

    const cr = upstreamResp.headers.get('content-range')
    if (cr) resHeaders['Content-Range'] = cr
    const cl = upstreamResp.headers.get('content-length') || (stream.contentLength ? String(stream.contentLength) : '')
    if (cl) resHeaders['Content-Length'] = cl

    res.writeHead(upstreamResp.status, resHeaders)

    if (req.method === 'HEAD') {
      try { await upstreamResp.body?.cancel?.() } catch {}
      handle.cleanup()
      res.end()
      return
    }

    if (upstreamResp.body) {
      const nodeStream = Readable.fromWeb(upstreamResp.body)
      const onDisconnect = () => {
        nodeStream.destroy()
      }
      res.once('close', onDisconnect)
      nodeStream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
        }
        if (!res.writableEnded) {
          res.end()
        }
      })
      nodeStream.on('end', () => {
        res.removeListener('close', onDisconnect)
        handle.cleanup()
      })
      nodeStream.on('close', () => {
        res.removeListener('close', onDisconnect)
        handle.cleanup()
      })
      nodeStream.pipe(res)
    } else {
      handle.cleanup()
      res.end()
    }
  } catch (err) {
    handle?.cleanup?.()
    if (clientAbortController.signal.aborted) {
      if (!res.writableEnded) res.end()
      return
    }
    if (!res.headersSent) {
      if (errorAsJson) {
        sendJson(res, 502, { error: 'Upstream audio error' })
      } else {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Upstream audio error')
      }
    } else if (!res.writableEnded) {
      res.end()
    }
  }
}

function startServer(options = {}) {
  const staticDir = path.resolve(options.staticDir || path.join(__dirname, '../frontend/dist'))
  const staticPrefix = staticDir.endsWith(path.sep) ? staticDir : `${staticDir}${path.sep}`
  const userDataDir = options.userDataDir || path.join(__dirname, 'userData')
  const version = options.version || '7.7.2'

  if (!fs.existsSync(userDataDir)) {
    try { fs.mkdirSync(userDataDir, { recursive: true }) } catch {}
  }

  const favoritesFile = path.join(userDataDir, 'favorites.json')
  const profileFile = path.join(userDataDir, 'profile.json')
  const lyricsCache = new Map()

  function getCachedLyrics(cacheKey) {
    const entry = lyricsCache.get(cacheKey)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      lyricsCache.delete(cacheKey)
      return null
    }
    lyricsCache.delete(cacheKey)
    lyricsCache.set(cacheKey, entry)
    return entry.data.map((item) => (item && typeof item === 'object' ? { ...item } : item))
  }

  function setCachedLyrics(cacheKey, data, ttlMs) {
    const now = Date.now()
    if (lyricsCache.has(cacheKey)) {
      lyricsCache.delete(cacheKey)
    }
    if (lyricsCache.size >= MAX_LYRICS_CACHE_SIZE) {
      for (const [k, v] of lyricsCache.entries()) {
        if (now >= v.expiresAt) lyricsCache.delete(k)
      }
    }
    while (lyricsCache.size >= MAX_LYRICS_CACHE_SIZE) {
      const oldestKey = lyricsCache.keys().next().value
      if (oldestKey === undefined) break
      lyricsCache.delete(oldestKey)
    }
    const cloned = Array.isArray(data)
      ? data.map((item) => (item && typeof item === 'object' ? { ...item } : item))
      : []
    lyricsCache.set(cacheKey, { expiresAt: now + ttlMs, data: cloned })
  }

  const server = http.createServer(async (req, res) => {
    const corsAllowed = applyCorsHeaders(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(corsAllowed ? 204 : 403)
      res.end()
      return
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
    const pathname = parsedUrl.pathname

    // 1. /api/status
    if (pathname === '/api/status') {
      const addr = server.address()
      sendJson(res, 200, {
        ok: true,
        status: 'online',
        app: 'UpBeat',
        version,
        port: typeof addr === 'object' && addr ? addr.port : null,
        platform: process.platform,
        arch: process.arch,
        engine: 'upbeat-electron-microserver',
        capabilities: {
          audio: true,
          download: true,
          lyrics: true,
          innertube: true,
          favorites: true,
          profile: true,
          jam: true,
          curate: false
        }
      })
      return
    }

    // 2. /api/innertube (Strict endpoint allowlist proxy to music.youtube.com / youtube.com)
    if (pathname === '/api/innertube' && req.method === 'POST') {
      let cleanup = () => {}
      try {
        const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES)
        const endpoint = String(payload?.endpoint || '').trim()
        const postBody = payload?.body ?? {}
        const service = String(payload?.service || 'music').trim()

        if (!ALLOWED_INNERTUBE_ENDPOINTS.has(endpoint)) {
          sendJson(res, 400, { error: 'Unsupported Innertube endpoint' })
          return
        }
        if (!ALLOWED_SERVICES.has(service)) {
          sendJson(res, 400, { error: 'Unsupported Innertube service' })
          return
        }
        if (!postBody || typeof postBody !== 'object' || Array.isArray(postBody)) {
          sendJson(res, 400, { error: 'Invalid Innertube request body' })
          return
        }

        const host = service === 'youtube' ? 'https://www.youtube.com' : 'https://music.youtube.com'
        const targetUrl = `${host}/youtubei/v1/${endpoint}?prettyPrint=false`

        const result = await fetchWithTimeout(
          targetUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': DESKTOP_CHROME_UA,
              Referer: host
            },
            body: JSON.stringify(postBody)
          },
          UPSTREAM_TIMEOUT_MS
        )
        cleanup = result.cleanup
        const data = await result.resp.text()
        res.writeHead(result.resp.status, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(data)
      } catch (err) {
        const code = err?.statusCode || 500
        sendJson(res, code, { error: err?.message || 'Innertube proxy error' })
      } finally {
        cleanup()
      }
      return
    }

    // 2b. /api/lyrics (LRCLIB /api/get duration-matched lookup + /api/search fallback with bounded TTL cache)
    if (pathname === '/api/lyrics' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('q') || '').trim()
      const trackName = (parsedUrl.searchParams.get('track_name') || '').trim()
      const artistName = (parsedUrl.searchParams.get('artist_name') || '').trim()
      const rawDuration = Number(parsedUrl.searchParams.get('duration') || 0)
      const durInt = Number.isFinite(rawDuration) && rawDuration > 15 ? Math.round(rawDuration) : 0

      if (!q && !trackName && !artistName) {
        sendJson(res, 200, [])
        return
      }

      const cacheKey = JSON.stringify([q.toLowerCase(), trackName.toLowerCase(), artistName.toLowerCase(), durInt])
      const cached = getCachedLyrics(cacheKey)
      if (cached !== null) {
        sendJson(res, 200, cached)
        return
      }

      const lrclibHeaders = {
        'User-Agent': `UpBeat/${version} (https://upbeat.app)`
      }

      if (trackName && artistName) {
        const getParams = new URLSearchParams({
          track_name: trackName,
          artist_name: artistName
        })
        if (durInt > 15) {
          getParams.set('duration', String(durInt))
        }
        let getCleanup = () => {}
        try {
          const getResult = await fetchWithTimeout(
            `https://lrclib.net/api/get?${getParams.toString()}`,
            { method: 'GET', headers: lrclibHeaders },
            UPSTREAM_TIMEOUT_MS
          )
          getCleanup = getResult.cleanup
          if (getResult.resp.ok) {
            const getData = await getResult.resp.json()
            if (
              getData &&
              typeof getData === 'object' &&
              !Array.isArray(getData) &&
              (getData.syncedLyrics || getData.plainLyrics)
            ) {
              const wrapped = [getData]
              setCachedLyrics(cacheKey, wrapped, LYRICS_CACHE_HIT_TTL_MS)
              sendJson(res, 200, wrapped)
              return
            }
          }
        } catch {} finally {
          getCleanup()
        }
      }

      const searchParams = new URLSearchParams()
      if (q) searchParams.set('q', q)
      if (trackName) searchParams.set('track_name', trackName)
      if (artistName) searchParams.set('artist_name', artistName)

      let cleanup = () => {}
      try {
        const result = await fetchWithTimeout(
          `https://lrclib.net/api/search?${searchParams.toString()}`,
          {
            method: 'GET',
            headers: lrclibHeaders
          },
          UPSTREAM_TIMEOUT_MS
        )
        cleanup = result.cleanup
        if (result.resp.ok) {
          const lyricsData = await result.resp.json()
          const normalized = Array.isArray(lyricsData) ? lyricsData : []
          setCachedLyrics(
            cacheKey,
            normalized,
            normalized.length > 0 ? LYRICS_CACHE_HIT_TTL_MS : LYRICS_CACHE_MISS_TTL_MS
          )
          sendJson(res, 200, normalized)
          return
        }
        if (result.resp.status === 404) {
          setCachedLyrics(cacheKey, [], LYRICS_CACHE_MISS_TTL_MS)
        }
      } catch {} finally {
        cleanup()
      }
      sendJson(res, 200, [])
      return
    }

    // 3. /api/audio-info/:id or /api/audio-info?id=...
    if (pathname === '/api/audio-info' || pathname.startsWith('/api/audio-info/')) {
      let videoId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('video_id') || ''
      if (!videoId) {
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length >= 3) videoId = parts[2]
      }
      videoId = String(videoId).trim()

      if (!VIDEO_ID_REGEX.test(videoId)) {
        sendJson(res, 400, { error: 'Missing or invalid video ID' })
        return
      }

      const stream = await resolveStreamUrl(videoId)
      if (stream) {
        sendJson(res, 200, {
          ok: true,
          video_id: videoId,
          duration: stream.duration,
          mimeType: stream.mimeType,
          contentLength: stream.contentLength,
          url: `/api/audio/${videoId}`
        })
      } else {
        sendJson(res, 404, { error: 'Audio stream unavailable' })
      }
      return
    }

    // 4. /api/audio/:id (GET/HEAD audio stream proxy with Range & 403 invalidation)
    if (pathname.startsWith('/api/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const videoId = pathname.slice('/api/audio/'.length).trim()
      if (!VIDEO_ID_REGEX.test(videoId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid video ID')
        return
      }

      await proxyUpstreamMedia({
        videoId,
        req,
        res,
        rangeHeader: req.headers.range || null
      })
      return
    }

    // 4b. /api/download/:id (GET/HEAD direct .m4a attachment parity route)
    if (pathname.startsWith('/api/download/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const videoId = pathname.slice('/api/download/'.length).trim()
      if (!VIDEO_ID_REGEX.test(videoId)) {
        sendJson(res, 400, { error: 'Invalid video ID' })
        return
      }

      const title = parsedUrl.searchParams.get('title') || 'Track'
      const artist = parsedUrl.searchParams.get('artist') || ''
      const filename = sanitizeDownloadFilename(title, artist)

      await proxyUpstreamMedia({
        videoId,
        req,
        res,
        rangeHeader: req.headers.range || null,
        extraHeaders: {
          'Content-Disposition': makeContentDisposition(filename),
          'Cache-Control': 'public, max-age=3600'
        },
        errorAsJson: true
      })
      return
    }

    // 5. /api/favorites
    if (pathname === '/api/favorites') {
      if (req.method === 'GET') {
        let data = '[]'
        try {
          if (fs.existsSync(favoritesFile)) data = fs.readFileSync(favoritesFile, 'utf8')
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(data || '[]')
        return
      }
      if (req.method === 'POST') {
        try {
          const parsed = await readJsonBody(req, MAX_JSON_BODY_BYTES)
          const valid =
            Array.isArray(parsed) ||
            (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.favorites))
          if (!valid) {
            sendJson(res, 400, { error: 'Favorites payload must be a JSON array or { favorites: [] }' })
            return
          }
          writeJsonAtomic(favoritesFile, parsed)
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, err?.statusCode || 500, { error: err?.message || 'Failed to save favorites' })
        }
        return
      }
    }

    // 6. /api/profile
    if (pathname === '/api/profile') {
      if (req.method === 'GET') {
        let data = '{}'
        try {
          if (fs.existsSync(profileFile)) data = fs.readFileSync(profileFile, 'utf8')
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(data || '{}')
        return
      }
      if (req.method === 'POST') {
        try {
          const parsed = await readJsonBody(req, MAX_JSON_BODY_BYTES)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            sendJson(res, 400, { error: 'Profile payload must be a JSON object' })
            return
          }
          writeJsonAtomic(profileFile, parsed)
          sendJson(res, 200, { ok: true })
        } catch (err) {
          sendJson(res, err?.statusCode || 500, { error: err?.message || 'Failed to save profile' })
        }
        return
      }
    }

    // 6b. /api/jam/social/send & /api/jam/social/poll & /api/social & /api/jam/room/*
    if (pathname === '/api/jam/social/send' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES)
        const nowMs = Date.now()
        const target = String(payload.targetFriendCode || '').trim().toUpperCase()
        if (target) {
          const pkt = { ...(payload.packet || {}), _serverTs: nowMs }
          if (pkt.from && pkt.from.friendCode) {
            const sCode = String(pkt.from.friendCode).trim().toUpperCase()
            socialPresence.set(sCode, { ...pkt.from, lastSeen: nowMs })
            boundMapSize(socialPresence)
          }
          const box = socialMailbox.get(target) || []
          const cutoff = nowMs - 12 * 3600 * 1000
          const filtered = box.filter((m) => (m._serverTs || 0) > cutoff)
          if (!pkt._packetId || !filtered.some((m) => m._packetId === pkt._packetId)) {
            filtered.push(pkt)
            if (filtered.length > 150) filtered.splice(0, filtered.length - 150)
          }
          socialMailbox.set(target, filtered)
          boundMapSize(socialMailbox)
        }
        sendJson(res, 200, { ok: true, serverTs: nowMs })
      } catch (err) {
        sendJson(res, err?.statusCode === 413 ? 413 : 200, { ok: false, error: err?.message })
      }
      return
    }

    if (pathname === '/api/jam/social/poll' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES)
        const nowMs = Date.now()
        const myCode = String(payload.friendCode || '').trim().toUpperCase()
        if (myCode && payload.summary && typeof payload.summary === 'object') {
          socialPresence.set(myCode, { ...payload.summary, friendCode: myCode, lastSeen: nowMs })
          boundMapSize(socialPresence)
        }
        const sinceTs = Number(payload.since || 0)
        const box = socialMailbox.get(myCode) || []
        const packets = box.filter((m) => (m._serverTs || 0) > sinceTs)
        const presenceList = []
        for (const fc of payload.friendCodes || []) {
          const cleanFc = String(fc || '').trim().toUpperCase()
          const pres = socialPresence.get(cleanFc)
          if (pres && nowMs - (pres.lastSeen || 0) < 45000) {
            presenceList.push({ ...pres, online: true })
          }
        }
        sendJson(res, 200, {
          ok: true,
          serverTs: nowMs,
          inbox: packets,
          packets,
          friends: presenceList,
          presence: presenceList
        })
      } catch (err) {
        sendJson(res, err?.statusCode === 413 ? 413 : 200, {
          ok: false,
          inbox: [],
          packets: [],
          friends: [],
          presence: []
        })
      }
      return
    }

    if (pathname === '/api/social' && req.method === 'GET') {
      const nowMs = Date.now()
      const myCode = String(parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('friendCode') || '')
        .trim()
        .toUpperCase()
      const sinceTs = Number(parsedUrl.searchParams.get('since') || 0)
      if (myCode && socialPresence.has(myCode)) {
        const cur = socialPresence.get(myCode)
        socialPresence.set(myCode, { ...cur, lastSeen: nowMs })
      }
      const box = socialMailbox.get(myCode) || []
      const cutoff = nowMs - 15 * 60 * 1000
      const validBox = box.filter((m) => (m._serverTs || 0) > cutoff)
      if (myCode) {
        socialMailbox.set(myCode, validBox)
        boundMapSize(socialMailbox)
      }
      const packets = validBox.filter((m) => (m._serverTs || 0) > sinceTs)

      const friendsParam = String(parsedUrl.searchParams.get('friends') || '')
      const friendCodes = friendsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      const presenceList = []
      for (const fc of friendCodes) {
        const pres = socialPresence.get(fc)
        if (pres && nowMs - (pres.lastSeen || 0) < 45000) {
          presenceList.push({ ...pres, friendCode: fc, online: true })
        }
      }
      sendJson(res, 200, {
        ok: true,
        serverTs: nowMs,
        inbox: packets,
        packets,
        friends: presenceList,
        presence: presenceList
      })
      return
    }

    if (pathname === '/api/social' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES)
        const nowMs = Date.now()
        const action = payload.action || (payload.toId || payload.targetFriendCode ? 'push' : 'poll')
        if (action === 'push') {
          const target = String(payload.toId || payload.targetFriendCode || '').trim().toUpperCase()
          const pkt = { ...(payload.packet || {}), _serverTs: nowMs }
          if (pkt.from && pkt.from.friendCode) {
            const sCode = String(pkt.from.friendCode).trim().toUpperCase()
            socialPresence.set(sCode, { ...pkt.from, friendCode: sCode, lastSeen: nowMs })
            boundMapSize(socialPresence)
          }
          if (target) {
            const box = socialMailbox.get(target) || []
            const cutoff = nowMs - 15 * 60 * 1000
            const filtered = box.filter((m) => (m._serverTs || 0) > cutoff)
            const dedupId = pkt.msgId || pkt._packetId
            if (!dedupId || !filtered.some((m) => (m.msgId || m._packetId) === dedupId)) {
              filtered.push(pkt)
              if (filtered.length > 150) filtered.splice(0, filtered.length - 150)
            }
            socialMailbox.set(target, filtered)
            boundMapSize(socialMailbox)
          }
          sendJson(res, 200, { ok: true, serverTs: nowMs })
          return
        }
        const myCode = String(payload.id || payload.friendCode || '').trim().toUpperCase()
        const summary = payload.summary || payload.profile
        if (myCode && summary && typeof summary === 'object') {
          socialPresence.set(myCode, { ...summary, friendCode: myCode, lastSeen: nowMs })
          boundMapSize(socialPresence)
        }
        const sinceTs = Number(payload.since || 0)
        const box = socialMailbox.get(myCode) || []
        const packets = box.filter((m) => (m._serverTs || 0) > sinceTs)
        const presenceList = []
        for (const fc of payload.friends || payload.friendCodes || []) {
          const cleanFc = String(fc || '').trim().toUpperCase()
          const pres = socialPresence.get(cleanFc)
          if (pres && nowMs - (pres.lastSeen || 0) < 45000) {
            presenceList.push({ ...pres, friendCode: cleanFc, online: true })
          }
        }
        sendJson(res, 200, {
          ok: true,
          serverTs: nowMs,
          inbox: packets,
          packets,
          friends: presenceList,
          presence: presenceList
        })
      } catch (err) {
        sendJson(res, err?.statusCode === 413 ? 413 : 200, { ok: false, error: err?.message })
      }
      return
    }

    if (pathname === '/api/jam/room/send' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES)
        const nowMs = Date.now()
        const room = String(payload.roomCode || '').trim().toUpperCase()
        if (room) {
          const pkt = { ...(payload.packet || {}), _serverTs: nowMs }
          const events = jamRooms.get(room) || []
          const cutoff = nowMs - 2 * 3600 * 1000
          const filtered = events.filter((e) => (e._serverTs || 0) > cutoff)
          if (!pkt._packetId || !filtered.some((e) => e._packetId === pkt._packetId)) {
            filtered.push(pkt)
            if (filtered.length > 200) filtered.splice(0, filtered.length - 200)
          }
          jamRooms.set(room, filtered)
          boundMapSize(jamRooms)
        }
        sendJson(res, 200, { ok: true, serverTs: nowMs })
      } catch (err) {
        sendJson(res, err?.statusCode === 413 ? 413 : 200, { ok: false, error: err?.message })
      }
      return
    }

    if (pathname === '/api/jam/room/poll' && req.method === 'GET') {
      const nowMs = Date.now()
      const room = String(parsedUrl.searchParams.get('roomCode') || '').trim().toUpperCase()
      const sinceTs = Number(parsedUrl.searchParams.get('since') || 0)
      const events = (jamRooms.get(room) || []).filter((e) => (e._serverTs || 0) > sinceTs)
      sendJson(res, 200, { ok: true, serverTs: nowMs, events, packets: events })
      return
    }

    // 7. Unknown /api/* routes MUST return 404 JSON rather than SPA index.html
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'API route not found', path: pathname })
      return
    }

    // 8. Static File Serving from staticDir (frontend/dist)
    if (req.method === 'GET' || req.method === 'HEAD') {
      let relativePath
      try {
        relativePath = decodeURIComponent(pathname).replace(/^\/+/, '')
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Bad Request')
        return
      }
      if (!relativePath) relativePath = 'index.html'

      let filePath = path.resolve(staticDir, relativePath)

      // Strictly enforce staticDir boundary (prevent prefix & directory traversal)
      if (filePath !== staticDir && !filePath.startsWith(staticPrefix)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          // SPA fallback: serve index.html for non-API navigation routes
          filePath = path.join(staticDir, 'index.html')
        }

        const ext = path.extname(filePath).toLowerCase()
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

        res.writeHead(200, {
          'Content-Type': mimeType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
        })

        if (req.method === 'HEAD') {
          res.end()
          return
        }

        const readStream = fs.createReadStream(filePath)
        readStream.on('error', () => {
          if (!res.writableEnded) res.end()
        })
        readStream.pipe(res)
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  return new Promise((resolve, reject) => {
    const basePort = Number(options.preferredPort) || DEFAULT_PORT
    const portCandidates =
      Array.isArray(options.portCandidates) && options.portCandidates.length > 0
        ? options.portCandidates
        : Array.from({ length: PORT_FALLBACK_COUNT }, (_, idx) => basePort + idx)

    let attemptIdx = 0

    const tryNextPort = () => {
      if (attemptIdx >= portCandidates.length) {
        reject(
          new Error(
            `Unable to bind UpBeat desktop microserver on deterministic ports: ${portCandidates.join(', ')}`
          )
        )
        return
      }

      const port = portCandidates[attemptIdx++]
      const onError = (err) => {
        server.removeListener('listening', onListening)
        if (err?.code === 'EADDRINUSE') {
          if (attemptIdx < portCandidates.length) {
            console.warn(
              `[UpBeat Desktop Server] Port ${port} in use, trying next deterministic port ${portCandidates[attemptIdx]}...`
            )
          }
          tryNextPort()
        } else {
          reject(err)
        }
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const actualPort = server.address().port
        console.log(`[UpBeat Desktop Server] Running on http://127.0.0.1:${actualPort}`)
        resolve({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}` })
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    }

    tryNextPort()
  })
}

module.exports = {
  startServer,
  resolveStreamUrl,
  DEFAULT_PORT,
  ALLOWED_INNERTUBE_ENDPOINTS,
  isAllowedCorsOrigin,
  MAX_LYRICS_CACHE_SIZE,
  LYRICS_CACHE_HIT_TTL_MS,
  LYRICS_CACHE_MISS_TTL_MS
}
