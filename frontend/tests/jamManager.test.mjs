import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage, withWindowStub } from './helpers/test-env.mjs'
import * as jamBarrel from '../src/jamEngine.js'
import { JamSessionManager } from '../src/jam/JamSessionManager.js'

const EXPECTED_JAM_EXPORTS = [
  'JAM_AVATARS',
  'JAM_REACTIONS',
  'JAM_REACTION_PRESETS',
  'JamSessionManager',
  'buildFriendInviteUrl',
  'buildJamInviteUrl',
  'evaluateAudioDrift',
  'extractDeepLinkParams',
  'getAppBaseUrl',
  'jamManager',
  'loadJamUserProfile',
  'normalizeFriendCode',
  'normalizeFriendId',
  'normalizeRoomCode',
  'renderEmoji',
  'sanitizePayloadForCloud',
  'sanitizeStoredJamAndSocialData',
  'saveJamUserProfile',
  'sortFriendsDeterministically'
]

/** Minimal event-driven MockPeer for isolated unit tests without WebRTC/network access. */
function createMockPeerClass() {
  return class MockPeer {
    constructor(idOrOpts, maybeOpts) {
      this.id = typeof idOrOpts === 'string' ? idOrOpts : `peer_${Math.random().toString(36).slice(2, 7)}`
      this.options = typeof idOrOpts === 'object' ? idOrOpts : (maybeOpts || {})
      this.destroyed = false
      this.disconnected = false
      this.handlers = new Map()
    }
    on(evt, cb) {
      const list = this.handlers.get(evt) || []
      list.push(cb)
      this.handlers.set(evt, list)
    }
    connect(targetId) {
      const conn = {
        peer: targetId,
        open: true,
        sent: [],
        _handlers: new Map(),
        on(evt, cb) {
          const list = this._handlers.get(evt) || []
          list.push(cb)
          this._handlers.set(evt, list)
        },
        send(pkt) {
          this.sent.push(pkt)
        },
        close() {
          this.open = false
        }
      }
      return conn
    }
    reconnect() {}
    destroy() {
      this.destroyed = true
    }
  }
}

test('jamEngine barrel preserves all expected exports plus JamSessionManager', () => {
  assert.deepEqual(Object.keys(jamBarrel).sort(), EXPECTED_JAM_EXPORTS)
  for (const name of EXPECTED_JAM_EXPORTS) {
    assert.notEqual(jamBarrel[name], undefined, `Export ${name} should be defined`)
  }
})

