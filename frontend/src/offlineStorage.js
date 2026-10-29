/**
 * UpBeat Universal Offline Storage Manager
 * Uses browser IndexedDB to store audio Blobs and metadata persistently
 * on Mac (Safari, Chrome, WKWebView Native App) and Android (Chrome, Capacitor WebView).
 * Works 100% offline with zero network connection.
 */

import { getTrackDownloadUrl, getAudioSource, hasBackend, getApiBase } from './standaloneApi'

const DB_NAME = 'upbeat_offline_db'
const DB_VERSION = 1
const STORE_NAME = 'offline_tracks'
const EVENT_NAME = 'upbeat_offline_change'

let _dbPromise = null
const _blobUrlCache = new Map()

/**
 * Opens and initializes the IndexedDB database
 */
export function openOfflineDb() {
  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported on this platform'))
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'video_id' })
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false })
        store.createIndex('title', 'title', { unique: false })
      }
    }

    request.onsuccess = (event) => {
      const db = event.target.result
      resolve(db)
    }

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error)
      _dbPromise = null
      reject(event.target.error)
    }
  })

  return _dbPromise
}

/**
 * Dispatch custom event when offline library changes
 */
export function notifyOfflineChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
  }
}

/**
 * Subscribe to offline storage changes
 */
export function subscribeOfflineChanges(callback) {
  if (typeof window === 'undefined') return () => {}
  const handler = () => callback()
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

/**
 * Formats byte size to human readable (KB, MB, GB)
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

/**
 * Retrieves all offline tracks from IndexedDB sorted by download date descending
 */
export async function getOfflineTracks() {
  try {
    const db = await openOfflineDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const tracks = request.result || []
        tracks.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0))
        resolve(tracks)
      }

      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to get offline tracks:', err)
    return []
  }
}

/**
 * Retrieves a single offline track by videoId
 */
export async function getOfflineTrack(videoId) {
  if (!videoId) return null
  try {
    const db = await openOfflineDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(videoId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    return null
  }
}

/**
 * Checks if a track is downloaded (fast boolean lookup)
 */
export async function isTrackDownloaded(videoId) {
  const track = await getOfflineTrack(videoId)
  return Boolean(track && track.blob)
}

/**
 * Returns a Set of all downloaded video_ids
 */
export async function getDownloadedVideoIds() {
  try {
    const db = await openOfflineDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAllKeys()

      request.onsuccess = () => {
        resolve(new Set(request.result || []))
      }
      request.onerror = () => resolve(new Set())
    })
  } catch {
    return new Set()
  }
}

/**
 * Helper to convert an image URL into a base64 Data URL for offline display
 */
async function cacheImageAsDataUrl(imgUrl) {
  if (!imgUrl) return ''
  try {
    const res = await fetch(imgUrl, { mode: 'cors' })
    if (!res.ok) return imgUrl
    const blob = await res.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => resolve(imgUrl)
      reader.readAsDataURL(blob)
    })
  } catch {
    return imgUrl
  }
}

/**
 * Saves a track to IndexedDB offline storage
 * Downloads the audio stream data and stores the Blob locally.
 */
