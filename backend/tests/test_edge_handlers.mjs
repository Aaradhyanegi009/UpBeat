import test from 'node:test'
import assert from 'node:assert/strict'
import innertubeHandler from '../../api/innertube.js'
import audioInfoHandler from '../../api/audio-info.js'
import audioHandler from '../../api/audio.js'
import socialHandler from '../../api/social.js'

const IOS_UA = 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_1 like Mac OS X; US)'
const ANDROID_VR_UA =
  'Mozilla/5.0 (Linux; Android 14; Quest 3 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.35.48.568434778 SamsungBrowser/4.0 Chrome/122.0.6261.119 Mobile VR Safari/537.36'

test('api/innertube enforces endpoint and service allowlist', async () => {
  const badEndpoint = await innertubeHandler(
    new Request('https://upbeat.local/api/innertube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: '../account', body: {}, service: 'music' })
    })
  )
  assert.equal(badEndpoint.status, 400)

  const badService = await innertubeHandler(
    new Request('https://upbeat.local/api/innertube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'search', body: {}, service: 'evil' })
    })
  )
  assert.equal(badService.status, 400)

  const origFetch = globalThis.fetch
  let calledUrl = ''
  globalThis.fetch = async (url) => {
    calledUrl = String(url)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  try {
    const okRes = await innertubeHandler(
      new Request('https://upbeat.local/api/innertube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'search', body: { query: 'test' }, service: 'music' })
      })
    )
    assert.equal(okRes.status, 200)
    assert.equal(calledUrl, 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('api/audio-info supports path & query params, HEAD, and avoids HE-AAC', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: { lengthSeconds: '215', title: 'Drama', author: 'aespa' },
        streamingData: {
          adaptiveFormats: [
            { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48000, url: 'https://gv.test/heaac' },
            { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: 'https://gv.test/aaclc' }
          ]
        }
      }),
      { status: 200 }
    )

  try {
    const pathRes = await audioInfoHandler(new Request('https://upbeat.local/api/audio-info/D8VEhcPeSlc'))
    assert.equal(pathRes.status, 200)
    const json = await pathRes.json()
    assert.equal(json.video_id, 'D8VEhcPeSlc')
    assert.equal(json.url, '/api/audio/D8VEhcPeSlc')
    assert.equal(json.direct_stream_url, 'https://gv.test/aaclc')

    const queryRes = await audioInfoHandler(new Request('https://upbeat.local/api/audio-info?id=D8VEhcPeSlc'))
    assert.equal(queryRes.status, 200)

    const headRes = await audioInfoHandler(
      new Request('https://upbeat.local/api/audio-info/D8VEhcPeSlc', { method: 'HEAD' })
    )
    assert.equal(headRes.status, 200)
    assert.equal(await headRes.text(), '')

    const badRes = await audioInfoHandler(new Request('https://upbeat.local/api/audio-info/bad'))
    assert.equal(badRes.status, 400)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('api/audio supports path & query, passes matching UA, handles HEAD, and never caches 403/500 as 200', async () => {
  const origFetch = globalThis.fetch
  const seenAudioUAs = []
  let upstreamMode = 'ok'

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('youtubei/v1/player')) {
      return new Response(
        JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { lengthSeconds: '200' },
          streamingData: {
            adaptiveFormats: [
              {
                itag: 140,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                contentLength: '4',
                url: `https://gv.test/stream?expire=${Math.floor(Date.now() / 1000) + 3600}`
              }
            ]
          }
        }),
        { status: 200 }
      )
    }

    seenAudioUAs.push(opts.headers?.['User-Agent'])
    if (upstreamMode === 'fail') {
      return new Response('forbidden', { status: 403 })
    }
    return new Response('ABCD', {
      status: 206,
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Range': 'bytes 0-3/4',
        'Content-Length': '4'
      }
    })
  }

  try {
    // 1. Path param GET without Range -> 200 OK with matching ANDROID_VR UA
    const res200 = await audioHandler(new Request('https://upbeat.local/api/audio/8SbUC-UaAxE'))
    assert.equal(res200.status, 200)
    assert.equal(await res200.text(), 'ABCD')
    assert.equal(seenAudioUAs[0], ANDROID_VR_UA)
    assert.notEqual(seenAudioUAs[0], IOS_UA)

    // 2. Query param GET with Range -> 206 Partial Content
    const res206 = await audioHandler(
      new Request('https://upbeat.local/api/audio?id=8SbUC-UaAxE', {
        headers: { Range: 'bytes=0-3' }
      })
    )
    assert.equal(res206.status, 206)
    assert.equal(res206.headers.get('Content-Range'), 'bytes 0-3/4')

    // 3. HEAD request -> empty body & Content-Length
    const headRes = await audioHandler(
      new Request('https://upbeat.local/api/audio/8SbUC-UaAxE', { method: 'HEAD' })
    )
    assert.equal(headRes.status, 200)
    assert.equal(headRes.headers.get('Content-Length'), '4')
    assert.equal(await headRes.text(), '')

    // 4. Upstream 403 failure MUST NOT return 200 OK or Cache-Control: max-age=3600
    upstreamMode = 'fail'
    const errRes = await audioHandler(new Request('https://upbeat.local/api/audio/8SbUC-UaAxE'))
    assert.equal(errRes.status, 502)
    assert.equal(errRes.headers.get('Cache-Control'), 'no-store')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('api/social retains packets across polls and filters strictly by since cursor', async () => {
  globalThis.__UPBEAT_SOCIAL_BOX__?.clear?.()
  const p1 = await socialHandler(
    new Request('https://upbeat.local/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'push',
        toId: 'abc123',
        packet: { msgId: 'pkt-1', type: 'PING', from: { friendCode: 'xyz999', name: 'Peer' } }
      })
    })
  )
  const j1 = await p1.json()
  assert.equal(j1.ok, true)

  // First tab polls since=0 -> gets pkt-1
  const tab1Poll = await (await socialHandler(new Request('https://upbeat.local/api/social?id=UP-ABC123&since=0'))).json()
  assert.equal(tab1Poll.inbox.length, 1)
  assert.equal(tab1Poll.inbox[0].msgId, 'pkt-1')

  // Second tab polling since=0 STILL gets pkt-1 (no destructive drain!)
  const tab2Poll = await (await socialHandler(new Request('https://upbeat.local/api/social?id=ABC123&since=0'))).json()
  assert.equal(tab2Poll.inbox.length, 1)

  // Subsequent poll with since=tab1Poll.serverTs returns 0 packets
  const tab1Next = await (
    await socialHandler(new Request(`https://upbeat.local/api/social?id=UP-ABC123&since=${tab1Poll.serverTs}`))
  ).json()
  assert.equal(tab1Next.inbox.length, 0)

  // Second push in same millisecond gets monotonic serverTs > tab1Poll.serverTs
  await socialHandler(
    new Request('https://upbeat.local/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'push',
        toId: 'UP-ABC123',
        packet: { msgId: 'pkt-2', type: 'PONG' }
      })
    })
  )
  const postPoll = await (
    await socialHandler(
      new Request('https://upbeat.local/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll', friendCode: 'abc123', since: tab1Poll.serverTs })
      })
    )
  ).json()
  assert.deepEqual(
    postPoll.inbox.map((m) => m.msgId),
    ['pkt-2']
  )
})
