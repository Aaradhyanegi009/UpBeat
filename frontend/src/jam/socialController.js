/**
 * Bidirectional friend requests, mutual auto-match, online presence state, and Jam invites.
 */
import {
  FRIENDS_LIST_STORAGE_KEY,
  FRIEND_REQ_IN_STORAGE_KEY,
  FRIEND_REQ_OUT_STORAGE_KEY,
  loadJamUserProfile,
  loadJsonArray,
  normalizeFriendCode,
  normalizeRoomCode,
  saveJsonArray,
  sortFriendsDeterministically
} from "./jamUtils.js"

export class SocialController {
  constructor(mgr) {
    this.mgr = mgr
  }

  broadcastLocalSocialState() {
    if (this.mgr.socialBc) {
      try {
        this.mgr.socialBc.postMessage({
          type: 'LOCAL_SOCIAL_STATE_SYNC',
          _senderInstanceId: this.mgr.instanceId,
          friends: this.mgr.state.friends,
          incomingRequests: this.mgr.state.incomingRequests,
          outgoingRequests: this.mgr.state.outgoingRequests,
          userProfile: this.mgr.userProfile
        })
      } catch {}
    }
  }

  triggerRapidSocialSync() {
    const code = this.mgr.userProfile?.friendCode
    this.mgr.ensurePresencePeerAlive()
    this.mgr.pollEdgeSocialMailbox()
    this.mgr.pollBackendSocial()
    if (code) {
      this.mgr.pollSocialCloudInbox(code, true)
    }
    this.mgr.pingAllFriends()
    ;[350, 900, 2000, 3800].forEach((ms) => {
      setTimeout(() => {
        this.mgr.pollEdgeSocialMailbox()
        this.mgr.pollBackendSocial()
        if (code) {
          this.mgr.pollSocialCloudInbox(code, true)
        }
        this.mgr.pingAllFriends()
      }, ms)
    })
  }


  getMyPublicSummary() {
    const snap = this.mgr.eventHandlers.getHostPlaybackSnapshot
      ? this.mgr.eventHandlers.getHostPlaybackSnapshot()
      : null
    const confirmedFriendCodes = (this.mgr.state?.friends || [])
      .map((f) => normalizeFriendCode(f.friendCode))
      .filter(Boolean)
      .slice(0, 30)
    const outgoingRequestCodes = (this.mgr.state?.outgoingRequests || [])
      .map((r) => normalizeFriendCode(r.friendCode))
      .filter(Boolean)
      .slice(0, 30)

    const cleanPicture =
      typeof this.mgr.userProfile?.picture === 'string' &&
      this.mgr.userProfile.picture.startsWith('http') &&
      this.mgr.userProfile.picture.length < 500
        ? this.mgr.userProfile.picture
        : ''

    return {
      id: this.mgr.userProfile?.id || 'usr',
      friendCode: this.mgr.userProfile?.friendCode || '',
      name: (this.mgr.userProfile?.name || 'Friend').slice(0, 40),
      avatar: '',
      picture: cleanPicture,
      confirmedFriendCodes,
      outgoingRequestCodes,
      currentTrack: snap?.track
        ? {
            video_id: snap.track.video_id,
            title: (snap.track.title || '').slice(0, 80),
            artist: (snap.track.artist || '').slice(0, 80),
            thumbnail:
              typeof snap.track.thumbnail === 'string' && snap.track.thumbnail.length < 300
                ? snap.track.thumbnail
                : '',
            duration_text: snap.track.duration_text || ''
          }
        : null,
      isPlaying: Boolean(snap?.isPlaying),
      activeJamCode: this.mgr.state.active ? this.mgr.state.roomCode : '',
      timestamp: Date.now()
    }
  }

