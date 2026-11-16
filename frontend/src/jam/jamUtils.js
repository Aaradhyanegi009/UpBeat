/**
 * Pure Jam/Social utilities, code normalizers, deep-link parsers, storage helpers, and audio drift math.
 */

export const JAM_USER_STORAGE_KEY = 'upbeat_jam_profile_v1'
export const LEGACY_PROFILE_KEYS = ['upbeat_jam_profile_v1', 'upbeat_jam_profile', 'upbeat_user_profile']
export const FRIENDS_LIST_STORAGE_KEY = 'upbeat_friends_list'
export const FRIEND_REQ_IN_STORAGE_KEY = 'upbeat_friend_requests_in'
export const FRIEND_REQ_OUT_STORAGE_KEY = 'upbeat_friend_requests_out'
export const SEEN_PACKETS_STORAGE_KEY = 'upbeat_seen_social_packets_v1'

const JAM_PEER_PREFIX = 'upbeat-jam-v70-'
const PRESENCE_PEER_PREFIX = 'upbeat-user-'
const CLOUD_RELAY_BASE = 'https://ntfy.tedomum.fr'
const CLOUD_RELAY_FALLBACK = 'https://ntfy.sp-codes.de'
const CLOUD_RELAY_TERTIARY = 'https://ntfy.envs.net'
export const CLOUD_RELAYS = [CLOUD_RELAY_BASE, CLOUD_RELAY_FALLBACK, CLOUD_RELAY_TERTIARY]

export async function fetchWithTimeout(url, options = {}, timeoutMs = 3000, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return null
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const res = await fetchFn(url, {
      ...options,
      signal: controller ? controller.signal : undefined
    })
    return res
  } catch (e) {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function sanitizePayloadForCloud(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (obj.startsWith('data:')) return ''
    return obj.length > 500 ? obj.slice(0, 500) : obj
  }
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.slice(0, 35).map(sanitizePayloadForCloud)
  }
  const clean = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'picture' || key === 'avatar') {
      if (typeof value === 'string' && value.startsWith('http') && value.length < 500) {
        clean[key] = value
      } else {
        clean[key] = ''
      }
    } else {
      clean[key] = sanitizePayloadForCloud(value)
    }
  }
  return clean
}

export const renderEmoji = (val, fallback = '') => {
  if (!val) return fallback
  if (typeof val === 'string') return val
  if (typeof val === 'object' && typeof val.emoji === 'string') return val.emoji
  return fallback
}

// Keep export for backwards compatibility
export const JAM_AVATARS = []
export const JAM_REACTIONS = []
export const JAM_REACTION_PRESETS = []

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' }
]

