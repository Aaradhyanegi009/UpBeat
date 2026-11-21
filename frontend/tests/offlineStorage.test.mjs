import './helpers/test-env.mjs'
import { resetStorage } from './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createOfflineAudioUrl,
  revokeCachedAudioUrl,
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
