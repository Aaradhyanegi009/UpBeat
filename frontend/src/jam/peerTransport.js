/**
 * WebRTC PeerJS presence peer, friend P2P links, ACK-verified packet delivery, and room host sockets.
 */
import {
  FRIENDS_LIST_STORAGE_KEY,
  FRIEND_REQ_IN_STORAGE_KEY,
  FRIEND_REQ_OUT_STORAGE_KEY,
  PEER_OPTIONS,
  getPresencePeerId,
  loadJamUserProfile,
  loadJsonArray,
  makePacketId,
  normalizeFriendCode,
  normalizeRoomCode,
  saveJsonArray
} from "./jamUtils.js"

export class PeerTransport {
  constructor(mgr) {
    this.mgr = mgr
  }

  restartPresenceNetwork() {
    if (this.mgr.presencePeerReclaimTimer) {
      clearTimeout(this.mgr.presencePeerReclaimTimer)
      this.mgr.presencePeerReclaimTimer = null
    }
    if (this.mgr.socialEventSource) {
      try {
        this.mgr.socialEventSource.close()
      } catch {}
      this.mgr.socialEventSource = null
    }
    if (this.mgr.presencePeer) {
      try {
        this.mgr.presencePeer.destroy()
      } catch {}
      this.mgr.presencePeer = null
    }
    this.mgr.initPresenceNetwork()
  }


  ensurePresencePeerAlive() {
    if (this.mgr.destroyed) return
    const myFriendCode = normalizeFriendCode(this.mgr.userProfile?.friendCode)
    if (!myFriendCode) return

    if (this.mgr.presencePeer && !this.mgr.presencePeer.destroyed) {
      if (this.mgr.presencePeer.disconnected) {
        try {
          this.mgr.presencePeer.reconnect()
        } catch {}
      }
      return
    }

    const now = Date.now()
    if (now - this.mgr.lastPresencePeerAttemptAt < 1200) return
    this.mgr.lastPresencePeerAttemptAt = now

    try {
      const peerId = getPresencePeerId(myFriendCode)
      const pPeer = new this.mgr.PeerClass(peerId, PEER_OPTIONS)
      this.mgr.presencePeer = pPeer

      pPeer.on('open', () => {
        if (this.mgr.presencePeerReclaimTimer) {
          clearTimeout(this.mgr.presencePeerReclaimTimer)
          this.mgr.presencePeerReclaimTimer = null
        }
        this.mgr.updateState({ presenceReady: true })
        for (const targetCode of Array.from(this.mgr.pendingPeerPackets.keys())) {
          this.mgr.connectToPeerFriend(targetCode)
        }
        this.mgr.pingAllFriends()
        this.mgr.retryOutgoingRequests()
      })

      pPeer.on('connection', (conn) => {
        this.mgr.setupPresenceConn(conn)
      })

      pPeer.on('disconnected', () => {
        if (this.mgr.destroyed) return
        try {
          if (!pPeer.destroyed) {
            pPeer.reconnect()
          }
        } catch {}
        this.mgr.scheduleTimer(() => {
          if (!this.mgr.destroyed && this.mgr.presencePeer === pPeer && (pPeer.destroyed || pPeer.disconnected)) {
            try {
              pPeer.destroy()
            } catch {}
            if (this.mgr.presencePeer === pPeer) {
              this.mgr.presencePeer = null
            }
            this.mgr.ensurePresencePeerAlive()
          }
        }, 2500)
      })

      pPeer.on('close', () => {
        if (this.mgr.presencePeer === pPeer) {
          this.mgr.presencePeer = null
          if (!this.mgr.destroyed) {
            this.mgr.scheduleTimer(() => this.mgr.ensurePresencePeerAlive(), 1500)
          }
        }
      })

      pPeer.on('error', (err) => {
        this.mgr.updateState({ presenceReady: true })
        if (this.mgr.destroyed) return
        if (err?.type === 'unavailable-id') {
          // Spin up auxiliary outbound peer immediately so B -> A works at 0ms,
          // AND schedule automatic reclaim of upbeat-user-UP-XXXXXX so A -> B also works!
          this.mgr.ensureAuxClientPeer()
          try {
            pPeer.destroy()
          } catch {}
          if (this.mgr.presencePeer === pPeer) {
            this.mgr.presencePeer = null
          }
          if (!this.mgr.presencePeerReclaimTimer) {
            this.mgr.presencePeerReclaimTimer = this.mgr.scheduleTimer(() => {
              this.mgr.presencePeerReclaimTimer = null
              this.mgr.ensurePresencePeerAlive()
            }, 3500)
          }
        } else if (
          err?.type === 'network' ||
          err?.type === 'server-error' ||
          err?.type === 'socket-error' ||
          err?.type === 'socket-closed' ||
          err?.type === 'disconnected'
        ) {
          this.mgr.scheduleTimer(() => this.mgr.ensurePresencePeerAlive(), 1500)
        }
      })
    } catch {}
  }