test('bidirectional friend request -> acceptance -> confirmed two-way friend state + ACK cancellation', async () => {
  resetStorage()
  const MockPeer = createMockPeerClass()
  const postedToEdge = []

  const aliceFetch = async (url, init = {}) => {
    if (init.method === 'POST' && init.body) {
      postedToEdge.push({ url: String(url), payload: JSON.parse(init.body) })
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }

  // 1. Alice sends a friend request to Bob (UP-BOB234)
  const alice = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: aliceFetch })
  alice.updateUserProfile({ friendCode: 'UP-ALC123', name: 'Alice' })

  const bob = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) })
  bob.updateUserProfile({ friendCode: 'UP-BOB234', name: 'Bob' })

  try {
    const res = alice.sendFriendRequest('UP-BOB234')
    assert.deepEqual(res, { ok: true, status: 'sent' })
    assert.equal(alice.state.outgoingRequests.length, 1)
    assert.equal(alice.state.outgoingRequests[0].friendCode, 'UP-BOB234')
    assert.equal(alice.pendingAckPackets.size, 1, 'Pending ACK entry created for FRIEND_REQUEST')

    // Deliver Alice's outbound FRIEND_REQUEST packet directly to Bob
    const reqEntry = Array.from(alice.pendingAckPackets.values())[0]
    assert.ok(postedToEdge.length >= 1, 'Edge/cloud send attempted')

    // Switch localStorage profile context? Both in-memory managers can still process packets directly:
    bob.handleSocialPacket(reqEntry.packet, null)
    assert.equal(bob.state.incomingRequests.length, 1)
    assert.equal(bob.state.incomingRequests[0].friendCode, 'UP-ALC123')
    assert.equal(bob.state.latestFriendRequestToast?.friendCode, 'UP-ALC123')

    // 2. Alice receives PACKET_ACK -> pending retry timers cancelled immediately
    alice.handleSocialPacket(
      {
        type: 'PACKET_ACK',
        msgId: reqEntry.msgId,
        targetFriendCode: 'UP-ALC123',
        _senderInstanceId: bob.instanceId,
        from: { friendCode: 'UP-BOB234', name: 'Bob' }
      },
      null
    )
    assert.equal(alice.pendingAckPackets.size, 0, 'PACKET_ACK clears pending retry queue')

    // 3. Bob accepts -> Bob promotes Alice & dispatches FRIEND_ACCEPTED
    bob.acceptFriendRequest('UP-ALC123')
    assert.ok(bob.state.friends.some((f) => f.friendCode === 'UP-ALC123'))
    assert.equal(bob.state.incomingRequests.length, 0)

    const acceptEntry = Array.from(bob.pendingAckPackets.values()).find((e) => e.packet?.type === 'FRIEND_ACCEPTED')
    assert.ok(acceptEntry, 'FRIEND_ACCEPTED queued with ACK')

    // 4. Alice receives FRIEND_ACCEPTED -> promotes Bob to confirmed friends and removes outgoing request
    alice.handleSocialPacket(acceptEntry.packet, null)
    assert.ok(alice.state.friends.some((f) => f.friendCode === 'UP-BOB234'))
    assert.equal(alice.state.outgoingRequests.length, 0)

    // 5. Duplicate packet ID is suppressed cleanly by markPacketSeen
    const seenFirst = alice.markPacketSeen('dedup-pkt-1')
    const seenSecond = alice.markPacketSeen('dedup-pkt-1')
    assert.equal(seenFirst, false)
    assert.equal(seenSecond, true)
  } finally {
    alice.destroy()
    bob.destroy()
    resetStorage()
  }
})

test('mutual outgoing friend requests auto-match into confirmed friendship', () => {
  resetStorage()
  const MockPeer = createMockPeerClass()
  const bob = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: null })
  bob.updateUserProfile({ friendCode: 'UP-BOB234', name: 'Bob' })

  const notifications = []
  bob.setHandlers({ onNotify: (msg, kind) => notifications.push({ msg, kind }) })

  try {
    // Bob already sent request to Alice
    bob.sendFriendRequest('UP-ALC123')
    assert.equal(bob.state.outgoingRequests.length, 1)

    // Incoming FRIEND_REQUEST arrives from Alice -> should auto-match instead of queuing duplicate incomingRequest
    bob.handleSocialPacket(
      {
        type: 'FRIEND_REQUEST',
        msgId: 'freq_cross_1',
        _senderInstanceId: 'inst_alice',
        targetFriendCode: 'UP-BOB234',
        from: { friendCode: 'UP-ALC123', name: 'Alice', picture: 'https://example.com/a.jpg' }
      },
      null
    )

    assert.ok(bob.state.friends.some((f) => f.friendCode === 'UP-ALC123'))
    assert.equal(bob.state.outgoingRequests.length, 0)
    assert.equal(bob.state.incomingRequests.length, 0)
    assert.ok(notifications.some((n) => n.msg.includes('are now friends')))
  } finally {
    bob.destroy()
    resetStorage()
  }
})

