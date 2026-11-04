import { Peer } from 'peerjs'

const JAM_USER_STORAGE_KEY = 'upbeat_jam_profile_v1'
const JAM_PEER_PREFIX = 'upbeat-jam-v64-'

export const JAM_AVATARS = ['🎧', '🎸', '🎹', '🎷', '🥁', '🎤', '🎻', '⚡']

export const JAM_REACTIONS = [
  { emoji: '🔥', label: 'Fire' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '⚡', label: 'Vibe' },
  { emoji: '💃', label: 'Dance' },
  { emoji: '✨', label: 'Magic' },
  { emoji: '🚀', label: 'Hype' }
]

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
]

function generateShortPin() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let pin = ''
  for (let i = 0; i < 4; i++) {
    pin += chars[Math.floor(Math.random() * chars.length)]
  }
  return `JAM-${pin}`
}

export function normalizeRoomCode(raw) {
  if (!raw) return ''
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const stripped = cleaned.startsWith('JAM') ? cleaned.slice(3) : cleaned
  if (!stripped) return ''
  return `JAM-${stripped.slice(0, 6)}`
}

function getPeerIdFromCode(roomCode) {
  const norm = normalizeRoomCode(roomCode)
  const suffix = norm.replace('JAM-', '').toLowerCase()
  return `${JAM_PEER_PREFIX}${suffix}`
}