  initPresenceNetwork() {
    this.mgr.userProfile = loadJamUserProfile()
    const myFriendCode = this.mgr.userProfile.friendCode

    // 1. Same-browser BroadcastChannel for local zero-latency sync across all open tabs/windows
    if (typeof BroadcastChannel !== 'undefined' && !this.mgr.socialBc) {
      try {
        this.mgr.socialBc = new BroadcastChannel('upbeat_social_v7')
        this.mgr.socialBc.onmessage = (ev) => {
          const data = ev?.data
          if (!data || data._senderInstanceId === this.mgr.instanceId) return

          // Instant cross-tab sync of friends, incoming and outgoing requests for the SAME user profile
          if (data.type === 'LOCAL_SOCIAL_STATE_SYNC') {
            if (!data.userProfile?.friendCode || data.userProfile.friendCode === this.mgr.userProfile?.friendCode) {
              this.mgr.updateState({
                friends: data.friends || [],
                incomingRequests: data.incomingRequests || [],
                outgoingRequests: data.outgoingRequests || []
              })
            }
            return
          }

          const currentCode = this.mgr.userProfile?.friendCode || myFriendCode
          if (!data.targetFriendCode || normalizeFriendCode(data.targetFriendCode) === currentCode) {
            this.mgr.handleSocialPacket(data, null)
          }
        }
      } catch {}
    }

    // Multi-window storage synchronization & window focus / visibility / network auto-refresh
    if (typeof window !== 'undefined' && !this.mgr._storageListenerAdded) {
      this.mgr._storageListenerAdded = true
      const onStorage = (ev) => {
        if (
          ev.key === FRIENDS_LIST_STORAGE_KEY ||
          ev.key === FRIEND_REQ_IN_STORAGE_KEY ||
          ev.key === FRIEND_REQ_OUT_STORAGE_KEY
        ) {
          const nextFriends = loadJsonArray(FRIENDS_LIST_STORAGE_KEY)
          const nextIn = loadJsonArray(FRIEND_REQ_IN_STORAGE_KEY)
          const nextOut = loadJsonArray(FRIEND_REQ_OUT_STORAGE_KEY)
          this.mgr.updateState({
            friends: nextFriends,
            incomingRequests: nextIn,
            outgoingRequests: nextOut
          })
        }
      }

      const onWakeOrOnline = () => {
        if (this.mgr.destroyed) return
        this.mgr.ensurePresencePeerAlive()
        this.mgr.pingAllFriends()
        this.mgr.retryOutgoingRequests()
        this.mgr.pollEdgeSocialMailbox()
        this.mgr.pollBackendSocial()
        this.mgr.pollSocialCloudInbox(this.mgr.userProfile?.friendCode, false)
      }

      const onVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          onWakeOrOnline()
        }
      }