test('multi-peer Star-Topology Jam room lists all participants, enforces DJ mode, and syncs monotonic play state', async () => {
  resetStorage()
  const MockPeer = createMockPeerClass()
  const host = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: null })
  host.updateUserProfile({ friendCode: 'UP-HST111', name: 'Host User' })

  const guest = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: null })
  guest.updateUserProfile({ friendCode: 'UP-GST222', name: 'Guest User' })

  const guestSyncs = []
  guest.setHandlers({
    onRemoteSync: (pkt, offset) => guestSyncs.push({ pkt, offset }),
    onNotify: () => {}
  })

  try {
    const roomCode = await host.createJam(null, 'host_only')
    assert.ok(roomCode.startsWith('JAM-'))
    assert.equal(host.state.role, 'host')
    assert.equal(host.state.djMode, 'host_only')
    assert.equal(host.state.participants.length, 1)

    // Simulate two remote guests joining Host via JAM_HELLO
    host.handleIncomingPacket(
      {
        type: 'JAM_HELLO',
        _fromRole: 'guest',
        _senderInstanceId: 'inst_guest_1',
        profile: { id: 'g1', friendCode: 'UP-GST222', name: 'Guest One', isHost: false }
      },
      null
    )
    host.handleIncomingPacket(
      {
        type: 'JAM_HELLO',
        _fromRole: 'guest',
        _senderInstanceId: 'inst_guest_2',
        profile: { id: 'g2', friendCode: 'UP-GST333', name: 'Guest Two', isHost: false }
      },
      null
    )

    assert.equal(host.state.participants.length, 3, 'Host tracks all 3 peers deterministically')
    assert.ok(host.state.participants.some((p) => p.friendCode === 'UP-GST222'))
    assert.ok(host.state.participants.some((p) => p.friendCode === 'UP-GST333'))

    // Simulate guest joining and enforcing host_only DJ mode locally
    guest.updateState({
      active: true,
      isHost: false,
      role: 'guest',
      roomCode,
      status: 'CONNECTED',
      djMode: 'host_only'
    })
    assert.equal(guest.emitControl('PAUSE', { currentTime: 42 }), false, 'Guest blocked from control in host_only mode')

    // Host broadcasts play state -> guest receives canonical JAM_PLAY_STATE
    host.broadcastPlayState(true, 42.5, {
      video_id: 'dQw4w9WgXcQ',
      title: 'Test Track',
      artist: 'Test Artist',
      duration: 215
    })
    assert.equal(host.stateSeq >= 1, true)

    guest.handleIncomingPacket(
      {
        type: 'JAM_PLAY_STATE',
        _fromRole: 'host',
        _senderInstanceId: host.instanceId,
        seq: 5,
        hostTimestamp: Date.now(),
        isPlaying: true,
        currentTime: 42.5,
        djMode: 'host_only',
        hostName: 'Host User',
        track: { video_id: 'dQw4w9WgXcQ', title: 'Test Track', artist: 'Test Artist' }
      },
      null
    )
    assert.equal(guestSyncs.length, 1)
    assert.equal(guestSyncs[0].pkt.forcePlayState, true)
    assert.equal(guestSyncs[0].pkt.isPlaying, true)

    // Reject stale out-of-order JAM_SYNC packet with lower sequence number
    guest.handleIncomingPacket(
      {
        type: 'JAM_SYNC',
        _fromRole: 'host',
        _senderInstanceId: host.instanceId,
        seq: 2,
        hostTimestamp: Date.now() - 5000,
        isPlaying: false,
        track: { video_id: 'dQw4w9WgXcQ', title: 'Stale Track', artist: 'Test Artist' }
      },
      null
    )
    assert.equal(guestSyncs.length, 1, 'Stale seq packet ignored cleanly')
  } finally {
    host.destroy()
    guest.destroy()
    resetStorage()
  }
})