export function loadJamUserProfile(googleUser = null) {
  try {
    const saved = localStorage.getItem(JAM_USER_STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : {}
    const id = parsed.id || `usr_${Math.random().toString(36).slice(2, 10)}`
    const name = googleUser?.name || parsed.name || `Listener ${id.slice(-3).toUpperCase()}`
    const avatar = parsed.avatar || JAM_AVATARS[Math.floor(Math.random() * JAM_AVATARS.length)]
    const picture = googleUser?.picture || parsed.picture || ''
    const profile = { id, name, avatar, picture }
    localStorage.setItem(JAM_USER_STORAGE_KEY, JSON.stringify(profile))
    return profile
  } catch {
    return {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      name: googleUser?.name || 'Music Lover',
      avatar: '🎧',
      picture: googleUser?.picture || ''
    }
  }
}

export function saveJamUserProfile(updates) {
  const current = loadJamUserProfile()
  const updated = { ...current, ...updates }
  try {
    localStorage.setItem(JAM_USER_STORAGE_KEY, JSON.stringify(updated))
  } catch {}
  return updated
}

/**
 * Compute 3-tier acoustic drift correction between Guest local audio and Host target clock
 */
export function evaluateAudioDrift(localCurrentTime, hostCurrentTime, hostTimestamp, clockOffsetMs, isPlaying) {
  const now = Date.now()
  // Host clock estimation at current moment: now - clockOffsetMs
  // Wait: if guest clock + offset = host clock, then estimatedHostNow = now + clockOffsetMs
  const estimatedHostNow = now + (clockOffsetMs || 0)
  const elapsedSec = isPlaying && hostTimestamp
    ? Math.max(0, Math.min(15, (estimatedHostNow - hostTimestamp) / 1000))
    : 0

  const targetTime = Math.max(0, (Number(hostCurrentTime) || 0) + elapsedSec)
  const driftSec = targetTime - (Number(localCurrentTime) || 0)
  const absDriftMs = Math.round(Math.abs(driftSec) * 1000)

  // Tier 1: < 150ms -> Imperceptible to human ear, keep normal speed
  if (absDriftMs < 150) {
    return {
      action: 'NONE',
      targetTime,
      driftMs: Math.round(driftSec * 1000),
      absDriftMs,
      playbackRate: 1.0,
      syncTier: 'IN_SYNC'
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
    this.bc = null // Same-browser BroadcastChannel fast bridge
    this.syncInterval = null
    this.pingInterval = null
    this.clockSamples = []

    this.state = {
      active: false,
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
      syncTier: 'IN_SYNC'
    }

    this.listeners = new Set()
    this.eventHandlers = {
      onRemoteSync: null,
      onRemoteControl: null,
      onRemoteQueueAdd: null,
      onReaction: null,
      onNotify: null,
      getHostPlaybackSnapshot: null
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
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) {
      try {
        fn(this.state)
      } catch {}
    }
  }

  /**
   * Setup same-device BroadcastChannel so multi-tab testing and local windows sync in < 2ms
   */
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

  /**
   * Start a new Jam session as Host
   */
  async createJam(googleUser = null, initialDjMode = 'open_party') {
    this.leaveJam(true)
    this.userProfile = loadJamUserProfile(googleUser)
    const roomCode = generateShortPin()
    const peerId = getPeerIdFromCode(roomCode)

    const hostParticipant = {
      id: this.userProfile.id,
      name: this.userProfile.name,
      avatar: this.userProfile.avatar,
      picture: this.userProfile.picture,
      isHost: true,
      rttMs: 0,
      inSync: true,
      joinedAt: Date.now()
    }

    this.updateState({
      active: true,
      role: 'host',
      roomCode,
      status: 'CONNECTING',
      error: null,
      djMode: initialDjMode,
      participants: [hostParticipant],
      hostName: this.userProfile.name,
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'IN_SYNC'
    })

    this.setupBroadcastChannel(roomCode)

    try {
      const peer = new Peer(peerId, {
        config: { iceServers: ICE_SERVERS },
        debug: 0
      })
      this.peer = peer

      peer.on('open', () => {
        this.updateState({ status: 'CONNECTED', error: null })
        this.startHostLoops()
        if (this.eventHandlers.onNotify) {
          this.eventHandlers.onNotify(`Jam started! Share code ${roomCode} with friends`, 'success')
        }
      })

      peer.on('connection', (conn) => {
        this.setupHostPeerConnection(conn)
      })

      peer.on('error', (err) => {
        console.warn('PeerJS Host notice:', err?.type || err)
        if (err?.type === 'unavailable-id') {
          // Retry with a new PIN if collision
          this.createJam(googleUser, initialDjMode)
          return
        }
        // Keep session active via BroadcastChannel fallback even if signaling server hiccups
        if (this.state.status === 'CONNECTING') {
          this.updateState({ status: 'CONNECTED' })
          this.startHostLoops()
        }
      })
    } catch (e) {
      console.warn('Peer init fallback:', e)
      this.updateState({ status: 'CONNECTED' })
      this.startHostLoops()
    }

    return roomCode
  }

  setupHostPeerConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn)
      // Immediately send current state and participants
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

  /**
   * Join an existing Jam session as Guest
   */
  async joinJam(rawCode, googleUser = null) {
    const roomCode = normalizeRoomCode(rawCode)
    if (!roomCode || roomCode.length < 6) {
      this.updateState({ error: 'Please enter a valid 4-character Jam code (e.g. JAM-4829)' })
      return false
    }

    this.leaveJam(true)
    this.userProfile = loadJamUserProfile(googleUser)
    const hostPeerId = getPeerIdFromCode(roomCode)

    const selfParticipant = {
      id: this.userProfile.id,
      name: this.userProfile.name,
      avatar: this.userProfile.avatar,
      picture: this.userProfile.picture,
      isHost: false,
      rttMs: 22,
      inSync: true,
      joinedAt: Date.now()
    }

    this.updateState({
      active: true,
      role: 'guest',
      roomCode,
      status: 'CONNECTING',
      error: null,
      participants: [selfParticipant],
      clockOffsetMs: 0,
      rttMs: 22,
      syncDeltaMs: 0,
      syncTier: 'IN_SYNC'
    })

    this.setupBroadcastChannel(roomCode)

    // Announce over BroadcastChannel immediately (for local/same-browser tabs)
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
        console.warn('PeerJS Guest error:', err?.type || err)
        if (err?.type === 'peer-unavailable') {
          // If BroadcastChannel already connected us locally, ignore peer-unavailable
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
    this.pingInterval = setInterval(sendPing, 8000)
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

  /**
   * Send packet from Host to all connected Guests
   */
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

  /**
   * Send packet from Guest to Host
   */
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

  /**
   * Host broadcasts immediate playback snapshot
   */
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

  broadcastParticipants() {
    if (this.state.role !== 'host') return
    this.broadcastFromHost({
      type: 'JAM_PARTICIPANTS',
      participants: this.state.participants,
      djMode: this.state.djMode,
      hostName: this.userProfile?.name || 'Host'
    })
  }

  /**
   * Handle incoming packets on both Host and Guest
   */
  handleIncomingPacket(data, conn) {
    if (!data || typeof data !== 'object') return

    switch (data.type) {
      case 'JAM_HELLO': {
        if (this.state.role === 'host' && data.profile) {
          if (conn) conn._guestProfileId = data.profile.id
          const exists = this.state.participants.some((p) => p.id === data.profile.id)
          const updated = exists
            ? this.state.participants.map((p) => (p.id === data.profile.id ? { ...p, ...data.profile } : p))
            : [...this.state.participants, { ...data.profile, isHost: false, inSync: true }]
          this.updateState({ participants: updated })
          this.broadcastParticipants()
          this.broadcastSyncNow()
          if (!exists && this.eventHandlers.onNotify) {
            this.eventHandlers.onNotify(`🎧 ${data.profile.name} joined your Jam!`, 'success')
          }
        }
        break
      }

      case 'JAM_PARTICIPANTS': {
        if (this.state.role === 'guest' && Array.isArray(data.participants)) {
          this.updateState({
            status: 'CONNECTED',
            error: null,
            participants: data.participants,
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
        // If Host receives control from Guest in Open Party mode, apply & rebroadcast to all guests
        if (this.state.role === 'host') {
          if (this.state.djMode === 'open_party') {
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
        if (this.state.role === 'host') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, data.addedBy)
          }
          this.broadcastFromHost(data)
          setTimeout(() => this.broadcastSyncNow(), 150)
        } else if (this.state.role === 'guest') {
          if (this.eventHandlers.onRemoteQueueAdd) {
            this.eventHandlers.onRemoteQueueAdd(data.track, data.addedBy)
          }
        }
        break
      }

      case 'JAM_REACTION': {
        if (this.state.role === 'host') {
          // Relay guest reaction to everyone else
          this.broadcastFromHost(data)
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
              data.djMode === 'open_party'
                ? '🎉 Host enabled Open Party Mode — anyone can DJ!'
                : '🔒 Host switched to Host-Only Broadcast Mode',
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

  /**
   * Dispatch a playback action (PLAY, PAUSE, SEEK, SELECT_TRACK, NEXT, PREV)
   */
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

  /**
   * Add a song to the shared Jam queue
   */
  emitQueueAdd(track) {
    if (!this.state.active || !track) return
    const packet = {
      type: 'JAM_QUEUE_ADD',
      track,
      addedBy: {
        id: this.userProfile?.id,
        name: this.userProfile?.name || 'Friend',
        avatar: this.userProfile?.avatar || '🎧'
      }
    }
    if (this.state.role === 'host') {
      this.broadcastFromHost(packet)
      setTimeout(() => this.broadcastSyncNow(), 100)
    } else {
      this.sendToHost(packet)
    }
  }

  /**
   * Send a live floating emoji reaction to everyone in the Jam
   */
  sendReaction(emoji) {
    if (!this.state.active || !emoji) return
    const packet = {
      type: 'JAM_REACTION',
      id: `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      emoji,
      senderId: this.userProfile?.id,
      senderName: this.userProfile?.name || 'You',
      senderAvatar: this.userProfile?.avatar || '🎧'
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

  /**
   * Toggle DJ Permission Mode (Host only)
   */
  setDjMode(mode) {
    if (this.state.role !== 'host') return
    const cleanMode = mode === 'host_only' ? 'host_only' : 'open_party'
    this.updateState({ djMode: cleanMode })
    this.broadcastFromHost({
      type: 'JAM_DJ_MODE',
      djMode: cleanMode
    })
  }

  /**
   * Update sync telemetry displayed in UI
   */
  reportDriftStatus(driftMs, syncTier) {
    if (Math.abs(driftMs - this.state.syncDeltaMs) > 25 || syncTier !== this.state.syncTier) {
      this.updateState({
        syncDeltaMs: driftMs,
        syncTier
      })
    }
  }

  /**
   * Leave or end the active Jam session
   */
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
      role: null,
      roomCode: '',
      status: 'IDLE',
      error: null,
      participants: [],
      hostName: '',
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'IN_SYNC'
    })

    if (!silent && this.eventHandlers.onNotify) {
      this.eventHandlers.onNotify('Left Jam session', 'info')
    }
  }
}

export const jamManager = new JamSessionManager()
