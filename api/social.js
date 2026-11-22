export const config = {
  runtime: 'edge',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-UpBeat-Session',
  'Cache-Control': 'no-store, no-cache, must-revalidate'
}

const TTL_MS = 15 * 60 * 1000 // 15 minutes social TTL
const TTL_SEC = 15 * 60
const JAM_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours Jam room TTL
const JAM_TTL_SEC = 2 * 60 * 60
const ONLINE_WINDOW_MS = 45 * 1000 // 45 seconds online presence window
const MAX_MAILBOX_PACKETS = 150
const MAX_ROOM_PACKETS = 200
const KV_TIMEOUT_MS = 2500

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

function readEnv(name) {
  if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
    return process.env[name]
  }
  return ''
}

function getKvConfig() {
  const url = (readEnv('KV_REST_API_URL') || readEnv('UPSTASH_REDIS_REST_URL') || '').trim().replace(/\/+$/, '')
  const token = (readEnv('KV_REST_API_TOKEN') || readEnv('UPSTASH_REDIS_REST_TOKEN') || '').trim()
  if (!url || !token) return null
  return { url, token }
}

function getSocialSecret() {
  return readEnv('UPBEAT_SOCIAL_SECRET').trim()
}

function getSocialStore() {
  if (!globalThis.__UPBEAT_SOCIAL_BOX__) {
    globalThis.__UPBEAT_SOCIAL_BOX__ = new Map()
  }
  return globalThis.__UPBEAT_SOCIAL_BOX__
}

function getJamRoomStore() {
  if (!globalThis.__UPBEAT_JAM_ROOMS__) {
    globalThis.__UPBEAT_JAM_ROOMS__ = new Map()
  }
  return globalThis.__UPBEAT_JAM_ROOMS__
}

function nextPushTs(nowMs = Date.now(), minTs = 0) {
  const prev = globalThis.__UPBEAT_SOCIAL_LAST_TS__ || 0
  const ts = Math.max(nowMs, prev + 1, minTs)
  globalThis.__UPBEAT_SOCIAL_LAST_TS__ = ts
  return ts
}

function currentServerTs(nowMs = Date.now()) {
  const prev = globalThis.__UPBEAT_SOCIAL_LAST_TS__ || 0
  const ts = Math.max(nowMs, prev)
  globalThis.__UPBEAT_SOCIAL_LAST_TS__ = ts
  return ts
}

export function normalizeFriendId(raw) {
  if (!raw) return ''
  const str = String(raw).trim().toUpperCase()
  const cleaned = str.replace(/[^A-Z0-9-]/g, '')
  if (!cleaned) return ''
  if (cleaned.startsWith('UP-')) {
    const body = cleaned.slice(3).replace(/[^A-Z0-9]/g, '')
    return body ? `UP-${body.slice(0, 6)}` : ''
  }
  const alnum = cleaned.replace(/[^A-Z0-9]/g, '')
  const body = alnum.startsWith('UP') && alnum.length > 6 ? alnum.slice(2) : alnum
  return body ? `UP-${body.slice(0, 6)}` : ''
}

export function normalizeRoomCode(raw) {
  if (!raw) return ''
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32)
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(b64u) {
  const clean = String(b64u || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

async function importHmacKey(secret, usage) {
  return globalThis.crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  )
}

export async function createSocialSessionToken(payload = {}, secret = '') {
  const effectiveSecret = String(secret || getSocialSecret() || '').trim()
  if (!effectiveSecret) {
    throw new Error('UPBEAT_SOCIAL_SECRET is required to sign session tokens')
  }
  const payloadObj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const payloadBytes = TEXT_ENCODER.encode(JSON.stringify(payloadObj))
  const payloadB64 = bytesToBase64Url(payloadBytes)
  const key = await importHmacKey(effectiveSecret, 'sign')
  const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(payloadB64))
  const sigB64 = bytesToBase64Url(new Uint8Array(sigBuf))
  return `${payloadB64}.${sigB64}`
}

