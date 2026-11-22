/**
 * Jam session lifecycle, Star-topology host packet routing, clock offset, and playback state sync.
 */
import { hasBackend } from "../services/platformConfig.js"
import {
  PEER_OPTIONS,
  generateShortPin,
  getPeerIdFromCode,
  loadJamUserProfile,
  makePacketId,
  normalizeRoomCode,
  sanitizePayloadForCloud
} from "./jamUtils.js"

export class RoomController {
  constructor(mgr) {
    this.mgr = mgr
  }

  async createJam(googleUser = null, initialDjMode = 'open_party') {
    this.mgr.leaveJam(true)
    this.mgr.userProfile = loadJamUserProfile(googleUser)
    const roomCode = generateShortPin()
    const peerId = getPeerIdFromCode(roomCode)
    const normDj = initialDjMode === 'host_only' ? 'host_only' : 'open_party'

    this.mgr.stateSeq = 0
    this.mgr.lastAppliedSeq = 0
    this.mgr.lastPlayStateTimestamp = 0

    const hostParticipant = this.mgr.buildSelfParticipant(true)

    this.mgr.updateState({
      active: true,
      isHost: true,
      role: 'host',
      roomCode,
      status: 'CONNECTED',
      error: null,
      djMode: normDj,
      participants: [hostParticipant],
      hostName: this.mgr.userProfile.name,
      clockOffsetMs: 0,
      rttMs: 0,
      syncDeltaMs: 0,
      syncTier: 'LOCKED'
    })

    this.mgr.setupRoomTransports(roomCode)
    this.mgr.startHostLoops()
    this.mgr.broadcastParticipants()
    this.mgr.broadcastSyncNow()
    this.mgr.broadcastPresenceStatus()

    if (this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify(`Jam session active: ${roomCode}`, 'success')
    }

    try {
      const peer = new this.mgr.PeerClass(peerId, PEER_OPTIONS)
      this.mgr.peer = peer

      peer.on('open', () => {
        this.mgr.updateState({ status: 'CONNECTED', error: null })
        this.mgr.broadcastParticipants()
        this.mgr.broadcastSyncNow()
      })

      peer.on('connection', (conn) => {
        this.mgr.setupHostPeerConnection(conn)
      })

      peer.on('disconnected', () => {
        try {
          if (!peer.destroyed) peer.reconnect()
        } catch {}
      })

      peer.on('error', (err) => {
        if (err?.type === 'unavailable-id') {
          this.mgr.createJam(googleUser, normDj)
        }
      })
    } catch {}

    return roomCode
  }


