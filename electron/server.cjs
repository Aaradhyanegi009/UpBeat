/**
 * UpBeat Windows Desktop Internal Microserver
 * Lightweight, zero-dependency Node.js HTTP server.
 * Serves the UpBeat frontend assets and proxies YouTube Music/Innertube
 * and high-performance audio streams directly on Windows.
 */

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

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

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.60.19',
  osName: 'Android',
  osVersion: '14',
  androidSdkVersion: 34,
  hl: 'en',
  gl: 'US'
}

const IOS_PLAYER_CLIENT = {
  clientName: 'IOS',
  clientVersion: '19.45.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iPhone',
  osVersion: '18.1.1',
  hl: 'en',
  gl: 'US'
}

const streamCache = new Map()
const CACHE_TTL_MS = 45 * 60 * 1000
const socialMailbox = new Map()
const socialPresence = new Map()
const jamRooms = new Map()

async function resolveStreamUrl(videoId) {
  if (!videoId || videoId.length !== 11) return null

  const cached = streamCache.get(videoId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached
  }

  const clients = [
    {
      client: ANDROID_VR_CLIENT,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Quest 3 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.35.48.568434778 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36'
    },
    {
      client: IOS_PLAYER_CLIENT,
      userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_1 like Mac OS X; US)'
    }
  ]

  for (const { client, userAgent } of clients) {
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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
        const entry = {
          streamUrl: chosen.url,
          mimeType: chosen.mimeType ? chosen.mimeType.split(';')[0] : 'audio/mp4',
          contentLength: chosen.contentLength ? Number(chosen.contentLength) : null,
          duration: Number(data?.videoDetails?.lengthSeconds || 0) || Math.round((chosen.approxDurationMs || 0) / 1000),
          video_id: videoId,
          ts: Date.now()
        }
        streamCache.set(videoId, entry)
        return entry
      }
    } catch {}
  }
  return null
}