export async function verifySocialSessionToken(token, secret = '', nowMs = Date.now()) {
  const effectiveSecret = String(secret || getSocialSecret() || '').trim()
  if (!effectiveSecret || !token || typeof token !== 'string') return null
  const parts = token.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  const [payloadB64, sigB64] = parts
  try {
    const sigBytes = base64UrlToBytes(sigB64)
    const key = await importHmacKey(effectiveSecret, 'verify')
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      TEXT_ENCODER.encode(payloadB64)
    )
    if (!valid) return null

    const decoded = TEXT_DECODER.decode(base64UrlToBytes(payloadB64))
    const claims = JSON.parse(decoded)
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null

    if (claims.exp !== undefined && claims.exp !== null) {
      const numExp = Number(claims.exp)
      if (!Number.isFinite(numExp)) return null
      const expMs = numExp < 1e12 ? numExp * 1000 : numExp
      if (expMs <= nowMs) return null
    }
    return claims
  } catch {
    return null
  }
}

function checkTokenScope(claims, { friendCode = '', roomCode = '' } = {}) {
  if (!claims) return { ok: true }
  const rawSub = claims.sub ?? claims.friendCode ?? claims.id ?? ''
  if (rawSub && String(rawSub).trim() !== '*') {
    const boundId = normalizeFriendId(rawSub)
    const reqId = friendCode ? normalizeFriendId(friendCode) : ''
    if (boundId && reqId && boundId !== reqId) {
      return { ok: false, status: 403, error: 'Forbidden: session token friendCode mismatch' }
    }
  }
  const rawRoom = claims.roomCode ?? ''
  if (rawRoom && String(rawRoom).trim() !== '*') {
    const boundRoom = normalizeRoomCode(rawRoom)
    const reqRoom = roomCode ? normalizeRoomCode(roomCode) : ''
    if (boundRoom && reqRoom && boundRoom !== reqRoom) {
      return { ok: false, status: 403, error: 'Forbidden: session token roomCode mismatch' }
    }
  }
  return { ok: true }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}

function boxKey(friendId) {
  return `upbeat:social:box:${friendId}`
}

function presKey(friendId) {
  return `upbeat:social:pres:${friendId}`
}

function roomKey(roomCode) {
  return `upbeat:jam:room:${roomCode}`
}

function parseKvJson(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }
  return raw
}

async function kvCommand(cfg, cmd) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), KV_TIMEOUT_MS) : null
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cmd),
      signal: controller ? controller.signal : undefined
    })
    if (!resp.ok) {
      throw new Error(`KV HTTP ${resp.status}`)
    }
    const body = await resp.json()
    if (body && typeof body === 'object' && body.error) {
      throw new Error(String(body.error))
    }
    return body && typeof body === 'object' && 'result' in body ? body.result : body
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function kvMgetMap(cfg, keys) {
  if (!keys.length) return new Map()
  const result = await kvCommand(cfg, ['MGET', ...keys])
  const values = Array.isArray(result) ? result : []
  const map = new Map()
  for (let i = 0; i < keys.length; i++) {
    map.set(keys[i], values[i] ?? null)
  }
  return map
}

function shapePresenceEntry(friendId, profile, nowMs) {
  if (!profile || typeof profile !== 'object') return null
  if (nowMs - (profile.lastSeen || 0) >= ONLINE_WINDOW_MS) return null
  return {
    ...profile,
    friendCode: friendId,
    online: true,
    lastSeen: profile.lastSeen,
    nowPlaying: profile.currentTrack || null,
    roomCode: profile.activeJamCode || ''
  }
}

function pruneStore(store, nowMs) {
  for (const [friendId, entry] of store.entries()) {
    if (!entry) {
      store.delete(friendId)
      continue
    }
    if (Array.isArray(entry.inbox)) {
      entry.inbox = entry.inbox.filter((pkt) => nowMs - (pkt._serverTs || 0) < TTL_MS)
    }
    const lastActive = Math.max(
      entry.lastSeen || 0,
      entry.inbox?.length ? entry.inbox[entry.inbox.length - 1]._serverTs || 0 : 0
    )
    if (nowMs - lastActive > TTL_MS && (!entry.inbox || entry.inbox.length === 0)) {
      store.delete(friendId)
    }
  }
}

