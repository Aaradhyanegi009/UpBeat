import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../../api/social.js'

test('api/social handles OPTIONS preflight with CORS headers', async () => {
  const res = await handler(new Request('https://upbeat.local/api/social', { method: 'OPTIONS' }))
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
})

test('api/social relays push packets and reports online presence', async () => {
  const senderProfile = { friendCode: 'UP-TEST11', name: 'SenderUser' }
  const packet = { msgId: 'msg-1', type: 'FRIEND_REQ', from: senderProfile }

  const pushRes = await handler(
    new Request('https://upbeat.local/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'push',
        toId: 'TEST22',
        packet,
        summary: senderProfile
      })
    })
  )
  assert.equal(pushRes.status, 200)
  const pushJson = await pushRes.json()
  assert.equal(pushJson.ok, true)

  const pollRes = await handler(
    new Request('https://upbeat.local/api/social?id=UP-TEST22&friends=UP-TEST11&since=0', {
      method: 'GET'
    })
  )
  assert.equal(pollRes.status, 200)
  const pollJson = await pollRes.json()
  assert.equal(pollJson.ok, true)
  assert.equal(pollJson.inbox.length, 1)
  assert.equal(pollJson.inbox[0].msgId, 'msg-1')
  assert.equal(pollJson.friends.length, 1)
  assert.equal(pollJson.friends[0].friendCode, 'UP-TEST11')
  assert.equal(pollJson.friends[0].online, true)
})
