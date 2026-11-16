/**
 * HTTP / Edge Mailbox / ntfy Cloud SSE / Local FastAPI Backend transport for Social & Jam Rooms.
 */
import { getApiBase, hasBackend } from "../services/platformConfig.js"
import {
  CLOUD_RELAYS,
  fetchWithTimeout,
  getRoomCloudTopic,
  getSocialCloudTopic,
  normalizeFriendCode,
  sanitizePayloadForCloud
} from "./jamUtils.js"

export class CloudRelayTransport {
  constructor(mgr) {
    this.mgr = mgr
  }

  _fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    return fetchWithTimeout(url, options, timeoutMs, this.mgr.fetchImpl)
  }

  initSocialCloudRelay(myFriendCode) {
    const topic = getSocialCloudTopic(myFriendCode)
    if (!topic || typeof EventSource === 'undefined') return
    try {
      if (this.mgr.socialEventSource) {
        try {
          this.mgr.socialEventSource.close()
        } catch {}
        this.mgr.socialEventSource = null
      }
      let relayIdx = 0
      const connect = () => {
        const base = CLOUD_RELAYS[relayIdx % CLOUD_RELAYS.length]
        try {
          const es = new EventSource(`${base}/${topic}/sse?since=1h`)
          this.mgr.socialEventSource = es
          es.onmessage = (ev) => {
            try {
              const wrapper = JSON.parse(ev.data)
              if (wrapper?.event === 'message' && wrapper.message) {
                const payload = JSON.parse(wrapper.message)
                if (payload && payload._senderInstanceId !== this.mgr.instanceId) {
                  this.mgr.handleSocialPacket(payload, null)
                }
              }
            } catch {}
          }
          es.onerror = () => {
            try {
              if (this.mgr.socialEventSource === es) {
                es.close()
                this.mgr.socialEventSource = null
                relayIdx = (relayIdx + 1) % CLOUD_RELAYS.length
                // Reconnect automatically with backoff — never give up!
                setTimeout(() => {
                  if (!this.mgr.socialEventSource) {
                    connect()
                  }
                }, 3000)
              }
            } catch {}
          }
        } catch {
          relayIdx = (relayIdx + 1) % CLOUD_RELAYS.length
          setTimeout(() => connect(), 3000)
        }
      }
      connect()
    } catch {}
  }

  async pollSocialCloudInbox(myFriendCode, force = false) {
    const cleanCode = normalizeFriendCode(myFriendCode || this.mgr.userProfile?.friendCode)
    if (!cleanCode || !this.mgr.fetchImpl) return
    const topic = getSocialCloudTopic(cleanCode)
    if (!topic) return
    const now = Date.now()
    if (!force && this.mgr.lastCloudPollAt && now - this.mgr.lastCloudPollAt < 3000) return
    this.mgr.lastCloudPollAt = now

    // Use poll=1 (and since=10m) so pending friend requests/acceptances are never missed and all relays respond
    for (const base of CLOUD_RELAYS) {
      try {
        const res = await this._fetchWithTimeout(
          `${base}/${topic}/json?poll=1&since=10m`,
          {},
          2500
        )
        if (!res || !res.ok) continue
        this.mgr.initialCloudPollDone = true
        const text = await res.text()
        const lines = text.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const wrapper = JSON.parse(line)
            if (wrapper?.event === 'message' && wrapper.message) {
              const payload = JSON.parse(wrapper.message)
              if (payload && payload._senderInstanceId !== this.mgr.instanceId) {
                this.mgr.handleSocialPacket(payload, null)
              }
            }
          } catch {}
        }
        break
      } catch {}
    }
  }

  async sendSocialCloudPacket(targetFriendCode, fullPacket) {
    const topic = getSocialCloudTopic(targetFriendCode)
    if (!topic || !this.mgr.fetchImpl) return
    const cleaned = sanitizePayloadForCloud(fullPacket)
    const body = JSON.stringify(cleaned)
    // Broadcast to ALL healthy cloud relays in parallel so the receiver catches it on ANY relay
    try {
      await Promise.allSettled(
        CLOUD_RELAYS.map((base) =>
          this._fetchWithTimeout(
            `${base}/${topic}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body
            },
            2500
          )
        )
      )
    } catch {}
  }

  getEdgeSocialUrls() {
    const urls = []
    if (hasBackend()) {
      urls.push(`${getApiBase()}/social`)
    }
    if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
      const localUrl = `${window.location.origin}/api/social`
      if (!urls.includes(localUrl)) {
        urls.push(localUrl)
      }
    }
    return urls
  }

  async sendEdgeSocialPacket(targetFriendCode, fullPacket) {
    const urls = this.mgr.getEdgeSocialUrls()
    if (!urls.length || !this.mgr.fetchImpl) return
    const cleaned = sanitizePayloadForCloud(fullPacket)
    const body = JSON.stringify({
      action: 'push',
      toId: normalizeFriendCode(targetFriendCode),
      fromId: this.mgr.userProfile?.friendCode,
      packet: cleaned,
      summary: this.mgr.getMyPublicSummary()
    })
    for (const url of urls) {
      try {
        const res = await this._fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          },
          2500
        )
        if (res && res.ok) break
      } catch {}
    }
  }

  async pollEdgeSocialMailbox() {
    const urls = this.mgr.getEdgeSocialUrls()
    if (!urls.length || !this.mgr.fetchImpl) return
    const myCode = normalizeFriendCode(this.mgr.userProfile?.friendCode)
    if (!myCode) return

    const friendCodes = [
      ...(this.mgr.state.friends || []).map((f) => normalizeFriendCode(f.friendCode)),
      ...(this.mgr.state.outgoingRequests || []).map((r) => normalizeFriendCode(r.friendCode))
    ].filter(Boolean)

    for (const baseUrl of urls) {
      try {
        const query = `id=${encodeURIComponent(myCode)}&friends=${encodeURIComponent(friendCodes.join(','))}&since=${this.mgr.lastSocialServerTs}`
        const res = await this._fetchWithTimeout(`${baseUrl}?${query}`, {}, 2500)
        if (!res || !res.ok) continue
        const data = await res.json()
        const inboxList = Array.isArray(data?.inbox)
          ? data.inbox
          : Array.isArray(data?.packets)
            ? data.packets
            : []
        for (const pkt of inboxList) {
          if (pkt && pkt._senderInstanceId !== this.mgr.instanceId) {
            this.mgr.handleSocialPacket(pkt, null)
          }
        }
        const presList = Array.isArray(data?.friends)
          ? data.friends
          : Array.isArray(data?.presence)
            ? data.presence
            : []
        for (const pres of presList) {
          if (pres && pres.friendCode) {
            this.mgr.updateFriendPresence(pres)
          }
        }
        break
      } catch {}
    }
  }

  async pollBackendSocial() {
    if (!hasBackend()) return
    try {
      const friendCodes = [
        ...(this.mgr.state.friends || []).map((f) => f.friendCode),
        ...(this.mgr.state.outgoingRequests || []).map((r) => r.friendCode)
      ].filter(Boolean)

      const res = await this._fetchWithTimeout(
        `${getApiBase()}/jam/social/poll`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            friendCode: this.mgr.userProfile.friendCode,
            summary: this.mgr.getMyPublicSummary(),
            friendCodes,
            since: this.mgr.lastSocialServerTs
          })
        },
        2500
      )
      if (!res || !res.ok) return
      const data = await res.json()
      if (data?.serverTs) {
        this.mgr.lastSocialServerTs = data.serverTs
      }
      if (Array.isArray(data?.packets)) {
        for (const pkt of data.packets) {
          if (pkt && pkt._senderInstanceId !== this.mgr.instanceId) {
            this.mgr.handleSocialPacket(pkt, null)
          }
        }
      }
      if (Array.isArray(data?.presence)) {
        for (const pres of data.presence) {
          if (pres && pres.friendCode) {
            this.mgr.updateFriendPresence(pres)
          }
        }
      }
    } catch {}
  }

  async sendBackendSocialPacket(targetFriendCode, fullPacket) {
    if (!hasBackend()) return
    try {
      await this._fetchWithTimeout(
        `${getApiBase()}/jam/social/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetFriendCode,
            packet: fullPacket
          })
        },
        2500
      )
    } catch {}
  }


  setupRoomTransports(roomCode) {
    this.mgr.teardownRoomTransports()
    if (!roomCode) return

    // 1. Same-browser BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.mgr.bc = new BroadcastChannel(`upbeat_jam_${roomCode}`)
        this.mgr.bc.onmessage = (ev) => {
          if (ev?.data && ev.data._senderInstanceId !== this.mgr.instanceId) {
            this.mgr.handleIncomingPacket(ev.data, null)
          }
        }
      } catch {}
    }

    // 2. Cloud SSE Relay for cross-network Jam sync fallback
    const topic = getRoomCloudTopic(roomCode)
    if (topic && typeof EventSource !== 'undefined') {
      try {
        let roomRelayIdx = 0
        const connectRoomSse = () => {
          const base = CLOUD_RELAYS[roomRelayIdx % CLOUD_RELAYS.length]
          try {
            const es = new EventSource(`${base}/${topic}/sse?since=5m`)
            this.mgr.roomEventSource = es
            es.onmessage = (ev) => {
              try {
                const wrapper = JSON.parse(ev.data)
                if (wrapper?.event === 'message' && wrapper.message) {
                  const pkt = JSON.parse(wrapper.message)
                  if (pkt && pkt._senderInstanceId !== this.mgr.instanceId) {
                    this.mgr.handleIncomingPacket(pkt, null)
                  }
                }
              } catch {}
            }
            es.onerror = () => {
              try {
                if (this.mgr.roomEventSource === es) {
                  es.close()
                  this.mgr.roomEventSource = null
                  roomRelayIdx = (roomRelayIdx + 1) % CLOUD_RELAYS.length
                  setTimeout(() => {
                    if (!this.mgr.roomEventSource && this.mgr.state.active) {
                      connectRoomSse()
                    }
                  }, 2500)
                }
              } catch {}
            }
          } catch {
            roomRelayIdx = (roomRelayIdx + 1) % CLOUD_RELAYS.length
            setTimeout(() => {
              if (!this.mgr.roomEventSource && this.mgr.state.active) connectRoomSse()
            }, 2500)
          }
        }
        connectRoomSse()
      } catch {}
    }

    // 3. Local FastAPI Backend & Cloud Room Polling
    this.mgr.lastRoomServerTs = Date.now() - 120000
    this.mgr.roomPollTimer = setInterval(() => {
      this.mgr.pollBackendRoom(roomCode)
      this.mgr.pollCloudRoom(roomCode)
    }, 1500)
    setTimeout(() => {
      this.mgr.pollBackendRoom(roomCode)
      this.mgr.pollCloudRoom(roomCode)
    }, 250)
  }

  teardownRoomTransports() {
    if (this.mgr.bc) {
      try {
        this.mgr.bc.close()
      } catch {}
      this.mgr.bc = null
    }
    if (this.mgr.roomEventSource) {
      try {
        this.mgr.roomEventSource.close()
      } catch {}
      this.mgr.roomEventSource = null
    }
    if (this.mgr.roomPollTimer) {
      clearInterval(this.mgr.roomPollTimer)
      this.mgr.roomPollTimer = null
    }
  }

  async pollCloudRoom(roomCode) {
    const topic = getRoomCloudTopic(roomCode)
    if (!topic || !this.mgr.fetchImpl) return
    for (const base of CLOUD_RELAYS) {
      try {
        const res = await this._fetchWithTimeout(
          `${base}/${topic}/json?poll=1&since=5m`,
          {},
          2500
        )
        if (!res || !res.ok) continue
        const text = await res.text()
        const lines = text.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const wrapper = JSON.parse(line)
            if (wrapper?.event === 'message' && wrapper.message) {
              const pkt = JSON.parse(wrapper.message)
              if (pkt && pkt._senderInstanceId !== this.mgr.instanceId) {
                this.mgr.handleIncomingPacket(pkt, null)
              }
            }
          } catch {}
        }
        break
      } catch {}
    }
  }

  async sendCloudRoomPacket(roomCode, payload) {
    const topic = getRoomCloudTopic(roomCode)
    if (!topic || !this.mgr.fetchImpl) return
    const cleaned = sanitizePayloadForCloud(payload)
    const body = JSON.stringify(cleaned)
    try {
      await Promise.allSettled(
        CLOUD_RELAYS.map((base) =>
          this._fetchWithTimeout(
            `${base}/${topic}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body
            },
            2500
          )
        )
      )
    } catch {}
  }

  async pollBackendRoom(roomCode) {
    if (!hasBackend() || !roomCode) return
    try {
      const res = await this._fetchWithTimeout(
        `${getApiBase()}/jam/room/poll?roomCode=${encodeURIComponent(roomCode)}&since=${this.mgr.lastRoomServerTs}`,
        {},
        2500
      )
      if (!res || !res.ok) return
      const data = await res.json()
      if (data?.serverTs) {
        this.mgr.lastRoomServerTs = data.serverTs
      }
      const items = Array.isArray(data?.events)
        ? data.events
        : Array.isArray(data?.packets)
          ? data.packets
          : []
      for (const item of items) {
        const pkt = item?.packet && typeof item.packet === 'object' ? item.packet : item
        if (pkt && pkt._senderInstanceId !== this.mgr.instanceId) {
          this.mgr.handleIncomingPacket(pkt, null)
        }
      }
    } catch {}
  }

  async sendBackendRoomPacket(roomCode, payload) {
    if (!hasBackend() || !roomCode) return
    try {
      await this._fetchWithTimeout(
        `${getApiBase()}/jam/room/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomCode,
            packet: payload
          })
        },
        2500
      )
    } catch {}
  }


  destroySocial() {
    if (this.mgr.socialBc) {
      try {
        this.mgr.socialBc.close()
      } catch {}
      this.mgr.socialBc = null
    }
    if (this.mgr.socialEventSource) {
      try {
        this.mgr.socialEventSource.close()
      } catch {}
      this.mgr.socialEventSource = null
    }
  }
}