function pruneRooms(roomStore, nowMs) {
  for (const [roomCode, events] of roomStore.entries()) {
    if (!Array.isArray(events)) {
      roomStore.delete(roomCode)
      continue
    }
    const valid = events.filter((e) => nowMs - (e._serverTs || 0) < JAM_TTL_MS)
    if (valid.length === 0) {
      roomStore.delete(roomCode)
    } else if (valid.length !== events.length) {
      roomStore.set(roomCode, valid)
    }
  }
}

function ensureRecord(store, friendId) {
  let rec = store.get(friendId)
  if (!rec) {
    rec = {
      profile: { friendCode: friendId },
      lastSeen: 0,
      inbox: []
    }
    store.set(friendId, rec)
  }
  return rec
}

function collectPresence(store, friendIds, nowMs) {
  const friendsPresence = []
  for (const fId of friendIds) {
    if (!fId) continue
    const fRec = store.get(fId)
    if (fRec && fRec.profile && nowMs - (fRec.lastSeen || 0) < ONLINE_WINDOW_MS) {
      friendsPresence.push({
        ...fRec.profile,
        friendCode: fId,
        online: true,
        lastSeen: fRec.lastSeen,
        nowPlaying: fRec.profile.currentTrack || null,
        roomCode: fRec.profile.activeJamCode || ''
      })
    }
  }
  return friendsPresence
}

async function handleRoomSend(kvCfg, roomCode, rawPacket) {
  const packet = rawPacket && typeof rawPacket === 'object' ? { ...rawPacket } : null

  if (kvCfg) {
    try {
      const raw = await kvCommand(kvCfg, ['GET', roomKey(roomCode)])
      const parsed = parseKvJson(raw, [])
      const baseList = Array.isArray(parsed) ? parsed : []
      const baseNow = Date.now()
      const valid = baseList.filter((e) => e && baseNow - (e._serverTs || 0) < JAM_TTL_MS)
      const maxExistingTs = valid.reduce((acc, e) => Math.max(acc, e._serverTs || 0), 0)
      const nowMs = nextPushTs(baseNow, maxExistingTs ? maxExistingTs + 1 : 0)

      if (packet) {
        packet._serverTs = nowMs
        const dedupId = packet._packetId || packet.msgId
        const isDup = dedupId && valid.some((e) => (e._packetId || e.msgId) === dedupId)
        if (!isDup) {
          valid.push(packet)
          if (valid.length > MAX_ROOM_PACKETS) {
            valid.splice(0, valid.length - MAX_ROOM_PACKETS)
          }
        }
        await kvCommand(kvCfg, ['SET', roomKey(roomCode), JSON.stringify(valid), 'EX', JAM_TTL_SEC])
      }
      return nowMs
    } catch (err) {
      console.warn('[UpBeat Social KV] roomSend fallback to memory:', err?.message || err)
    }
  }

  const roomStore = getJamRoomStore()
  const nowMs = nextPushTs()
  pruneRooms(roomStore, nowMs)
  if (packet) {
    const events = roomStore.get(roomCode) || []
    packet._serverTs = nowMs
    const dedupId = packet._packetId || packet.msgId
    const isDup = dedupId && events.some((e) => (e._packetId || e.msgId) === dedupId)
    if (!isDup) {
      events.push(packet)
      if (events.length > MAX_ROOM_PACKETS) {
        events.splice(0, events.length - MAX_ROOM_PACKETS)
      }
    }
    roomStore.set(roomCode, events)
  }
  return nowMs
}

async function handleRoomPoll(kvCfg, roomCode, since) {
  const nowMs = currentServerTs()
  if (kvCfg) {
    try {
      const raw = await kvCommand(kvCfg, ['GET', roomKey(roomCode)])
      const parsed = parseKvJson(raw, [])
      const valid = (Array.isArray(parsed) ? parsed : []).filter(
        (e) => e && nowMs - (e._serverTs || 0) < JAM_TTL_MS
      )
      const filtered = valid.filter((e) => (e._serverTs || 0) > since).map((e) => ({ ...e }))
      const maxPktTs = filtered.reduce((acc, e) => Math.max(acc, e._serverTs || 0), 0)
      const effectiveServerTs = maxPktTs > nowMs ? currentServerTs(maxPktTs) : nowMs
      return { serverTs: effectiveServerTs, events: filtered }
    } catch (err) {
      console.warn('[UpBeat Social KV] roomPoll fallback to memory:', err?.message || err)
    }
  }

  const roomStore = getJamRoomStore()
  pruneRooms(roomStore, nowMs)
  const events = (roomStore.get(roomCode) || [])
    .filter((e) => (e._serverTs || 0) > since)
    .map((e) => ({ ...e }))
  return { serverTs: nowMs, events }
}

