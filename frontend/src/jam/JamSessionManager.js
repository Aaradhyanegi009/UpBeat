/**
 * Unified Jam Session & Social Manager composing PeerJS WebRTC, Cloud/Edge Relays,
 * Friend Requests, and Star-Topology Room Sync.
 */
import { Peer } from "peerjs"
import {
  FRIENDS_LIST_STORAGE_KEY,
  FRIEND_REQ_IN_STORAGE_KEY,
  FRIEND_REQ_OUT_STORAGE_KEY,
  SEEN_PACKETS_STORAGE_KEY,
  generateFriendCode,
  loadJamUserProfile,
  loadJsonArray,
  normalizeFriendCode,
  saveJamUserProfile,
  saveJsonArray
} from "./jamUtils.js"
import { CloudRelayTransport } from "./cloudRelayTransport.js"
import { PeerTransport } from "./peerTransport.js"
import { SocialController } from "./socialController.js"
import { RoomController } from "./roomController.js"

export class JamSessionManager {
  constructor(options = {}) {
    this.PeerClass = options.PeerClass || Peer
    this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? (...a) => fetch(...a) : null)
    this.autoInit = options.autoInit !== false
    // Unique runtime instance ID per tab/window so multiple tabs on the same browser don't collide
    this.instanceId = `inst_${Math.random().toString(36).slice(2, 10)}`
    this.seenPacketIds = new Set(loadJsonArray(SEEN_PACKETS_STORAGE_KEY))
    this.cloudRetryTick = 0
    this.initialCloudPollDone = false
    this.lastCloudPollAt = 0
    this.isModalOpen = false

    // Monotonic sequence counters & timestamps for Star-Topology multi-node state deduplication
    this.stateSeq = 0
    this.lastAppliedSeq = 0
    this.lastPlayStateTimestamp = 0

    this.peer = null
    this.hostConnections = new Map() // clientId/peerId -> DataConnection (Star topology router on Host)
    this.connections = this.hostConnections // Alias for backward compatibility
    this.hostConn = null // DataConnection to Host (used by Guest)
    this.bc = null // Same-browser BroadcastChannel for Jam room
    this.roomEventSource = null // Cloud SSE stream for Jam room
    this.roomPollTimer = null
    this.lastRoomServerTs = 0

    this.presencePeer = null
    this.presencePeerReclaimTimer = null
    this.lastPresencePeerAttemptAt = 0
    this.auxClientPeer = null // Fallback outgoing Peer if fixed ID is temporarily busy
    this.activeFriendConnections = new Map() // friendCode (UP-XXXXXX) -> bidirectional DataConnection
    this.presenceConns = this.activeFriendConnections // Alias for backward compatibility
    this.pendingPeerConns = new Map() // friendCode -> DataConnection currently opening
    this.pendingPeerPackets = new Map() // friendCode -> Array<Packet> queued while opening
    this.pendingAckPackets = new Map() // msgId -> { targetFriendId, packet, acked, timers }
    this.declinedRequestTimestamps = new Map() // friendCode -> timestamp of explicit decline
    this.socialBc = null
    this.socialEventSource = null // Cloud SSE stream for user's social inbox
    this.presenceTimer = null
    this.backendPollTimer = null
    this.edgePollTick = 0
    this.lastSocialServerTs = 0

    this.syncInterval = null
    this.pingInterval = null
    this.clockSamples = []

    this.cloudTransport = new CloudRelayTransport(this)
    this.peerTransport = new PeerTransport(this)
    this.socialController = new SocialController(this)
    this.roomController = new RoomController(this)

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

