import './helpers/test-env.mjs'
import { withWindowStub } from './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeRoomCode,
  normalizeFriendCode,
  normalizeFriendId,
  extractDeepLinkParams,
  sanitizePayloadForCloud,
  sortFriendsDeterministically,
  evaluateAudioDrift
} from '../src/jamEngine.js'

test('normalizeRoomCode and normalizeFriendCode accept raw codes and URLs', () => {
  assert.equal(normalizeRoomCode('ab12'), 'JAM-AB12')
  assert.equal(normalizeRoomCode('jam-xy98pq'), 'JAM-XY98PQ')
  assert.equal(normalizeRoomCode('https://upbeat.app/?jam=WXYZ12'), 'JAM-WXYZ12')
  assert.equal(normalizeRoomCode(''), '')

  assert.equal(normalizeFriendId, normalizeFriendCode)
  assert.equal(normalizeFriendCode('up-ab12cd'), 'UP-AB12CD')
  assert.equal(normalizeFriendCode('https://host/?addFriend=XY99ZZ'), 'UP-XY99ZZ')
  assert.equal(normalizeFriendCode('upbeat://addFriend?code=M2N3P4'), 'UP-M2N3P4')
})

test('extractDeepLinkParams parses custom scheme and HTTP query/hash links', () => {
  const friendLink = extractDeepLinkParams('upbeat://addFriend?code=UP-ABC234')
  assert.equal(friendLink.friendCode, 'UP-ABC234')
  assert.equal(friendLink.jamCode, null)

  const jamLink = extractDeepLinkParams('https://example.com/?jam=JAM-K9L8')
  assert.equal(jamLink.jamCode, 'JAM-K9L8')
  assert.equal(jamLink.friendCode, null)

  withWindowStub(() => {
    window.location.search = '?addFriend=UP-QWER12'
    const fromLoc = extractDeepLinkParams('')
    assert.equal(fromLoc.friendCode, 'UP-QWER12')
  })
})

test('sanitizePayloadForCloud strips base64 data URIs and keeps payload compact (<4KB)', () => {
  const bigBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(50000)
  const payload = {
    type: 'FRIEND_ACCEPT',
    from: {
      friendCode: 'UP-112233',
      name: 'Alice',
      picture: bigBase64,
      bio: 'x'.repeat(1200)
    },
    avatar: bigBase64,
    tracks: Array.from({ length: 60 }, (_, i) => ({ id: i }))
  }

  const sanitized = sanitizePayloadForCloud(payload)
  assert.equal(sanitized.from.picture, '')
  assert.equal(sanitized.avatar, '')
  assert.equal(sanitized.from.bio.length, 500)
  assert.equal(sanitized.tracks.length, 35)
  assert.ok(JSON.stringify(sanitized).length < 4096)
})

test('sortFriendsDeterministically orders online first, then case-insensitive name, then friendCode', () => {
  const list = [
    { friendCode: 'UP-0002', name: 'bob', online: false },
    { friendCode: 'UP-0003', name: 'Zed', online: true },
    { friendCode: 'UP-0004', name: 'Alice', online: true },
    { friendCode: 'UP-0001', name: 'Alice', online: true }
  ]
  const sorted = sortFriendsDeterministically(list)
  assert.deepEqual(
    sorted.map((x) => x.friendCode),
    ['UP-0001', 'UP-0004', 'UP-0003', 'UP-0002']
  )
})

test('evaluateAudioDrift returns LOCKED, RAMPING, and SEEKING tiers cleanly', () => {
  const now = Date.now()
  const locked = evaluateAudioDrift(10.0, 10.05, now, 0, true)
  assert.equal(locked.action, 'NONE')
  assert.equal(locked.syncTier, 'LOCKED')

  const rampingFast = evaluateAudioDrift(10.0, 10.4, now, 0, true)
  assert.equal(rampingFast.action, 'RAMP')
  assert.equal(rampingFast.syncTier, 'RAMPING')
  assert.equal(rampingFast.playbackRate, 1.035)

  const pausedSeek = evaluateAudioDrift(10.0, 12.0, now - 5000, 0, false)
  assert.equal(pausedSeek.action, 'SEEK')
  assert.equal(pausedSeek.targetTime, 12.0) // Must NOT extrapolate elapsedSec when paused
})