export const PEER_OPTIONS = {
  config: {
    iceServers: ICE_SERVERS,
    sdpSemantics: 'unified-plan'
  },
  pingInterval: 5000,
  debug: 0
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomChars(len) {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

export function generateShortPin() {
  return `JAM-${randomChars(4)}`
}

export function generateFriendCode() {
  return `UP-${randomChars(6)}`
}

export function makePacketId() {
  return `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeRoomCode(raw) {
  if (!raw) return ''
  const str = String(raw).trim()
  // Extract room code if a full URL or deep link is passed
  const urlMatch =
    str.match(/[?&#/](?:jam|join|room|code)[=:]([A-Za-z0-9-]+)/i) ||
    str.match(/^(?:jam|join|room|code)[=:]([A-Za-z0-9-]+)/i)
  const candidate = (urlMatch ? urlMatch[1] : str).trim().toUpperCase()

  let body = ''
  if (candidate.startsWith('JAM-')) {
    body = candidate.slice(4).replace(/[^A-Z0-9]/g, '')
  } else {
    const alnum = candidate.replace(/[^A-Z0-9]/g, '')
    body = alnum.startsWith('JAM') && alnum.length > 4 ? alnum.slice(3) : alnum
  }
  if (!body) return ''
  return `JAM-${body.slice(0, 6)}`
}

export function normalizeFriendCode(raw) {
  if (!raw) return ''
  const str = String(raw).trim()
  // Extract friend code if a full URL or deep link is passed
  const urlMatch =
    str.match(/[?&#/](?:addFriend|friend|user|code)[=:]([A-Za-z0-9-]+)/i) ||
    str.match(/^(?:addFriend|friend|user|code)[=:]([A-Za-z0-9-]+)/i) ||
    str.match(/\b(UP-[A-Za-z0-9]{4,8})\b/i)
  const candidate = (urlMatch ? urlMatch[1] : str).trim().toUpperCase()

  let body = ''
  if (candidate.startsWith('UP-')) {
    body = candidate.slice(3).replace(/[^A-Z0-9]/g, '')
  } else {
    const alnum = candidate.replace(/[^A-Z0-9]/g, '')
    body = alnum.startsWith('UP') && alnum.length > 6 ? alnum.slice(2) : alnum
  }
  if (!body) return ''
  return `UP-${body.slice(0, 6)}`
}

export const normalizeFriendId = normalizeFriendCode

export function getAppBaseUrl() {
  if (typeof window === 'undefined') return 'upbeat://'
  try {
    const origin = window.location.origin
    // Only use web URL if hosted on a real custom web domain (not localhost, capacitor, file, or dummy vercel)
    if (
      origin &&
      !origin.includes('127.0.0.1') &&
      !origin.includes('localhost') &&
      !origin.startsWith('file:') &&
      !origin.startsWith('capacitor:') &&
      !origin.includes('vercel.app')
    ) {
      return `${origin}${window.location.pathname}`.replace(/\/+$/, '') + '/'
    }
    const savedWeb = localStorage.getItem('upbeat_jam_share_origin')
    if (savedWeb && savedWeb.startsWith('http') && !savedWeb.includes('vercel.app')) {
      return savedWeb.replace(/\/+$/, '') + '/'
    }
    return 'upbeat://'
  } catch {
    return 'upbeat://'
  }
}

export function buildJamInviteUrl(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  if (!norm) return ''
  const base = getAppBaseUrl()
  if (base.startsWith('upbeat://')) {
    return `upbeat://jam?code=${encodeURIComponent(norm)}`
  }
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}jam=${encodeURIComponent(norm)}`
}

export function buildFriendInviteUrl(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  const base = getAppBaseUrl()
  if (base.startsWith('upbeat://')) {
    return `upbeat://addFriend?code=${encodeURIComponent(norm)}`
  }
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}addFriend=${encodeURIComponent(norm)}`
}

export function extractDeepLinkParams(urlStr = '') {
  try {
    const raw = String(urlStr || '').trim()
    if (!raw && typeof window === 'undefined') {
      return { jamCode: null, friendCode: null }
    }

    let search = ''
    let hash = ''
    let pathname = ''

    if (raw) {
      const normalizedUrl = raw.replace(/^upbeat:\/\//i, 'http://upbeat.local/')
      try {
        const u = new URL(normalizedUrl, 'http://upbeat.local')
        search = u.search
        hash = u.hash
        pathname = u.pathname || ''
      } catch {
        search = raw
      }
    } else if (typeof window !== 'undefined') {
      search = window.location.search
      hash = window.location.hash
      pathname = window.location.pathname || ''
    }

    const searchParams = new URLSearchParams(search)
    let hashParams = new URLSearchParams()
    if (hash && hash.includes('=')) {
      const cleanHash = hash.replace(/^[#/?]+/, '')
      hashParams = new URLSearchParams(cleanHash)
    }

    // Direct check for UP- or JAM- anywhere in raw string or parameters
    const codeParam = searchParams.get('code') || hashParams.get('code') || ''
    const isFriendContext =
      pathname.toLowerCase().includes('friend') ||
      raw.toLowerCase().includes('addfriend') ||
      raw.toLowerCase().includes('friend=') ||
      codeParam.toUpperCase().startsWith('UP-')

    const isJamContext =
      pathname.toLowerCase().includes('jam') ||
      raw.toLowerCase().includes('jam=') ||
      codeParam.toUpperCase().startsWith('JAM-')

    const friendRaw =
      searchParams.get('addFriend') ||
      searchParams.get('friend') ||
      searchParams.get('user') ||
      hashParams.get('addFriend') ||
      hashParams.get('friend') ||
      hashParams.get('user') ||
      (isFriendContext && codeParam ? codeParam : null) ||
      (raw.match(/\b(UP-[A-Z0-9]{4,8})\b/i) ? raw.match(/\b(UP-[A-Z0-9]{4,8})\b/i)[1] : null)

    const jamRaw =
      searchParams.get('jam') ||
      searchParams.get('join') ||
      searchParams.get('room') ||
      hashParams.get('jam') ||
      hashParams.get('join') ||
      hashParams.get('room') ||
      (isJamContext && codeParam ? codeParam : null) ||
      (!isFriendContext && codeParam && codeParam.toUpperCase().startsWith('JAM-') ? codeParam : null) ||
      (raw.match(/\b(JAM-[A-Z0-9]{3,6})\b/i) ? raw.match(/\b(JAM-[A-Z0-9]{3,6})\b/i)[1] : null)

    return {
      jamCode: jamRaw ? normalizeRoomCode(jamRaw) : null,
      friendCode: friendRaw ? normalizeFriendCode(friendRaw) : null
    }
  } catch {
    return { jamCode: null, friendCode: null }
  }
}

export function getPeerIdFromCode(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  const suffix = norm.replace('JAM-', '').toLowerCase()
  return `${JAM_PEER_PREFIX}${suffix}`
}

export function getPresencePeerId(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  return `${PRESENCE_PEER_PREFIX}${norm}`
}

export function getSocialCloudTopic(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  return `upbeat_v7_user_${norm.replace(/[^A-Z0-9]/g, '')}`
}

export function getRoomCloudTopic(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  if (!norm) return ''
  return `upbeat_v7_room_${norm.replace(/[^A-Z0-9]/g, '')}`
}

export function sanitizeStoredJamAndSocialData() {
  if (typeof window === 'undefined' || !window.localStorage) return

  for (const key of LEGACY_PROFILE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const cleanFriendCode = normalizeFriendCode(parsed.friendCode) || generateFriendCode()
        const updated = {
          ...parsed,
          avatar: '',
          friendCode: cleanFriendCode
        }
        localStorage.setItem(key, JSON.stringify(updated))
      }
    } catch {}
  }

  for (const listKey of [FRIENDS_LIST_STORAGE_KEY, FRIEND_REQ_IN_STORAGE_KEY, FRIEND_REQ_OUT_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(listKey)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const sanitized = parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            ...item,
            friendCode: normalizeFriendCode(item.friendCode || item.id),
            avatar: '',
            name: String(item.name || 'Friend')
          }))
          .filter((item) => Boolean(item.friendCode) && item.friendCode.length >= 7)
        localStorage.setItem(listKey, JSON.stringify(sanitized))
      }
    } catch {}
  }
}

sanitizeStoredJamAndSocialData()

export function loadJamUserProfile(googleUser = null) {
  try {
    const saved = localStorage.getItem(JAM_USER_STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : {}
    const id = parsed.id || `usr_${Math.random().toString(36).slice(2, 10)}`
    const friendCode =
      normalizeFriendCode(parsed.friendCode) && normalizeFriendCode(parsed.friendCode).length >= 7
        ? normalizeFriendCode(parsed.friendCode)
        : generateFriendCode()
    const name = googleUser?.name || parsed.name || `Listener ${friendCode.slice(-3)}`
    const picture = googleUser?.picture || parsed.picture || ''
    const profile = { id, friendCode, name, avatar: '', picture }
    localStorage.setItem(JAM_USER_STORAGE_KEY, JSON.stringify(profile))
    return profile
  } catch {
    return {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      friendCode: generateFriendCode(),
      name: googleUser?.name || 'Music Lover',
      avatar: '',
      picture: googleUser?.picture || ''
    }
  }
}

export function saveJamUserProfile(updates) {
  const current = loadJamUserProfile()
  const nextCode = normalizeFriendCode(updates?.friendCode || current.friendCode)
  const updated = {
    ...current,
    ...updates,
    avatar: '',
    friendCode: nextCode && nextCode.length >= 7 ? nextCode : current.friendCode
  }
  try {
    localStorage.setItem(JAM_USER_STORAGE_KEY, JSON.stringify(updated))
  } catch {}
  return updated
}

export function loadJsonArray(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveJsonArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

export function sortFriendsDeterministically(friendsList = []) {
  if (!Array.isArray(friendsList)) return []
  return [...friendsList].sort((a, b) => {
    // 1. Primary Sort: Online status (online = 1, offline = 0)
    const aOnline = a?.online ? 1 : 0
    const bOnline = b?.online ? 1 : 0
    if (aOnline !== bOnline) return bOnline - aOnline

    // 2. Secondary Sort: Alphabetical by display name (case-insensitive)
    // NEVER sort by lastSeen — that causes online friends to swap positions on every ping!
    const nameA = String(a?.name || '').trim()
    const nameB = String(b?.name || '').trim()
    const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
    if (nameCmp !== 0) return nameCmp

    // 3. Tertiary Tie-Breaker: Permanent Friend Code / ID
    const idA = String(a?.friendCode || a?.id || '')
    const idB = String(b?.friendCode || b?.id || '')
    return idA.localeCompare(idB)
  })
}

export function evaluateAudioDrift(localCurrentTime, hostCurrentTime, hostTimestamp, clockOffsetMs, isPlaying) {
  const now = Date.now()
  const estimatedHostNow = now + (clockOffsetMs || 0)
  // When paused (isPlaying === false), NEVER extrapolate elapsed time
  const elapsedSec =
    isPlaying && hostTimestamp ? Math.max(0, Math.min(15, (estimatedHostNow - hostTimestamp) / 1000)) : 0

  const targetTime = isPlaying
    ? Math.max(0, (Number(hostCurrentTime) || 0) + elapsedSec)
    : Math.max(0, Number(hostCurrentTime) || 0)
  const driftSec = targetTime - (Number(localCurrentTime) || 0)
  const absDriftMs = Math.round(Math.abs(driftSec) * 1000)

  // Tier 1: < 150ms -> Locked in sync, keep 1.0x speed
  if (absDriftMs < 150) {
    return {
      action: 'NONE',
      targetTime,
      driftMs: Math.round(driftSec * 1000),
      absDriftMs,
      playbackRate: 1.0,
      syncTier: 'LOCKED'
    }
  }

  // Tier 2: 150ms - 850ms while playing -> Smooth micro-speed ramping
  if (isPlaying && absDriftMs < 850) {
    const rate = driftSec > 0 ? 1.035 : 0.965
    return {
      action: 'RAMP',
      targetTime,
      driftMs: Math.round(driftSec * 1000),
      absDriftMs,
      playbackRate: rate,
      syncTier: 'RAMPING'
    }
  }

  // Tier 3: >= 850ms or paused -> Hard seek
  return {
    action: 'SEEK',
    targetTime,
    driftMs: Math.round(driftSec * 1000),
    absDriftMs,
    playbackRate: 1.0,
    syncTier: 'SEEKING'
  }
}