function startServer(options = {}) {
  const staticDir = options.staticDir || path.join(__dirname, '../frontend/dist')
  const userDataDir = options.userDataDir || path.join(__dirname, 'userData')
  const version = options.version || '7.3.1'

  if (!fs.existsSync(userDataDir)) {
    try { fs.mkdirSync(userDataDir, { recursive: true }) } catch {}
  }

  const favoritesFile = path.join(userDataDir, 'favorites.json')
  const profileFile = path.join(userDataDir, 'profile.json')

  const server = http.createServer(async (req, res) => {
    // Enable CORS for all local requests
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Accept')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
    const pathname = parsedUrl.pathname

    // 1. /api/status
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        version,
        platform: process.platform,
        arch: process.arch,
        engine: 'upbeat-electron-microserver'
      }))
      return
    }

    // 2. /api/innertube (Proxy to music.youtube.com / youtube.com)
    if (pathname === '/api/innertube' && req.method === 'POST') {
      let bodyData = ''
      req.on('data', (chunk) => { bodyData += chunk })
      req.on('end', async () => {
        try {
          const payload = JSON.parse(bodyData || '{}')
          const endpoint = payload.endpoint || ''
          const postBody = payload.body || {}
          const service = payload.service || 'music'

          const host = service === 'youtube' ? 'https://www.youtube.com' : 'https://music.youtube.com'
          const targetUrl = `${host}/youtubei/v1/${endpoint}?prettyPrint=false`

          const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
              Referer: host
            },
            body: JSON.stringify(postBody)
          })

          const data = await upstream.text()
          res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
          res.end(data)
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || 'Innertube proxy error' }))
        }
      })
      return
    }

    // 3. /api/audio-info/:id or /api/audio-info?id=...
    if (pathname.startsWith('/api/audio-info')) {
      let videoId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('video_id')
      if (!videoId) {
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length >= 2 && parts[1] !== 'audio-info') videoId = parts[1]
        else if (parts.length >= 3) videoId = parts[2]
      }

      if (!videoId || videoId.length !== 11) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing or invalid video ID' }))
        return
      }

      const stream = await resolveStreamUrl(videoId)
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          video_id: videoId,
          duration: stream.duration,
          mimeType: stream.mimeType,
          contentLength: stream.contentLength,
          url: `/api/audio/${videoId}`
        }))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Audio stream unavailable' }))
      }
      return
    }

    // 4. /api/audio/:id
    if (pathname.startsWith('/api/audio/')) {
      const videoId = pathname.replace('/api/audio/', '').split('?')[0].trim()
      if (!videoId || videoId.length !== 11) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid video ID')
        return
      }

      const stream = await resolveStreamUrl(videoId)
      if (!stream?.streamUrl) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Stream not found')
        return
      }

      const rangeHeader = req.headers.range
      const upstreamHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
      if (rangeHeader) {
        upstreamHeaders['Range'] = rangeHeader
      }

      try {
        const upstreamResp = await fetch(stream.streamUrl, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: upstreamHeaders
        })

        const resHeaders = {
          'Content-Type': upstreamResp.headers.get('content-type') || stream.mimeType || 'audio/mp4',
          'Accept-Ranges': 'bytes'
        }

        const cr = upstreamResp.headers.get('content-range')
        if (cr) resHeaders['Content-Range'] = cr
        const cl = upstreamResp.headers.get('content-length')
        if (cl) resHeaders['Content-Length'] = cl

        res.writeHead(upstreamResp.status, resHeaders)

        if (req.method === 'HEAD') {
          res.end()
          return
        }

        if (upstreamResp.body) {
          const { Readable } = require('stream')
          Readable.fromWeb(upstreamResp.body).pipe(res)
        } else {
          res.end()
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('Upstream audio error')
        }
      }
      return
    }

    // 5. /api/favorites
    if (pathname === '/api/favorites') {
      if (req.method === 'GET') {
        let data = '[]'
        try {
          if (fs.existsSync(favoritesFile)) data = fs.readFileSync(favoritesFile, 'utf8')
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(data || '[]')
        return
      }
      if (req.method === 'POST') {
        let b = ''
        req.on('data', (c) => { b += c })
        req.on('end', () => {
          try {
            fs.writeFileSync(favoritesFile, b, 'utf8')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: e.message }))
          }
        })
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
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(data || '{}')
        return
      }
      if (req.method === 'POST') {
        let b = ''
        req.on('data', (c) => { b += c })
        req.on('end', () => {
          try {
            fs.writeFileSync(profileFile, b, 'utf8')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        return
      }
    }

    // 6b. /api/jam/social/send & /api/jam/social/poll & /api/jam/room/send & /api/jam/room/poll
    if (pathname === '/api/jam/social/send' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        try {
          const payload = JSON.parse(b || '{}')
          const nowMs = Date.now()
          const target = String(payload.targetFriendCode || '').trim().toUpperCase()
          if (target) {
            const pkt = { ...(payload.packet || {}), _serverTs: nowMs }
            if (pkt.from && pkt.from.friendCode) {
              const sCode = String(pkt.from.friendCode).trim().toUpperCase()
              socialPresence.set(sCode, { ...pkt.from, lastSeen: nowMs })
            }
            const box = socialMailbox.get(target) || []
            const cutoff = nowMs - 12 * 3600 * 1000
            const filtered = box.filter((m) => (m._serverTs || 0) > cutoff)
            if (!pkt._packetId || !filtered.some((m) => m._packetId === pkt._packetId)) {
              filtered.push(pkt)
              if (filtered.length > 150) filtered.splice(0, filtered.length - 150)
            }
            socialMailbox.set(target, filtered)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, serverTs: nowMs }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false }))
        }
      })
      return
    }

    if (pathname === '/api/jam/social/poll' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        try {
          const payload = JSON.parse(b || '{}')
          const nowMs = Date.now()
          const myCode = String(payload.friendCode || '').trim().toUpperCase()
          if (myCode && payload.summary && typeof payload.summary === 'object') {
            socialPresence.set(myCode, { ...payload.summary, friendCode: myCode, lastSeen: nowMs })
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
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, serverTs: nowMs, packets, presence: presenceList }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, packets: [], presence: [] }))
        }
      })
      return
    }

    if (pathname === '/api/jam/room/send' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        try {
          const payload = JSON.parse(b || '{}')
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
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, serverTs: nowMs }))
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false }))
        }
      })
      return
    }

    if (pathname === '/api/jam/room/poll' && req.method === 'GET') {
      const nowMs = Date.now()
      const room = String(parsedUrl.searchParams.get('roomCode') || '').trim().toUpperCase()
      const sinceTs = Number(parsedUrl.searchParams.get('since') || 0)
      const events = (jamRooms.get(room) || []).filter((e) => (e._serverTs || 0) > sinceTs)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, serverTs: nowMs, events }))
      return
    }

    // 7. Static File Serving from staticDir (frontend/dist)
    if (req.method === 'GET' || req.method === 'HEAD') {
      let relativePath = decodeURIComponent(pathname.replace(/^\/+/, ''))
      if (!relativePath) relativePath = 'index.html'

      let filePath = path.join(staticDir, relativePath)

      // Prevent directory traversal
      if (!filePath.startsWith(staticDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          // SPA fallback: serve index.html for navigation routes
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
        readStream.pipe(res)
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  return new Promise((resolve, reject) => {
    // Try preferred port 8000 (matching Mac dev/native), fallback to dynamic port
    const tryPort = (port) => {
      server.listen(port, '127.0.0.1', () => {
        const actualPort = server.address().port
        console.log(`[UpBeat Desktop Server] Running on http://127.0.0.1:${actualPort}`)
        resolve({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}` })
      })
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port !== 0) {
          console.warn(`[UpBeat Desktop Server] Port ${port} in use, picking random free port...`)
          tryPort(0)
        } else {
          reject(err)
        }
      })
    }

    tryPort(options.preferredPort || 8000)
  })
}

module.exports = { startServer, resolveStreamUrl }