test('sendReaction emits both emoji and reaction fields and JAM_PONG relays over cloud when conn is absent', async () => {
  resetStorage()
  const MockPeer = createMockPeerClass()
  const postedCloud = []

  const cloudFetch = async (url, init = {}) => {
    if (init.method === 'POST' && init.body) {
      postedCloud.push({ url: String(url), payload: JSON.parse(init.body) })
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }
  }

  const host = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: cloudFetch })
  host.updateUserProfile({ friendCode: 'UP-HST111', name: 'Host User' })
  const receivedReactions = []
  host.setHandlers({ onReaction: (pkt) => receivedReactions.push(pkt) })

  const guest = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: null })
  guest.updateUserProfile({ friendCode: 'UP-GST222', name: 'Guest User' })

  try {
    await host.createJam(null, 'open_party')
    postedCloud.length = 0

    host.sendReaction('🔥')
    assert.equal(receivedReactions.length, 1)
    assert.equal(receivedReactions[0].emoji, '🔥')
    assert.equal(receivedReactions[0].reaction, '🔥')
    const cloudReaction = postedCloud.find((p) => p.payload?.type === 'JAM_REACTION')
    assert.ok(cloudReaction, 'JAM_REACTION sent to cloud relay')
    assert.equal(cloudReaction.payload.emoji, '🔥')

    // Host replies to cloud-only JAM_PING (conn === null) with JAM_PONG via cloud relay
    postedCloud.length = 0
    host.handleIncomingPacket(
      {
        type: 'JAM_PING',
        t1: 1000,
        senderId: guest.getSelfParticipantId(),
        _fromRole: 'guest',
        _senderInstanceId: guest.instanceId
      },
      null
    )
    const cloudPong = postedCloud.find((p) => p.payload?.type === 'JAM_PONG')
    assert.ok(cloudPong, 'JAM_PONG sent over cloud relay when direct PeerJS conn is null')

    // Guest applying JAM_PONG updates clockOffsetMs and rttMs
    guest.updateState({ active: true, isHost: false, role: 'guest', status: 'CONNECTED' })
    const now = Date.now()
    guest.handleIncomingPacket(
      {
        type: 'JAM_PONG',
        t1: now - 40,
        t2: now + 500,
        t3: now + 502,
        targetId: guest.getSelfParticipantId(),
        _fromRole: 'host',
        _senderInstanceId: host.instanceId
      },
      null
    )
    assert.ok(Math.abs(guest.state.clockOffsetMs - 521) <= 25)
    assert.ok(guest.state.rttMs >= 2)
  } finally {
    host.destroy()
    guest.destroy()
    resetStorage()
  }
})

test('roomController conn close cleans up guest state when no relay is active and destroy() clears timers', async () => {
  resetStorage()
  let latestPeer = null
  let latestConn = null

  class EventedMockPeer {
    constructor() {
      this.destroyed = false
      this.disconnected = false
      this.handlers = new Map()
      latestPeer = this
    }
    on(evt, cb) {
      const list = this.handlers.get(evt) || []
      list.push(cb)
      this.handlers.set(evt, list)
    }
    emit(evt, arg) {
      for (const cb of this.handlers.get(evt) || []) cb(arg)
    }
    connect() {
      const conn = {
        open: true,
        handlers: new Map(),
        on(evt, cb) {
          const list = this.handlers.get(evt) || []
          list.push(cb)
          this.handlers.set(evt, list)
        },
        emit(evt, arg) {
          for (const cb of this.handlers.get(evt) || []) cb(arg)
        },
        send() {},
        close() {
          this.open = false
        }
      }
      latestConn = conn
      return conn
    }
    destroy() {
      this.destroyed = true
    }
  }

  // Native app with no backend URL -> hasBackend() === false, no EventSource in Node
  const prevWindow = globalThis.window
  globalThis.window = {
    location: { origin: 'https://upbeat.example.com', pathname: '/', search: '', hash: '', port: '' },
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    Capacitor: { isNativePlatform: () => true }
  }
  const notifications = []
  const guest = new JamSessionManager({ autoInit: false, PeerClass: EventedMockPeer, fetchImpl: null })
  guest.setHandlers({ onNotify: (msg) => notifications.push(msg) })

  try {
    await guest.joinJam('JAM-ABCD')
    assert.ok(latestPeer)
    latestPeer.emit('open')
    assert.ok(latestConn)
    latestConn.emit('open')
    assert.equal(guest.state.status, 'CONNECTED')
    assert.equal(guest.state.active, true)

    // Host drops PeerJS connection without JAM_ENDED
    latestConn.emit('close')
    assert.equal(guest.hostConn, null)
    assert.equal(guest.state.active, false)
    assert.equal(guest.state.status, 'IDLE')
    assert.ok(notifications.some((n) => /disconnected/i.test(n)))

    // destroy() marks destroyed and leaves zero active timers
    guest.scheduleTimer(() => {}, 5000)
    assert.ok(guest._timers.size >= 1)
    guest.destroy()
    assert.equal(guest.destroyed, true)
    assert.equal(guest._timers.size, 0)
  } finally {
    guest.destroy()
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
    resetStorage()
  }
})