  async joinJam(rawCode, googleUser = null) {
    const roomCode = normalizeRoomCode(rawCode)
    if (!roomCode || roomCode.length < 6) {
      this.mgr.updateState({ error: 'Please enter a valid Jam code (e.g. JAM-4829)' })
      return false
    }

    this.mgr.leaveJam(true)
    this.mgr.userProfile = loadJamUserProfile(googleUser)
    const hostPeerId = getPeerIdFromCode(roomCode)

    this.mgr.stateSeq = 0
    this.mgr.lastAppliedSeq = 0
    this.mgr.lastPlayStateTimestamp = 0

    const selfParticipant = this.mgr.buildSelfParticipant(false)

    this.mgr.updateState({
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

    this.mgr.setupRoomTransports(roomCode)

    // Immediately announce over BroadcastChannel, Backend, and Cloud Relay
    this.mgr.sendToHost(
      {
        type: 'JAM_HELLO',
        profile: selfParticipant
      },
      { useCloud: true }
    )

    // Retry JAM_HELLO after 1.2s in case host was still initializing
    this.mgr.scheduleTimer(() => {
      if (this.mgr.state.active && this.mgr.state.role === 'guest') {
        this.mgr.sendToHost(
          {
            type: 'JAM_HELLO',
            profile: selfParticipant
          },
          { useCloud: true }
        )
      }
    }, 1200)

    this.mgr.startGuestPingLoop()

    try {
      const peer = new this.mgr.PeerClass(PEER_OPTIONS)
      this.mgr.peer = peer

      const connectTimeout = this.mgr.scheduleTimer(() => {
        if (
          this.mgr.state.active &&
          this.mgr.state.status === 'CONNECTING' &&
          this.mgr.state.participants.length <= 1
        ) {
          this.mgr.updateState({
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
        this.mgr.hostConn = conn

        conn.on('open', () => {
          this.mgr.clearTimer(connectTimeout)
          if (this.mgr.hostDisconnectTimer) {
            this.mgr.clearTimer(this.mgr.hostDisconnectTimer)
            this.mgr.hostDisconnectTimer = null
          }
          this.mgr.updateState({ status: 'CONNECTED', error: null })
          this.mgr.sendToHost(
            {
              type: 'JAM_HELLO',
              profile: selfParticipant
            },
            { useCloud: false }
          )
          this.mgr.broadcastPresenceStatus()
          if (this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`Joined Jam ${roomCode}`, 'success')
          }
        })

        conn.on('data', (data) => {
          this.mgr.clearTimer(connectTimeout)
          if (this.mgr.hostDisconnectTimer) {
            this.mgr.clearTimer(this.mgr.hostDisconnectTimer)
            this.mgr.hostDisconnectTimer = null
          }
          if (this.mgr.state.status !== 'CONNECTED') {
            this.mgr.updateState({ status: 'CONNECTED', error: null })
          }
          this.mgr.handleIncomingPacket(data, conn)
        })

        conn.on('close', () => {
          this.mgr.clearTimer(connectTimeout)
          if (this.mgr.hostConn === conn) {
            this.mgr.hostConn = null
          }
          if (this.mgr.state.active && this.mgr.state.role === 'guest') {
            const hasRelay = hasBackend() || Boolean(this.mgr.roomEventSource)
            if (!hasRelay) {
              if (this.mgr.eventHandlers.onNotify) {
                this.mgr.eventHandlers.onNotify('Host disconnected from Jam', 'info')
              }
              this.mgr.leaveJam(true)
              return
            }
            const closedAt = Date.now()
            this.mgr.updateState({ status: 'CONNECTING' })
            if (this.mgr.hostDisconnectTimer) {
              this.mgr.clearTimer(this.mgr.hostDisconnectTimer)
            }
            this.mgr.hostDisconnectTimer = this.mgr.scheduleTimer(() => {
              this.mgr.hostDisconnectTimer = null
              const hostAliveOverRelay = this.mgr.hostConn?.open || (this.mgr.lastHostPacketAt || 0) > closedAt
              if (this.mgr.state.active && this.mgr.state.role === 'guest' && !hostAliveOverRelay) {
                if (this.mgr.eventHandlers.onNotify) {
                  this.mgr.eventHandlers.onNotify('Host disconnected from Jam', 'info')
                }
                this.mgr.leaveJam(true)
              }
            }, 6000)
          }
        })
      })

      peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') {
          // Wait for cloud/backend relay before declaring error
          this.mgr.scheduleTimer(() => {
            if (
              this.mgr.state.active &&
              this.mgr.state.status !== 'CONNECTED' &&
              this.mgr.state.participants.length <= 1
            ) {
              this.mgr.updateState({
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
    this.mgr.stopLoops()
    let hostTick = 0
    this.mgr.syncInterval = setInterval(() => {
      hostTick++
      const useCloudNow = hostTick % 2 === 0
      this.mgr.broadcastSyncNow(null, { useCloud: useCloudNow })
      if (hostTick % 2 === 0) {
        this.mgr.broadcastParticipants()
      }
    }, 2000)
  }

  startGuestPingLoop() {
    this.mgr.stopLoops()
    const sendPing = () => {
      const isDirectOpen = Boolean(this.mgr.hostConn && this.mgr.hostConn.open)
      this.mgr.sendToHost(
        {
          type: 'JAM_PING',
          t1: Date.now(),
          senderId: this.mgr.getSelfParticipantId()
        },
        { useCloud: !isDirectOpen }
      )
      // If guest sees only itself in the room, re-announce JAM_HELLO to ensure Host registers it!
      if (this.mgr.state.active && this.mgr.state.role === 'guest' && (this.mgr.state.participants?.length || 0) <= 1) {
        this.mgr.sendToHost(
          {
            type: 'JAM_HELLO',
            profile: this.mgr.buildSelfParticipant(false)
          },
          { useCloud: true }
        )
      }
    }
    sendPing()
    this.mgr.pingInterval = setInterval(sendPing, 3500)
  }

  stopLoops() {
    if (this.mgr.syncInterval) {
      clearInterval(this.mgr.syncInterval)
      this.mgr.syncInterval = null
    }
    if (this.mgr.pingInterval) {
      clearInterval(this.mgr.pingInterval)
      this.mgr.pingInterval = null
    }
    if (this.mgr.hostDisconnectTimer) {
      this.mgr.clearTimer(this.mgr.hostDisconnectTimer)
      this.mgr.hostDisconnectTimer = null
    }
  }

  broadcastFromHost(packet, options = { useCloud: true }, excludeClientId = null) {
    if (!this.mgr.state.active || this.mgr.state.role !== 'host') return
    const nextSeq = ++this.mgr.stateSeq
    const payload = {
      ...packet,
      seq: nextSeq,
      timestamp: packet.timestamp || Date.now(),
      _fromRole: 'host',
      _isFromHost: true,
      _packetId: makePacketId(),
      _senderProfileId: this.mgr.getSelfParticipantId(),
      _senderInstanceId: this.mgr.instanceId
    }
    for (const [peerKey, conn] of this.mgr.hostConnections.entries()) {
      if (!conn || conn.open === false) {
        this.mgr.hostConnections.delete(peerKey)
        continue
      }
      if (
        excludeClientId &&
        (peerKey === excludeClientId || conn._guestProfileId === excludeClientId)
      ) {
        continue
      }
      try {
        conn.send(payload)
      } catch {
        this.mgr.hostConnections.delete(peerKey)
      }
    }
    if (this.mgr.bc) {
      try {
        this.mgr.bc.postMessage(payload)
      } catch {}
    }
    this.mgr.sendBackendRoomPacket(this.mgr.state.roomCode, payload)
    if (options?.useCloud !== false) {
      this.mgr.sendCloudRoomPacket(this.mgr.state.roomCode, payload)
    }
  }

  sendToHost(packet, options = { useCloud: true }) {
    if (!this.mgr.state.active) return
    const payload = {
      ...packet,
      _fromRole: 'guest',
      _isFromHost: false,
      _packetId: packet._packetId || makePacketId(),
      _senderProfileId: this.mgr.getSelfParticipantId(),
      _senderInstanceId: this.mgr.instanceId
    }
    if (this.mgr.hostConn && this.mgr.hostConn.open) {
      try {
        this.mgr.hostConn.send(payload)
      } catch {}
    }
    if (this.mgr.bc) {
      try {
        this.mgr.bc.postMessage(payload)
      } catch {}
    }
    this.mgr.sendBackendRoomPacket(this.mgr.state.roomCode, payload)
    if (options?.useCloud !== false) {
      this.mgr.sendCloudRoomPacket(this.mgr.state.roomCode, payload)
    }
  }

  broadcastPlayState(isPlaying, currentTime = 0, track = null) {
    if (!this.mgr.state.active) return
    const cleanPlaying = Boolean(isPlaying)
    const cleanTime = Number(currentTime) || 0

    if (this.mgr.state.role === 'host') {
      const nowTs = Date.now()
      this.mgr.lastPlayStateTimestamp = nowTs
      const snap = this.mgr.eventHandlers.getHostPlaybackSnapshot
        ? this.mgr.eventHandlers.getHostPlaybackSnapshot()
        : null
      const activeTrack = track || snap?.track || null

      const buildPacket = () => ({
        type: 'JAM_PLAY_STATE',
        roomCode: this.mgr.state.roomCode,
        isPlaying: cleanPlaying,
        currentTime: cleanTime,
        track: activeTrack,
        hostTimestamp: Date.now(),
        djMode: this.mgr.state.djMode,
        hostName: this.mgr.userProfile?.name || 'Host'
      })

      // Immediate 0ms dispatch + 120ms confirmation double-tap so no guest ever misses Pause/Play
      this.mgr.broadcastFromHost(buildPacket(), { useCloud: true })
      this.mgr.scheduleTimer(() => {
        if (this.mgr.state.active && this.mgr.state.role === 'host') {
          this.mgr.broadcastFromHost(buildPacket(), { useCloud: true })
        }
      }, 120)
      this.mgr.broadcastPresenceStatus()
    } else if (this.mgr.state.role === 'guest') {
      this.mgr.emitControl(cleanPlaying ? 'PLAY' : 'PAUSE', {
        isPlaying: cleanPlaying,
        currentTime: cleanTime,
        track: track || undefined
      })
    }
  }

  broadcastSyncNow(overridePatch = null, options = { useCloud: true }) {
    if (!this.mgr.state.active || this.mgr.state.role !== 'host') return
    const snapshot = this.mgr.eventHandlers.getHostPlaybackSnapshot
      ? this.mgr.eventHandlers.getHostPlaybackSnapshot()
      : null
    const merged = { ...(snapshot || {}), ...(overridePatch || {}) }

    this.mgr.broadcastFromHost(
      {
        type: 'JAM_SYNC',
        roomCode: this.mgr.state.roomCode,
        track: merged.track || null,
        isPlaying: Boolean(merged.isPlaying),
        currentTime: Number(merged.currentTime) || 0,
        hostTimestamp: Date.now(),
        queue: Array.isArray(merged.queue) ? merged.queue.slice(0, 30) : [],
        djMode: this.mgr.state.djMode,
        hostName: this.mgr.userProfile?.name || 'Host'
      },
      options
    )
  }

  broadcastHostSync(overridePatch = null) {
    this.mgr.broadcastSyncNow(overridePatch, { useCloud: true })
    this.mgr.broadcastPresenceStatus()
  }

  broadcastParticipants() {
    if (this.mgr.state.role !== 'host') return
    const sanitizedParticipants = (this.mgr.state.participants || []).map((p) => ({
      ...p,
      peerId: p.peerId || p.id,
      name: (p.name || 'Participant').slice(0, 40),
      avatar: '',
      picture:
        typeof p.picture === 'string' && p.picture.startsWith('http') && p.picture.length < 500
          ? p.picture
          : ''
    }))
    this.mgr.broadcastFromHost(
      {
        type: 'JAM_PARTICIPANTS',
        participants: sanitizedParticipants,
        djMode: this.mgr.state.djMode,
        hostName: (this.mgr.userProfile?.name || 'Host').slice(0, 40)
      },
      { useCloud: true }
    )
  }

  handleIncomingPacket(data, conn) {
    if (!data || typeof data !== 'object') return
    if (data._senderInstanceId && data._senderInstanceId === this.mgr.instanceId) return

    // STRICT STAR-TOPOLOGY ROUTING GUARD:
    // Guests MUST ignore packets sent directly by other Guests over shared broadcast relays
    // (BroadcastChannel, Cloud SSE, Backend room poll). Only the Host's canonical broadcasts
    // (_fromRole === 'host') are applied by Guests, preventing 3+ node echo storms!
    if (this.mgr.state.role === 'guest' && data._fromRole === 'guest') {
      return
    }
    if (this.mgr.state.role === 'host' && data._fromRole === 'host') {
      return
    }

    // Deduplicate discrete room events across multiple transports
    if (
      data._packetId &&
      data.type !== 'JAM_SYNC' &&
      data.type !== 'JAM_PLAY_STATE' &&
      data.type !== 'JAM_PING' &&
      data.type !== 'JAM_PONG'
    ) {
      if (this.mgr.markPacketSeen(data._packetId)) return
    }

    switch (data.type) {
      case 'JAM_HELLO': {
        if (this.mgr.state.role === 'host' && data.profile) {
          const guestId = data.profile.id || data.profile.peerId
          const cleanProfile = {
            ...data.profile,
            id: guestId,
            peerId: guestId,
            name: (data.profile.name || 'Participant').slice(0, 40),
            avatar: '',
            picture:
              typeof data.profile.picture === 'string' &&
              data.profile.picture.startsWith('http') &&
              data.profile.picture.length < 500
                ? data.profile.picture
                : '',
            isHost: false,
            inSync: true
          }
          if (conn) {
            conn._guestProfileId = cleanProfile.id
            // Prune any older stale PeerJS connections from this same guest ID
            for (const [peerKey, existingConn] of this.mgr.hostConnections.entries()) {
              if (existingConn !== conn && existingConn?._guestProfileId === cleanProfile.id) {
                try {
                  existingConn.close()
                } catch {}
                this.mgr.hostConnections.delete(peerKey)
              }
            }
          }
          const exists = this.mgr.state.participants.some((p) => p.id === cleanProfile.id)
          const updated = exists
            ? this.mgr.state.participants.map((p) =>
                p.id === cleanProfile.id ? { ...p, ...cleanProfile, isHost: p.isHost } : p
              )
            : [...this.mgr.state.participants, cleanProfile]
          this.mgr.updateState({ status: 'CONNECTED', participants: updated })
          this.mgr.broadcastParticipants()
          this.mgr.broadcastSyncNow(null, { useCloud: true })
          if (!exists && this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`${cleanProfile.name} joined the Jam`, 'success')
          }
        }
        break
      }

      case 'JAM_PARTICIPANTS': {
        if (this.mgr.state.role === 'guest' && Array.isArray(data.participants)) {
          this.mgr.lastHostPacketAt = Date.now()
          const wasConnecting = this.mgr.state.status !== 'CONNECTED'
          const cleanList = data.participants.map((p) => ({
            ...p,
            peerId: p.peerId || p.id,
            name: (p.name || 'Participant').slice(0, 40),
            avatar: '',
            picture:
              typeof p.picture === 'string' &&
              p.picture.startsWith('http') &&
              p.picture.length < 500
                ? p.picture
                : ''
          }))
          this.mgr.updateState({
            status: 'CONNECTED',
            error: null,
            participants: cleanList,
            djMode: data.djMode || this.mgr.state.djMode,
            hostName: data.hostName || this.mgr.state.hostName
          })
          if (wasConnecting && this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`Connected to ${data.hostName || 'Host'}'s Jam`, 'success')
          }
        }
        break
      }

      case 'JAM_PING': {
        if (this.mgr.state.role === 'host') {
          const pong = {
            type: 'JAM_PONG',
            t1: data.t1,
            t2: Date.now(),
            t3: Date.now(),
            targetId: data.senderId,
            _fromRole: 'host',
            _isFromHost: true,
            _senderProfileId: this.mgr.getSelfParticipantId(),
            _senderInstanceId: this.mgr.instanceId
          }
          if (conn && conn.open) {
            try {
              conn.send(pong)
            } catch {}
          } else {
            this.mgr.broadcastFromHost(pong, { useCloud: true })
          }
        }
        break
      }

      case 'JAM_PONG': {
        if (
          this.mgr.state.role === 'guest' &&
          (!data.targetId || data.targetId === this.mgr.getSelfParticipantId())
        ) {
          this.mgr.lastHostPacketAt = Date.now()
          const t4 = Date.now()
          const rtt = Math.max(2, t4 - data.t1 - (data.t3 - data.t2))
          const offset = Math.round((data.t2 - data.t1 + (data.t3 - t4)) / 2)
          this.mgr.clockSamples.push({ rtt, offset })
          if (this.mgr.clockSamples.length > 5) this.mgr.clockSamples.shift()
          const sortedOffsets = [...this.mgr.clockSamples].map((s) => s.offset).sort((a, b) => a - b)
          const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)] || 0
          this.mgr.updateState({
            rttMs: Math.round(rtt),
            clockOffsetMs: medianOffset
          })
        }
        break
      }

      case 'JAM_PLAY_STATE': {
        if (this.mgr.state.role === 'guest') {
          this.mgr.lastHostPacketAt = Date.now()
          const pktTs = Number(data.hostTimestamp || data.timestamp) || Date.now()
          if (this.mgr.lastPlayStateTimestamp && pktTs < this.mgr.lastPlayStateTimestamp - 50) {
            return
          }
          this.mgr.lastPlayStateTimestamp = pktTs
          if (typeof data.seq === 'number' && data.seq > this.mgr.lastAppliedSeq) {
            this.mgr.lastAppliedSeq = data.seq
          }
          this.mgr.updateState({
            status: 'CONNECTED',
            error: null,
            djMode: data.djMode || this.mgr.state.djMode,
            hostName: data.hostName || this.mgr.state.hostName
          })
          if (this.mgr.eventHandlers.onRemoteSync) {
            this.mgr.eventHandlers.onRemoteSync(
              { ...data, forcePlayState: true },
              this.mgr.state.clockOffsetMs
            )
          }
        }
        break
      }

      case 'JAM_SYNC': {
        if (this.mgr.state.role === 'guest') {
          this.mgr.lastHostPacketAt = Date.now()
          if (typeof data.seq === 'number') {
            if (this.mgr.lastAppliedSeq > 0 && data.seq < this.mgr.lastAppliedSeq) {
              return
            }
            this.mgr.lastAppliedSeq = data.seq
          }
          const pktTs = Number(data.hostTimestamp || data.timestamp) || 0
          // Prevent an older in-flight periodic JAM_SYNC heartbeat from overriding a newer JAM_PLAY_STATE
          if (this.mgr.lastPlayStateTimestamp > 0 && pktTs > 0 && pktTs < this.mgr.lastPlayStateTimestamp) {
            return
          }
          this.mgr.updateState({
            status: 'CONNECTED',
            error: null,
            djMode: data.djMode || this.mgr.state.djMode,
            hostName: data.hostName || this.mgr.state.hostName
          })
          if ((data.track || typeof data.isPlaying === 'boolean') && this.mgr.eventHandlers.onRemoteSync) {
            this.mgr.eventHandlers.onRemoteSync(data, this.mgr.state.clockOffsetMs)
          }
        }
        break
      }

      case 'JAM_CONTROL': {
        if (this.mgr.state.role === 'host') {
          if (this.mgr.state.djMode !== 'host_only') {
            if (this.mgr.eventHandlers.onRemoteControl) {
              this.mgr.eventHandlers.onRemoteControl(data)
            }
            // Re-broadcast canonical control from Host to all other guests (excluding sender on PeerJS)
            this.mgr.broadcastFromHost(data, { useCloud: true }, data.senderId || data._senderProfileId)
            if (data.action === 'PAUSE' || data.action === 'PLAY') {
              this.mgr.broadcastPlayState(
                data.action === 'PLAY',
                data.currentTime,
                data.track || null
              )
            }
          }
        } else if (this.mgr.state.role === 'guest') {
          // Ignore if this control echoed back to the guest who originally sent it
          if (data.senderId && data.senderId === this.mgr.getSelfParticipantId()) {
            return
          }
          if (this.mgr.eventHandlers.onRemoteControl) {
            this.mgr.eventHandlers.onRemoteControl(data)
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
        if (this.mgr.state.role === 'host') {
          if (this.mgr.eventHandlers.onRemoteQueueAdd) {
            this.mgr.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
          this.mgr.broadcastFromHost(
            { ...data, addedBy: cleanAddedBy },
            { useCloud: true },
            cleanAddedBy.id
          )
          this.mgr.scheduleTimer(() => this.mgr.broadcastSyncNow(null, { useCloud: true }), 150)
        } else if (this.mgr.state.role === 'guest') {
          if (cleanAddedBy.id && cleanAddedBy.id === this.mgr.getSelfParticipantId()) {
            return
          }
          if (this.mgr.eventHandlers.onRemoteQueueAdd) {
            this.mgr.eventHandlers.onRemoteQueueAdd(data.track, cleanAddedBy)
          }
        }
        break
      }

      case 'JAM_REACTION': {
        if (this.mgr.state.role === 'host') {
          this.mgr.broadcastFromHost(data, { useCloud: true }, data.senderId)
        }
        if (data.senderId && data.senderId === this.mgr.getSelfParticipantId()) {
          return
        }
        if (this.mgr.eventHandlers.onReaction) {
          this.mgr.eventHandlers.onReaction(data)
        }
        break
      }

      case 'JAM_DJ_MODE': {
        if (this.mgr.state.role === 'guest') {
          this.mgr.updateState({ djMode: data.djMode })
          if (this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(
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
        if (this.mgr.state.role === 'host' && data.senderId) {
          for (const [peerKey, existingConn] of this.mgr.hostConnections.entries()) {
            if (existingConn?._guestProfileId === data.senderId) {
              try {
                existingConn.close()
              } catch {}
              this.mgr.hostConnections.delete(peerKey)
            }
          }
          const gone = this.mgr.state.participants.find((p) => p.id === data.senderId)
          const nextList = this.mgr.state.participants.filter((p) => p.id !== data.senderId)
          this.mgr.updateState({ participants: nextList })
          this.mgr.broadcastParticipants()
          if (gone && this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`${gone.name} left the Jam`, 'info')
          }
        }
        break
      }

      case 'JAM_ENDED': {
        if (this.mgr.state.role === 'guest') {
          if (this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify('Host ended the Jam session', 'info')
          }
          this.mgr.leaveJam(true)
        }
        break
      }

      case 'JAM_RESYNC_REQUEST': {
        if (this.mgr.state.role === 'host') {
          this.mgr.broadcastSyncNow(null, { useCloud: true })
          this.mgr.broadcastParticipants()
        }
        break
      }

      default:
        break
    }
  }

  emitControl(action, payload = {}) {
    if (!this.mgr.state.active) return true
    if (this.mgr.state.role === 'guest' && this.mgr.state.djMode === 'host_only') {
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify('Host-Only Mode is active', 'warning')
      }
      return false
    }

    const packet = {
      type: 'JAM_CONTROL',
      action,
      ...payload,
      senderId: this.mgr.getSelfParticipantId(),
      senderName: this.mgr.userProfile?.name || 'Friend',
      timestamp: Date.now(),
      _packetId: makePacketId()
    }

    if (this.mgr.state.role === 'host') {
      if (action === 'PAUSE' || action === 'PLAY') {
        this.mgr.broadcastPlayState(action === 'PLAY', payload.currentTime, payload.track)
      }
      this.mgr.broadcastFromHost(packet, { useCloud: true })
      this.mgr.scheduleTimer(() => this.mgr.broadcastSyncNow(null, { useCloud: true }), 80)
    } else {
      this.mgr.sendToHost(packet, { useCloud: true })
    }
    return true
  }

  emitPlaybackControl(action, payload = {}) {
    return this.mgr.emitControl(action, payload)
  }

  emitQueueAdd(track) {
    if (!this.mgr.state.active || !track) return
    const packet = {
      type: 'JAM_QUEUE_ADD',
      track,
      addedBy: {
        id: this.mgr.getSelfParticipantId(),
        name: this.mgr.userProfile?.name || 'Friend',
        avatar: ''
      },
      _packetId: makePacketId()
    }
    if (this.mgr.state.role === 'host') {
      this.mgr.broadcastFromHost(packet, { useCloud: true })
      this.mgr.scheduleTimer(() => this.mgr.broadcastSyncNow(null, { useCloud: true }), 100)
    } else {
      this.mgr.sendToHost(packet, { useCloud: true })
    }
  }

  sendReaction(reactionType = '🔥') {
    if (!this.mgr.state.active) return
    const id = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const emojiVal =
      typeof reactionType === 'object'
        ? (reactionType?.emoji || reactionType?.reaction || '🔥')
        : (reactionType || '🔥')
    const packet = {
      type: 'JAM_REACTION',
      id,
      _packetId: id,
      emoji: emojiVal,
      reaction: emojiVal,
      senderId: this.mgr.getSelfParticipantId(),
      senderName: this.mgr.userProfile?.name || 'You',
      senderAvatar: ''
    }
    this.mgr.markPacketSeen(id)
    if (this.mgr.state.role === 'host') {
      this.mgr.broadcastFromHost(packet, { useCloud: true })
    } else {
      this.mgr.sendToHost(packet, { useCloud: true })
    }
    if (this.mgr.eventHandlers.onReaction) {
      this.mgr.eventHandlers.onReaction(packet)
    }
  }

  setDjMode(mode) {
    if (this.mgr.state.role !== 'host') return
    const cleanMode = mode === 'host_only' ? 'host_only' : 'open_party'
    this.mgr.updateState({ djMode: cleanMode })
    this.mgr.broadcastFromHost(
      {
        type: 'JAM_DJ_MODE',
        djMode: cleanMode
      },
      { useCloud: true }
    )
  }

  reportDriftStatus(driftMs, syncTier) {
    const cleanTier = syncTier === 'IN_SYNC' ? 'LOCKED' : syncTier || 'LOCKED'
    if (Math.abs(driftMs - this.mgr.state.syncDeltaMs) > 25 || cleanTier !== this.mgr.state.syncTier) {
      this.mgr.updateState({
        syncDeltaMs: driftMs,
        syncTier: cleanTier
      })
    }
  }

  resyncNow() {
    if (!this.mgr.state.active) return false
    if (this.mgr.state.role === 'host') {
      this.mgr.broadcastHostSync()
      this.mgr.broadcastParticipants()
      return true
    }
    if (this.mgr.state.role === 'guest') {
      this.mgr.sendToHost(
        {
          type: 'JAM_PING',
          t1: Date.now(),
          senderId: this.mgr.getSelfParticipantId()
        },
        { useCloud: true }
      )
      this.mgr.sendToHost(
        {
          type: 'JAM_RESYNC_REQUEST',
          senderId: this.mgr.getSelfParticipantId(),
          _packetId: makePacketId()
        },
        { useCloud: true }
      )
      if (this.mgr.state.roomCode) {
        try {
          this.mgr.pollBackendRoom?.(this.mgr.state.roomCode)
          this.mgr.pollCloudRoom?.(this.mgr.state.roomCode)
        } catch {}
      }
      return true
    }
    return false
  }

  leaveJam(silent = false) {
    this.mgr.stopLoops()
    if (this.mgr.state.active) {
      if (this.mgr.state.role === 'host') {
        this.mgr.broadcastFromHost({ type: 'JAM_ENDED' }, { useCloud: true })
      } else if (this.mgr.state.role === 'guest') {
        this.mgr.sendToHost(
          { type: 'JAM_LEAVE', senderId: this.mgr.getSelfParticipantId() },
          { useCloud: true }
        )
      }
    }

    for (const conn of this.mgr.connections.values()) {
      try {
        conn.close()
      } catch {}
    }
    this.mgr.connections.clear()

    if (this.mgr.hostConn) {
      try {
        this.mgr.hostConn.close()
      } catch {}
      this.mgr.hostConn = null
    }

    if (this.mgr.peer) {
      try {
        this.mgr.peer.destroy()
      } catch {}
      this.mgr.peer = null
    }

    this.mgr.teardownRoomTransports()

    this.mgr.clockSamples = []
    this.mgr.updateState({
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

    this.mgr.broadcastPresenceStatus()

    if (!silent && this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify('Left Jam session', 'info')
    }
  }
}