      this.mgr._onStorageListener = onStorage
      this.mgr._onWakeListener = onWakeOrOnline
      this.mgr._onVisibilityListener = onVisibility

      window.addEventListener('storage', onStorage)
      window.addEventListener('focus', onWakeOrOnline)
      window.addEventListener('online', onWakeOrOnline)
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility)
      }
    }

    // 2. Cloud SSE Stream + Edge Mailbox Relay
    this.mgr.initSocialCloudRelay(myFriendCode)

    // 3. PeerJS WebRTC Presence Peer (permanently bound to upbeat-user-UP-XXXXXX)
    this.mgr.ensurePresencePeerAlive()

    // 4. Periodic Presence & Edge Mailbox Polling
    if (this.mgr.presenceTimer) clearInterval(this.mgr.presenceTimer)
    this.mgr.presenceTimer = setInterval(() => {
      this.mgr.ensurePresencePeerAlive()
      this.mgr.pingAllFriends()
      this.mgr.retryOutgoingRequests()
      this.mgr.pruneStaleFriendPresence()
      // Always poll cloud inbox on every tick so incoming friend requests & acceptances are received in real time
      this.mgr.pollSocialCloudInbox(this.mgr.userProfile?.friendCode || myFriendCode, false)
    }, 3500)

    if (this.mgr.backendPollTimer) clearInterval(this.mgr.backendPollTimer)
    this.mgr.backendPollTimer = setInterval(() => {
      this.mgr.edgePollTick = (this.mgr.edgePollTick || 0) + 1
      // Pillar 3: Poll /api/social every 3s while JamModal is open (or pending requests), and every ~9s in background
      const shouldPollEdge =
        this.mgr.isModalOpen ||
        (this.mgr.state.outgoingRequests?.length || 0) > 0 ||
        (this.mgr.state.incomingRequests?.length || 0) > 0 ||
        this.mgr.edgePollTick % 3 === 0
      if (shouldPollEdge) {
        this.mgr.pollEdgeSocialMailbox()
      }
      this.mgr.pollBackendSocial()
    }, 3000)

    this.mgr.scheduleTimer(() => {
      this.mgr.pollEdgeSocialMailbox()
      this.mgr.pollBackendSocial()
      this.mgr.pollSocialCloudInbox(myFriendCode, true)
      this.mgr.pingAllFriends()
      this.mgr.retryOutgoingRequests()
    }, 200)
  }

  ensureAuxClientPeer() {
    if (this.mgr.auxClientPeer && !this.mgr.auxClientPeer.destroyed) {
      if (this.mgr.auxClientPeer.disconnected) {
        try {
          this.mgr.auxClientPeer.reconnect()
        } catch {}
      }
      return this.mgr.auxClientPeer
    }
    try {
      const aux = new this.mgr.PeerClass(PEER_OPTIONS)
      this.mgr.auxClientPeer = aux
      aux.on('open', () => {
        for (const targetCode of Array.from(this.mgr.pendingPeerPackets.keys())) {
          this.mgr.connectToPeerFriend(targetCode)
        }
        this.mgr.pingAllFriends()
        this.mgr.retryOutgoingRequests()
      })
      aux.on('connection', (conn) => {
        this.mgr.setupPresenceConn(conn)
      })
      aux.on('disconnected', () => {
        try {
          if (!aux.destroyed) aux.reconnect()
        } catch {}
      })
      return aux
    } catch {
      return null
    }
  }

  getActiveSocialPeer() {
    this.mgr.ensurePresencePeerAlive()
    if (this.mgr.presencePeer && this.mgr.presencePeer.open && !this.mgr.presencePeer.destroyed) {
      return this.mgr.presencePeer
    }
    if (this.mgr.auxClientPeer && this.mgr.auxClientPeer.open && !this.mgr.auxClientPeer.destroyed) {
      return this.mgr.auxClientPeer
    }
    return this.mgr.ensureAuxClientPeer()
  }

  connectToPeerFriend(cleanTarget) {
    const normTarget = normalizeFriendCode(cleanTarget)
    if (!normTarget || normTarget === this.mgr.userProfile?.friendCode) return null
    const existing = this.mgr.activeFriendConnections.get(normTarget)
    if (existing && existing.open) return existing
    const pending = this.mgr.pendingPeerConns.get(normTarget)
    if (pending) return pending

    const activePeer = this.mgr.getActiveSocialPeer()
    if (!activePeer || !activePeer.open || activePeer.destroyed) return null

    try {
      const targetPeerId = getPresencePeerId(normTarget)
      const conn = activePeer.connect(targetPeerId, {
        reliable: true,
        serialization: 'json'
      })
      if (conn) {
        this.mgr.pendingPeerConns.set(normTarget, conn)
        this.mgr.setupPresenceConn(conn, normTarget)
        this.mgr.scheduleTimer(() => {
          if (this.mgr.pendingPeerConns.get(normTarget) === conn && !conn.open) {
            this.mgr.pendingPeerConns.delete(normTarget)
          }
        }, 6500)
        return conn
      }
    } catch {}
    return null
  }

  flushPendingForFriend(cleanFriendCode, conn) {
    const cleanCode = normalizeFriendCode(cleanFriendCode)
    if (!cleanCode || !conn || !conn.open) return

    // 1. Flush queued packets from pendingPeerPackets
    const queued = this.mgr.pendingPeerPackets.get(cleanCode) || []
    this.mgr.pendingPeerPackets.delete(cleanCode)
    for (const pkt of queued) {
      try {
        conn.send(pkt)
      } catch {}
    }

    // 2. Flush any un-ACKed reliable packets targeting this friend (at 0ms and +250ms for SCTP readiness)
    const sendUnacked = () => {
      if (!conn.open) return
      for (const entry of this.mgr.pendingAckPackets.values()) {
        if (!entry.acked && entry.targetFriendId === cleanCode) {
          try {
            conn.send(entry.packet)
          } catch {}
        }
      }
    }
    sendUnacked()
    this.mgr.scheduleTimer(sendUnacked, 250)
  }


  setupPresenceConn(conn, knownFriendCode = null) {
    if (!conn) return

    // Pillar 2 Reverse-Path Piggybacking: Infer friendCode immediately from conn.peer if it starts with upbeat-user-
    const peerExtracted =
      conn.peer && String(conn.peer).startsWith(PRESENCE_PEER_PREFIX)
        ? normalizeFriendCode(String(conn.peer).slice(PRESENCE_PEER_PREFIX.length))
        : ''
    let resolvedFriendCode = normalizeFriendCode(knownFriendCode || peerExtracted)

    conn.on('open', () => {
      conn._lastDataAt = Date.now()
      if (resolvedFriendCode) {
        // Keep conn open in activeFriendConnections for bidirectional communication!
        this.mgr.activeFriendConnections.set(resolvedFriendCode, conn)
        this.mgr.pendingPeerConns.delete(resolvedFriendCode)
        this.mgr.flushPendingForFriend(resolvedFriendCode, conn)
      }
      try {
        const isConfirmed =
          resolvedFriendCode &&
          (this.mgr.state.friends || []).some(
            (f) => normalizeFriendCode(f.friendCode) === resolvedFriendCode
          )
        const isPendingOut =
          resolvedFriendCode &&
          (this.mgr.state.outgoingRequests || []).some(
            (r) => normalizeFriendCode(r.friendCode) === resolvedFriendCode
          )
        conn.send({
          ...this.mgr.buildPresencePayload('PRESENCE_PING', {
            isConfirmedFriend: Boolean(isConfirmed),
            isPendingOutgoing: Boolean(isPendingOut)
          }),
          _packetId: makePacketId(),
          _senderInstanceId: this.mgr.instanceId
        })
      } catch {}
    })

    conn.on('data', (data) => {
      conn._lastDataAt = Date.now()
      const cleanFrom = normalizeFriendCode(
        data?.from?.friendCode || data?._fromFriendCode || resolvedFriendCode
      )
      if (cleanFrom && cleanFrom !== this.mgr.userProfile?.friendCode) {
        resolvedFriendCode = cleanFrom
        // Pillar 2: Save incoming/bidirectional DataConnection in activeFriendConnections
        this.mgr.activeFriendConnections.set(cleanFrom, conn)
        this.mgr.pendingPeerConns.delete(cleanFrom)
        this.mgr.flushPendingForFriend(cleanFrom, conn)
      }
      this.mgr.handleSocialPacket(data, conn)
    })

    const cleanup = () => {
      if (resolvedFriendCode) {
        if (this.mgr.pendingPeerConns.get(resolvedFriendCode) === conn) {
          this.mgr.pendingPeerConns.delete(resolvedFriendCode)
        }
      }
      for (const [code, activeConn] of this.mgr.activeFriendConnections.entries()) {
        if (activeConn === conn) {
          this.mgr.activeFriendConnections.delete(code)
        }
      }
    }
    conn.on('close', cleanup)
    conn.on('error', cleanup)
  }


  sendWithAck(targetFriendId, packet, maxRetries = 4) {
    const cleanTarget = normalizeFriendCode(targetFriendId)
    if (!cleanTarget || cleanTarget === this.mgr.userProfile?.friendCode) return null

    const msgId =
      packet.msgId ||
      packet._packetId ||
      `${packet.type || 'PKT'}_${this.mgr.userProfile?.friendCode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    const fullPacket = {
      ...packet,
      msgId,
      _packetId: msgId,
      targetFriendCode: cleanTarget,
      _fromFriendCode: this.mgr.userProfile.friendCode,
      _senderInstanceId: this.mgr.instanceId,
      sentAt: packet.sentAt || Date.now()
    }

    // Cancel any older pending ACK entry of the exact same type to the same target to prevent timer buildup
    for (const [oldId, oldEntry] of this.mgr.pendingAckPackets.entries()) {
      if (oldEntry.targetFriendId === cleanTarget && oldEntry.packet?.type === fullPacket.type) {
        oldEntry.timers.forEach((t) => clearTimeout(t))
        this.mgr.pendingAckPackets.delete(oldId)
      }
    }

    const ackEntry = {
      msgId,
      targetFriendId: cleanTarget,
      packet: fullPacket,
      acked: false,
      timers: []
    }
    this.mgr.pendingAckPackets.set(msgId, ackEntry)

    // 1. Immediate BroadcastChannel + Edge Mailbox (/api/social) + Local Backend + Cloud Relay
    if (this.mgr.socialBc) {
      try {
        this.mgr.socialBc.postMessage(fullPacket)
      } catch {}
    }
    this.mgr.sendEdgeSocialPacket(cleanTarget, fullPacket)
    this.mgr.sendBackendSocialPacket(cleanTarget, fullPacket)
    this.mgr.sendSocialCloudPacket(cleanTarget, fullPacket)

    // 2. Send over already-open connection in activeFriendConnections AND ensure outbound P2P connection
    const trySendOverP2P = () => {
      if (ackEntry.acked) return
      // Refresh sender summary so latest confirmedFriendCodes / outgoingRequestCodes are always included
      ackEntry.packet.from = this.mgr.getMyPublicSummary()
      const openConn = this.mgr.activeFriendConnections.get(cleanTarget)
      if (openConn && openConn.open) {
        try {
          openConn.send(ackEntry.packet)
        } catch {}
      } else {
        this.mgr.connectToPeerFriend(cleanTarget)
      }
    }

    trySendOverP2P()

    // Schedule retry waves (+350ms, +900ms, +2000ms, +3800ms) until PACKET_ACK arrives
    const retryDelays = [350, 900, 2000, 3800].slice(0, maxRetries)
    retryDelays.forEach((delayMs, idx) => {
      const t = setTimeout(() => {
        if (ackEntry.acked) return
        trySendOverP2P()
        if (idx === 1 || idx === 3) {
          this.mgr.sendEdgeSocialPacket(cleanTarget, ackEntry.packet)
          this.mgr.sendBackendSocialPacket(cleanTarget, ackEntry.packet)
        }
      }, delayMs)
      ackEntry.timers.push(t)
    })

    // Cleanup entry after 12s
    const cleanupTimer = setTimeout(() => {
      this.mgr.pendingAckPackets.delete(msgId)
    }, 12000)
    ackEntry.timers.push(cleanupTimer)

    return msgId
  }

  sendReliableToFriend(targetFriendId, packet, maxRetries = 4) {
    return this.mgr.sendWithAck(targetFriendId, packet, maxRetries)
  }

  acknowledgePacket(msgId, senderProfile = null) {
    if (!msgId) return
    const entry = this.mgr.pendingAckPackets.get(msgId)
    if (entry) {
      entry.acked = true
      entry.timers.forEach((t) => clearTimeout(t))
      this.mgr.pendingAckPackets.delete(msgId)
    }
    if (senderProfile && senderProfile.friendCode) {
      this.mgr.updateFriendPresence(senderProfile)
    }
  }

  sendSocialPacket(targetFriendCode, packet, options = { useCloud: false }) {
    const cleanTarget = normalizeFriendCode(targetFriendCode)
    if (!cleanTarget || cleanTarget === this.mgr.userProfile?.friendCode) return

    const isReliableType =
      packet.type === 'FRIEND_REQUEST' ||
      packet.type === 'FRIEND_ACCEPTED' ||
      packet.type === 'FRIEND_SYNC_ACK' ||
      packet.type === 'FRIEND_REMOVED' ||
      packet.type === 'JAM_INVITE'

    if (isReliableType) {
      this.mgr.sendWithAck(cleanTarget, packet, 4)
      return
    }

    const msgId = packet.msgId || packet._packetId || makePacketId()
    const fullPacket = {
      ...packet,
      msgId,
      _packetId: msgId,
      targetFriendCode: cleanTarget,
      _fromFriendCode: this.mgr.userProfile.friendCode,
      _senderInstanceId: this.mgr.instanceId
    }

    // 1. BroadcastChannel (same browser tabs)
    if (this.mgr.socialBc) {
      try {
        this.mgr.socialBc.postMessage(fullPacket)
      } catch {}
    }

    // 2. Local FastAPI Backend & Edge Mailbox
    this.mgr.sendBackendSocialPacket(cleanTarget, fullPacket)
    if (fullPacket.type === 'PACKET_ACK' || fullPacket.type === 'FRIEND_STATUS_PROBE') {
      this.mgr.sendEdgeSocialPacket(cleanTarget, fullPacket)
    }

    // 3. Cloud Pub/Sub Relay (strictly only when explicitly requested for discrete packets)
    if (options?.useCloud === true && fullPacket.type !== 'PRESENCE_PING' && fullPacket.type !== 'PRESENCE_STATUS') {
      this.mgr.sendSocialCloudPacket(cleanTarget, fullPacket)
    }

    // 4. PeerJS WebRTC DataChannel (Bidirectional Pipe Reuse)
    const existing = this.mgr.activeFriendConnections.get(cleanTarget)
    if (existing && existing.open) {
      try {
        existing.send(fullPacket)
        return
      } catch {}
    }

    const q = this.mgr.pendingPeerPackets.get(cleanTarget) || []
    if (fullPacket.type !== 'PRESENCE_PING' || !q.some((p) => p.type === 'PRESENCE_PING')) {
      q.push(fullPacket)
      if (q.length > 25) q.shift()
      this.mgr.pendingPeerPackets.set(cleanTarget, q)
    }

    this.mgr.connectToPeerFriend(cleanTarget)
  }


  sendPacketAck(senderFriendCode, msgId, conn = null) {
    if (!msgId || !senderFriendCode) return
    const ackPkt = this.mgr.buildPresencePayload('PACKET_ACK', {
      msgId,
      targetFriendCode: senderFriendCode
    })
    if (conn && conn.open) {
      try {
        conn.send(ackPkt)
      } catch {}
    }
    this.mgr.sendSocialPacket(senderFriendCode, ackPkt, { useCloud: true })
    this.mgr.sendSocialCloudPacket(senderFriendCode, ackPkt)
  }


  setupHostPeerConnection(conn) {
    if (!conn) return
    const connKey = conn.peer || `peer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    conn._connKey = connKey

    conn.on('open', () => {
      this.mgr.hostConnections.set(connKey, conn)
      this.mgr.broadcastParticipants()
      this.mgr.broadcastSyncNow()
    })

    conn.on('data', (data) => {
      if (!this.mgr.hostConnections.has(connKey) && conn.open) {
        this.mgr.hostConnections.set(connKey, conn)
      }
      this.mgr.handleIncomingPacket(data, conn)
    })

    const cleanup = () => {
      this.mgr.hostConnections.delete(connKey)
      if (conn._guestProfileId) {
        // Only remove participant if they don't have another active connection in hostConnections
        let hasOtherOpenConn = false
        for (const other of this.mgr.hostConnections.values()) {
          if (other && other !== conn && other.open && other._guestProfileId === conn._guestProfileId) {
            hasOtherOpenConn = true
            break
          }
        }
        if (!hasOtherOpenConn) {
          const gone = this.mgr.state.participants.find((p) => p.id === conn._guestProfileId)
          const nextList = this.mgr.state.participants.filter((p) => p.id !== conn._guestProfileId)
          this.mgr.updateState({ participants: nextList })
          this.mgr.broadcastParticipants()
          if (gone && this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`${gone.name} left the Jam`, 'info')
          }
        }
      }
    }

    conn.on('close', cleanup)
    conn.on('error', cleanup)
  }


  destroyAll() {
    if (typeof window !== 'undefined') {
      if (this.mgr._onStorageListener) {
        window.removeEventListener('storage', this.mgr._onStorageListener)
        this.mgr._onStorageListener = null
      }
      if (this.mgr._onWakeListener) {
        window.removeEventListener('focus', this.mgr._onWakeListener)
        window.removeEventListener('online', this.mgr._onWakeListener)
        this.mgr._onWakeListener = null
      }
    }
    if (typeof document !== 'undefined' && this.mgr._onVisibilityListener) {
      document.removeEventListener('visibilitychange', this.mgr._onVisibilityListener)
      this.mgr._onVisibilityListener = null
    }
    this.mgr._storageListenerAdded = false
    for (const [, entry] of this.mgr.pendingAckPackets.entries()) {
      entry.timers.forEach((t) => clearTimeout(t))
    }
    this.mgr.pendingAckPackets.clear()
    this.mgr.pendingPeerPackets.clear()
    for (const [, conn] of this.mgr.pendingPeerConns.entries()) {
      try { conn.close() } catch {}
    }
    this.mgr.pendingPeerConns.clear()
    for (const [, conn] of this.mgr.activeFriendConnections.entries()) {
      try { conn.close() } catch {}
    }
    this.mgr.activeFriendConnections.clear()
    if (this.mgr.presencePeer) {
      try { this.mgr.presencePeer.destroy() } catch {}
      this.mgr.presencePeer = null
    }
    if (this.mgr.auxClientPeer) {
      try { this.mgr.auxClientPeer.destroy() } catch {}
      this.mgr.auxClientPeer = null
    }
  }
}
