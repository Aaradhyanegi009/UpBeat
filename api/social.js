export const config = {
  runtime: 'edge'
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate'
}

const TTL_MS = 15 * 60 * 1000 // 15 minutes TTL
const ONLINE_WINDOW_MS = 45 * 1000 // 45 seconds online presence window

function getSocialStore() {
  if (!globalThis.__UPBEAT_SOCIAL_BOX__) {
    globalThis.__UPBEAT_SOCIAL_BOX__ = new Map()
  }
  return globalThis.__UPBEAT_SOCIAL_BOX__
}

function normalizeFriendId(raw) {
  if (!raw) return ''
  const str = String(raw).trim().toUpperCase()
  const cleaned = str.replace(/[^A-Z0-9-]/g, '')
  if (cleaned.startsWith('UP-')) {
    const body = cleaned.slice(3).replace(/[^A-Z0-9]/g, '')
    return body ? `UP-${body.slice(0, 6)}` : ''
  }
  const alnum = cleaned.replace(/[^A-Z0-9]/g, '')
  const body = alnum.startsWith('UP') && alnum.length > 6 ? alnum.slice(2) : alnum
  return body ? `UP-${body.slice(0, 6)}` : ''
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    })
  }

  const store = getSocialStore()
  const nowMs = Date.now()
  pruneStore(store, nowMs)

  try {
    const url = new URL(req.url, 'http://localhost')

    // GET /api/social?id=UP-XXXXXX&friends=UP-AAA,UP-BBB
    if (req.method === 'GET') {
      const myId = normalizeFriendId(url.searchParams.get('id') || url.searchParams.get('friendCode'))
      const friendsParam = url.searchParams.get('friends') || ''
      const friendIds = friendsParam
        .split(',')
        .map((f) => normalizeFriendId(f))
        .filter(Boolean)

      let inboxPackets = []
      if (myId) {
        const myRec = ensureRecord(store, myId)
        myRec.lastSeen = nowMs
        inboxPackets = Array.isArray(myRec.inbox) ? [...myRec.inbox] : []
        // Drain delivered packets so they aren't re-delivered endlessly
        myRec.inbox = []
      }

      const friendsPresence = []
      for (const fId of friendIds) {
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

      return new Response(
        JSON.stringify({
          ok: true,
          serverTs: nowMs,
          inbox: inboxPackets,
          packets: inboxPackets,
          friends: friendsPresence,
          presence: friendsPresence
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      )
    }

    // POST /api/social
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const action = body.action || (body.toId || body.targetFriendCode ? 'push' : 'poll')

      if (action === 'push') {
        const targetId = normalizeFriendId(body.toId || body.targetFriendCode || body.packet?.targetFriendCode)
        const packet = body.packet && typeof body.packet === 'object' ? { ...body.packet } : null

        // Update sender's online presence if included
        const senderProfile = packet?.from || body.profile || body.summary
        const senderId = normalizeFriendId(
          senderProfile?.friendCode || packet?._fromFriendCode || body.fromId
        )
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
            if (targetRec.inbox.length > 150) {
              targetRec.inbox.splice(0, targetRec.inbox.length - 150)
            }
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            serverTs: nowMs
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          }
        )
      }

      // POST poll fallback (updates caller's full summary + drains inbox + returns friend statuses)
      const myId = normalizeFriendId(body.id || body.friendCode)
      const summary = body.summary || body.profile
      if (myId) {
        const myRec = ensureRecord(store, myId)
        if (summary && typeof summary === 'object') {
          myRec.profile = { ...myRec.profile, ...summary, friendCode: myId }
        }
        myRec.lastSeen = nowMs
      }

      const inboxPackets = myId ? [...(store.get(myId)?.inbox || [])] : []
      if (myId && store.get(myId)) {
        store.get(myId).inbox = []
      }

      const rawFriends = Array.isArray(body.friends)
        ? body.friends
        : Array.isArray(body.friendCodes)
          ? body.friendCodes
          : []
      const friendsPresence = []
      for (const rawF of rawFriends) {
        const fId = normalizeFriendId(rawF)
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

      return new Response(
        JSON.stringify({
          ok: true,
          serverTs: nowMs,
          inbox: inboxPackets,
          packets: inboxPackets,
          friends: friendsPresence,
          presence: friendsPresence
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        }
      )
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Social mailbox error' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    )
  }
}
