import { Peer } from 'peerjs'

const JAM_USER_STORAGE_KEY = 'upbeat_jam_profile_v1'
const LEGACY_PROFILE_KEYS = ['upbeat_jam_profile_v1', 'upbeat_jam_profile', 'upbeat_user_profile']
const FRIENDS_LIST_STORAGE_KEY = 'upbeat_friends_list'
const FRIEND_REQ_IN_STORAGE_KEY = 'upbeat_friend_requests_in'
const FRIEND_REQ_OUT_STORAGE_KEY = 'upbeat_friend_requests_out'

const JAM_PEER_PREFIX = 'upbeat-jam-v70-'
const PRESENCE_PEER_PREFIX = 'upbeat-user-'

export const renderEmoji = (val, fallback = '🎧') => {
  if (!val) return fallback
  if (typeof val === 'string') return val
  if (typeof val === 'object' && typeof val.emoji === 'string') return val.emoji
  return fallback
}

export const JAM_AVATARS = ['🎧', '🎸', '🎹', '🎷', '🥁', '🎤', '🎻', '⚡']

export const JAM_REACTIONS = ['🔥', '❤️', '🙌', '⚡', '🥹', '🕺', '🚀', '✨']

export const JAM_REACTION_PRESETS = [
  { emoji: '🔥', label: 'Fire' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '🙌', label: 'Hands' },
  { emoji: '⚡', label: 'Vibe' },
  { emoji: '🥹', label: 'Feels' },
  { emoji: '🕺', label: 'Dance' },
  { emoji: '🚀', label: 'Hype' },
  { emoji: '✨', label: 'Magic' }
]

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
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

export function normalizeRoomCode(raw) {
  if (!raw) return ''
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const stripped = cleaned.startsWith('JAM') ? cleaned.slice(3) : cleaned
  if (!stripped) return ''
  return `JAM-${stripped.slice(0, 6)}`
}

export function normalizeFriendCode(raw) {
  if (!raw) return ''
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const stripped = cleaned.startsWith('UP') ? cleaned.slice(2) : cleaned
  if (!stripped) return ''
  return `UP-${stripped.slice(0, 6)}`
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

/**
 * Boot sanitizer: Ensure any stored avatar or reaction in localStorage is a plain string emoji,
 * preventing React Error #31 ({emoji, label} object rendered as child).
 */
export function sanitizeStoredJamAndSocialData() {
  if (typeof window === 'undefined' || !window.localStorage) return

  for (const key of LEGACY_PROFILE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const cleanAvatar = renderEmoji(parsed.avatar, '🎧')
        const cleanFriendCode = normalizeFriendCode(parsed.friendCode) || generateFriendCode()
        const updated = {
          ...parsed,
          avatar: cleanAvatar,
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
            avatar: renderEmoji(item.avatar, '🎧'),
            name: String(item.name || 'Friend')
          }))
          .filter((item) => Boolean(item.friendCode))
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
    const friendCode = normalizeFriendCode(parsed.friendCode) || generateFriendCode()
    const name = googleUser?.name || parsed.name || `Listener ${friendCode.slice(-3)}`
    const avatar = renderEmoji(parsed.avatar, JAM_AVATARS[0])
    const picture = googleUser?.picture || parsed.picture || ''
    const profile = { id, friendCode, name, avatar, picture }
    localStorage.setItem(JAM_USER_STORAGE_KEY, JSON.stringify(profile))
    return profile
  } catch {
    return {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      friendCode: generateFriendCode(),
      name: googleUser?.name || 'Music Lover',
      avatar: '🎧',
      picture: googleUser?.picture || ''
    }
  }
}