    if (this.autoInit && typeof window !== 'undefined') {
      this.initPresenceNetwork()
    }
  }

  setModalOpen(isOpen) {
    const wasOpen = this.isModalOpen
    this.isModalOpen = Boolean(isOpen)
    if (this.isModalOpen && !wasOpen) {
      this.ensurePresencePeerAlive()
      this.triggerRapidSocialSync()
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

  notifyListeners() {
    for (const fn of this.listeners) {
      try {
        fn(this.state)
      } catch {}
    }
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
    this.notifyListeners()
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
    const cleanPicture =
      typeof this.userProfile?.picture === 'string' &&
      this.userProfile.picture.startsWith('http') &&
      this.userProfile.picture.length < 500
        ? this.userProfile.picture
        : ''

    return {
      id: this.getSelfParticipantId(),
      peerId: this.getSelfParticipantId(),
      friendCode: this.userProfile?.friendCode || '',
      name: (this.userProfile?.name || 'Participant').slice(0, 40),
      avatar: '',
      picture: cleanPicture,
      isHost: Boolean(isHost),
      rttMs: isHost ? 0 : 18,
      inSync: true,
      joinedAt: Date.now()
    }
  }


  initSocialCloudRelay(...args) { return this.cloudTransport.initSocialCloudRelay(...args) }
  pollSocialCloudInbox(...args) { return this.cloudTransport.pollSocialCloudInbox(...args) }
  sendSocialCloudPacket(...args) { return this.cloudTransport.sendSocialCloudPacket(...args) }
  getEdgeSocialUrls(...args) { return this.cloudTransport.getEdgeSocialUrls(...args) }
  sendEdgeSocialPacket(...args) { return this.cloudTransport.sendEdgeSocialPacket(...args) }
  pollEdgeSocialMailbox(...args) { return this.cloudTransport.pollEdgeSocialMailbox(...args) }
  pollBackendSocial(...args) { return this.cloudTransport.pollBackendSocial(...args) }
  sendBackendSocialPacket(...args) { return this.cloudTransport.sendBackendSocialPacket(...args) }
  setupRoomTransports(...args) { return this.cloudTransport.setupRoomTransports(...args) }
  teardownRoomTransports(...args) { return this.cloudTransport.teardownRoomTransports(...args) }
  pollCloudRoom(...args) { return this.cloudTransport.pollCloudRoom(...args) }
  sendCloudRoomPacket(...args) { return this.cloudTransport.sendCloudRoomPacket(...args) }
  pollBackendRoom(...args) { return this.cloudTransport.pollBackendRoom(...args) }
  sendBackendRoomPacket(...args) { return this.cloudTransport.sendBackendRoomPacket(...args) }
  restartPresenceNetwork(...args) { return this.peerTransport.restartPresenceNetwork(...args) }
  ensurePresencePeerAlive(...args) { return this.peerTransport.ensurePresencePeerAlive(...args) }
  initPresenceNetwork(...args) { return this.peerTransport.initPresenceNetwork(...args) }
  ensureAuxClientPeer(...args) { return this.peerTransport.ensureAuxClientPeer(...args) }
  getActiveSocialPeer(...args) { return this.peerTransport.getActiveSocialPeer(...args) }
  connectToPeerFriend(...args) { return this.peerTransport.connectToPeerFriend(...args) }
  flushPendingForFriend(...args) { return this.peerTransport.flushPendingForFriend(...args) }
  setupPresenceConn(...args) { return this.peerTransport.setupPresenceConn(...args) }
  sendWithAck(...args) { return this.peerTransport.sendWithAck(...args) }
  sendReliableToFriend(...args) { return this.peerTransport.sendReliableToFriend(...args) }
  acknowledgePacket(...args) { return this.peerTransport.acknowledgePacket(...args) }
  sendSocialPacket(...args) { return this.peerTransport.sendSocialPacket(...args) }
  sendPacketAck(...args) { return this.peerTransport.sendPacketAck(...args) }
  setupHostPeerConnection(...args) { return this.peerTransport.setupHostPeerConnection(...args) }
  broadcastLocalSocialState(...args) { return this.socialController.broadcastLocalSocialState(...args) }
  triggerRapidSocialSync(...args) { return this.socialController.triggerRapidSocialSync(...args) }
  getMyPublicSummary(...args) { return this.socialController.getMyPublicSummary(...args) }
  buildPresencePayload(...args) { return this.socialController.buildPresencePayload(...args) }
  pingAllFriends(...args) { return this.socialController.pingAllFriends(...args) }
  retryOutgoingRequests(...args) { return this.socialController.retryOutgoingRequests(...args) }
  broadcastPresenceStatus(...args) { return this.socialController.broadcastPresenceStatus(...args) }
  pruneStaleFriendPresence(...args) { return this.socialController.pruneStaleFriendPresence(...args) }
  hasSenderConfirmedMe(...args) { return this.socialController.hasSenderConfirmedMe(...args) }
  hasSenderRequestedMe(...args) { return this.socialController.hasSenderRequestedMe(...args) }
  processIncomingFriendRequest(...args) { return this.socialController.processIncomingFriendRequest(...args) }
  handleSocialPacket(...args) { return this.socialController.handleSocialPacket(...args) }
  updateFriendPresence(...args) { return this.socialController.updateFriendPresence(...args) }
  promoteToConfirmedFriend(...args) { return this.socialController.promoteToConfirmedFriend(...args) }
  sendFriendRequest(...args) { return this.socialController.sendFriendRequest(...args) }
  acceptFriendRequest(...args) { return this.socialController.acceptFriendRequest(...args) }
  declineFriendRequest(...args) { return this.socialController.declineFriendRequest(...args) }
  dismissFriendRequestToast(...args) { return this.socialController.dismissFriendRequestToast(...args) }
  cancelOutgoingRequest(...args) { return this.socialController.cancelOutgoingRequest(...args) }
  removeFriend(...args) { return this.socialController.removeFriend(...args) }
  inviteFriendToJam(...args) { return this.socialController.inviteFriendToJam(...args) }
  dismissJamInvite(...args) { return this.socialController.dismissJamInvite(...args) }
  createJam(...args) { return this.roomController.createJam(...args) }
  joinJam(...args) { return this.roomController.joinJam(...args) }
  startHostLoops(...args) { return this.roomController.startHostLoops(...args) }
  startGuestPingLoop(...args) { return this.roomController.startGuestPingLoop(...args) }
  stopLoops(...args) { return this.roomController.stopLoops(...args) }
  broadcastFromHost(...args) { return this.roomController.broadcastFromHost(...args) }
  sendToHost(...args) { return this.roomController.sendToHost(...args) }
  broadcastPlayState(...args) { return this.roomController.broadcastPlayState(...args) }
  broadcastSyncNow(...args) { return this.roomController.broadcastSyncNow(...args) }
  broadcastHostSync(...args) { return this.roomController.broadcastHostSync(...args) }
  broadcastParticipants(...args) { return this.roomController.broadcastParticipants(...args) }
  handleIncomingPacket(...args) { return this.roomController.handleIncomingPacket(...args) }
  emitControl(...args) { return this.roomController.emitControl(...args) }
  emitPlaybackControl(...args) { return this.roomController.emitPlaybackControl(...args) }
  emitQueueAdd(...args) { return this.roomController.emitQueueAdd(...args) }
  sendReaction(...args) { return this.roomController.sendReaction(...args) }
  setDjMode(...args) { return this.roomController.setDjMode(...args) }
  reportDriftStatus(...args) { return this.roomController.reportDriftStatus(...args) }
  leaveJam(...args) { return this.roomController.leaveJam(...args) }

  destroy() {
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null }
    if (this.backendPollTimer) { clearInterval(this.backendPollTimer); this.backendPollTimer = null }
    if (this.presencePeerReclaimTimer) { clearTimeout(this.presencePeerReclaimTimer); this.presencePeerReclaimTimer = null }
    this.roomController.leaveJam(true)
    this.cloudTransport.destroySocial()
    this.peerTransport.destroyAll()
    this.listeners.clear()
  }
}

export const jamManager = new JamSessionManager()
