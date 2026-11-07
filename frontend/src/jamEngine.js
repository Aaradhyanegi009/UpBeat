import { Peer } from 'peerjs'
import { getApiBase, hasBackend } from './standaloneApi'

const JAM_USER_STORAGE_KEY = 'upbeat_jam_profile_v1'
const LEGACY_PROFILE_KEYS = ['upbeat_jam_profile_v1', 'upbeat_jam_profile', 'upbeat_user_profile']
const FRIENDS_LIST_STORAGE_KEY = 'upbeat_friends_list'
const FRIEND_REQ_IN_STORAGE_KEY = 'upbeat_friend_requests_in'
const FRIEND_REQ_OUT_STORAGE_KEY = 'upbeat_friend_requests_out'
const SEEN_PACKETS_STORAGE_KEY = 'upbeat_seen_social_packets_v1'

const JAM_PEER_PREFIX = 'upbeat-jam-v70-'
const PRESENCE_PEER_PREFIX = 'upbeat-user-'
const CLOUD_RELAY_BASE = 'https://ntfy.sh'

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
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomChars(len) {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

function generateShortPin() {
  return `JAM-${randomChars(4)}`
}

function generateFriendCode() {
  return `UP-${randomChars(6)}`
}

function makePacketId() {
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
    str.match(/[?&#/](?:addFriend|friend|user)[=:]([A-Za-z0-9-]+)/i) ||
    str.match(/^(?:addFriend|friend|user)[=:]([A-Za-z0-9-]+)/i)
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

export function getAppBaseUrl() {
  if (typeof window === 'undefined') return 'https://upbeat-music.vercel.app/'
  try {
    const origin = window.location.origin
    if (
      origin &&
      !origin.includes('127.0.0.1') &&
      !origin.includes('localhost') &&
      !origin.startsWith('file:') &&
      !origin.startsWith('capacitor:')
    ) {
      return `${origin}${window.location.pathname}`
    }
    const savedWeb = localStorage.getItem('upbeat_jam_share_origin')
    if (savedWeb && savedWeb.startsWith('http')) {
      return savedWeb.replace(/\/+$/, '') + '/'
    }
    return 'https://upbeat-music.vercel.app/'
  } catch {
    return 'https://upbeat-music.vercel.app/'
  }
}

export function buildJamInviteUrl(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  if (!norm) return ''
  const base = getAppBaseUrl()
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}jam=${encodeURIComponent(norm)}`
}

export function buildFriendInviteUrl(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  const base = getAppBaseUrl()
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}addFriend=${encodeURIComponent(norm)}`
}

export function extractDeepLinkParams(urlStr = '') {
  try {
    let search = ''
    let hash = ''
    if (urlStr) {
      const normalizedUrl = String(urlStr).replace(/^upbeat:\/\//i, 'http://upbeat.local/')
      const u = new URL(normalizedUrl, 'http://upbeat.local')
      search = u.search
      hash = u.hash
    } else if (typeof window !== 'undefined') {
      search = window.location.search
      hash = window.location.hash
    }

    const searchParams = new URLSearchParams(search)
    let hashParams = new URLSearchParams()
    if (hash && hash.includes('=')) {
      const cleanHash = hash.replace(/^[#/?]+/, '')
      hashParams = new URLSearchParams(cleanHash)
    }

    const jamRaw =
      searchParams.get('jam') ||
      searchParams.get('join') ||
      searchParams.get('room') ||
      searchParams.get('code') ||
      hashParams.get('jam') ||
      hashParams.get('join') ||
      hashParams.get('room') ||
      hashParams.get('code')

    const friendRaw =
      searchParams.get('addFriend') ||
      searchParams.get('friend') ||
      searchParams.get('user') ||
      hashParams.get('addFriend') ||
      hashParams.get('friend') ||
      hashParams.get('user')

    return {
      jamCode: jamRaw ? normalizeRoomCode(jamRaw) : null,
      friendCode: friendRaw ? normalizeFriendCode(friendRaw) : null
    }
  } catch {
    return { jamCode: null, friendCode: null }
  }
}

function getPeerIdFromCode(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  const suffix = norm.replace('JAM-', '').toLowerCase()
  return `${JAM_PEER_PREFIX}${suffix}`
}

function getPresencePeerId(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  return `${PRESENCE_PEER_PREFIX}${norm}`
}

function getSocialCloudTopic(friendCode) {
  const norm = normalizeFriendCode(friendCode)
  if (!norm) return ''
  return `upbeat_v7_user_${norm.replace(/[^A-Z0-9]/g, '')}`
}

function getRoomCloudTopic(roomCode) {
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

function loadJsonArray(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveJsonArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

export function evaluateAudioDrift(localCurrentTime, hostCurrentTime, hostTimestamp, clockOffsetMs, isPlaying) {
  const now = Date.now()
  const estimatedHostNow = now + (clockOffsetMs || 0)
  const elapsedSec =
    isPlaying && hostTimestamp ? Math.max(0, Math.min(15, (estimatedHostNow - hostTimestamp) / 1000)) : 0

  const targetTime = Math.max(0, (Number(hostCurrentTime) || 0) + elapsedSec)
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

class JamSessionManager {
  constructor() {
    // Unique runtime instance ID per tab/window so multiple tabs on the same browser don't collide
    this.instanceId = `inst_${Math.random().toString(36).slice(2, 10)}`
    this.seenPacketIds = new Set(loadJsonArray(SEEN_PACKETS_STORAGE_KEY))
    this.cloudRetryTick = 0
    this.initialCloudPollDone = false

    this.peer = null
    this.connections = new Map() // peerId -> DataConnection (used by Host)
    this.hostConn = null // DataConnection to Host (used by Guest)
    this.bc = null // Same-browser BroadcastChannel for Jam room
    this.roomEventSource = null // Cloud SSE stream for Jam room
    this.roomPollTimer = null
    this.lastRoomServerTs = 0

    this.presencePeer = null
    this.auxClientPeer = null // Fallback outgoing Peer if fixed ID is busy in another tab
    this.presenceConns = new Map() // friendCode -> DataConnection
    this.pendingPeerConns = new Map() // friendCode -> DataConnection currently opening
    this.pendingPeerPackets = new Map() // friendCode -> Array<Packet> queued while opening
    this.socialBc = null
    this.socialEventSource = null // Cloud SSE stream for user's social inbox
    this.presenceTimer = null
    this.backendPollTimer = null
    this.lastSocialServerTs = 0

    this.syncInterval = null
    this.pingInterval = null
    this.clockSamples = []

    this.userProfile = loadJamUserProfile()

    this.state = {
      active: false,
      isHost: false,
      role: null, // 'host' | 'guest' | null
      roomCode: '',
      status: 'IDLE', // 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
      error: null,
      djMode: 'open_party', // 'open_party' | 'host_only'
      participants: [],
      hostName: '',
      clockOffsetMs: 0,
      rttMs: 18,
      syncDeltaMs: 0,
      syncTier: 'LOCKED',

      userProfile: this.userProfile,
      friends: loadJsonArray(FRIENDS_LIST_STORAGE_KEY).map((f) => ({
        ...f,
        avatar: '',
        online: false
      })),
      incomingRequests: loadJsonArray(FRIEND_REQ_IN_STORAGE_KEY).map((r) => ({
        ...r,
        avatar: ''
      })),
      outgoingRequests: loadJsonArray(FRIEND_REQ_OUT_STORAGE_KEY).map((r) => ({
        ...r,
        avatar: ''
      })),
      incomingJamInvite: null,
      latestFriendRequestToast: null,
      presenceReady: false
    }

    this.listeners = new Set()
    this.eventHandlers = {
      onRemoteSync: null,
      onRemoteControl: null,
      onRemoteQueueAdd: null,
      onReaction: null,
      onNotify: null,
      onJamInvite: null,
      getHostPlaybackSnapshot: null
    }

    if (typeof window !== 'undefined') {
      this.initPresenceNetwork()
    }
  }

  markPacketSeen(packetId) {
    if (!packetId) return false
    if (this.seenPacketIds.has(packetId)) return true
    this.seenPacketIds.add(packetId)
    if (this.seenPacketIds.size > 500) {
      const first = this.seenPacketIds.values().next().value
      this.seenPacketIds.delete(first)
    }
    saveJsonArray(SEEN_PACKETS_STORAGE_KEY, Array.from(this.seenPacketIds))
    return false
  }

  subscribe(listener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  setHandlers(handlers) {
    this.eventHandlers = { ...this.eventHandlers, ...handlers }
  }

  updateState(patch) {
    const nextRole = patch.role !== undefined ? patch.role : this.state.role
    const nextIsHost = patch.isHost !== undefined ? patch.isHost : nextRole === 'host'
    this.state = {
      ...this.state,
      ...patch,
      role: nextRole,
      isHost: Boolean(nextIsHost)
    }
    for (const fn of this.listeners) {
      try {
        fn(this.state)
      } catch {}
    }
  }

  refreshProfile(googleUser = null) {
    this.userProfile = loadJamUserProfile(googleUser)
    this.updateState({ userProfile: this.userProfile })
    this.broadcastPresenceStatus()
    return this.userProfile
  }

  updateUserProfile(updates) {
    const prevCode = this.userProfile?.friendCode
    this.userProfile = saveJamUserProfile(updates)
    this.updateState({ userProfile: this.userProfile })
    if (prevCode && this.userProfile.friendCode !== prevCode) {
      this.restartPresenceNetwork()
    }
    if (this.state.active) {
      const updatedParticipants = this.state.participants.map((p) =>
        p.id === this.getSelfParticipantId()
          ? { ...p, name: this.userProfile.name, avatar: '' }
          : p
      )
      this.updateState({ participants: updatedParticipants })
      if (this.state.isHost) {
        this.broadcastParticipants()
      } else {
        this.sendToHost({
          type: 'JAM_HELLO',
          profile: this.buildSelfParticipant(false)
        })
      }
    }
    this.broadcastPresenceStatus()
    return this.userProfile
  }

  regenerateFriendCode() {
    const newCode = generateFriendCode()
    return this.updateUserProfile({ friendCode: newCode })
  }

  getSelfParticipantId() {
    return `${this.userProfile?.id || 'usr'}_${this.instanceId.slice(-4)}`
  }

  buildSelfParticipant(isHost = false) {
    return {
      id: this.getSelfParticipantId(),
      peerId: this.getSelfParticipantId(),
      friendCode: this.userProfile.friendCode,
      name: this.userProfile.name,
      avatar: '',
      picture: this.userProfile.picture || '',
      isHost: Boolean(isHost),
      rttMs: isHost ? 0 : 18,
      inSync: true,
      joinedAt: Date.now()
    }
  }

  restartPresenceNetwork() {
    if (this.socialEventSource) {
      try {
        this.socialEventSource.close()
      } catch {}
      this.socialEventSource = null
    }
    if (this.presencePeer) {
      try {
        this.presencePeer.destroy()
      } catch {}
      this.presencePeer = null
    }
    this.initPresenceNetwork()
  }

  broadcastLocalSocialState() {
    if (this.socialBc) {
      try {
        this.socialBc.postMessage({
          type: 'LOCAL_SOCIAL_STATE_SYNC',
          _senderInstanceId: this.instanceId,
          friends: this.state.friends,
          incomingRequests: this.state.incomingRequests,
          outgoingRequests: this.state.outgoingRequests,
          userProfile: this.userProfile
        })
      } catch {}
    }
  }

  triggerRapidSocialSync() {
    const code = this.userProfile?.friendCode
    this.pollBackendSocial()
    this.pollSocialCloudInbox(code)
    this.pingAllFriends()
    ;[250, 700, 1600, 3200].forEach((ms) => {
      setTimeout(() => {
        this.pollBackendSocial()
        this.pollSocialCloudInbox(code)
        this.pingAllFriends()
      }, ms)
    })
  }

  initPresenceNetwork() {
    this.userProfile = loadJamUserProfile()
    const myFriendCode = this.userProfile.friendCode

    // 1. Same-browser BroadcastChannel for local zero-latency sync across all open tabs/windows
    if (typeof BroadcastChannel !== 'undefined' && !this.socialBc) {
      try {
        this.socialBc = new BroadcastChannel('upbeat_social_v7')
        this.socialBc.onmessage = (ev) => {
          const data = ev?.data
          if (!data || data._senderInstanceId === this.instanceId) return

          // Instant cross-tab sync of friends, incoming and outgoing requests for the SAME user profile
          if (data.type === 'LOCAL_SOCIAL_STATE_SYNC') {
            if (!data.userProfile?.friendCode || data.userProfile.friendCode === this.userProfile?.friendCode) {
              this.updateState({
                friends: data.friends || [],
                incomingRequests: data.incomingRequests || [],
                outgoingRequests: data.outgoingRequests || []
              })
            }
            return
          }

          const currentCode = this.userProfile?.friendCode || myFriendCode
          if (!data.targetFriendCode || normalizeFriendCode(data.targetFriendCode) === currentCode) {
            this.handleSocialPacket(data, null)
          }
        }
      } catch {}
    }

    // Multi-window storage synchronization & window focus auto-refresh
    if (typeof window !== 'undefined' && !this._storageListenerAdded) {
      this._storageListenerAdded = true
      window.addEventListener('storage', (ev) => {
        if (
          ev.key === FRIENDS_LIST_STORAGE_KEY ||
          ev.key === FRIEND_REQ_IN_STORAGE_KEY ||
          ev.key === FRIEND_REQ_OUT_STORAGE_KEY
        ) {
          const nextFriends = loadJsonArray(FRIENDS_LIST_STORAGE_KEY)
          const nextIn = loadJsonArray(FRIEND_REQ_IN_STORAGE_KEY)
          const nextOut = loadJsonArray(FRIEND_REQ_OUT_STORAGE_KEY)
          this.updateState({
            friends: nextFriends,
            incomingRequests: nextIn,
            outgoingRequests: nextOut
          })
        }
      })

      window.addEventListener('focus', () => {
        this.pingAllFriends()
        this.retryOutgoingRequests()
        this.pollSocialCloudInbox(this.userProfile?.friendCode)
        this.pollBackendSocial()
      })
    }

    // 2. Cloud SSE + HTTP Relay (ntfy.sh) for 100% cross-network & offline-queued delivery
    this.initSocialCloudRelay(myFriendCode)

    // 3. PeerJS WebRTC Presence Peer
    if (!this.presencePeer) {
      try {
        const peerId = getPresencePeerId(myFriendCode)
        const pPeer = new Peer(peerId, {
          config: { iceServers: ICE_SERVERS },
          debug: 0
        })
        this.presencePeer = pPeer

        pPeer.on('open', () => {
          this.updateState({ presenceReady: true })
          this.pingAllFriends()
          this.retryOutgoingRequests()
        })

        pPeer.on('connection', (conn) => {
          this.setupPresenceConn(conn)
        })

        pPeer.on('disconnected', () => {
          try {
            if (!pPeer.destroyed) pPeer.reconnect()
          } catch {}
        })

        pPeer.on('error', (err) => {
          this.updateState({ presenceReady: true })
          if (err?.type === 'unavailable-id') {
            // Another tab on this machine already holds the primary presence Peer ID;
            // spin up an auxiliary client peer so outgoing PeerJS connections still work!
            this.ensureAuxClientPeer()
          }
        })
      } catch {}
    }

    // 4. Periodic Presence & Backend Polling (rapid 2.5s and 1.2s intervals for snappy real-time responsiveness)
    if (this.presenceTimer) clearInterval(this.presenceTimer)
    this.presenceTimer = setInterval(() => {
      this.pingAllFriends()
      this.retryOutgoingRequests()
      this.pruneStaleFriendPresence()
      this.pollSocialCloudInbox(this.userProfile?.friendCode || myFriendCode)
    }, 2500)

    if (this.backendPollTimer) clearInterval(this.backendPollTimer)
    this.backendPollTimer = setInterval(() => {
      this.pollBackendSocial()
    }, 1200)

    setTimeout(() => {
      this.pollBackendSocial()
      this.pollSocialCloudInbox(myFriendCode)
      this.pingAllFriends()
      this.retryOutgoingRequests()
    }, 200)
  }

  ensureAuxClientPeer() {
    if (this.auxClientPeer && !this.auxClientPeer.destroyed) return this.auxClientPeer
    try {
      const aux = new Peer({
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.auxClientPeer = aux
      aux.on('open', () => {
        this.pingAllFriends()
        this.retryOutgoingRequests()
      })
      aux.on('connection', (conn) => {
        this.setupPresenceConn(conn)
      })
      return aux
    } catch {
      return null
    }
  }

  getActiveSocialPeer() {
    if (this.presencePeer && this.presencePeer.open && !this.presencePeer.destroyed) {
      return this.presencePeer
    }
    if (this.auxClientPeer && this.auxClientPeer.open && !this.auxClientPeer.destroyed) {
      return this.auxClientPeer
    }
    return this.ensureAuxClientPeer()
  }

  initSocialCloudRelay(myFriendCode) {
    const topic = getSocialCloudTopic(myFriendCode)
    if (!topic || typeof EventSource === 'undefined') return
    try {
      if (this.socialEventSource) {
        try {
          this.socialEventSource.close()
        } catch {}
      }
      const es = new EventSource(`${CLOUD_RELAY_BASE}/${topic}/sse?since=10m`)
      this.socialEventSource = es
      es.onmessage = (ev) => {
        try {
          const wrapper = JSON.parse(ev.data)
          if (wrapper?.event === 'message' && wrapper.message) {
            const payload = JSON.parse(wrapper.message)
            if (payload && payload._senderInstanceId !== this.instanceId) {
              this.handleSocialPacket(payload, null)
            }
          }
        } catch {}
      }
    } catch {}
  }

  async pollSocialCloudInbox(myFriendCode) {
    const topic = getSocialCloudTopic(myFriendCode || this.userProfile?.friendCode)
    if (!topic || typeof fetch === 'undefined') return
    try {
      const sinceWindow = this.initialCloudPollDone ? '30s' : '15m'
      const res = await fetch(`${CLOUD_RELAY_BASE}/${topic}/json?poll=1&since=${sinceWindow}`)
      if (!res.ok) return
      this.initialCloudPollDone = true
      const text = await res.text()
      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const wrapper = JSON.parse(line)
          if (wrapper?.event === 'message' && wrapper.message) {
            const payload = JSON.parse(wrapper.message)
            if (payload && payload._senderInstanceId !== this.instanceId) {
              this.handleSocialPacket(payload, null)
            }
          }
        } catch {}
      }
    } catch {}
  }

  async sendSocialCloudPacket(targetFriendCode, fullPacket) {
    const topic = getSocialCloudTopic(targetFriendCode)
    if (!topic || typeof fetch === 'undefined') return
    try {
      await fetch(`${CLOUD_RELAY_BASE}/${topic}`, {
        method: 'POST',
        body: JSON.stringify(fullPacket)
      })
    } catch {}
  }

  async pollBackendSocial() {
    if (!hasBackend()) return
    try {
      const friendCodes = [
        ...(this.state.friends || []).map((f) => f.friendCode),
        ...(this.state.outgoingRequests || []).map((r) => r.friendCode)
      ].filter(Boolean)

      const res = await fetch(`${getApiBase()}/jam/social/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friendCode: this.userProfile.friendCode,
          summary: this.getMyPublicSummary(),
          friendCodes,
          since: this.lastSocialServerTs
        })
      })
      if (!res.ok) return
      const data = await res.json()
      if (data?.serverTs) {
        this.lastSocialServerTs = data.serverTs
      }
      if (Array.isArray(data?.packets)) {
        for (const pkt of data.packets) {
          if (pkt && pkt._senderInstanceId !== this.instanceId) {
            this.handleSocialPacket(pkt, null)
          }
        }
      }
      if (Array.isArray(data?.presence)) {
        for (const pres of data.presence) {
          if (pres && pres.friendCode) {
            this.updateFriendPresence(pres)
          }
        }
      }
    } catch {}
  }

  async sendBackendSocialPacket(targetFriendCode, fullPacket) {
    if (!hasBackend()) return
    try {
      await fetch(`${getApiBase()}/jam/social/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetFriendCode,
          packet: fullPacket
        })
      })
    } catch {}
  }

  setupPresenceConn(conn, knownFriendCode = null) {
    if (!conn) return
    conn.on('open', () => {
      conn._lastDataAt = Date.now()
      if (knownFriendCode) {
        const cleanKnown = normalizeFriendCode(knownFriendCode)
        this.presenceConns.set(cleanKnown, conn)
        this.pendingPeerConns.delete(cleanKnown)
        // Flush any queued social packets for this friend
        const queued = this.pendingPeerPackets.get(cleanKnown) || []
        this.pendingPeerPackets.delete(cleanKnown)
        for (const pkt of queued) {
          try {
            conn.send(pkt)
          } catch {}
        }
      }
      try {
        const isConfirmed =
          knownFriendCode &&
          (this.state.friends || []).some(
            (f) => normalizeFriendCode(f.friendCode) === normalizeFriendCode(knownFriendCode)
          )
        conn.send({
          ...this.buildPresencePayload('PRESENCE_PING', {
            isConfirmedFriend: Boolean(isConfirmed)
          }),
          _packetId: makePacketId(),
          _senderInstanceId: this.instanceId
        })
      } catch {}
    })

    conn.on('data', (data) => {
      conn._lastDataAt = Date.now()
      if (data?._fromFriendCode) {
        const cleanFrom = normalizeFriendCode(data._fromFriendCode)
        if (cleanFrom) {
          this.presenceConns.set(cleanFrom, conn)
        }
      }
      this.handleSocialPacket(data, conn)
    })

    const cleanup = () => {
      if (knownFriendCode) {
        this.pendingPeerConns.delete(normalizeFriendCode(knownFriendCode))
      }
      for (const [code, activeConn] of this.presenceConns.entries()) {
        if (activeConn === conn) {
          this.presenceConns.delete(code)
        }
      }
    }
    conn.on('close', cleanup)
    conn.on('error', cleanup)
  }

  getMyPublicSummary() {
    const snap = this.eventHandlers.getHostPlaybackSnapshot
      ? this.eventHandlers.getHostPlaybackSnapshot()
      : null
    const confirmedFriendCodes = (this.state?.friends || [])
      .map((f) => normalizeFriendCode(f.friendCode))
      .filter(Boolean)
    return {
      id: this.userProfile.id,
      friendCode: this.userProfile.friendCode,
      name: this.userProfile.name,
      avatar: '',
      picture: this.userProfile.picture || '',
      confirmedFriendCodes,
      currentTrack: snap?.track
        ? {
            video_id: snap.track.video_id,
            title: snap.track.title,
            artist: snap.track.artist,
            thumbnail: snap.track.thumbnail,
            duration_text: snap.track.duration_text
          }
        : null,
      isPlaying: Boolean(snap?.isPlaying),
      activeJamCode: this.state.active ? this.state.roomCode : '',
      timestamp: Date.now()
    }
  }

  buildPresencePayload(type, extra = {}) {
    return {
      type,
      from: this.getMyPublicSummary(),
      _fromFriendCode: this.userProfile.friendCode,
      _senderInstanceId: this.instanceId,
      _packetId: makePacketId(),
      sentAt: Date.now(),
      ...extra
    }
  }

  sendSocialPacket(targetFriendCode, packet, options = { useCloud: true }) {
    const cleanTarget = normalizeFriendCode(targetFriendCode)
    if (!cleanTarget) return

    const fullPacket = {
      ...packet,
      targetFriendCode: cleanTarget,
      _fromFriendCode: this.userProfile.friendCode,
      _senderInstanceId: this.instanceId,
      _packetId: packet._packetId || makePacketId()
    }

    // 1. BroadcastChannel (same browser tabs)
    if (this.socialBc) {
      try {
        this.socialBc.postMessage(fullPacket)
      } catch {}
    }

    // 2. Local FastAPI Backend Relay
    this.sendBackendSocialPacket(cleanTarget, fullPacket)

    // 3. Cloud Pub/Sub Relay (for friend requests, accepts, acks, removals, jam invites, and probes)
    const isHighPriority =
      fullPacket.type === 'FRIEND_REQUEST' ||
      fullPacket.type === 'FRIEND_ACCEPTED' ||
      fullPacket.type === 'FRIEND_SYNC_ACK' ||
      fullPacket.type === 'FRIEND_REMOVED' ||
      fullPacket.type === 'JAM_INVITE' ||
      options?.useCloud === true
    if (isHighPriority) {
      this.sendSocialCloudPacket(cleanTarget, fullPacket)
    }

    // 4. PeerJS WebRTC DataChannel (with outbound fallback so stale inbound conns never drop FRIEND_ACCEPTED)
    if (cleanTarget === this.userProfile.friendCode) return

    const existing = this.presenceConns.get(cleanTarget)
    const isConnFresh = existing && existing.open && existing._lastDataAt && Date.now() - existing._lastDataAt < 12000
    if (existing && existing.open) {
      try {
        existing.send(fullPacket)
        if (!options?.forceOutboundPeer && isConnFresh) {
          return
        }
      } catch {}
    }

    const q = this.pendingPeerPackets.get(cleanTarget) || []
    // Avoid queueing duplicate PRESENCE_PINGs
    if (fullPacket.type !== 'PRESENCE_PING' || !q.some((p) => p.type === 'PRESENCE_PING')) {
      q.push(fullPacket)
      this.pendingPeerPackets.set(cleanTarget, q)
    }

    if (this.pendingPeerConns.has(cleanTarget) && !options?.forceOutboundPeer) {
      return
    }

    const activePeer = this.getActiveSocialPeer()
    if (activePeer && activePeer.open && !activePeer.destroyed) {
      try {
        const targetPeerId = getPresencePeerId(cleanTarget)
        const conn = activePeer.connect(targetPeerId, {
          reliable: true,
          serialization: 'json'
        })
        if (conn) {
          this.pendingPeerConns.set(cleanTarget, conn)
          this.setupPresenceConn(conn, cleanTarget)
          setTimeout(() => {
            if (this.pendingPeerConns.get(cleanTarget) === conn && !conn.open) {
              this.pendingPeerConns.delete(cleanTarget)
            }
          }, 7000)
        }
      } catch {}
    }
  }

  pingAllFriends() {
    const friends = this.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.sendSocialPacket(
          f.friendCode,
          this.buildPresencePayload('PRESENCE_PING', { isConfirmedFriend: true }),
          { useCloud: false }
        )
      }
    }
    this.pollBackendSocial()
  }

  retryOutgoingRequests() {
    const outgoing = this.state.outgoingRequests || []
    if (!outgoing.length) return
    this.cloudRetryTick = (this.cloudRetryTick || 0) + 1
    // Every 2nd cycle (~5s), also use Cloud Relay so cross-network friends reconcile automatically
    const useCloudNow = this.cloudRetryTick % 2 === 0
    for (const req of outgoing) {
      if (req.friendCode) {
        this.sendSocialPacket(
          req.friendCode,
          this.buildPresencePayload('FRIEND_STATUS_PROBE', { isPendingOutgoing: true }),
          { useCloud: useCloudNow }
        )
        this.sendSocialPacket(
          req.friendCode,
          this.buildPresencePayload('FRIEND_REQUEST', { isPendingOutgoing: true }),
          { useCloud: false }
        )
      }
    }
  }

  broadcastPresenceStatus() {
    const friends = this.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.sendSocialPacket(
          f.friendCode,
          this.buildPresencePayload('PRESENCE_STATUS', { isConfirmedFriend: true }),
          { useCloud: true }
        )
      }
    }
    this.pollBackendSocial()
  }

  pruneStaleFriendPresence() {
    const now = Date.now()
    let changed = false
    const nextFriends = (this.state.friends || []).map((f) => {
      if (f.online && f.lastSeen && now - f.lastSeen > 45000) {
        changed = true
        return { ...f, online: false }
      }
      return f
    })
    if (changed) {
      this.updateState({ friends: nextFriends })
      saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    }
  }

  hasSenderConfirmedMe(sender, packetData = null) {
    if (packetData?.isConfirmedFriend === true) return true
    const myCode = normalizeFriendCode(this.userProfile?.friendCode)
    if (!myCode) return false
    if (Array.isArray(sender?.confirmedFriendCodes)) {
      return sender.confirmedFriendCodes.some((c) => normalizeFriendCode(c) === myCode)
    }
    return false
  }

  handleSocialPacket(data, conn) {
    if (!data || typeof data !== 'object' || !data.from) return
    if (data._senderInstanceId && data._senderInstanceId === this.instanceId) return

    const myCode = normalizeFriendCode(this.userProfile?.friendCode)
    if (data.targetFriendCode && normalizeFriendCode(data.targetFriendCode) !== myCode) {
      return
    }

    // For idempotent state-changing packets, deduplicate by _packetId (persisted across reloads)
    if (
      data._packetId &&
      (data.type === 'FRIEND_REQUEST' ||
        data.type === 'FRIEND_ACCEPTED' ||
        data.type === 'FRIEND_SYNC_ACK' ||
        data.type === 'FRIEND_REMOVED' ||
        data.type === 'JAM_INVITE')
    ) {
      if (this.markPacketSeen(data._packetId)) return
    }

    const sender = {
      ...data.from,
      friendCode: normalizeFriendCode(data.from.friendCode || data._fromFriendCode),
      avatar: ''
    }
    if (!sender.friendCode || sender.friendCode === myCode) return

    const isAlreadyFriend = this.state.friends.some((f) => f.friendCode === sender.friendCode)
    const isOutgoingPending = this.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode)
    const senderConfirmedMe = this.hasSenderConfirmedMe(sender, data)

    // Layer 3 Auto-Reconciliation: If we have an outgoing request to sender AND sender already has us in their confirmed friends, promote immediately!
    if (isOutgoingPending && senderConfirmedMe && data.type !== 'FRIEND_REMOVED') {
      this.promoteToConfirmedFriend(sender)
      const ackReply = this.buildPresencePayload('FRIEND_SYNC_ACK', {
        targetFriendCode: sender.friendCode,
        isConfirmedFriend: true
      })
      if (conn && conn.open) {
        try { conn.send(ackReply) } catch {}
      }
      this.sendSocialPacket(sender.friendCode, ackReply, { useCloud: true })
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
      }
      return
    }

    switch (data.type) {
      case 'FRIEND_STATUS_PROBE':
      case 'PRESENCE_PING': {
        this.updateFriendPresence(sender, data)

        // If sender is already a confirmed friend on our side, tell them explicitly so their Outgoing Pending upgrades immediately!
        if (isAlreadyFriend) {
          const pongReply = this.buildPresencePayload('PRESENCE_PONG', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try {
              conn.send(pongReply)
            } catch {}
          } else {
            this.sendSocialPacket(sender.friendCode, pongReply, { useCloud: true })
          }

          if (data.type === 'FRIEND_STATUS_PROBE' || data.isPendingOutgoing) {
            const acceptReply = this.buildPresencePayload('FRIEND_ACCEPTED', {
              targetFriendCode: sender.friendCode,
              isConfirmedFriend: true
            })
            if (conn && conn.open) {
              try { conn.send(acceptReply) } catch {}
            }
            this.sendSocialPacket(sender.friendCode, acceptReply, { useCloud: true })
          }
          break
        }

        // If both users sent requests to each other (mutual pending), auto-promote both sides!
        if (isOutgoingPending && (data.type === 'FRIEND_STATUS_PROBE' || data.isPendingOutgoing)) {
          this.promoteToConfirmedFriend(sender)
          const acceptReply = this.buildPresencePayload('FRIEND_ACCEPTED', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try { conn.send(acceptReply) } catch {}
          }
          this.sendSocialPacket(sender.friendCode, acceptReply, { useCloud: true })
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`You and ${sender.name} are now friends!`, 'success')
          }
          break
        }

        const reply = this.buildPresencePayload('PRESENCE_PONG', {
          targetFriendCode: sender.friendCode,
          isConfirmedFriend: false
        })
        if (conn && conn.open) {
          try {
            conn.send(reply)
          } catch {}
        } else {
          this.sendSocialPacket(sender.friendCode, reply, { useCloud: false })
        }
        break
      }

      case 'PRESENCE_PONG':
      case 'PRESENCE_STATUS': {
        this.updateFriendPresence(sender, data)
        break
      }

      case 'FRIEND_REQUEST': {
        if (isAlreadyFriend) {
          this.updateFriendPresence(sender, data)
          const acceptReply = this.buildPresencePayload('FRIEND_ACCEPTED', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try { conn.send(acceptReply) } catch {}
          }
          this.sendSocialPacket(sender.friendCode, acceptReply, {
            useCloud: true,
            forceOutboundPeer: true
          })
          return
        }

        if (isOutgoingPending) {
          this.promoteToConfirmedFriend(sender)
          const acceptReply = this.buildPresencePayload('FRIEND_ACCEPTED', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try { conn.send(acceptReply) } catch {}
          }
          this.sendSocialPacket(sender.friendCode, acceptReply, {
            useCloud: true,
            forceOutboundPeer: true
          })
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`You and ${sender.name} are now friends!`, 'success')
          }
          return
        }

        const existsIn = this.state.incomingRequests.some((r) => r.friendCode === sender.friendCode)
        const reqEntry = {
          friendCode: sender.friendCode,
          name: sender.name || `Friend ${sender.friendCode.slice(-4)}`,
          avatar: '',
          picture: sender.picture || '',
          currentTrack: sender.currentTrack || null,
          requestedAt: Date.now()
        }
        const nextIn = existsIn
          ? this.state.incomingRequests.map((r) =>
              r.friendCode === sender.friendCode ? { ...r, ...reqEntry } : r
            )
          : [reqEntry, ...this.state.incomingRequests]

        saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
        this.updateState({
          incomingRequests: nextIn,
          latestFriendRequestToast: reqEntry
        })
        this.broadcastLocalSocialState()
        if (!existsIn && this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`${sender.name} sent you a friend request`, 'info')
        }
        break
      }

      case 'FRIEND_ACCEPTED': {
        const wasAlreadyFriend = this.state.friends.some((f) => f.friendCode === sender.friendCode)
        this.promoteToConfirmedFriend(sender)
        // Layer 2 Bidirectional Handshake: Send FRIEND_SYNC_ACK back to the accepter so both sides lock in online presence & latest profile immediately
        const ackReply = this.buildPresencePayload('FRIEND_SYNC_ACK', {
          targetFriendCode: sender.friendCode,
          isConfirmedFriend: true
        })
        if (conn && conn.open) {
          try { conn.send(ackReply) } catch {}
        }
        this.sendSocialPacket(sender.friendCode, ackReply, {
          useCloud: true,
          forceOutboundPeer: true
        })
        if (!wasAlreadyFriend && this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
        }
        break
      }

      case 'FRIEND_SYNC_ACK': {
        const wasAlreadyFriend = this.state.friends.some((f) => f.friendCode === sender.friendCode)
        const wasPending =
          this.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode) ||
          this.state.incomingRequests.some((r) => r.friendCode === sender.friendCode)
        if (wasAlreadyFriend || wasPending) {
          this.promoteToConfirmedFriend(sender)
          if (!wasAlreadyFriend && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
          }
        }
        break
      }

      case 'FRIEND_REMOVED': {
        const cleanSender = sender.friendCode
        const packetTs = Number(data.sentAt || data.from?.timestamp || 0)
        const existingFriend = (this.state.friends || []).find((f) => f.friendCode === cleanSender)
        const existingOut = (this.state.outgoingRequests || []).find((r) => r.friendCode === cleanSender)
        const newestLocalTs = Math.max(
          Number(existingFriend?.acceptedAt || 0),
          Number(existingOut?.sentAt || 0)
        )
        // Ignore stale historical FRIEND_REMOVED packets that predate our latest friend action
        if (packetTs > 0 && newestLocalTs > 0 && packetTs + 2000 < newestLocalTs) {
          return
        }

        const activeConn = this.presenceConns.get(cleanSender)
        if (activeConn) {
          try { activeConn.close() } catch {}
          this.presenceConns.delete(cleanSender)
        }
        this.pendingPeerConns.delete(cleanSender)
        this.pendingPeerPackets.delete(cleanSender)

        const nextFriends = (this.state.friends || []).filter((f) => f.friendCode !== cleanSender)
        const nextOut = (this.state.outgoingRequests || []).filter((r) => r.friendCode !== cleanSender)
        const nextIn = (this.state.incomingRequests || []).filter((r) => r.friendCode !== cleanSender)

        saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
        saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
        saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)

        this.updateState({
          friends: nextFriends,
          outgoingRequests: nextOut,
          incomingRequests: nextIn
        })
        this.broadcastLocalSocialState()
        break
      }

      case 'JAM_INVITE': {
        const invite = {
          id: `inv_${Date.now()}`,
          roomCode: normalizeRoomCode(data.roomCode),
          hostName: sender.name || data.hostName || 'Friend',
          hostAvatar: '',
          hostFriendCode: sender.friendCode,
          currentTrack: data.currentTrack || sender.currentTrack || null,
          receivedAt: Date.now()
        }
        if (!invite.roomCode) return
        this.updateState({ incomingJamInvite: invite })
        if (this.eventHandlers.onJamInvite) {
          this.eventHandlers.onJamInvite(invite)
        }
        if (this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(
            `${invite.hostName} invited you to join Jam (${invite.roomCode})`,
            'info'
          )
        }
        break
      }

      default:
        break
    }
  }

  updateFriendPresence(sender, packetData = null) {
    if (!sender?.friendCode) return
    const cleanCode = normalizeFriendCode(sender.friendCode)
    if (!cleanCode) return

    // If sender is in outgoingRequests AND their summary confirms they already added us, auto-promote to confirmed friend!
    const outIdx = this.state.outgoingRequests.findIndex((r) => r.friendCode === cleanCode)
    if (outIdx !== -1) {
      if (this.hasSenderConfirmedMe(sender, packetData)) {
        this.promoteToConfirmedFriend(sender)
        if (this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`${sender.name || cleanCode} accepted your friend request!`, 'success')
        }
        return
      }
      const nextOut = [...this.state.outgoingRequests]
      nextOut[outIdx] = {
        ...nextOut[outIdx],
        name: sender.name || nextOut[outIdx].name,
        picture: sender.picture || nextOut[outIdx].picture || '',
        online: true
      }
      saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
      this.updateState({ outgoingRequests: nextOut })
    }

    const idx = this.state.friends.findIndex((f) => f.friendCode === cleanCode)
    if (idx === -1) return
    const updatedFriend = {
      ...this.state.friends[idx],
      name: sender.name || this.state.friends[idx].name,
      avatar: '',
      picture: sender.picture || this.state.friends[idx].picture || '',
      online: true,
      lastSeen: Date.now(),
      currentTrack: sender.currentTrack || null,
      isPlaying: Boolean(sender.isPlaying),
      activeJamCode: sender.activeJamCode || ''
    }
    const nextFriends = [...this.state.friends]
    nextFriends[idx] = updatedFriend
    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.updateState({ friends: nextFriends })
  }

  promoteToConfirmedFriend(sender) {
    const cleanCode = normalizeFriendCode(sender.friendCode)
    if (!cleanCode) return

    const nextIn = this.state.incomingRequests.filter((r) => r.friendCode !== cleanCode)
    const nextOut = this.state.outgoingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)

    const existing = this.state.friends.find((f) => f.friendCode === cleanCode)
    const friendEntry = {
      friendCode: cleanCode,
      name: sender.name || existing?.name || `Friend ${cleanCode.slice(-4)}`,
      avatar: '',
      picture: sender.picture || existing?.picture || '',
      online: true,
      lastSeen: Date.now(),
      acceptedAt: existing?.acceptedAt || Date.now(),
      currentTrack: sender.currentTrack ?? existing?.currentTrack ?? null,
      isPlaying: sender.isPlaying !== undefined ? Boolean(sender.isPlaying) : Boolean(existing?.isPlaying),
      activeJamCode: sender.activeJamCode ?? existing?.activeJamCode ?? ''
    }

    const nextFriends = existing
      ? this.state.friends.map((f) => (f.friendCode === cleanCode ? { ...f, ...friendEntry } : f))
      : [friendEntry, ...this.state.friends]

    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.updateState({
      friends: nextFriends,
      incomingRequests: nextIn,
      outgoingRequests: nextOut,
      latestFriendRequestToast:
        this.state.latestFriendRequestToast?.friendCode === cleanCode
          ? null
          : this.state.latestFriendRequestToast
    })
    this.broadcastLocalSocialState()
  }

  sendFriendRequest(rawCode) {
    const targetCode = normalizeFriendCode(rawCode)
    if (!targetCode || targetCode.length < 7) {
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify('Enter a valid Friend Code (e.g. UP-7K4M9P)', 'warning')
      }
      return { ok: false, error: 'Enter a valid Friend Code (e.g. UP-7K4M9P)' }
    }

    if (targetCode === this.userProfile.friendCode) {
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify(
          'That is your own Friend Code! Share it with a friend or click the refresh icon next to your ID to generate a separate test ID.',
          'warning'
        )
      }
      return { ok: false, error: 'Cannot add your own Friend Code' }
    }

    if (this.state.friends.some((f) => f.friendCode === targetCode)) {
      this.sendSocialPacket(
        targetCode,
        this.buildPresencePayload('PRESENCE_PING', { isConfirmedFriend: true }),
        { useCloud: true }
      )
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify('Already in your Friends list!', 'info')
      }
      return { ok: true, status: 'already_friends' }
    }

    const incomingMatch = this.state.incomingRequests.find((r) => r.friendCode === targetCode)
    if (incomingMatch) {
      this.acceptFriendRequest(targetCode)
      return { ok: true, status: 'accepted' }
    }

    const existingOut = this.state.outgoingRequests.find((r) => r.friendCode === targetCode)
    const nextEntry = {
      friendCode: targetCode,
      name: existingOut?.name || `Friend ${targetCode.slice(-4)}`,
      avatar: '',
      picture: existingOut?.picture || '',
      online: Boolean(existingOut?.online),
      sentAt: Date.now()
    }
    const nextOut = [
      nextEntry,
      ...this.state.outgoingRequests.filter((r) => r.friendCode !== targetCode)
    ]
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
    this.updateState({ outgoingRequests: nextOut })
    this.broadcastLocalSocialState()

    this.sendSocialPacket(
      targetCode,
      this.buildPresencePayload('FRIEND_REQUEST', { isPendingOutgoing: true }),
      { useCloud: true, forceOutboundPeer: true }
    )
    this.sendSocialPacket(
      targetCode,
      this.buildPresencePayload('FRIEND_STATUS_PROBE', { isPendingOutgoing: true }),
      { useCloud: true }
    )
    this.triggerRapidSocialSync()

    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(`Friend request sent to ${targetCode}`, 'success')
    }
    return { ok: true, status: 'sent' }
  }

  acceptFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return
    const req = this.state.incomingRequests.find((r) => r.friendCode === cleanCode) || {
      friendCode: cleanCode,
      name: `Friend ${cleanCode.slice(-4)}`,
      avatar: ''
    }
    // 1. Promote locally FIRST so getMyPublicSummary().confirmedFriendCodes immediately includes cleanCode
    this.promoteToConfirmedFriend(req)

    // 2. Layer 1 Multi-Path Dispatch: Send FRIEND_ACCEPTED over existing conn, fresh outbound PeerJS conn, Backend, Cloud, and BroadcastChannel
    const acceptPacket = this.buildPresencePayload('FRIEND_ACCEPTED', {
      targetFriendCode: cleanCode,
      isConfirmedFriend: true
    })
    this.sendSocialPacket(cleanCode, acceptPacket, {
      useCloud: true,
      forceOutboundPeer: true
    })
    this.sendSocialPacket(
      cleanCode,
      this.buildPresencePayload('PRESENCE_PING', {
        targetFriendCode: cleanCode,
        isConfirmedFriend: true
      }),
      { useCloud: true }
    )

    // 3. Follow-up confirmation waves so if Sender was briefly switching apps/tabs, they still receive instant promotion
    ;[350, 1200, 2800].forEach((delayMs) => {
      setTimeout(() => {
        if ((this.state.friends || []).some((f) => f.friendCode === cleanCode)) {
          this.sendSocialPacket(
            cleanCode,
            this.buildPresencePayload('FRIEND_SYNC_ACK', {
              targetFriendCode: cleanCode,
              isConfirmedFriend: true
            }),
            { useCloud: delayMs === 1200 }
          )
        }
      }, delayMs)
    })

    this.triggerRapidSocialSync()
    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(`Added ${req.name} to Friends`, 'success')
    }
  }

  declineFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextIn = this.state.incomingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    this.updateState({
      incomingRequests: nextIn,
      latestFriendRequestToast:
        this.state.latestFriendRequestToast?.friendCode === cleanCode
          ? null
          : this.state.latestFriendRequestToast
    })
    this.broadcastLocalSocialState()
  }

  dismissFriendRequestToast() {
    this.updateState({ latestFriendRequestToast: null })
  }

  cancelOutgoingRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextOut = this.state.outgoingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
    this.updateState({ outgoingRequests: nextOut })
    this.broadcastLocalSocialState()
  }

  removeFriend(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return

    // Notify the other user across all channels so they update their friends list in real time
    this.sendSocialPacket(
      cleanCode,
      this.buildPresencePayload('FRIEND_REMOVED', { targetFriendCode: cleanCode }),
      { useCloud: true }
    )

    // Terminate any active direct WebRTC data connection
    const activeConn = this.presenceConns.get(cleanCode)
    if (activeConn) {
      try { activeConn.close() } catch {}
      this.presenceConns.delete(cleanCode)
    }
    this.pendingPeerConns.delete(cleanCode)
    this.pendingPeerPackets.delete(cleanCode)

    const nextFriends = this.state.friends.filter((f) => f.friendCode !== cleanCode)
    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.updateState({ friends: nextFriends })
    this.broadcastLocalSocialState()

    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify('Friend removed', 'info')
    }
  }

  async inviteFriendToJam(friendCode, googleUser = null) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return

    let roomCode = this.state.roomCode
    if (!this.state.active || !roomCode) {
      roomCode = await this.createJam(googleUser, 'open_party')
    }

    const snap = this.eventHandlers.getHostPlaybackSnapshot
      ? this.eventHandlers.getHostPlaybackSnapshot()
      : null

    this.sendSocialPacket(
      cleanCode,
      this.buildPresencePayload('JAM_INVITE', {
        roomCode,
        hostName: this.userProfile.name,
        hostAvatar: '',
        currentTrack: snap?.track || null
      }),
      { useCloud: true }
    )

    const friend = this.state.friends.find((f) => f.friendCode === cleanCode)
    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(
        `Invited ${friend?.name || cleanCode} to Jam (${roomCode})`,
        'success'
      )
    }
    return roomCode
  }

  dismissJamInvite() {
    this.updateState({ incomingJamInvite: null })
  }

  // ============================================================================
  // MULTI-CHANNEL ROOM TRANSPORT (BroadcastChannel + Backend + Cloud SSE + PeerJS)
  // ============================================================================
  setupRoomTransports(roomCode) {
    this.teardownRoomTransports()
    if (!roomCode) return

    // 1. Same-browser BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(`upbeat_jam_${roomCode}`)
        this.bc.onmessage = (ev) => {
          if (ev?.data && ev.data._senderInstanceId !== this.instanceId) {
            this.handleIncomingPacket(ev.data, null)
          }
        }
      } catch {}
    }

    // 2. Cloud SSE Relay (ntfy.sh) for cross-network Jam sync fallback
    const topic = getRoomCloudTopic(roomCode)
    if (topic && typeof EventSource !== 'undefined') {
      try {
        const es = new EventSource(`${CLOUD_RELAY_BASE}/${topic}/sse?since=2m`)
        this.roomEventSource = es
        es.onmessage = (ev) => {
          try {
            const wrapper = JSON.parse(ev.data)
            if (wrapper?.event === 'message' && wrapper.message) {
              const pkt = JSON.parse(wrapper.message)
              if (pkt && pkt._senderInstanceId !== this.instanceId) {
                this.handleIncomingPacket(pkt, null)
              }
            }
          } catch {}
        }
      } catch {}
    }

    // 3. Local FastAPI Backend Room Polling
    this.lastRoomServerTs = Date.now() - 120000
    this.roomPollTimer = setInterval(() => {
      this.pollBackendRoom(roomCode)
    }, 1500)
    setTimeout(() => {
      this.pollBackendRoom(roomCode)
      this.pollCloudRoom(roomCode)
    }, 250)
  }

  teardownRoomTransports() {
    if (this.bc) {
      try {
        this.bc.close()
      } catch {}
      this.bc = null
    }
    if (this.roomEventSource) {
      try {
        this.roomEventSource.close()
      } catch {}
      this.roomEventSource = null
    }
    if (this.roomPollTimer) {
      clearInterval(this.roomPollTimer)
      this.roomPollTimer = null
    }
  }

  async pollCloudRoom(roomCode) {
    const topic = getRoomCloudTopic(roomCode)
    if (!topic || typeof fetch === 'undefined') return
    try {
      const res = await fetch(`${CLOUD_RELAY_BASE}/${topic}/json?poll=1&since=2m`)
      if (!res.ok) return
      const text = await res.text()
      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const wrapper = JSON.parse(line)
          if (wrapper?.event === 'message' && wrapper.message) {
            const pkt = JSON.parse(wrapper.message)
            if (pkt && pkt._senderInstanceId !== this.instanceId) {
              this.handleIncomingPacket(pkt, null)
            }
          }
        } catch {}
      }
    } catch {}
  }

  async sendCloudRoomPacket(roomCode, payload) {
    const topic = getRoomCloudTopic(roomCode)
    if (!topic || typeof fetch === 'undefined') return
    try {
      await fetch(`${CLOUD_RELAY_BASE}/${topic}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    } catch {}
  }

  async pollBackendRoom(roomCode) {
    if (!hasBackend() || !roomCode) return
    try {
      const res = await fetch(
        `${getApiBase()}/jam/room/poll?roomCode=${encodeURIComponent(roomCode)}&since=${this.lastRoomServerTs}`
      )
      if (!res.ok) return
      const data = await res.json()
      if (data?.serverTs) {
        this.lastRoomServerTs = data.serverTs
      }
      if (Array.isArray(data?.packets)) {
        for (const pkt of data.packets) {
          if (pkt && pkt._senderInstanceId !== this.instanceId) {
            this.handleIncomingPacket(pkt, null)
          }
        }
      }
    } catch {}
  }

  async sendBackendRoomPacket(roomCode, payload) {
    if (!hasBackend() || !roomCode) return
    try {
      await fetch(`${getApiBase()}/jam/room/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode,
          packet: payload
        })
      })
    } catch {}
  }

  async createJam(googleUser = null, initialDjMode = 'open_party') {
    this.leaveJam(true)
    this.userProfile = loadJamUserProfile(googleUser)
    const roomCode = generateShortPin()
    const peerId = getPeerIdFromCode(roomCode)
    const normDj = initialDjMode === 'host_only' ? 'host_only' : 'open_party'

    const hostParticipant = this.buildSelfParticipant(true)

    this.updateState({
      active: true,
      isHost: true,
      role: 'host',
      roomCode,
      status: 'CONNECTED',
      error: null,
      djMode: normDj,
      participants: [hostParticipant],
      hostName: this.userProfile.name,
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'LOCKED'
    })

    this.setupRoomTransports(roomCode)
    this.startHostLoops()
    this.broadcastParticipants()
    this.broadcastSyncNow()
    this.broadcastPresenceStatus()

    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(`Jam session active: ${roomCode}`, 'success')
    }

    try {
      const peer = new Peer(peerId, {
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.peer = peer

      peer.on('open', () => {
        this.updateState({ status: 'CONNECTED', error: null })
        this.broadcastParticipants()
        this.broadcastSyncNow()
      })

      peer.on('connection', (conn) => {
        this.setupHostPeerConnection(conn)
      })

      peer.on('disconnected', () => {
        try {
          if (!peer.destroyed) peer.reconnect()
        } catch {}
      })

      peer.on('error', (err) => {
        if (err?.type === 'unavailable-id') {
          this.createJam(googleUser, normDj)
        }
      })
    } catch {}

    return roomCode
  }

  setupHostPeerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
      this.broadcastParticipants()
      this.broadcastSyncNow()
    })

    conn.on('data', (data) => {
      this.handleIncomingPacket(data, conn)
    })

    const cleanup = () => {
      this.connections.delete(conn.peer)
      if (conn._guestProfileId) {
        const gone = this.state.participants.find((p) => p.id === conn._guestProfileId)
        const nextList = this.state.participants.filter((p) => p.id !== conn._guestProfileId)
        this.updateState({ participants: nextList })
        this.broadcastParticipants()
        if (gone && this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`${gone.name} left the Jam`, 'info')
        }
      }
    }

    conn.on('close', cleanup)
    conn.on('error', cleanup)
  }

  async joinJam(rawCode, googleUser = null) {
    const roomCode = normalizeRoomCode(rawCode)
    if (!roomCode || roomCode.length < 6) {
      this.updateState({ error: 'Please enter a valid Jam code (e.g. JAM-4829)' })
      return false
    }

    this.leaveJam(true)
    this.userProfile = loadJamUserProfile(googleUser)
    const hostPeerId = getPeerIdFromCode(roomCode)

    const selfParticipant = this.buildSelfParticipant(false)

    this.updateState({
      active: true,
      isHost: false,
      role: 'guest',
      roomCode,
      status: 'CONNECTING',
      error: null,
      participants: [selfParticipant],
      clockOffsetMs: 0,
      rttMs: 18,
      syncDeltaMs: 0,
      syncTier: 'LOCKED',
      incomingJamInvite: null
    })

    this.setupRoomTransports(roomCode)

    // Immediately announce over BroadcastChannel, Backend, and Cloud Relay
    this.sendToHost(
      {
        type: 'JAM_HELLO',
        profile: selfParticipant
      },
      { useCloud: true }
    )

    // Retry JAM_HELLO after 1.2s in case host was still initializing
    setTimeout(() => {
      if (this.state.active && this.state.role === 'guest') {
        this.sendToHost(
          {
            type: 'JAM_HELLO',
            profile: selfParticipant
          },
          { useCloud: true }
        )
      }
    }, 1200)

    this.startGuestPingLoop()

    try {
      const peer = new Peer({
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.peer = peer

      const connectTimeout = setTimeout(() => {
        if (
          this.state.active &&
          this.state.status === 'CONNECTING' &&
          this.state.participants.length <= 1
        ) {
          this.updateState({
            status: 'ERROR',
            error: `Room ${roomCode} not found or host is offline`
          })
        }
      }, 11000)

      peer.on('open', () => {
        const conn = peer.connect(hostPeerId, {
          reliable: true,
          serialization: 'json'
        })
        this.hostConn = conn

        conn.on('open', () => {
          clearTimeout(connectTimeout)
          this.updateState({ status: 'CONNECTED', error: null })
          this.sendToHost(
            {
              type: 'JAM_HELLO',
              profile: selfParticipant
            },
            { useCloud: false }
          )
          this.broadcastPresenceStatus()
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`Joined Jam ${roomCode}`, 'success')
          }
        })

        conn.on('data', (data) => {
          clearTimeout(connectTimeout)
          if (this.state.status !== 'CONNECTED') {
            this.updateState({ status: 'CONNECTED', error: null })
          }
          this.handleIncomingPacket(data, conn)
        })

        conn.on('close', () => {
          if (this.state.active && this.state.role === 'guest' && !hasBackend()) {
            // Only leave if not connected via relay
          }
        })
      })

      peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') {
          // Wait for cloud/backend relay before declaring error
          setTimeout(() => {
            if (
              this.state.active &&
              this.state.status !== 'CONNECTED' &&
              this.state.participants.length <= 1
            ) {
              this.updateState({
                status: 'ERROR',
                error: `Room ${roomCode} not found or host went offline`
              })
            }
          }, 3500)
        }
      })
    } catch {}

    return true
  }

  startHostLoops() {
    this.stopLoops()
    this.syncInterval = setInterval(() => {
      this.broadcastSyncNow(null, { useCloud: false })
    }, 2000)
  }

  startGuestPingLoop() {
    this.stopLoops()
    const sendPing = () => {
      this.sendToHost(
        {
          type: 'JAM_PING',
          t1: Date.now(),
          senderId: this.getSelfParticipantId()
        },
        { useCloud: false }
      )
    }
    sendPing()
    this.pingInterval = setInterval(sendPing, 6000)
  }

  stopLoops() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  broadcastFromHost(packet, options = { useCloud: true }) {
    if (!this.state.active || this.state.role !== 'host') return
    const payload = {
      ...packet,
      _packetId: packet._packetId || makePacketId(),
      _senderProfileId: this.getSelfParticipantId(),
      _senderInstanceId: this.instanceId
    }
    for (const conn of this.connections.values()) {
      try {
        if (conn.open) conn.send(payload)
      } catch {}
    }
    if (this.bc) {
      try {
        this.bc.postMessage(payload)
      } catch {}
    }
    this.sendBackendRoomPacket(this.state.roomCode, payload)
    if (options?.useCloud !== false) {
      this.sendCloudRoomPacket(this.state.roomCode, payload)
    }
  }

  sendToHost(packet, options = { useCloud: true }) {
    if (!this.state.active) return
    const payload = {
      ...packet,
      _packetId: packet._packetId || makePacketId(),
      _senderProfileId: this.getSelfParticipantId(),
      _senderInstanceId: this.instanceId
    }
    if (this.hostConn && this.hostConn.open) {
      try {
        this.hostConn.send(payload)
      } catch {}
    }
    if (this.bc) {
      try {
        this.bc.postMessage(payload)
      } catch {}
    }
    this.sendBackendRoomPacket(this.state.roomCode, payload)
    if (options?.useCloud !== false) {
      this.sendCloudRoomPacket(this.state.roomCode, payload)
    }
  }

  broadcastSyncNow(overridePatch = null, options = { useCloud: true }) {
    if (!this.state.active || this.state.role !== 'host') return
    const snapshot = this.eventHandlers.getHostPlaybackSnapshot
      ? this.eventHandlers.getHostPlaybackSnapshot()
      : null
    const merged = { ...(snapshot || {}), ...(overridePatch || {}) }

    this.broadcastFromHost(
      {
        type: 'JAM_SYNC',
        roomCode: this.state.roomCode,
        track: merged.track || null,
        isPlaying: Boolean(merged.isPlaying),
        currentTime: Number(merged.currentTime) || 0,
        hostTimestamp: Date.now(),
        queue: Array.isArray(merged.queue) ? merged.queue.slice(0, 30) : [],
        djMode: this.state.djMode,
        hostName: this.userProfile?.name || 'Host'
      },
      options
    )
  }

  broadcastHostSync(overridePatch = null) {
    this.broadcastSyncNow(overridePatch, { useCloud: true })
    this.broadcastPresenceStatus()
  }

  broadcastParticipants() {
    if (this.state.role !== 'host') return
    const sanitizedParticipants = (this.state.participants || []).map((p) => ({
      ...p,
      peerId: p.peerId || p.id,
      avatar: ''
    }))
    this.broadcastFromHost(
      {
        type: 'JAM_PARTICIPANTS',
        participants: sanitizedParticipants,
        djMode: this.state.djMode,
        hostName: this.userProfile?.name || 'Host'
      },
      { useCloud: true }
    )
  }

  handleIncomingPacket(data, conn) {
    if (!data || typeof data !== 'object') return
    if (data._senderInstanceId && data._senderInstanceId === this.instanceId) return

    // Deduplicate discrete room events across multiple transports
    if (
      data._packetId &&
      data.type !== 'JAM_SYNC' &&
      data.type !== 'JAM_PING' &&
      data.type !== 'JAM_PONG'
    ) {
      if (this.markPacketSeen(data._packetId)) return
    }

    switch (data.type) {
      case 'JAM_HELLO': {
        if (this.state.role === 'host' && data.profile) {
          const guestId = data.profile.id || data.profile.peerId
          const cleanProfile = {
            ...data.profile,
            id: guestId,
            peerId: guestId,
            avatar: '',
            isHost: false,
            inSync: true
          }
          if (conn) conn._guestProfileId = cleanProfile.id
          const exists = this.state.participants.some((p) => p.id === cleanProfile.id)
          const updated = exists
            ? this.state.participants.map((p) =>
                p.id === cleanProfile.id ? { ...p, ...cleanProfile, isHost: p.isHost } : p
              )
            : [...this.state.participants, cleanProfile]
          this.updateState({ status: 'CONNECTED', participants: updated })
          this.broadcastParticipants()
          this.broadcastSyncNow(null, { useCloud: true })
          if (!exists && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`${cleanProfile.name} joined the Jam`, 'success')
          }
        }
        break
      }

      case 'JAM_PARTICIPANTS': {
        if (this.state.role === 'guest' && Array.isArray(data.participants)) {
          const wasConnecting = this.state.status !== 'CONNECTED'
          const cleanList = data.participants.map((p) => ({
            ...p,
            peerId: p.peerId || p.id,
            avatar: ''
          }))
          this.updateState({
            status: 'CONNECTED',
            error: null,
            participants: cleanList,
            djMode: data.djMode || this.state.djMode,
            hostName: data.hostName || this.state.hostName
          })
          if (wasConnecting && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`Connected to ${data.hostName || 'Host'}'s Jam`, 'success')
          }
        }
        break
      }

      case 'JAM_PING': {
        if (this.state.role === 'host') {
          const pong = {
            type: 'JAM_PONG',
            t1: data.t1,
            t2: Date.now(),
            t3: Date.now(),
            targetId: data.senderId,
            _senderProfileId: this.getSelfParticipantId(),
            _senderInstanceId: this.instanceId
          }
          if (conn && conn.open) {
            try {
              conn.send(pong)
            } catch {}
          } else {
            this.broadcastFromHost(pong, { useCloud: false })
          }
        }
        break
      }

      case 'JAM_PONG': {
        if (
          this.state.role === 'guest' &&
          (!data.targetId || data.targetId === this.getSelfParticipantId())
        ) {
          const t4 = Date.now()
          const rtt = Math.max(2, t4 - data.t1 - (data.t3 - data.t2))
          const offset = Math.round((data.t2 - data.t1 + (data.t3 - t4)) / 2)
          this.clockSamples.push({ rtt, offset })
          if (this.clockSamples.length > 5) this.clockSamples.shift()
          const sortedOffsets = [...this.clockSamples].map((s) => s.offset).sort((a, b) => a - b)
          const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)] || 0
          this.updateState({
            rttMs: Math.round(rtt),
            clockOffsetMs: medianOffset
          })
        }
        break
      }

      case 'JAM_SYNC': {
        if (this.state.role === 'guest') {
          this.updateState({
            status: 'CONNECTED',
            error: null,
            djMode: data.djMode || this.state.djMode,
            hostName: data.hostName || this.state.hostName
          })
          if (data.track && this.eventHandlers.onRemoteSync) {
            this.eventHandlers.onRemoteSync(data, this.state.clockOffsetMs)
          }
        }
        break
      }

      case 'JAM_CONTROL': {
        if (this.state.role === 'host') {
          if (this.state.djMode !== 'host_only') {
            if (this.eventHandlers.onRemoteControl) {
              this.eventHandlers.onRemoteControl(data)
            }
            this.broadcastFromHost(data, { useCloud: true })
          }
        } else if (this.state.role === 'guest') {
          if (this.eventHandlers.onRemoteControl) {
            this.eventHandlers.onRemoteControl(data)
          }
        }
        break
      }

      case 'JAM_QUEUE_ADD': {
        const cleanAddedBy = {
          ...(data.addedBy || {}),
          avatar: '',
          name: data.addedBy?.name || 'Friend'
        }
        if (this.state.role === 'host') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
          this.broadcastFromHost({ ...data, addedBy: cleanAddedBy }, { useCloud: true })
          setTimeout(() => this.broadcastSyncNow(null, { useCloud: true }), 150)
        } else if (this.state.role === 'guest') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
        }
        break
      }

      case 'JAM_REACTION': {
        if (this.state.role === 'host') {
          this.broadcastFromHost(data, { useCloud: true })
        }
        if (this.eventHandlers.onReaction) {
          this.eventHandlers.onReaction(data)
        }
        break
      }

      case 'JAM_DJ_MODE': {
        if (this.state.role === 'guest') {
          this.updateState({ djMode: data.djMode })
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(
              data.djMode === 'host_only'
                ? 'Host switched to Host-Only DJ Mode'
                : 'Host enabled Open Party Mode',
              'info'
            )
          }
        }
        break
      }

      case 'JAM_LEAVE': {
        if (this.state.role === 'host' && data.senderId) {
          const gone = this.state.participants.find((p) => p.id === data.senderId)
          const nextList = this.state.participants.filter((p) => p.id !== data.senderId)
          this.updateState({ participants: nextList })
          this.broadcastParticipants()
          if (gone && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`${gone.name} left the Jam`, 'info')
          }
        }
        break
      }

      case 'JAM_ENDED': {
        if (this.state.role === 'guest') {
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify('Host ended the Jam session', 'info')
          }
          this.leaveJam(true)
        }
        break
      }

      default:
        break
    }
  }

  emitControl(action, payload = {}) {
    if (!this.state.active) return true
    if (this.state.role === 'guest' && this.state.djMode === 'host_only') {
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify('Host-Only Mode is active', 'warning')
      }
      return false
    }

    const packet = {
      type: 'JAM_CONTROL',
      action,
      ...payload,
      senderId: this.getSelfParticipantId(),
      senderName: this.userProfile?.name || 'Friend',
      timestamp: Date.now(),
      _packetId: makePacketId()
    }

    if (this.state.role === 'host') {
      this.broadcastFromHost(packet, { useCloud: true })
      setTimeout(() => this.broadcastSyncNow(null, { useCloud: true }), 80)
    } else {
      this.sendToHost(packet, { useCloud: true })
    }
    return true
  }

  emitPlaybackControl(action, payload = {}) {
    return this.emitControl(action, payload)
  }

  emitQueueAdd(track) {
    if (!this.state.active || !track) return
    const packet = {
      type: 'JAM_QUEUE_ADD',
      track,
      addedBy: {
        id: this.getSelfParticipantId(),
        name: this.userProfile?.name || 'Friend',
        avatar: ''
      },
      _packetId: makePacketId()
    }
    if (this.state.role === 'host') {
      this.broadcastFromHost(packet, { useCloud: true })
      setTimeout(() => this.broadcastSyncNow(null, { useCloud: true }), 100)
    } else {
      this.sendToHost(packet, { useCloud: true })
    }
  }

  sendReaction(reactionType = 'vibe') {
    if (!this.state.active) return
    const id = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const packet = {
      type: 'JAM_REACTION',
      id,
      _packetId: id,
      reaction: reactionType,
      senderId: this.getSelfParticipantId(),
      senderName: this.userProfile?.name || 'You',
      senderAvatar: ''
    }
    this.markPacketSeen(id)
    if (this.state.role === 'host') {
      this.broadcastFromHost(packet, { useCloud: true })
    } else {
      this.sendToHost(packet, { useCloud: true })
    }
    if (this.eventHandlers.onReaction) {
      this.eventHandlers.onReaction(packet)
    }
  }

  setDjMode(mode) {
    if (this.state.role !== 'host') return
    const cleanMode = mode === 'host_only' ? 'host_only' : 'open_party'
    this.updateState({ djMode: cleanMode })
    this.broadcastFromHost(
      {
        type: 'JAM_DJ_MODE',
        djMode: cleanMode
      },
      { useCloud: true }
    )
  }

  reportDriftStatus(driftMs, syncTier) {
    const cleanTier = syncTier === 'IN_SYNC' ? 'LOCKED' : syncTier || 'LOCKED'
    if (Math.abs(driftMs - this.state.syncDeltaMs) > 25 || cleanTier !== this.state.syncTier) {
      this.updateState({
        syncDeltaMs: driftMs,
        syncTier: cleanTier
      })
    }
  }

  leaveJam(silent = false) {
    this.stopLoops()
    if (this.state.active) {
      if (this.state.role === 'host') {
        this.broadcastFromHost({ type: 'JAM_ENDED' }, { useCloud: true })
      } else if (this.state.role === 'guest') {
        this.sendToHost(
          { type: 'JAM_LEAVE', senderId: this.getSelfParticipantId() },
          { useCloud: true }
        )
      }
    }

    for (const conn of this.connections.values()) {
      try {
        conn.close()
      } catch {}
    }
    this.connections.clear()

    if (this.hostConn) {
      try {
        this.hostConn.close()
      } catch {}
      this.hostConn = null
    }

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch {}
      this.peer = null
    }

    this.teardownRoomTransports()

    this.clockSamples = []
    this.updateState({
      active: false,
      isHost: false,
      role: null,
      roomCode: '',
      status: 'IDLE',
      error: null,
      participants: [],
      hostName: '',
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'LOCKED'
    })

    this.broadcastPresenceStatus()

    if (!silent && this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify('Left Jam session', 'info')
    }
  }
}

export const jamManager = new JamSessionManager()