export function saveJamUserProfile(updates) {
  const current = loadJamUserProfile()
  const updated = {
    ...current,
    ...updates,
    avatar: renderEmoji(updates?.avatar ?? current.avatar, '🎧'),
    friendCode: normalizeFriendCode(updates?.friendCode || current.friendCode) || current.friendCode
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

/**
 * Compute 3-tier acoustic drift correction between Guest local audio and Host target clock
 */
export function evaluateAudioDrift(localCurrentTime, hostCurrentTime, hostTimestamp, clockOffsetMs, isPlaying) {
  const now = Date.now()
  const estimatedHostNow = now + (clockOffsetMs || 0)
  const elapsedSec = isPlaying && hostTimestamp
    ? Math.max(0, Math.min(15, (estimatedHostNow - hostTimestamp) / 1000))
    : 0

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

  // Tier 2: 150ms - 850ms while playing -> Smooth micro-speed ramping (no clicks or pops)
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

  // Tier 3: >= 850ms or paused out of alignment -> Hard seek
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
    this.peer = null
    this.connections = new Map() // peerId -> DataConnection (used by Host)
    this.hostConn = null // DataConnection to Host (used by Guest)
    this.bc = null // Same-browser BroadcastChannel fast bridge for Jam room

    // Always-on Friends Presence P2P & BroadcastChannel
    this.presencePeer = null
    this.presenceConns = new Map() // friendCode -> DataConnection
    this.socialBc = null
    this.presenceTimer = null

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

      // Friends & Presence State (v7.0)
      userProfile: this.userProfile,
      friends: loadJsonArray(FRIENDS_LIST_STORAGE_KEY).map((f) => ({
        ...f,
        avatar: renderEmoji(f.avatar, '🎧'),
        online: false
      })),
      incomingRequests: loadJsonArray(FRIEND_REQ_IN_STORAGE_KEY).map((r) => ({
        ...r,
        avatar: renderEmoji(r.avatar, '🎧')
      })),
      outgoingRequests: loadJsonArray(FRIEND_REQ_OUT_STORAGE_KEY).map((r) => ({
        ...r,
        avatar: renderEmoji(r.avatar, '🎧')
      })),
      incomingJamInvite: null,
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
      setTimeout(() => this.initPresenceNetwork(), 350)
    }
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
    this.userProfile = saveJamUserProfile(updates)
    this.updateState({ userProfile: this.userProfile })
    if (this.state.active) {
      const updatedParticipants = this.state.participants.map((p) =>
        p.id === this.userProfile.id
          ? { ...p, name: this.userProfile.name, avatar: renderEmoji(this.userProfile.avatar, '🎧') }
          : p
      )
      this.updateState({ participants: updatedParticipants })
      if (this.state.isHost) {
        this.broadcastParticipants()
      } else {
        this.sendToHost({
          type: 'JAM_HELLO',
          profile: {
            id: this.userProfile.id,
            friendCode: this.userProfile.friendCode,
            name: this.userProfile.name,
            avatar: renderEmoji(this.userProfile.avatar, '🎧'),
            picture: this.userProfile.picture,
            isHost: false,
            inSync: true
          }
        })
      }
    }
    this.broadcastPresenceStatus()
    return this.userProfile
  }

  // ============================================================================
  // PILLAR 3: REAL-TIME FRIENDS & ALWAYS-ON PRESENCE NETWORK (UP-XXXXXX)
  // ============================================================================

  initPresenceNetwork() {
    this.userProfile = loadJamUserProfile()
    const myFriendCode = this.userProfile.friendCode

    // 1. Same-device / local tab BroadcastChannel social mesh
    if (typeof BroadcastChannel !== 'undefined' && !this.socialBc) {
      try {
        this.socialBc = new BroadcastChannel('upbeat_social_v7')
        this.socialBc.onmessage = (ev) => {
          const data = ev?.data
          if (!data || data._fromFriendCode === myFriendCode) return
          if (!data.targetFriendCode || data.targetFriendCode === myFriendCode) {
            this.handleSocialPacket(data, null)
          }
        }
      } catch {}
    }

    // 2. Deterministic PeerJS Presence Endpoint (upbeat-user-UP-XXXXXX)
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

        pPeer.on('error', () => {
          // Even if PeerJS ID is already open in another tab, BroadcastChannel still works
          this.updateState({ presenceReady: true })
        })
      } catch {}
    }

    if (this.presenceTimer) clearInterval(this.presenceTimer)
    this.presenceTimer = setInterval(() => {
      this.pingAllFriends()
      this.pruneStaleFriendPresence()
    }, 15000)

    setTimeout(() => {
      this.pingAllFriends()
      this.retryOutgoingRequests()
    }, 1000)
  }

  setupPresenceConn(conn, knownFriendCode = null) {
    conn.on('open', () => {
      if (knownFriendCode) {
        this.presenceConns.set(knownFriendCode, conn)
      }
      try {
        conn.send(this.buildPresencePayload('PRESENCE_PING'))
      } catch {}
    })

    conn.on('data', (data) => {
      if (data?._fromFriendCode) {
        this.presenceConns.set(data._fromFriendCode, conn)
      }
      this.handleSocialPacket(data, conn)
    })

    const cleanup = () => {
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
    return {
      id: this.userProfile.id,
      friendCode: this.userProfile.friendCode,
      name: this.userProfile.name,
      avatar: renderEmoji(this.userProfile.avatar, '🎧'),
      picture: this.userProfile.picture || '',
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
      ...extra
    }
  }

  sendSocialPacket(targetFriendCode, packet) {
    const cleanTarget = normalizeFriendCode(targetFriendCode)
    if (!cleanTarget || cleanTarget === this.userProfile.friendCode) return

    const fullPacket = {
      ...packet,
      targetFriendCode: cleanTarget,
      _fromFriendCode: this.userProfile.friendCode
    }

    // 1. Send via BroadcastChannel (instant same-device delivery)
    if (this.socialBc) {
      try {
        this.socialBc.postMessage(fullPacket)
      } catch {}
    }

    // 2. Send via active PeerJS connection or open a new one
    const existing = this.presenceConns.get(cleanTarget)
    if (existing && existing.open) {
      try {
        existing.send(fullPacket)
        return
      } catch {}
    }

    if (this.presencePeer && !this.presencePeer.destroyed) {
      try {
        const targetPeerId = getPresencePeerId(cleanTarget)
        const conn = this.presencePeer.connect(targetPeerId, { reliable: true })
        this.setupPresenceConn(conn, cleanTarget)
        conn.on('open', () => {
          try {
            conn.send(fullPacket)
          } catch {}
        })
      } catch {}
    }
  }

  pingAllFriends() {
    const friends = this.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.sendSocialPacket(f.friendCode, this.buildPresencePayload('PRESENCE_PING'))
      }
    }
  }

  retryOutgoingRequests() {
    const outgoing = this.state.outgoingRequests || []
    for (const req of outgoing) {
      if (req.friendCode) {
        this.sendSocialPacket(req.friendCode, this.buildPresencePayload('FRIEND_REQUEST'))
      }
    }
  }

  broadcastPresenceStatus() {
    const friends = this.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.sendSocialPacket(f.friendCode, this.buildPresencePayload('PRESENCE_STATUS'))
      }
    }
  }

  pruneStaleFriendPresence() {
    const now = Date.now()
    let changed = false
    const nextFriends = (this.state.friends || []).map((f) => {
      if (f.online && f.lastSeen && now - f.lastSeen > 42000) {
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

  handleSocialPacket(data, conn) {
    if (!data || typeof data !== 'object' || !data.from) return
    const sender = {
      ...data.from,
      friendCode: normalizeFriendCode(data.from.friendCode),
      avatar: renderEmoji(data.from.avatar, '🎧')
    }
    if (!sender.friendCode) return

    switch (data.type) {
      case 'PRESENCE_PING': {
        this.updateFriendPresence(sender)
        const reply = this.buildPresencePayload('PRESENCE_PONG', {
          targetFriendCode: sender.friendCode
        })
        if (conn && conn.open) {
          try { conn.send(reply) } catch {}
        } else {
          this.sendSocialPacket(sender.friendCode, reply)
        }
        break
      }

      case 'PRESENCE_PONG':
      case 'PRESENCE_STATUS': {
        this.updateFriendPresence(sender)
        break
      }

      case 'FRIEND_REQUEST': {
        // Check if already friends
        const alreadyFriend = this.state.friends.some((f) => f.friendCode === sender.friendCode)
        if (alreadyFriend) {
          this.updateFriendPresence(sender)
          this.sendSocialPacket(sender.friendCode, this.buildPresencePayload('FRIEND_ACCEPTED'))
          return
        }

        // Check if we also have an outgoing request to them (Mutual Request Handshake!)
        const isOutgoingMatch = this.state.outgoingRequests.some(
          (r) => r.friendCode === sender.friendCode
        )
        if (isOutgoingMatch) {
          this.promoteToConfirmedFriend(sender)
          this.sendSocialPacket(sender.friendCode, this.buildPresencePayload('FRIEND_ACCEPTED'))
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(
              `🎉 You and ${sender.name} (${sender.friendCode}) are now friends!`,
              'success'
            )
          }
          return
        }

        // Otherwise add to incomingRequests if not already present
        const existsIn = this.state.incomingRequests.some((r) => r.friendCode === sender.friendCode)
        if (!existsIn) {
          const nextIn = [
            {
              friendCode: sender.friendCode,
              name: sender.name,
              avatar: sender.avatar,
              picture: sender.picture || '',
              currentTrack: sender.currentTrack || null,
              requestedAt: Date.now()
            },
            ...this.state.incomingRequests
          ]
          saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
          this.updateState({ incomingRequests: nextIn })
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(
              `${sender.avatar} ${sender.name} sent you a Friend Request!`,
              'info'
            )
          }
        }
        break
      }

      case 'FRIEND_ACCEPTED': {
        this.promoteToConfirmedFriend(sender)
        if (this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(
            `${sender.avatar} ${sender.name} accepted your friend request!`,
            'success'
          )
        }
        break
      }

      case 'JAM_INVITE': {
        const invite = {
          id: `inv_${Date.now()}`,
          roomCode: normalizeRoomCode(data.roomCode),
          hostName: sender.name || data.hostName || 'Friend',
          hostAvatar: renderEmoji(sender.avatar || data.hostAvatar, '🎧'),
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
            `🎧 ${invite.hostName} invited you to a Live Jam (${invite.roomCode})!`,
            'info'
          )
        }
        break
      }

      default:
        break
    }
  }

  updateFriendPresence(sender) {
    const idx = this.state.friends.findIndex((f) => f.friendCode === sender.friendCode)
    if (idx === -1) return
    const updatedFriend = {
      ...this.state.friends[idx],
      name: sender.name || this.state.friends[idx].name,
      avatar: renderEmoji(sender.avatar || this.state.friends[idx].avatar, '🎧'),
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

    const exists = this.state.friends.some((f) => f.friendCode === cleanCode)
    const friendEntry = {
      friendCode: cleanCode,
      name: sender.name || `Friend ${cleanCode.slice(-4)}`,
      avatar: renderEmoji(sender.avatar, '🎧'),
      picture: sender.picture || '',
      online: true,
      lastSeen: Date.now(),
      currentTrack: sender.currentTrack || null,
      isPlaying: Boolean(sender.isPlaying),
      activeJamCode: sender.activeJamCode || ''
    }

    const nextFriends = exists
      ? this.state.friends.map((f) => (f.friendCode === cleanCode ? { ...f, ...friendEntry } : f))
      : [friendEntry, ...this.state.friends]

    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.updateState({
      friends: nextFriends,
      incomingRequests: nextIn,
      outgoingRequests: nextOut
    })
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
        this.eventHandlers.onNotify("That's your own Friend Code!", 'warning')
      }
      return { ok: false, error: "That's your own Friend Code!" }
    }

    if (this.state.friends.some((f) => f.friendCode === targetCode)) {
      if (this.eventHandlers.onNotify) {
        this.eventHandlers.onNotify('Already in your Friends list!', 'info')
      }
      return { ok: true, status: 'already_friends' }
    }

    // If they already sent us an incoming request, accept immediately!
    const incomingMatch = this.state.incomingRequests.find((r) => r.friendCode === targetCode)
    if (incomingMatch) {
      this.acceptFriendRequest(targetCode)
      return { ok: true, status: 'accepted' }
    }

    if (!this.state.outgoingRequests.some((r) => r.friendCode === targetCode)) {
      const nextOut = [
        {
          friendCode: targetCode,
          name: `Friend ${targetCode.slice(-4)}`,
          avatar: '🎧',
          sentAt: Date.now()
        },
        ...this.state.outgoingRequests
      ]
      saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
      this.updateState({ outgoingRequests: nextOut })
    }

    this.sendSocialPacket(targetCode, this.buildPresencePayload('FRIEND_REQUEST'))
    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(`Friend request sent to ${targetCode}!`, 'success')
    }
    return { ok: true, status: 'sent' }
  }

  acceptFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const req = this.state.incomingRequests.find((r) => r.friendCode === cleanCode) || {
      friendCode: cleanCode,
      name: `Friend ${cleanCode.slice(-4)}`,
      avatar: '🎧'
    }
    this.promoteToConfirmedFriend(req)
    this.sendSocialPacket(cleanCode, this.buildPresencePayload('FRIEND_ACCEPTED'))
    this.sendSocialPacket(cleanCode, this.buildPresencePayload('PRESENCE_PING'))
    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(`Added ${req.name} to your Friends!`, 'success')
    }
  }

  declineFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextIn = this.state.incomingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    this.updateState({ incomingRequests: nextIn })
  }

  cancelOutgoingRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextOut = this.state.outgoingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
    this.updateState({ outgoingRequests: nextOut })
  }

  removeFriend(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextFriends = this.state.friends.filter((f) => f.friendCode !== cleanCode)
    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.updateState({ friends: nextFriends })
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
        hostAvatar: renderEmoji(this.userProfile.avatar, '🎧'),
        currentTrack: snap?.track || null
      })
    )

    const friend = this.state.friends.find((f) => f.friendCode === cleanCode)
    if (this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify(
        `Sent Live Jam invite (${roomCode}) to ${friend?.name || cleanCode}!`,
        'success'
      )
    }
    return roomCode
  }

  dismissJamInvite() {
    this.updateState({ incomingJamInvite: null })
  }

  // ============================================================================
  // LIVE JAM ROOM P2P ENGINE
  // ============================================================================

  setupBroadcastChannel(roomCode) {
    if (this.bc) {
      try { this.bc.close() } catch {}
      this.bc = null
    }
    if (typeof BroadcastChannel !== 'undefined' && roomCode) {
      try {
        this.bc = new BroadcastChannel(`upbeat_jam_${roomCode}`)
        this.bc.onmessage = (ev) => {
          if (ev?.data && ev.data._senderProfileId !== this.userProfile?.id) {
            this.handleIncomingPacket(ev.data, null)
          }
        }
      } catch {}
    }
  }

  async createJam(googleUser = null, initialDjMode = 'open_party') {
    this.leaveJam(true)
    this.userProfile = loadJamUserProfile(googleUser)
    const roomCode = generateShortPin()
    const peerId = getPeerIdFromCode(roomCode)
    const normDj = initialDjMode === 'host_only' ? 'host_only' : 'open_party'

    const hostParticipant = {
      id: this.userProfile.id,
      peerId: this.userProfile.id,
      friendCode: this.userProfile.friendCode,
      name: this.userProfile.name,
      avatar: renderEmoji(this.userProfile.avatar, '🎧'),
      picture: this.userProfile.picture,
      isHost: true,
      rttMs: 0,
      inSync: true,
      joinedAt: Date.now()
    }

    this.updateState({
      active: true,
      isHost: true,
      role: 'host',
      roomCode,
      status: 'CONNECTING',
      error: null,
      djMode: normDj,
      participants: [hostParticipant],
      hostName: this.userProfile.name,
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'LOCKED'
    })

    this.setupBroadcastChannel(roomCode)
    this.broadcastPresenceStatus()

    try {
      const peer = new Peer(peerId, {
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.peer = peer

      peer.on('open', () => {
        this.updateState({ status: 'CONNECTED', error: null })
        this.startHostLoops()
        this.broadcastPresenceStatus()
        if (this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`Jam started! Room code: ${roomCode}`, 'success')
        }
      })

      peer.on('connection', (conn) => {
        this.setupHostPeerConnection(conn)
      })

      peer.on('error', (err) => {
        if (err?.type === 'unavailable-id') {
          this.createJam(googleUser, normDj)
          return
        }
        if (this.state.status === 'CONNECTING') {
          this.updateState({ status: 'CONNECTED' })
          this.startHostLoops()
        }
      })
    } catch {
      this.updateState({ status: 'CONNECTED' })
      this.startHostLoops()
    }

    return roomCode
  }

  setupHostPeerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
      this.broadcastSyncNow()
      this.broadcastParticipants()
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

    const selfParticipant = {
      id: this.userProfile.id,
      peerId: this.userProfile.id,
      friendCode: this.userProfile.friendCode,
      name: this.userProfile.name,
      avatar: renderEmoji(this.userProfile.avatar, '🎧'),
      picture: this.userProfile.picture,
      isHost: false,
      rttMs: 18,
      inSync: true,
      joinedAt: Date.now()
    }

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

    this.setupBroadcastChannel(roomCode)

    // Announce immediately over BroadcastChannel for instant local/multi-tab join
    this.sendToHost({
      type: 'JAM_HELLO',
      profile: selfParticipant
    })

    try {
      const peer = new Peer({
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.peer = peer

      peer.on('open', () => {
        const conn = peer.connect(hostPeerId, { reliable: true })
        this.hostConn = conn

        const connectTimeout = setTimeout(() => {
          if (this.state.status === 'CONNECTING' && this.state.participants.length <= 1) {
            this.updateState({
              status: 'ERROR',
              error: `Could not find active room ${roomCode}. Check the code and ensure Host is online.`
            })
          }
        }, 9000)

        conn.on('open', () => {
          clearTimeout(connectTimeout)
          this.updateState({ status: 'CONNECTED', error: null })
          this.sendToHost({
            type: 'JAM_HELLO',
            profile: selfParticipant
          })
          this.startGuestPingLoop()
          this.broadcastPresenceStatus()
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`Joined Jam ${roomCode}! Syncing audio...`, 'success')
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
          if (this.state.active && this.state.role === 'guest') {
            if (this.eventHandlers.onNotify) {
              this.eventHandlers.onNotify('Host ended the Jam session', 'info')
            }
            this.leaveJam(true)
          }
        })
      })

      peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') {
          if (this.state.participants.length > 1) return
          this.updateState({
            status: 'ERROR',
            error: `Room ${roomCode} not found or Host went offline.`
          })
        }
      })
    } catch (e) {
      this.updateState({
        status: 'ERROR',
        error: e.message || 'Failed to initialize WebRTC connection'
      })
    }

    return true
  }

  startHostLoops() {
    this.stopLoops()
    this.syncInterval = setInterval(() => {
      this.broadcastSyncNow()
    }, 2000)
  }

  startGuestPingLoop() {
    this.stopLoops()
    const sendPing = () => {
      this.sendToHost({
        type: 'JAM_PING',
        t1: Date.now(),
        senderId: this.userProfile?.id
      })
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

  broadcastFromHost(packet) {
    if (!this.state.active || this.state.role !== 'host') return
    const payload = { ...packet, _senderProfileId: this.userProfile?.id }
    for (const conn of this.connections.values()) {
      try {
        if (conn.open) conn.send(payload)
      } catch {}
    }
    if (this.bc) {
      try { this.bc.postMessage(payload) } catch {}
    }
  }

  sendToHost(packet) {
    if (!this.state.active) return
    const payload = { ...packet, _senderProfileId: this.userProfile?.id }
    if (this.hostConn && this.hostConn.open) {
      try { this.hostConn.send(payload) } catch {}
    }
    if (this.bc) {
      try { this.bc.postMessage(payload) } catch {}
    }
  }

  broadcastSyncNow(overridePatch = null) {
    if (!this.state.active || this.state.role !== 'host') return
    const snapshot = this.eventHandlers.getHostPlaybackSnapshot
      ? this.eventHandlers.getHostPlaybackSnapshot()
      : null
    if (!snapshot && !overridePatch) return

    const merged = { ...(snapshot || {}), ...(overridePatch || {}) }
    if (!merged.track) return

    this.broadcastFromHost({
      type: 'JAM_SYNC',
      roomCode: this.state.roomCode,
      track: merged.track,
      isPlaying: Boolean(merged.isPlaying),
      currentTime: Number(merged.currentTime) || 0,
      hostTimestamp: Date.now(),
      queue: Array.isArray(merged.queue) ? merged.queue.slice(0, 30) : [],
      djMode: this.state.djMode,
      hostName: this.userProfile?.name || 'Host'
    })
  }

  // Alias used by App.jsx
  broadcastHostSync(overridePatch = null) {
    this.broadcastSyncNow(overridePatch)
    this.broadcastPresenceStatus()
  }

  broadcastParticipants() {
    if (this.state.role !== 'host') return
    const sanitizedParticipants = (this.state.participants || []).map((p) => ({
      ...p,
      peerId: p.peerId || p.id,
      avatar: renderEmoji(p.avatar, '🎧')
    }))
    this.broadcastFromHost({
      type: 'JAM_PARTICIPANTS',
      participants: sanitizedParticipants,
      djMode: this.state.djMode,
      hostName: this.userProfile?.name || 'Host'
    })
  }

  handleIncomingPacket(data, conn) {
    if (!data || typeof data !== 'object') return

    switch (data.type) {
      case 'JAM_HELLO': {
        if (this.state.role === 'host' && data.profile) {
          const cleanProfile = {
            ...data.profile,
            peerId: data.profile.peerId || data.profile.id,
            avatar: renderEmoji(data.profile.avatar, '🎧')
          }
          if (conn) conn._guestProfileId = cleanProfile.id
          const exists = this.state.participants.some((p) => p.id === cleanProfile.id)
          const updated = exists
            ? this.state.participants.map((p) => (p.id === cleanProfile.id ? { ...p, ...cleanProfile } : p))
            : [...this.state.participants, { ...cleanProfile, isHost: false, inSync: true }]
          this.updateState({ status: 'CONNECTED', participants: updated })
          this.broadcastParticipants()
          this.broadcastSyncNow()
          if (!exists && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`${cleanProfile.avatar} ${cleanProfile.name} joined your Jam!`, 'success')
          }
        }
        break
      }

      case 'JAM_PARTICIPANTS': {
        if (this.state.role === 'guest' && Array.isArray(data.participants)) {
          const cleanList = data.participants.map((p) => ({
            ...p,
            peerId: p.peerId || p.id,
            avatar: renderEmoji(p.avatar, '🎧')
          }))
          this.updateState({
            status: 'CONNECTED',
            error: null,
            participants: cleanList,
            djMode: data.djMode || this.state.djMode,
            hostName: data.hostName || this.state.hostName
          })
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
            _senderProfileId: this.userProfile?.id
          }
          if (conn && conn.open) {
            try { conn.send(pong) } catch {}
          } else if (this.bc) {
            try { this.bc.postMessage(pong) } catch {}
          }
        }
        break
      }

      case 'JAM_PONG': {
        if (this.state.role === 'guest' && (!data.targetId || data.targetId === this.userProfile?.id)) {
          const t4 = Date.now()
          const rtt = Math.max(2, (t4 - data.t1) - (data.t3 - data.t2))
          const offset = Math.round(((data.t2 - data.t1) + (data.t3 - t4)) / 2)
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
          if (this.eventHandlers.onRemoteSync) {
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
            this.broadcastFromHost(data)
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
          avatar: renderEmoji(data.addedBy?.avatar, '🎧'),
          name: data.addedBy?.name || 'Friend'
        }
        if (this.state.role === 'host') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
          this.broadcastFromHost({ ...data, addedBy: cleanAddedBy })
          setTimeout(() => this.broadcastSyncNow(), 150)
        } else if (this.state.role === 'guest') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
        }
        break
      }

      case 'JAM_REACTION': {
        const cleanPacket = {
          ...data,
          emoji: renderEmoji(data.emoji, '🔥'),
          senderAvatar: renderEmoji(data.senderAvatar, '🎧'),
          senderName: data.senderName || 'Friend'
        }
        if (this.state.role === 'host') {
          this.broadcastFromHost(cleanPacket)
        }
        if (this.eventHandlers.onReaction) {
          this.eventHandlers.onReaction(cleanPacket)
        }
        break
      }

      case 'JAM_DJ_MODE': {
        if (this.state.role === 'guest') {
          this.updateState({ djMode: data.djMode })
          if (this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(
              data.djMode === 'host_only'
                ? '🔒 Host switched to Host-Only DJ Mode'
                : '🎉 Host enabled Open Party Mode — anyone can DJ!',
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
        this.eventHandlers.onNotify('🔒 Host-Only Mode is active. Ask the host to enable Open Party!', 'warning')
      }
      return false
    }

    const packet = {
      type: 'JAM_CONTROL',
      action,
      ...payload,
      senderId: this.userProfile?.id,
      senderName: this.userProfile?.name || 'Friend',
      timestamp: Date.now()
    }

    if (this.state.role === 'host') {
      this.broadcastFromHost(packet)
      setTimeout(() => this.broadcastSyncNow(), 80)
    } else {
      this.sendToHost(packet)
    }
    return true
  }

  // Alias used by App.jsx
  emitPlaybackControl(action, payload = {}) {
    return this.emitControl(action, payload)
  }

  emitQueueAdd(track) {
    if (!this.state.active || !track) return
    const packet = {
      type: 'JAM_QUEUE_ADD',
      track,
      addedBy: {
        id: this.userProfile?.id,
        name: this.userProfile?.name || 'Friend',
        avatar: renderEmoji(this.userProfile?.avatar, '🎧')
      }
    }
    if (this.state.role === 'host') {
      this.broadcastFromHost(packet)
      setTimeout(() => this.broadcastSyncNow(), 100)
    } else {
      this.sendToHost(packet)
    }
  }

  sendReaction(emojiInput) {
    if (!this.state.active) return
    const emojiStr = renderEmoji(emojiInput, '🔥')
    const packet = {
      type: 'JAM_REACTION',
      id: `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      emoji: emojiStr,
      senderId: this.userProfile?.id,
      senderName: this.userProfile?.name || 'You',
      senderAvatar: renderEmoji(this.userProfile?.avatar, '🎧')
    }
    if (this.state.role === 'host') {
      this.broadcastFromHost(packet)
    } else {
      this.sendToHost(packet)
    }
    if (this.eventHandlers.onReaction) {
      this.eventHandlers.onReaction(packet)
    }
  }

  setDjMode(mode) {
    if (this.state.role !== 'host') return
    const cleanMode = mode === 'host_only' ? 'host_only' : 'open_party'
    this.updateState({ djMode: cleanMode })
    this.broadcastFromHost({
      type: 'JAM_DJ_MODE',
      djMode: cleanMode
    })
  }

  reportDriftStatus(driftMs, syncTier) {
    const cleanTier = syncTier === 'IN_SYNC' ? 'LOCKED' : (syncTier || 'LOCKED')
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
        this.broadcastFromHost({ type: 'JAM_ENDED' })
      } else if (this.state.role === 'guest') {
        this.sendToHost({ type: 'JAM_LEAVE', senderId: this.userProfile?.id })
      }
    }

    for (const conn of this.connections.values()) {
      try { conn.close() } catch {}
    }
    this.connections.clear()

    if (this.hostConn) {
      try { this.hostConn.close() } catch {}
      this.hostConn = null
    }

    if (this.peer) {
      try { this.peer.destroy() } catch {}
      this.peer = null
    }

    if (this.bc) {
      try { this.bc.close() } catch {}
      this.bc = null
    }

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