  buildPresencePayload(type, extra = {}) {
    const packetId = extra.msgId || extra._packetId || `${type}_${this.mgr.userProfile?.friendCode || 'USR'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    return {
      type,
      msgId: packetId,
      _packetId: packetId,
      from: this.mgr.getMyPublicSummary(),
      _fromFriendCode: this.mgr.userProfile.friendCode,
      _senderInstanceId: this.mgr.instanceId,
      sentAt: Date.now(),
      ...extra
    }
  }

  /**
   * Pillar 2: ACK-Verified Retry Handshake for Outbound Packets (FRIEND_REQUEST, FRIEND_ACCEPTED, JAM_INVITE, etc.)
   */

  pingAllFriends() {
    const friends = this.mgr.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.mgr.sendSocialPacket(
          f.friendCode,
          this.mgr.buildPresencePayload('PRESENCE_PING', { isConfirmedFriend: true }),
          { useCloud: false }
        )
      }
    }
  }

  retryOutgoingRequests() {
    const outgoing = this.mgr.state.outgoingRequests || []
    if (!outgoing.length) return
    this.mgr.cloudRetryTick = (this.mgr.cloudRetryTick || 0) + 1
    // Only use Cloud Relay every 5th cycle (~15s) to prevent HTTP 429 rate-limiting
    const useCloudNow = this.mgr.cloudRetryTick % 5 === 1
    for (const req of outgoing) {
      if (req.friendCode) {
        const probePkt = this.mgr.buildPresencePayload('FRIEND_STATUS_PROBE', { isPendingOutgoing: true })
        this.mgr.sendSocialPacket(req.friendCode, probePkt, { useCloud: useCloudNow })
        this.mgr.sendEdgeSocialPacket(
          req.friendCode,
          this.mgr.buildPresencePayload('FRIEND_REQUEST', { isPendingOutgoing: true })
        )
      }
    }
  }

  broadcastPresenceStatus() {
    const friends = this.mgr.state.friends || []
    for (const f of friends) {
      if (f.friendCode) {
        this.mgr.sendSocialPacket(
          f.friendCode,
          this.mgr.buildPresencePayload('PRESENCE_STATUS', { isConfirmedFriend: true }),
          { useCloud: false }
        )
      }
    }
    this.mgr.pollBackendSocial()
  }

  pruneStaleFriendPresence() {
    const ONLINE_TTL_MS = 35000
    const now = Date.now()
    let changed = false
    const nextFriends = (this.mgr.state.friends || []).map((f) => {
      if (f.online && f.lastSeen && now - f.lastSeen > ONLINE_TTL_MS) {
        changed = true
        return { ...f, online: false }
      }
      return f
    })
    if (changed) {
      const sorted = sortFriendsDeterministically(nextFriends)
      this.mgr.updateState({ friends: sorted })
      saveJsonArray(FRIENDS_LIST_STORAGE_KEY, sorted)
    }
  }

  hasSenderConfirmedMe(sender, packetData = null) {
    if (packetData?.isConfirmedFriend === true) return true
    const myCode = normalizeFriendCode(this.mgr.userProfile?.friendCode)
    if (!myCode) return false
    if (Array.isArray(sender?.confirmedFriendCodes)) {
      return sender.confirmedFriendCodes.some((c) => normalizeFriendCode(c) === myCode)
    }
    return false
  }

  hasSenderRequestedMe(sender, packetData = null) {
    if (packetData?.isPendingOutgoing === true) return true
    const myCode = normalizeFriendCode(this.mgr.userProfile?.friendCode)
    if (!myCode) return false
    if (Array.isArray(sender?.outgoingRequestCodes)) {
      return sender.outgoingRequestCodes.some((c) => normalizeFriendCode(c) === myCode)
    }
    return false
  }


  processIncomingFriendRequest(sender, data, conn) {
    const myCode = normalizeFriendCode(this.mgr.userProfile?.friendCode)
    if (!sender?.friendCode || sender.friendCode === myCode) return

    const isAlreadyFriend = this.mgr.state.friends.some((f) => f.friendCode === sender.friendCode)
    const isOutgoingPending = this.mgr.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode)

    if (isAlreadyFriend) {
      this.mgr.updateFriendPresence(sender, data)
      const acceptReply = this.mgr.buildPresencePayload('FRIEND_ACCEPTED', {
        targetFriendCode: sender.friendCode,
        isConfirmedFriend: true
      })
      if (conn && conn.open) {
        try {
          conn.send(acceptReply)
        } catch {}
      }
      this.mgr.sendWithAck(sender.friendCode, acceptReply, 3)
      return
    }

    // Pillar 4 Cross-Request Auto-Match: If we also have an outgoing request to sender, auto-accept both!
    if (isOutgoingPending) {
      this.mgr.promoteToConfirmedFriend(sender)
      const acceptReply = this.mgr.buildPresencePayload('FRIEND_ACCEPTED', {
        targetFriendCode: sender.friendCode,
        isConfirmedFriend: true
      })
      if (conn && conn.open) {
        try {
          conn.send(acceptReply)
        } catch {}
      }
      this.mgr.sendWithAck(sender.friendCode, acceptReply, 4)
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify(`You and ${sender.name} are now friends!`, 'success')
      }
      return
    }

    const cleanSenderPic =
      typeof sender.picture === 'string' && sender.picture.startsWith('http') && sender.picture.length < 500
        ? sender.picture
        : ''
    const existsIn = this.mgr.state.incomingRequests.some((r) => r.friendCode === sender.friendCode)
    const reqEntry = {
      friendCode: sender.friendCode,
      name: sender.name || `Friend ${sender.friendCode.slice(-4)}`,
      avatar: '',
      picture: cleanSenderPic,
      currentTrack: sender.currentTrack || null,
      requestedAt: Date.now()
    }
    const nextIn = existsIn
      ? this.mgr.state.incomingRequests.map((r) =>
          r.friendCode === sender.friendCode ? { ...r, ...reqEntry } : r
        )
      : [reqEntry, ...this.mgr.state.incomingRequests]

    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    this.mgr.updateState({
      incomingRequests: nextIn,
      latestFriendRequestToast: reqEntry
    })
    this.mgr.broadcastLocalSocialState()
    if (!existsIn && this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify(`👋 New friend request from ${reqEntry.name}!`, 'info')
    }
  }

  handleSocialPacket(data, conn) {
    if (!data || typeof data !== 'object') return
    if (data._senderInstanceId && data._senderInstanceId === this.mgr.instanceId) return

    const myCode = normalizeFriendCode(this.mgr.userProfile?.friendCode || loadJamUserProfile()?.friendCode)
    if (data.targetFriendCode && myCode && normalizeFriendCode(data.targetFriendCode) !== myCode) {
      return
    }

    const rawSender = data.from && typeof data.from === 'object' ? data.from : data
    const sender = {
      ...rawSender,
      friendCode: normalizeFriendCode(rawSender.friendCode || data._fromFriendCode || data.friendCode),
      avatar: ''
    }
    if (!sender.friendCode || (myCode && sender.friendCode === myCode)) return

    // Save incoming connection in activeFriendConnections for reverse-path piggybacking
    if (conn && conn.open) {
      this.mgr.activeFriendConnections.set(sender.friendCode, conn)
      this.mgr.flushPendingForFriend(sender.friendCode, conn)
    }

    // Handle PACKET_ACK immediately
    if (data.type === 'PACKET_ACK') {
      this.mgr.acknowledgePacket(data.msgId || data._packetId, sender)
      return
    }

    // Send PACKET_ACK for reliable packet types BEFORE deduplication return so retries stop on sender
    const incomingMsgId = data.msgId || data._packetId
    if (
      incomingMsgId &&
      (data.type === 'FRIEND_REQUEST' ||
        data.type === 'FRIEND_ACCEPTED' ||
        data.type === 'FRIEND_SYNC_ACK' ||
        data.type === 'FRIEND_REMOVED' ||
        data.type === 'JAM_INVITE')
    ) {
      this.mgr.sendPacketAck(sender.friendCode, incomingMsgId, conn)
      const isAlreadySeen = this.mgr.markPacketSeen(incomingMsgId)
      if (isAlreadySeen) {
        this.mgr.updateFriendPresence(sender, data)
        const isStillPending = this.mgr.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode)
        if (!isStillPending || (data.type !== 'FRIEND_ACCEPTED' && data.type !== 'FRIEND_SYNC_ACK')) {
          return
        }
      }
    }

    const isAlreadyFriend = this.mgr.state.friends.some((f) => f.friendCode === sender.friendCode)
    const isOutgoingPending = this.mgr.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode)
    const senderConfirmedMe = this.mgr.hasSenderConfirmedMe(sender, data)
    const senderRequestedMe = this.mgr.hasSenderRequestedMe(sender, data)

    // Layer 3 Auto-Reconciliation: If we have an outgoing request to sender AND sender already has us in their confirmed friends (or sends acceptance), promote immediately!
    if (isOutgoingPending && (senderConfirmedMe || data.type === 'FRIEND_ACCEPTED' || data.type === 'FRIEND_SYNC_ACK') && data.type !== 'FRIEND_REMOVED') {
      this.mgr.promoteToConfirmedFriend(sender)
      const ackReply = this.mgr.buildPresencePayload('FRIEND_SYNC_ACK', {
        targetFriendCode: sender.friendCode,
        isConfirmedFriend: true
      })
      if (conn && conn.open) {
        try {
          conn.send(ackReply)
        } catch {}
      }
      this.mgr.sendWithAck(sender.friendCode, ackReply, 3)
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
      }
      return
    }

    // Reverse-Path Request Discovery: If ANY packet (probe, ping, pong) from sender indicates they have a pending outgoing request to us, materialize it!
    if (
      senderRequestedMe &&
      !isAlreadyFriend &&
      data.type !== 'FRIEND_REQUEST' &&
      data.type !== 'FRIEND_REMOVED' &&
      data.type !== 'FRIEND_DECLINED'
    ) {
      const declinedAt = this.mgr.declinedRequestTimestamps.get(sender.friendCode) || 0
      const pktTime = Number(data.sentAt || sender.timestamp || Date.now())
      if (!declinedAt || pktTime > declinedAt + 3000) {
        this.mgr.processIncomingFriendRequest(sender, data, conn)
      }
    }

    switch (data.type) {
      case 'FRIEND_STATUS_PROBE':
      case 'PRESENCE_PING': {
        this.mgr.updateFriendPresence(sender, data)

        // If sender is already a confirmed friend on our side, tell them explicitly so their Outgoing Pending upgrades immediately!
        if (isAlreadyFriend) {
          const pongReply = this.mgr.buildPresencePayload('PRESENCE_PONG', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try {
              conn.send(pongReply)
            } catch {}
          } else {
            this.mgr.sendSocialPacket(sender.friendCode, pongReply, { useCloud: true })
          }

          if (data.type === 'FRIEND_STATUS_PROBE' || data.isPendingOutgoing) {
            const acceptReply = this.mgr.buildPresencePayload('FRIEND_ACCEPTED', {
              targetFriendCode: sender.friendCode,
              isConfirmedFriend: true
            })
            if (conn && conn.open) {
              try {
                conn.send(acceptReply)
              } catch {}
            }
            this.mgr.sendWithAck(sender.friendCode, acceptReply, 3)
          }
          break
        }

        // If both users sent requests to each other (mutual pending), auto-promote both sides!
        if (isOutgoingPending && (data.type === 'FRIEND_STATUS_PROBE' || data.isPendingOutgoing || senderRequestedMe)) {
          this.mgr.promoteToConfirmedFriend(sender)
          const acceptReply = this.mgr.buildPresencePayload('FRIEND_ACCEPTED', {
            targetFriendCode: sender.friendCode,
            isConfirmedFriend: true
          })
          if (conn && conn.open) {
            try {
              conn.send(acceptReply)
            } catch {}
          }
          this.mgr.sendWithAck(sender.friendCode, acceptReply, 4)
          if (this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`You and ${sender.name} are now friends!`, 'success')
          }
          break
        }

        const reply = this.mgr.buildPresencePayload('PRESENCE_PONG', {
          targetFriendCode: sender.friendCode,
          isConfirmedFriend: false
        })
        if (conn && conn.open) {
          try {
            conn.send(reply)
          } catch {}
        } else {
          this.mgr.sendSocialPacket(sender.friendCode, reply, { useCloud: false })
        }
        break
      }

      case 'PRESENCE_PONG':
      case 'PRESENCE_STATUS': {
        this.mgr.updateFriendPresence(sender, data)
        break
      }

      case 'FRIEND_REQUEST': {
        this.mgr.processIncomingFriendRequest(sender, data, conn)
        break
      }

      case 'FRIEND_ACCEPTED': {
        const wasAlreadyFriend = this.mgr.state.friends.some((f) => f.friendCode === sender.friendCode)
        this.mgr.promoteToConfirmedFriend(sender)
        // Layer 2 Bidirectional Handshake: Send FRIEND_SYNC_ACK back to the accepter so both sides lock in online presence & latest profile immediately
        const ackReply = this.mgr.buildPresencePayload('FRIEND_SYNC_ACK', {
          targetFriendCode: sender.friendCode,
          isConfirmedFriend: true
        })
        if (conn && conn.open) {
          try {
            conn.send(ackReply)
          } catch {}
        }
        this.mgr.sendWithAck(sender.friendCode, ackReply, 3)
        if (!wasAlreadyFriend && this.mgr.eventHandlers.onNotify) {
          this.mgr.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
        }
        break
      }

      case 'FRIEND_SYNC_ACK': {
        const wasAlreadyFriend = this.mgr.state.friends.some((f) => f.friendCode === sender.friendCode)
        const wasPending =
          this.mgr.state.outgoingRequests.some((r) => r.friendCode === sender.friendCode) ||
          this.mgr.state.incomingRequests.some((r) => r.friendCode === sender.friendCode)
        if (wasAlreadyFriend || wasPending) {
          this.mgr.promoteToConfirmedFriend(sender)
          if (!wasAlreadyFriend && this.mgr.eventHandlers.onNotify) {
            this.mgr.eventHandlers.onNotify(`${sender.name} accepted your friend request!`, 'success')
          }
        }
        break
      }

      case 'FRIEND_REMOVED': {
        const cleanSender = sender.friendCode
        const packetTs = Number(data.sentAt || data.from?.timestamp || 0)
        const existingFriend = (this.mgr.state.friends || []).find((f) => f.friendCode === cleanSender)
        const existingOut = (this.mgr.state.outgoingRequests || []).find((r) => r.friendCode === cleanSender)
        const newestLocalTs = Math.max(
          Number(existingFriend?.acceptedAt || 0),
          Number(existingOut?.sentAt || 0)
        )
        // Ignore stale historical FRIEND_REMOVED packets that predate our latest friend action
        if (packetTs > 0 && newestLocalTs > 0 && packetTs + 2000 < newestLocalTs) {
          return
        }

        const activeConn = this.mgr.activeFriendConnections.get(cleanSender)
        if (activeConn) {
          try {
            activeConn.close()
          } catch {}
          this.mgr.activeFriendConnections.delete(cleanSender)
        }
        this.mgr.pendingPeerConns.delete(cleanSender)
        this.mgr.pendingPeerPackets.delete(cleanSender)

        const nextFriends = (this.mgr.state.friends || []).filter((f) => f.friendCode !== cleanSender)
        const nextOut = (this.mgr.state.outgoingRequests || []).filter((r) => r.friendCode !== cleanSender)
        const nextIn = (this.mgr.state.incomingRequests || []).filter((r) => r.friendCode !== cleanSender)

        saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
        saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
        saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)

        this.mgr.updateState({
          friends: nextFriends,
          outgoingRequests: nextOut,
          incomingRequests: nextIn
        })
        this.mgr.broadcastLocalSocialState()
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
        this.mgr.updateState({ incomingJamInvite: invite })
        if (this.mgr.eventHandlers.onJamInvite) {
          this.mgr.eventHandlers.onJamInvite(invite)
        }
        if (this.mgr.eventHandlers.onNotify) {
          this.mgr.eventHandlers.onNotify(
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
    if (!cleanCode || cleanCode === this.mgr.userProfile?.friendCode) return

    // If sender is not a friend yet, check if their public summary shows they have an outgoing request to us!
    const isAlreadyFriend = this.mgr.state.friends.some((f) => f.friendCode === cleanCode)
    if (!isAlreadyFriend && this.mgr.hasSenderRequestedMe(sender, packetData)) {
      const declinedAt = this.mgr.declinedRequestTimestamps.get(cleanCode) || 0
      if (!declinedAt || Date.now() - declinedAt > 15000) {
        this.mgr.processIncomingFriendRequest(sender, packetData, null)
      }
    }

    // If sender is in outgoingRequests AND their summary confirms they already added us, auto-promote to confirmed friend!
    const outIdx = this.mgr.state.outgoingRequests.findIndex((r) => r.friendCode === cleanCode)
    if (outIdx !== -1) {
      if (this.mgr.hasSenderConfirmedMe(sender, packetData)) {
        this.mgr.promoteToConfirmedFriend(sender)
        if (this.mgr.eventHandlers.onNotify) {
          this.mgr.eventHandlers.onNotify(`${sender.name || cleanCode} accepted your friend request!`, 'success')
        }
        return
      }
      const prevOut = this.mgr.state.outgoingRequests[outIdx]
      const nextOutName = sender.name || prevOut.name
      const nextOutPic = sender.picture || prevOut.picture || ''
      if (!prevOut.online || prevOut.name !== nextOutName || (prevOut.picture || '') !== nextOutPic) {
        const nextOut = [...this.mgr.state.outgoingRequests]
        nextOut[outIdx] = {
          ...prevOut,
          name: nextOutName,
          picture: nextOutPic,
          online: true
        }
        saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
        this.mgr.updateState({ outgoingRequests: nextOut })
      }
    }

    const idx = this.mgr.state.friends.findIndex((f) => f.friendCode === cleanCode)
    if (idx === -1) return

    const existing = this.mgr.state.friends[idx]
    const now = Date.now()
    // Always refresh lastSeen in-place so the 35s online hysteresis window stays fresh
    existing.lastSeen = now

    const nextName = sender.name || existing.name
    const nextPic = sender.picture || existing.picture || ''
    const nextTrack = sender.currentTrack || sender.nowPlaying || null
    const nextIsPlaying = Boolean(sender.isPlaying)
    const nextJamCode = sender.activeJamCode || sender.roomCode || ''

    const uiChanged =
      !existing.online ||
      existing.name !== nextName ||
      (existing.picture || '') !== nextPic ||
      (existing.currentTrack?.video_id || '') !== (nextTrack?.video_id || '') ||
      (existing.currentTrack?.title || '') !== (nextTrack?.title || '') ||
      Boolean(existing.isPlaying) !== nextIsPlaying ||
      (existing.activeJamCode || '') !== nextJamCode

    if (!uiChanged) {
      // Quiet heartbeat: only lastSeen updated — skip React state churn & re-sorting!
      return
    }

    const updatedFriend = {
      ...existing,
      name: nextName,
      avatar: '',
      picture: nextPic,
      online: true,
      lastSeen: now,
      currentTrack: nextTrack,
      isPlaying: nextIsPlaying,
      activeJamCode: nextJamCode
    }
    const nextFriends = [...this.mgr.state.friends]
    nextFriends[idx] = updatedFriend
    const sorted = sortFriendsDeterministically(nextFriends)
    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, sorted)
    this.mgr.updateState({ friends: sorted })
  }

  promoteToConfirmedFriend(sender) {
    const cleanCode = normalizeFriendCode(sender.friendCode)
    if (!cleanCode) return

    this.mgr.declinedRequestTimestamps.delete(cleanCode)
    const nextIn = this.mgr.state.incomingRequests.filter((r) => r.friendCode !== cleanCode)
    const nextOut = this.mgr.state.outgoingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)

    const existing = this.mgr.state.friends.find((f) => f.friendCode === cleanCode)
    const cleanPic =
      typeof sender.picture === 'string' && sender.picture.startsWith('http') && sender.picture.length < 500
        ? sender.picture
        : (existing?.picture && existing.picture.startsWith('http') && existing.picture.length < 500 ? existing.picture : '')
    const friendEntry = {
      friendCode: cleanCode,
      name: sender.name || existing?.name || `Friend ${cleanCode.slice(-4)}`,
      avatar: '',
      picture: cleanPic,
      online: true,
      lastSeen: Date.now(),
      acceptedAt: existing?.acceptedAt || Date.now(),
      currentTrack: sender.currentTrack ?? existing?.currentTrack ?? null,
      isPlaying: sender.isPlaying !== undefined ? Boolean(sender.isPlaying) : Boolean(existing?.isPlaying),
      activeJamCode: sender.activeJamCode ?? existing?.activeJamCode ?? ''
    }

    const rawFriends = existing
      ? this.mgr.state.friends.map((f) => (f.friendCode === cleanCode ? { ...f, ...friendEntry } : f))
      : [friendEntry, ...this.mgr.state.friends]
    const nextFriends = sortFriendsDeterministically(rawFriends)

    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.mgr.updateState({
      friends: nextFriends,
      incomingRequests: nextIn,
      outgoingRequests: nextOut,
      latestFriendRequestToast:
        this.mgr.state.latestFriendRequestToast?.friendCode === cleanCode
          ? null
          : this.mgr.state.latestFriendRequestToast
    })
    this.mgr.broadcastLocalSocialState()
  }

  sendFriendRequest(rawCode) {
    const targetCode = normalizeFriendCode(rawCode)
    if (!targetCode || targetCode.length < 7) {
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify('Enter a valid Friend Code (e.g. UP-7K4M9P)', 'warning')
      }
      return { ok: false, error: 'Enter a valid Friend Code (e.g. UP-7K4M9P)' }
    }

    if (targetCode === this.mgr.userProfile.friendCode) {
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify(
          'That is your own Friend Code! Share it with a friend or click the refresh icon next to your ID to generate a separate test ID.',
          'warning'
        )
      }
      return { ok: false, error: 'Cannot add your own Friend Code' }
    }

    this.mgr.declinedRequestTimestamps.delete(targetCode)

    if (this.mgr.state.friends.some((f) => f.friendCode === targetCode)) {
      this.mgr.sendSocialPacket(
        targetCode,
        this.mgr.buildPresencePayload('PRESENCE_PING', { isConfirmedFriend: true }),
        { useCloud: false }
      )
      if (this.mgr.eventHandlers.onNotify) {
        this.mgr.eventHandlers.onNotify('Already in your Friends list!', 'info')
      }
      return { ok: true, status: 'already_friends' }
    }

    const incomingMatch = this.mgr.state.incomingRequests.find((r) => r.friendCode === targetCode)
    if (incomingMatch) {
      this.mgr.acceptFriendRequest(targetCode)
      return { ok: true, status: 'accepted' }
    }

    const existingOut = this.mgr.state.outgoingRequests.find((r) => r.friendCode === targetCode)
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
      ...this.mgr.state.outgoingRequests.filter((r) => r.friendCode !== targetCode)
    ]
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
    this.mgr.updateState({ outgoingRequests: nextOut })
    this.mgr.broadcastLocalSocialState()

    // Dual-Transport Dispatch: P2P sendWithAck + Edge Mailbox (/api/social) + Cloud Relay
    const reqPacket = this.mgr.buildPresencePayload('FRIEND_REQUEST', {
      targetFriendCode: targetCode,
      isPendingOutgoing: true
    })
    this.mgr.sendWithAck(targetCode, reqPacket, 4)
    this.mgr.sendSocialCloudPacket(targetCode, reqPacket)
    this.mgr.triggerRapidSocialSync()

    if (this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify(`Friend request sent to ${targetCode}`, 'success')
    }
    return { ok: true, status: 'sent' }
  }

  acceptFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return
    const req = this.mgr.state.incomingRequests.find((r) => r.friendCode === cleanCode) || {
      friendCode: cleanCode,
      name: `Friend ${cleanCode.slice(-4)}`,
      avatar: ''
    }
    // 1. Promote locally FIRST so getMyPublicSummary().confirmedFriendCodes immediately includes cleanCode
    this.mgr.promoteToConfirmedFriend(req)

    // 2. Dispatch FRIEND_ACCEPTED with ACK-verified retry handshake + Edge Mailbox + Cloud Relay
    const acceptPacket = this.mgr.buildPresencePayload('FRIEND_ACCEPTED', {
      targetFriendCode: cleanCode,
      isConfirmedFriend: true
    })
    this.mgr.sendWithAck(cleanCode, acceptPacket, 4)
    this.mgr.sendSocialCloudPacket(cleanCode, acceptPacket)

    this.mgr.triggerRapidSocialSync()
    if (this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify(`Added ${req.name} to Friends`, 'success')
    }
  }

  declineFriendRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (cleanCode) {
      this.mgr.declinedRequestTimestamps.set(cleanCode, Date.now())
    }
    const nextIn = this.mgr.state.incomingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_IN_STORAGE_KEY, nextIn)
    this.mgr.updateState({
      incomingRequests: nextIn,
      latestFriendRequestToast:
        this.mgr.state.latestFriendRequestToast?.friendCode === cleanCode
          ? null
          : this.mgr.state.latestFriendRequestToast
    })
    this.mgr.broadcastLocalSocialState()
  }

  dismissFriendRequestToast() {
    this.mgr.updateState({ latestFriendRequestToast: null })
  }

  cancelOutgoingRequest(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    const nextOut = this.mgr.state.outgoingRequests.filter((r) => r.friendCode !== cleanCode)
    saveJsonArray(FRIEND_REQ_OUT_STORAGE_KEY, nextOut)
    this.mgr.updateState({ outgoingRequests: nextOut })
    this.mgr.broadcastLocalSocialState()
  }

  removeFriend(friendCode) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return

    // Notify the other user across all channels so they update their friends list in real time
    this.mgr.sendWithAck(
      cleanCode,
      this.mgr.buildPresencePayload('FRIEND_REMOVED', { targetFriendCode: cleanCode }),
      3
    )

    // Terminate any active direct WebRTC data connection
    const activeConn = this.mgr.activeFriendConnections.get(cleanCode)
    if (activeConn) {
      try {
        activeConn.close()
      } catch {}
      this.mgr.activeFriendConnections.delete(cleanCode)
    }
    this.mgr.pendingPeerConns.delete(cleanCode)
    this.mgr.pendingPeerPackets.delete(cleanCode)

    const nextFriends = this.mgr.state.friends.filter((f) => f.friendCode !== cleanCode)
    saveJsonArray(FRIENDS_LIST_STORAGE_KEY, nextFriends)
    this.mgr.updateState({ friends: nextFriends })
    this.mgr.broadcastLocalSocialState()

    if (this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify('Friend removed', 'info')
    }
  }

  async inviteFriendToJam(friendCode, googleUser = null) {
    const cleanCode = normalizeFriendCode(friendCode)
    if (!cleanCode) return

    let roomCode = this.mgr.state.roomCode
    if (!this.mgr.state.active || !roomCode) {
      roomCode = await this.mgr.createJam(googleUser, 'open_party')
    }

    const snap = this.mgr.eventHandlers.getHostPlaybackSnapshot
      ? this.mgr.eventHandlers.getHostPlaybackSnapshot()
      : null

    this.mgr.sendWithAck(
      cleanCode,
      this.mgr.buildPresencePayload('JAM_INVITE', {
        roomCode,
        hostName: this.mgr.userProfile.name,
        hostAvatar: '',
        currentTrack: snap?.track || null
      }),
      4
    )

    const friend = this.mgr.state.friends.find((f) => f.friendCode === cleanCode)
    if (this.mgr.eventHandlers.onNotify) {
      this.mgr.eventHandlers.onNotify(
        `Invited ${friend?.name || cleanCode} to Jam (${roomCode})`,
        'success'
      )
    }
    return roomCode
  }

  dismissJamInvite() {
    this.mgr.updateState({ incomingJamInvite: null })
  }

}
