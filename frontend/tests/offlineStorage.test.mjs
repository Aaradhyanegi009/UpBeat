import './helpers/test-env.mjs'
import { resetStorage } from './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createOfflineAudioUrl,
  revokeCachedAudioUrl,
  pruneIdleAudioUrls,
  saveTrackOffline,
  clearAllOfflineTracks
} from '../src/offlineStorage.js'

const sharedStoreMap = new Map()

function getFakeIndexedDb() {
  const makeReq = (fn) => {
    const req = { result: null, error: null, onsuccess: null, onerror: null }
    queueMicrotask(() => {
      try {
        req.result = fn()
        req.onsuccess?.({ target: req })
      } catch (e) {
        req.error = e
        req.onerror?.({ target: req })
      }
    })
    return req
  }
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        get: (k) => makeReq(() => sharedStoreMap.get(k)),
        put: (val) => makeReq(() => { sharedStoreMap.set(val.video_id, val); return val.video_id }),
        delete: (k) => makeReq(() => sharedStoreMap.delete(k)),
        clear: () => makeReq(() => sharedStoreMap.clear()),
        getAll: () => makeReq(() => Array.from(sharedStoreMap.values())),
        getAllKeys: () => makeReq(() => Array.from(sharedStoreMap.keys()))
      })
    })
  }
  return {
    open: () => {
      const req = { result: fakeDb, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      queueMicrotask(() => req.onsuccess?.({ target: req }))
      return req
    }
  }
}

test('createOfflineAudioUrl enforces bounded LRU cache and revokes evicted blob URLs', async () => {
  resetStorage()
  sharedStoreMap.clear()
  const records = Array.from({ length: 10 }, (_, i) => ({
    video_id: `vid_lru_${String(i).padStart(2, '0')}`,
    title: `Song ${i}`,
    artist: 'Artist',
    mimeType: 'audio/mp4',
    blob: new Blob([new Uint8Array(1024)], { type: 'audio/mp4' })
  }))
  const prevWin = globalThis.window
  const prevCreate = URL.createObjectURL
  const prevRevoke = URL.revokeObjectURL
  const revoked = []
  let seq = 0

  globalThis.window = {
    indexedDB: getFakeIndexedDb(),
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {}
  }
  URL.createObjectURL = () => `blob:test/${++seq}`
  URL.revokeObjectURL = (u) => revoked.push(u)

  try {
    await clearAllOfflineTracks()
    for (const r of records) sharedStoreMap.set(r.video_id, r)

    // Populate 8 entries -> none evicted yet
    const urls = []
    for (let i = 0; i < 8; i++) {
      urls.push(await createOfflineAudioUrl(records[i].video_id))
    }
    assert.equal(revoked.length, 0)

    // Touch track 0 to mark it MRU; next insertion should evict track 1 instead of track 0
    await createOfflineAudioUrl(records[0].video_id)
    await createOfflineAudioUrl(records[8].video_id)
    assert.deepEqual(revoked, [urls[1]])

    // Explicit revoke works cleanly
    revokeCachedAudioUrl(records[0].video_id)
    assert.equal(revoked.includes(urls[0]), true)
  } finally {
    await clearAllOfflineTracks()
    URL.createObjectURL = prevCreate
    URL.revokeObjectURL = prevRevoke
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    resetStorage()
  }
})

