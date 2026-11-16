import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage } from './helpers/test-env.mjs'
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
