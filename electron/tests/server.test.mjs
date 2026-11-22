import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { startServer, DEFAULT_PORT } = require('../server.cjs')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upbeat-electron-test-'))
  const staticDir = path.join(root, 'dist')
  const siblingSecretDir = path.join(root, 'dist-secret')
  const userDataDir = path.join(root, 'userData')
  fs.mkdirSync(staticDir, { recursive: true })
  fs.mkdirSync(siblingSecretDir, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><body>UpBeat</body></html>')
  fs.writeFileSync(path.join(siblingSecretDir, 'secret.txt'), 'TOP_SECRET')
  return { root, staticDir, siblingSecretDir, userDataDir }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

test('DEFAULT_PORT is deterministic 48173 (not Python 8000 or ephemeral 0)', () => {
  assert.equal(DEFAULT_PORT, 48173)
})

test('startServer uses deterministic portCandidates and rejects instead of falling back to port 0', async () => {
  const ws = createTempWorkspace()
  const blockerA = net.createServer().listen(0, '127.0.0.1')
  const blockerB = net.createServer().listen(0, '127.0.0.1')
  await Promise.all([
    new Promise((r) => blockerA.once('listening', r)),
    new Promise((r) => blockerB.once('listening', r))
  ])
  const portA = blockerA.address().port
  const portB = blockerB.address().port
  const portC = await getFreePort()

  try {
    // Rejects when all deterministic candidates are occupied
    await assert.rejects(
      () =>
        startServer({
          portCandidates: [portA, portB],
          staticDir: ws.staticDir,
          userDataDir: ws.userDataDir
        }),
      /Unable to bind/
    )

    // Falls through deterministically to next candidate (portC) when portA is busy
    const srv = await startServer({
      portCandidates: [portA, portC],
      staticDir: ws.staticDir,
      userDataDir: ws.userDataDir
    })
    assert.equal(srv.port, portC)
    await new Promise((r) => srv.server.close(r))
  } finally {
    await new Promise((r) => blockerA.close(r))
    await new Promise((r) => blockerB.close(r))
    fs.rmSync(ws.root, { recursive: true, force: true })
  }
})

test('microserver enforces CORS, 404 JSON on unknown /api/*, and path traversal protection', async () => {
  const ws = createTempWorkspace()
  const port = await getFreePort()
  const { server, url } = await startServer({
    portCandidates: [port],
    staticDir: ws.staticDir,
    userDataDir: ws.userDataDir,
    version: '7.7.0'
  })

  try {
    // Status & capabilities
    const statusRes = await fetch(`${url}/api/status`)
    assert.equal(statusRes.status, 200)
    const statusJson = await statusRes.json()
    assert.equal(statusJson.version, '7.7.0')
    assert.equal(statusJson.capabilities.download, true)
    assert.equal(statusJson.capabilities.lyrics, true)
    assert.equal(statusJson.capabilities.curate, false)

    // Unknown /api/* must return 404 JSON, never HTML index.html
    const unknownApi = await fetch(`${url}/api/curate`)
    assert.equal(unknownApi.status, 404)
    assert.match(unknownApi.headers.get('content-type') || '', /application\/json/)
    const unknownBody = await unknownApi.json()
    assert.equal(unknownBody.error, 'API route not found')

    // CORS allows localhost/127.0.0.1 and rejects evil external origin
    const allowedCors = await fetch(`${url}/api/status`, {
      headers: { Origin: 'http://127.0.0.1:5173' }
    })
    assert.equal(allowedCors.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')

    const blockedCors = await fetch(`${url}/api/status`, {
      headers: { Origin: 'https://evil.example' }
    })
    assert.equal(blockedCors.headers.get('access-control-allow-origin'), null)

    const blockedPreflight = await fetch(`${url}/api/favorites`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' }
    })
    assert.equal(blockedPreflight.status, 403)

    // Path traversal to sibling prefix directory (../dist-secret/secret.txt) must return 403
    const traversalRes = await fetch(`${url}/..%2fdist-secret/secret.txt`)
    assert.equal(traversalRes.status, 403)

    // Non-API navigation route serves SPA index.html
    const spaRes = await fetch(`${url}/library`)
    assert.equal(spaRes.status, 200)
    assert.match(spaRes.headers.get('content-type') || '', /text\/html/)
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    fs.rmSync(ws.root, { recursive: true, force: true })
  }
})

test('favorites & profile enforce JSON validation and 1MB max body size', async () => {
  const ws = createTempWorkspace()
  const port = await getFreePort()
  const { server, url } = await startServer({
    portCandidates: [port],
    staticDir: ws.staticDir,
    userDataDir: ws.userDataDir
  })

  try {
    // Reject invalid JSON
    const badJson = await fetch(`${url}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json'
    })
    assert.equal(badJson.status, 400)

    // Reject wrong JSON shape on /api/favorites
    const badFavShape = await fetch(`${url}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true })
    })
    assert.equal(badFavShape.status, 400)

    // Reject wrong JSON shape on /api/profile (array instead of object)
    const badProfShape = await fetch(`${url}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3])
    })
    assert.equal(badProfShape.status, 400)

    // Reject > 1MB payload with 413
    const huge = JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 256) })
    const oversizeRes = await fetch(`${url}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge
    })
    assert.equal(oversizeRes.status, 413)

    // Valid roundtrip
    const saveFav = await fetch(`${url}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ title: 'Starboy', video_id: '34Na4j8AVgA' }])
    })
    assert.equal(saveFav.status, 200)
    const readFav = await (await fetch(`${url}/api/favorites`)).json()
    assert.equal(readFav.length, 1)
    assert.equal(readFav[0].video_id, '34Na4j8AVgA')
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    fs.rmSync(ws.root, { recursive: true, force: true })
  }
})

test('innertube endpoint allowlist, lyrics proxy, download attachment, and 403 cache invalidation', async () => {
  const ws = createTempWorkspace()
  const port = await getFreePort()
  const { server, url } = await startServer({
    portCandidates: [port],
    staticDir: ws.staticDir,
    userDataDir: ws.userDataDir
  })

  const origFetch = globalThis.fetch
  let playerCallCount = 0
  let audioFetchCalls = 0

  try {
    // Disallowed innertube endpoint must fail with 400 without upstream fetch
    const badEndpoint = await origFetch(`${url}/api/innertube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: '../admin', body: {} })
    })
    assert.equal(badEndpoint.status, 400)

    // Mock global.fetch inside server process (intercepting upstream calls while calling origFetch for localhost)
    globalThis.fetch = async (target, opts) => {
      const targetStr = String(target)
      if (targetStr.startsWith(url)) {
        return origFetch(target, opts)
      }
      assert.ok(opts?.signal, 'upstream fetch must pass an AbortSignal timeout')

      if (targetStr.startsWith('https://music.youtube.com/youtubei/v1/search')) {
        return new Response(JSON.stringify({ mocked: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (targetStr.startsWith('https://lrclib.net/api/search')) {
        return new Response(JSON.stringify([{ id: 1, trackName: 'Starboy', syncedLyrics: '[00:01.00] Test' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (targetStr.startsWith('https://www.youtube.com/youtubei/v1/player')) {
        playerCallCount += 1
        const streamUrl = `https://cdn.example.test/audio_${playerCallCount}.m4a`
        return new Response(
          JSON.stringify({
            playabilityStatus: { status: 'OK' },
            videoDetails: { lengthSeconds: '210' },
            streamingData: {
              adaptiveFormats: [{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: streamUrl, contentLength: '11' }]
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (targetStr === 'https://cdn.example.test/audio_1.m4a') {
        audioFetchCalls += 1
        // Simulate expired/forbidden cached stream URL
        return new Response('Forbidden', { status: 403 })
      }

      if (targetStr === 'https://cdn.example.test/audio_2.m4a') {
        audioFetchCalls += 1
        return new Response(Buffer.from('AUDIO_BYTES'), {
          status: 200,
          headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '11' }
        })
      }

      throw new Error(`Unexpected upstream URL in test: ${targetStr}`)
    }

    // Valid innertube search
    const itRes = await origFetch(`${url}/api/innertube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'search', service: 'music', body: { query: 'test' } })
    })
    assert.equal(itRes.status, 200)
    assert.deepEqual(await itRes.json(), { mocked: true })

    // Lyrics proxy
    const lyrRes = await origFetch(`${url}/api/lyrics?q=Starboy`)
    assert.equal(lyrRes.status, 200)
    const lyrJson = await lyrRes.json()
    assert.equal(lyrJson[0].trackName, 'Starboy')

    // Invalid video ID on /api/download/
    const badDl = await origFetch(`${url}/api/download/badid`)
    assert.equal(badDl.status, 400)

    // /api/download/:id retries on 403 by invalidating cache & re-resolving streamUrl
    const dlRes = await origFetch(`${url}/api/download/dQw4w9WgXcQ?title=Starboy&artist=The%20Weeknd`)
    assert.equal(dlRes.status, 200)
    assert.match(dlRes.headers.get('content-disposition') || '', /attachment; filename="The Weeknd - Starboy\.m4a"/)
    assert.equal(await dlRes.text(), 'AUDIO_BYTES')
    assert.equal(playerCallCount, 2)
    assert.equal(audioFetchCalls, 2)
  } finally {
    globalThis.fetch = origFetch
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    fs.rmSync(ws.root, { recursive: true, force: true })
  }
})

test('lyrics endpoint supports /api/get duration lookup, /api/search fallback, and hit/negative TTL caching', async () => {
  const ws = createTempWorkspace()
  const port = await getFreePort()
  const { server, url } = await startServer({
    portCandidates: [port],
    staticDir: ws.staticDir,
    userDataDir: ws.userDataDir
  })

  const origFetch = globalThis.fetch
  const upstreamCalls = []

  try {
    globalThis.fetch = async (target, opts) => {
      const targetStr = String(target)
      if (targetStr.startsWith(url)) {
        return origFetch(target, opts)
      }
      upstreamCalls.push(targetStr)

      if (targetStr.startsWith('https://lrclib.net/api/get')) {
        const u = new URL(targetStr)
        if (u.searchParams.get('track_name') === 'Starboy') {
          return new Response(
            JSON.stringify({
              id: 101,
              trackName: 'Starboy',
              artistName: 'The Weeknd',
              duration: 230,
              syncedLyrics: '[00:01.00] Look what you done'
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response('Not Found', { status: 404 })
      }

      if (targetStr.startsWith('https://lrclib.net/api/search')) {
        const u = new URL(targetStr)
        if (u.searchParams.get('track_name') === 'Fallback Song') {
          return new Response(
            JSON.stringify([{ id: 202, trackName: 'Fallback Song', plainLyrics: 'Line 1' }]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      throw new Error(`Unexpected upstream URL: ${targetStr}`)
    }

    // 1. /api/get hit wraps JSON object as 1-element array and caches subsequent call
    const r1 = await origFetch(`${url}/api/lyrics?track_name=Starboy&artist_name=The%20Weeknd&duration=230`)
    assert.equal(r1.status, 200)
    const j1 = await r1.json()
    assert.equal(Array.isArray(j1), true)
    assert.equal(j1.length, 1)
    assert.equal(j1[0].id, 101)
    assert.equal(upstreamCalls.length, 1)
    assert.match(upstreamCalls[0], /^https:\/\/lrclib\.net\/api\/get\?/)
    assert.match(upstreamCalls[0], /duration=230/)

    const r2 = await origFetch(`${url}/api/lyrics?track_name=starboy&artist_name=the%20weeknd&duration=230`)
    assert.equal(r2.status, 200)
    assert.deepEqual(await r2.json(), j1)
    assert.equal(upstreamCalls.length, 1, 'Repeated lookup should hit lyrics cache')

    // 2. /api/get 404 falls back to /api/search
    const r3 = await origFetch(`${url}/api/lyrics?track_name=Fallback%20Song&artist_name=Someone&duration=180`)
    assert.equal(r3.status, 200)
    const j3 = await r3.json()
    assert.equal(j3.length, 1)
    assert.equal(j3[0].id, 202)
    assert.equal(upstreamCalls.length, 3)
    assert.match(upstreamCalls[1], /^https:\/\/lrclib\.net\/api\/get\?/)
    assert.match(upstreamCalls[2], /^https:\/\/lrclib\.net\/api\/search\?/)

    // 3. Negative empty miss caches for 5m without hammering LRCLIB
    const m1 = await origFetch(`${url}/api/lyrics?q=NoLyricsTrackXYZ`)
    assert.deepEqual(await m1.json(), [])
    const callsAfterMiss = upstreamCalls.length
    const m2 = await origFetch(`${url}/api/lyrics?q=nolyricstrackxyz`)
    assert.deepEqual(await m2.json(), [])
    assert.equal(upstreamCalls.length, callsAfterMiss, 'Repeated empty miss should hit negative cache')
  } finally {
    globalThis.fetch = origFetch
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    fs.rmSync(ws.root, { recursive: true, force: true })
  }
})