test('saveTrackOffline forwards track metadata to getAudioSource(vid, track) and passes AbortSignal', async () => {
  resetStorage()
  sharedStoreMap.clear()
  localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
  const prevWin = globalThis.window
  const prevFetch = globalThis.fetch
  const seenCalls = []

  globalThis.window = {
    indexedDB: getFakeIndexedDb(),
    location: { origin: 'https://upbeat.example.com', port: '' },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {}
  }

  globalThis.fetch = async (url, opts = {}) => {
    seenCalls.push({ url: String(url), hasSignal: Boolean(opts?.signal) })
    if (String(url).includes('/api/audio-info/')) {
      return new Response(JSON.stringify({ duration: 215, video_id: 'dQw4w9WgXcQ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    return new Response(new Uint8Array(25000), {
      status: 200,
      headers: { 'content-type': 'audio/mp4' }
    })
  }

  try {
    await saveTrackOffline({
      video_id: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration_text: '3:35'
    })
    assert.equal(sharedStoreMap.has('dQw4w9WgXcQ'), true)
    const infoCall = seenCalls.find((c) => c.url.includes('/api/audio-info/'))
    assert.ok(infoCall, 'audio-info called with track metadata')
    assert.match(infoCall.url, /expected_duration=215/)
    assert.match(infoCall.url, /title=Never\+Gonna\+Give\+You\+Up/)
    const dlCall = seenCalls.find((c) => c.url.includes('/api/download/') || c.url.includes('/api/audio/'))
    assert.ok(dlCall?.hasSignal, 'fetch passes AbortSignal for timeout protection')
  } finally {
    await clearAllOfflineTracks()
    globalThis.fetch = prevFetch
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    resetStorage()
  }
})

test('saveTrackOffline reports streaming onProgress({ loaded, total, pct }) and re-throws AbortError cleanly', async () => {
  resetStorage()
  sharedStoreMap.clear()
  localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
  const prevWin = globalThis.window
  const prevFetch = globalThis.fetch

  globalThis.window = {
    indexedDB: getFakeIndexedDb(),
    location: { origin: 'https://upbeat.example.com', port: '' },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {}
  }

  const chunk1 = new Uint8Array(15000).fill(1)
  const chunk2 = new Uint8Array(15000).fill(2)
  const totalBytes = chunk1.byteLength + chunk2.byteLength

  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/audio-info/')) {
      return new Response(JSON.stringify({ duration: 180, video_id: 'strmProg001' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1)
        controller.enqueue(chunk2)
        controller.close()
      }
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'audio/mp4',
        'content-length': String(totalBytes)
      }
    })
  }

  const progressEvents = []
  try {
    const rec = await saveTrackOffline(
      { video_id: 'strmProg001', title: 'Streaming Song', artist: 'Artist' },
      { onProgress: (evt) => progressEvents.push(evt) }
    )
    assert.equal(rec.size, totalBytes)
    assert.ok(progressEvents.length >= 3)
    assert.deepEqual(progressEvents[0], { loaded: 0, total: 0, pct: 0 })
    assert.ok(progressEvents.some((e) => e.loaded === 15000 && e.total === totalBytes && e.pct > 0 && e.pct < 100))
    assert.deepEqual(progressEvents[progressEvents.length - 1], { loaded: totalBytes, total: totalBytes, pct: 100 })

    // Mid-stream cancellation via AbortSignal throws AbortError and leaves DB untouched
    const ac = new AbortController()
    let chunkReadCount = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/audio-info/')) {
        return new Response(JSON.stringify({ duration: 180, video_id: 'abortTrack1' }), { status: 200 })
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mp4', 'content-length': '60000' }),
        body: {
          getReader() {
            return {
              async read() {
                chunkReadCount++
                if (chunkReadCount === 1) return { done: false, value: new Uint8Array(12000) }
                ac.abort()
                return { done: false, value: new Uint8Array(12000) }
              },
              async cancel() {}
            }
          }
        }
      }
    }

    await assert.rejects(
      () => saveTrackOffline({ video_id: 'abortTrack1', title: 'Abort Song', artist: 'Artist' }, { signal: ac.signal }),
      (err) => err?.name === 'AbortError'
    )
    assert.equal(sharedStoreMap.has('abortTrack1'), false)
  } finally {
    await clearAllOfflineTracks()
    globalThis.fetch = prevFetch
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    resetStorage()
  }
})

test('pruneIdleAudioUrls revokes idle cached blob URLs while retaining active keepVideoIds', async () => {
  resetStorage()
  sharedStoreMap.clear()
  const prevWin = globalThis.window
  const prevCreate = URL.createObjectURL
  const prevRevoke = URL.revokeObjectURL
  const revoked = []
  let seq = 0

  globalThis.window = {
    indexedDB: getFakeIndexedDb(),
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {}
  }
  URL.createObjectURL = () => `blob:prune/${++seq}`
  URL.revokeObjectURL = (u) => revoked.push(u)

  try {
    for (const id of ['keepVid0001', 'idleVid0002', 'idleVid0003']) {
      sharedStoreMap.set(id, {
        video_id: id,
        title: id,
        artist: 'Artist',
        mimeType: 'audio/mp4',
        blob: new Blob([new Uint8Array(512)], { type: 'audio/mp4' })
      })
    }
    const uKeep = await createOfflineAudioUrl('keepVid0001')
    const uIdle1 = await createOfflineAudioUrl('idleVid0002')
    const uIdle2 = await createOfflineAudioUrl('idleVid0003')

    const pruned = pruneIdleAudioUrls(['keepVid0001'])
    assert.deepEqual(pruned.sort(), ['idleVid0002', 'idleVid0003'])
    assert.equal(revoked.includes(uIdle1), true)
    assert.equal(revoked.includes(uIdle2), true)
    assert.equal(revoked.includes(uKeep), false)
  } finally {
    await clearAllOfflineTracks()
    URL.createObjectURL = prevCreate
    URL.revokeObjectURL = prevRevoke
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    resetStorage()
  }
})