async function handleSocialPush(kvCfg, { targetId, packet, senderId, senderProfile }) {
  if (kvCfg) {
    try {
      const readKeys = []
      if (senderId && senderProfile && typeof senderProfile === 'object') {
        readKeys.push(presKey(senderId))
      }
      if (targetId && packet) {
        readKeys.push(boxKey(targetId))
      }
      const fetched = readKeys.length ? await kvMgetMap(kvCfg, readKeys) : new Map()
      const baseNow = Date.now()
      const rawBox = targetId && packet ? parseKvJson(fetched.get(boxKey(targetId)), []) : []
      const validBox = (Array.isArray(rawBox) ? rawBox : []).filter(
        (pkt) => pkt && baseNow - (pkt._serverTs || 0) < TTL_MS
      )
      const maxExistingTs = validBox.reduce((acc, p) => Math.max(acc, p._serverTs || 0), 0)
      const nowMs = nextPushTs(baseNow, maxExistingTs ? maxExistingTs + 1 : 0)

      const writes = []
      if (senderId && senderProfile && typeof senderProfile === 'object') {
        const curPres = parseKvJson(fetched.get(presKey(senderId)), {})
        const mergedPres = {
          ...(curPres && typeof curPres === 'object' ? curPres : {}),
          ...senderProfile,
          friendCode: senderId,
          lastSeen: nowMs
        }
        writes.push(['SET', presKey(senderId), JSON.stringify(mergedPres), 'EX', TTL_SEC])
      }

      if (targetId && packet) {
        packet._serverTs = nowMs
        packet.targetFriendCode = targetId
        const dedupKey = packet.msgId || packet._packetId
        const isDuplicate =
          dedupKey &&
          validBox.some((existing) => (existing.msgId || existing._packetId) === dedupKey)
        if (!isDuplicate) {
          validBox.push(packet)
          if (validBox.length > MAX_MAILBOX_PACKETS) {
            validBox.splice(0, validBox.length - MAX_MAILBOX_PACKETS)
          }
        }
        writes.push(['SET', boxKey(targetId), JSON.stringify(validBox), 'EX', TTL_SEC])
      }

      if (writes.length) {
        await Promise.all(writes.map((cmd) => kvCommand(kvCfg, cmd)))
      }
      return nowMs
    } catch (err) {
      console.warn('[UpBeat Social KV] socialPush fallback to memory:', err?.message || err)
    }
  }

  const store = getSocialStore()
  const nowMs = nextPushTs()
  pruneStore(store, nowMs)

  if (senderId && senderProfile && typeof senderProfile === 'object') {
    const senderRec = ensureRecord(store, senderId)
    senderRec.profile = {
      ...senderRec.profile,
      ...senderProfile,
      friendCode: senderId
    }
    senderRec.lastSeen = nowMs
  }

  if (targetId && packet) {
    const targetRec = ensureRecord(store, targetId)
    packet._serverTs = nowMs
    packet.targetFriendCode = targetId
    const dedupKey = packet.msgId || packet._packetId
    const isDuplicate =
      dedupKey &&
      targetRec.inbox.some((existing) => (existing.msgId || existing._packetId) === dedupKey)

    if (!isDuplicate) {
      targetRec.inbox.push(packet)
      if (targetRec.inbox.length > MAX_MAILBOX_PACKETS) {
        targetRec.inbox.splice(0, targetRec.inbox.length - MAX_MAILBOX_PACKETS)
      }
    }
  }
  return nowMs
}

