// Tiny hash router. Hash URLs (#/search, #/library…) behave the same in the
// Android WebView, the macOS wrapper and on Vercel, and keep the existing
// ?jam= / #jam= invite links working.
import { useEffect, useState } from 'react'

const ROUTE_EVENT = 'upbeat-route'

function parseLocation() {
  const raw = (window.location.hash || '').replace(/^#/, '')
  if (!raw.startsWith('/')) return { path: '/', params: {} }
  const [path, qs] = raw.split('?')
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(qs || '')) }
}

export function buildPath(path, params) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString() : ''
  return qs ? `${path}?${qs}` : path
}

export function navigate(path, { replace = false, params } = {}) {
  const target = `#${buildPath(path, params)}`
  if (window.location.hash === target) return
  const depth = (window.history.state?.ubDepth || 0) + (replace ? 0 : 1)
  if (replace) {
    window.history.replaceState({ ub: true, ubDepth: depth }, '', target)
  } else {
    window.history.pushState({ ub: true, ubDepth: depth }, '', target)
  }
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/** True when going back stays inside the app. */
export function canGoBack() {
  return (window.history.state?.ubDepth || 0) > 0
}

export function goBack(fallback = '/') {
  if (canGoBack()) window.history.back()
  else navigate(fallback, { replace: true })
}

export function useRoute() {
  const [route, setRoute] = useState(parseLocation)
  useEffect(() => {
    const update = () => setRoute(parseLocation())
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    window.addEventListener(ROUTE_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener(ROUTE_EVENT, update)
    }
  }, [])
  return route
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