test('resyncNow triggers immediate host sync or guest JAM_PING + JAM_RESYNC_REQUEST roundtrip', async () => {
  resetStorage()
  const MockPeer = createMockPeerClass()
  const hostPosted = []
  const guestPosted = []

  const hostFetch = async (url, init = {}) => {
    if (init.method === 'POST' && init.body) {
      hostPosted.push({ url: String(url), payload: JSON.parse(init.body) })
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }
  }

  const guestFetch = async (url, init = {}) => {
    if (init.method === 'POST' && init.body) {
      guestPosted.push({ url: String(url), payload: JSON.parse(init.body) })
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }
  }

  const host = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: hostFetch })
  host.updateUserProfile({ friendCode: 'UP-HST999', name: 'Host' })
  host.setHandlers({
    getHostPlaybackSnapshot: () => ({
      track: { video_id: 'dQw4w9WgXcQ', title: 'Sync Track', artist: 'Artist' },
      isPlaying: true,
      currentTime: 42,
      queue: []
    })
  })

  const guest = new JamSessionManager({ autoInit: false, PeerClass: MockPeer, fetchImpl: guestFetch })
  guest.updateUserProfile({ friendCode: 'UP-GST999', name: 'Guest' })

  try {
    // Inactive returns false
    assert.equal(host.resyncNow(), false)
    assert.equal(guest.resyncNow(), false)

    // Host resyncNow broadcasts JAM_SYNC + JAM_PARTICIPANTS
    const code = await host.createJam(null, 'open_party')
    hostPosted.length = 0
    assert.equal(host.resyncNow(), true)
    assert.ok(hostPosted.some((p) => p.payload?.type === 'JAM_SYNC' && p.payload?.currentTime === 42))
    assert.ok(hostPosted.some((p) => p.payload?.type === 'JAM_PARTICIPANTS'))

    // Guest resyncNow emits JAM_PING + JAM_RESYNC_REQUEST
    guest.updateState({
      active: true,
      isHost: false,
      role: 'guest',
      roomCode: code,
      status: 'CONNECTED'
    })
    guestPosted.length = 0
    assert.equal(guest.resyncNow(), true)
    assert.ok(guestPosted.some((p) => p.payload?.type === 'JAM_PING'))
    const req = guestPosted.find((p) => p.payload?.type === 'JAM_RESYNC_REQUEST')
    assert.ok(req)

    // Host handling JAM_RESYNC_REQUEST broadcasts JAM_SYNC immediately
    hostPosted.length = 0
    host.handleIncomingPacket(
      {
        ...req.payload,
        _fromRole: 'guest',
        _senderInstanceId: guest.instanceId
      },
      null
    )
    assert.ok(hostPosted.some((p) => p.payload?.type === 'JAM_SYNC'))
    assert.ok(hostPosted.some((p) => p.payload?.type === 'JAM_PARTICIPANTS'))
  } finally {
    host.destroy()
    guest.destroy()
    resetStorage()
  }
})