export async function saveTrackOffline(track, onProgress = null) {
  if (!track || (!track.video_id && !track.url)) {
    throw new Error('Invalid track: missing video_id')
  }

  // Extract clean video_id
  let vid = track.video_id
  if (!vid && track.url) {
    if (track.url.includes('v=')) {
      vid = track.url.split('v=')[1].split('&')[0].split('/')[0]
    } else if (track.url.includes('youtu.be/')) {
      vid = track.url.split('youtu.be/')[1].split('?')[0].split('/')[0]
    }
  }

  if (!vid) {
    throw new Error('Invalid track: unable to resolve video_id')
  }

  // 1. Build prioritized candidate download and stream URLs
  const candidateUrls = []
  const primaryDl = getTrackDownloadUrl({ ...track, video_id: vid })
  if (primaryDl) candidateUrls.push(primaryDl)

  // Direct backend audio endpoint
  const streamEndpoint = `${getApiBase()}/audio/${encodeURIComponent(vid)}`
  candidateUrls.push(streamEndpoint)

  // Direct YouTube audio stream resolver
  try {
    const src = await getAudioSource(vid)
    const directUrl = typeof src === 'string' ? src : src?.url
    if (directUrl && !candidateUrls.includes(directUrl)) {
      candidateUrls.push(directUrl)
    }
  } catch {}

  // Fallback video IDs if present on track
  if (Array.isArray(track.fallback_ids)) {
    for (const fvid of track.fallback_ids) {
      if (fvid && fvid !== vid) {
        const fbDl = getTrackDownloadUrl({ ...track, video_id: fvid })
        if (fbDl) candidateUrls.push(fbDl)
        candidateUrls.push(`${getApiBase()}/audio/${encodeURIComponent(fvid)}`)
      }
    }
  }

  // 2. Fetch the audio as Blob with multi-tier fallback
  if (onProgress) onProgress(10)
  let audioBlob = null
  let lastErr = null

  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i]
    if (onProgress) onProgress(10 + Math.round((i / candidateUrls.length) * 35))
    try {
      const res = await fetch(url)
      if (res.ok) {
        const blob = await res.blob()
        if (blob && blob.size > 20000) {
          audioBlob = blob
          break
        }
      } else {
        lastErr = new Error(`Download failed with status ${res.status}`)
      }
    } catch (e) {
      lastErr = e
    }
  }

  if (!audioBlob || audioBlob.size <= 20000) {
    throw lastErr || new Error('Unable to resolve audio stream for offline download')
  }

  if (onProgress) onProgress(65)

  // 3. Cache thumbnail for offline view
  let offlineThumb = track.thumbnail || ''
  if (offlineThumb && offlineThumb.startsWith('http')) {
    try {
      offlineThumb = await cacheImageAsDataUrl(offlineThumb)
    } catch {}
  }

  // 4. Save record into IndexedDB
  const record = {
    video_id: vid,
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    thumbnail: offlineThumb,
    duration_text: track.duration_text || '',
    duration: track.duration || 0,
    vibe: track.vibe || '',
    reason: track.reason || '',
    url: track.url || `https://www.youtube.com/watch?v=${vid}`,
    size: audioBlob.size,
    mimeType: audioBlob.type || 'audio/mp4',
    downloadedAt: Date.now(),
    blob: audioBlob
  }

  const db = await openOfflineDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })

  if (onProgress) onProgress(100)
  notifyOfflineChange()
  return record
}

/**
 * Deletes an offline track from IndexedDB
 */
export async function deleteOfflineTrack(videoId) {
  if (!videoId) return
  try {
    // Revoke cached blob URL if any
    if (_blobUrlCache.has(videoId)) {
      URL.revokeObjectURL(_blobUrlCache.get(videoId))
      _blobUrlCache.delete(videoId)
    }

    const db = await openOfflineDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(videoId)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })

    // Notify backend if available
    if (hasBackend()) {
      try {
        fetch(`${getApiBase()}/offline/tracks/${videoId}`, { method: 'DELETE' }).catch(() => {})
      } catch {}
    }

    notifyOfflineChange()
  } catch (err) {
    console.error('Failed to delete offline track:', err)
  }
}

/**
 * Clears all tracks from offline storage
 */
export async function clearAllOfflineTracks() {
  try {
    _blobUrlCache.forEach((url) => URL.revokeObjectURL(url))
    _blobUrlCache.clear()

    const db = await openOfflineDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })

    notifyOfflineChange()
  } catch (err) {
    console.error('Failed to clear offline tracks:', err)
  }
}

/**
 * Returns an instant Blob URL for offline playback
 */
export async function createOfflineAudioUrl(videoId) {
  if (!videoId) return null
  if (_blobUrlCache.has(videoId)) {
    return _blobUrlCache.get(videoId)
  }

  const track = await getOfflineTrack(videoId)
  if (!track || !track.blob) return null

  // Ensure blob has a valid audio MIME type so browser audio decoders accept it
  const blob = track.blob.type && track.blob.type.startsWith('audio/')
    ? track.blob
    : new Blob([track.blob], { type: track.mimeType || 'audio/mp4' })

  const url = URL.createObjectURL(blob)
  _blobUrlCache.set(videoId, url)
  return url
}

/**
 * Revokes any cached object URLs to free memory
 */
export function revokeCachedAudioUrl(videoId) {
  if (_blobUrlCache.has(videoId)) {
    URL.revokeObjectURL(_blobUrlCache.get(videoId))
    _blobUrlCache.delete(videoId)
  }
}

/**
 * Calculates total count and byte size of offline tracks
 */
export async function getOfflineStorageStats() {
  try {
    const tracks = await getOfflineTracks()
    const totalBytes = tracks.reduce((acc, t) => acc + (t.size || 0), 0)
    return {
      count: tracks.length,
      totalBytes,
      formattedSize: formatBytes(totalBytes)
    }
  } catch {
    return { count: 0, totalBytes: 0, formattedSize: '0 B' }
  }
}

/**
 * Global Offline Mode State (persisted in localStorage)
 */
const OFFLINE_MODE_KEY = 'upbeat_offline_mode_active'

export function isOfflineModeActive() {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(OFFLINE_MODE_KEY) === 'true'
}

export function setOfflineModeActive(active) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(OFFLINE_MODE_KEY, active ? 'true' : 'false')
  notifyOfflineChange()
}