async function handleSocialPoll(kvCfg, { myId, friendIds, since, summary }) {
  const nowMs = currentServerTs()

  if (kvCfg) {
    try {
      const keys = []
      const pushUnique = (k) => {
        if (!keys.includes(k)) keys.push(k)
      }
      if (myId) {
        pushUnique(boxKey(myId))
        pushUnique(presKey(myId))
      }
      for (const fId of friendIds) {
        if (fId) pushUnique(presKey(fId))
      }

      const fetched = keys.length ? await kvMgetMap(kvCfg, keys) : new Map()

      let inboxPackets = []
      let ownUpdatedPres = null
      if (myId) {
        const rawBox = parseKvJson(fetched.get(boxKey(myId)), [])
        const validBox = (Array.isArray(rawBox) ? rawBox : []).filter(
          (pkt) => pkt && nowMs - (pkt._serverTs || 0) < TTL_MS
        )
        inboxPackets = validBox
          .filter((pkt) => (pkt._serverTs || 0) > since)
          .map((pkt) => ({ ...pkt }))

        const curPres = parseKvJson(fetched.get(presKey(myId)), { friendCode: myId })
        ownUpdatedPres = {
          ...(curPres && typeof curPres === 'object' ? curPres : { friendCode: myId }),
          ...(summary && typeof summary === 'object' ? summary : {}),
          friendCode: myId,
          lastSeen: nowMs
        }
        await kvCommand(kvCfg, ['SET', presKey(myId), JSON.stringify(ownUpdatedPres), 'EX', TTL_SEC])
      }

      const friendsPresence = []
      for (const fId of friendIds) {
        if (!fId) continue
        const fPres = fId === myId && ownUpdatedPres
          ? ownUpdatedPres
          : parseKvJson(fetched.get(presKey(fId)), null)
        const shaped = shapePresenceEntry(fId, fPres, nowMs)
        if (shaped) friendsPresence.push(shaped)
      }

      const maxPktTs = inboxPackets.reduce((acc, p) => Math.max(acc, p._serverTs || 0), 0)
      const effectiveServerTs = maxPktTs > nowMs ? currentServerTs(maxPktTs) : nowMs
      return { serverTs: effectiveServerTs, inboxPackets, friendsPresence }
    } catch (err) {
      console.warn('[UpBeat Social KV] socialPoll fallback to memory:', err?.message || err)
    }
  }

  const store = getSocialStore()
  pruneStore(store, nowMs)

  let inboxPackets = []
  if (myId) {
    const myRec = ensureRecord(store, myId)
    if (summary && typeof summary === 'object') {
      myRec.profile = { ...myRec.profile, ...summary, friendCode: myId }
    }
    myRec.lastSeen = nowMs
    inboxPackets = (Array.isArray(myRec.inbox) ? myRec.inbox : [])
      .filter((pkt) => (pkt._serverTs || 0) > since)
      .map((pkt) => ({ ...pkt }))
  }

  const friendsPresence = collectPresence(store, friendIds, nowMs)
  return { serverTs: nowMs, inboxPackets, friendsPresence }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    })
  }

  const kvCfg = getKvConfig()
  const socialSecret = getSocialSecret()

  try {
    let sessionClaims = null
    if (socialSecret) {
      const token = req.headers.get('x-upbeat-session') || ''
      sessionClaims = await verifySocialSessionToken(token, socialSecret, Date.now())
      if (!sessionClaims) {
        return jsonResponse({ ok: false, error: 'Unauthorized: invalid or missing session token' }, 401)
      }
    }

    const url = new URL(req.url, 'http://localhost')

    // GET /api/social?id=UP-XXXXXX&friends=UP-AAA,UP-BBB&since=0
    // OR GET /api/social?roomCode=JAM-1234&since=0
    if (req.method === 'GET') {
      const rawRoom = url.searchParams.get('roomCode') || ''
      const queryAction = url.searchParams.get('action') || ''
      if (rawRoom || queryAction === 'room_poll') {
        const roomCode = normalizeRoomCode(rawRoom)
        if (!roomCode) {
          return jsonResponse({ ok: false, error: 'roomCode is required' }, 400)
        }
        const scope = checkTokenScope(sessionClaims, { roomCode })
        if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

        const since = Number(url.searchParams.get('since') || 0) || 0
        const { serverTs, events } = await handleRoomPoll(kvCfg, roomCode, since)
        return jsonResponse({
          ok: true,
          serverTs,
          roomCode,
          events,
          packets: events
        })
      }

      const myId = normalizeFriendId(url.searchParams.get('id') || url.searchParams.get('friendCode'))
      const scope = checkTokenScope(sessionClaims, { friendCode: myId })
      if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

      const since = Number(url.searchParams.get('since') || 0) || 0
      const friendsParam = url.searchParams.get('friends') || ''
      const friendIds = friendsParam
        .split(',')
        .map((f) => normalizeFriendId(f))
        .filter(Boolean)

      const { serverTs, inboxPackets, friendsPresence } = await handleSocialPoll(kvCfg, {
        myId,
        friendIds,
        since,
        summary: null
      })

      return jsonResponse({
        ok: true,
        serverTs,
        inbox: inboxPackets,
        packets: inboxPackets,
        friends: friendsPresence,
        presence: friendsPresence
      })
    }

    // POST /api/social
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const action =
        body.action ||
        (body.roomCode
          ? (body.packet ? 'room_send' : 'room_poll')
          : (body.toId || body.targetFriendCode ? 'push' : 'poll'))

      if (action === 'room_send') {
        const roomCode = normalizeRoomCode(body.roomCode || '')
        if (!roomCode) {
          return jsonResponse({ ok: false, error: 'roomCode is required' }, 400)
        }
        const scope = checkTokenScope(sessionClaims, { roomCode })
        if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

        const serverTs = await handleRoomSend(kvCfg, roomCode, body.packet)
        return jsonResponse({ ok: true, serverTs, roomCode })
      }

      if (action === 'room_poll') {
        const roomCode = normalizeRoomCode(body.roomCode || '')
        if (!roomCode) {
          return jsonResponse({ ok: false, error: 'roomCode is required' }, 400)
        }
        const scope = checkTokenScope(sessionClaims, { roomCode })
        if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

        const since = Number(body.since || 0) || 0
        const { serverTs, events } = await handleRoomPoll(kvCfg, roomCode, since)
        return jsonResponse({
          ok: true,
          serverTs,
          roomCode,
          events,
          packets: events
        })
      }

      if (action === 'push') {
        const targetId = normalizeFriendId(body.toId || body.targetFriendCode || body.packet?.targetFriendCode)
        const packet = body.packet && typeof body.packet === 'object' ? { ...body.packet } : null
        const senderProfile = packet?.from || body.profile || body.summary
        const senderId = normalizeFriendId(
          senderProfile?.friendCode || packet?._fromFriendCode || body.fromId
        )

        const scope = checkTokenScope(sessionClaims, { friendCode: senderId })
        if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

        const serverTs = await handleSocialPush(kvCfg, {
          targetId,
          packet,
          senderId,
          senderProfile
        })

        return jsonResponse({
          ok: true,
          serverTs
        })
      }

      // POST poll fallback (updates caller's full summary + retains packets filtered by since cursor)
      const myId = normalizeFriendId(body.id || body.friendCode)
      const scope = checkTokenScope(sessionClaims, { friendCode: myId })
      if (!scope.ok) return jsonResponse({ ok: false, error: scope.error }, scope.status)

      const since = Number(body.since || 0) || 0
      const summary = body.summary || body.profile
      const rawFriends = Array.isArray(body.friends)
        ? body.friends
        : Array.isArray(body.friendCodes)
          ? body.friendCodes
          : []
      const friendIds = rawFriends.map((rawF) => normalizeFriendId(rawF)).filter(Boolean)

      const { serverTs, inboxPackets, friendsPresence } = await handleSocialPoll(kvCfg, {
        myId,
        friendIds,
        since,
        summary
      })

      return jsonResponse({
        ok: true,
        serverTs,
        inbox: inboxPackets,
        packets: inboxPackets,
        friends: friendsPresence,
        presence: friendsPresence
      })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || 'Social mailbox error' }, 500)
  }
}
