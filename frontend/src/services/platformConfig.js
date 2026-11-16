/**
 * Platform environment detection, persistent settings, API URL builders, and direct Innertube transport.
 */

// ---------------------------------------------------------------------------
// Platform + settings
// ---------------------------------------------------------------------------

export function isNativeApp() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

export function getStoredApiKey() {
  return localStorage.getItem('upbeat_gemini_api_key') || ''
}

export function setStoredApiKey(key) {
  localStorage.setItem('upbeat_gemini_api_key', (key || '').trim())
}

export function getStoredServerUrl() {
  return (localStorage.getItem('upbeat_server_url') || '').trim().replace(/\/+$/, '')
}

export function setStoredServerUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`
  localStorage.setItem('upbeat_server_url', u)
}

/** True when a Mac backend is reachable in principle (same-origin web, or configured URL in the APK). */
export function hasBackend() {
  if (!isNativeApp()) return true
  return Boolean(getStoredServerUrl())
}

/** Open URL in Android native external browser/app or web new tab */
export function openExternalUrl(url) {
  if (!url) return
  const safeUrl = String(url).trim()
  if (!safeUrl) return

  // 1. Android Native Capacitor Bridge
  if (typeof window !== 'undefined' && window.UpBeatNative && typeof window.UpBeatNative.openExternalUrl === 'function') {
    try {
      window.UpBeatNative.openExternalUrl(safeUrl)
      return
    } catch {}
  }

  // 2. Web browser fallback: open in new tab
  try {
    const win = window.open(safeUrl, '_blank', 'noopener,noreferrer')
    if (!win) {
      const a = document.createElement('a')
      a.href = safeUrl
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  } catch {
    window.location.href = safeUrl
  }
}

/** Base for backend API calls. */
export function getApiBase() {
  const custom = getStoredServerUrl()
  if (custom) return `${custom}/api`
  return '/api'
}

export function apiUrl(path) {
  return `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Proxy-aware Innertube API request.
 * - In Capacitor native app (Android): direct fetch uses CapacitorHttp to bypass CORS.
 * - In browser / PWA (iPhone, Mac, Windows): routes via `/api/innertube` (Vercel Edge or Mac backend)
 *   to avoid browser CORS blocks.
 */
export async function callInnertube(endpoint, payload, service = 'music') {
  const host = service === 'youtube' ? 'https://www.youtube.com' : 'https://music.youtube.com'

  if (isNativeApp()) {
    return fetch(`${host}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }

  try {
    const proxyRes = await fetch(apiUrl('/innertube'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        body: payload,
        service
      })
    })
    if (proxyRes.ok) return proxyRes
  } catch {}

  // Fallback to direct fetch
  return fetch(`${host}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

/** True if the app can curate right now (backend available or Gemini key saved). */
export function isConfigured() {
  return hasBackend() || Boolean(getStoredApiKey())
}
