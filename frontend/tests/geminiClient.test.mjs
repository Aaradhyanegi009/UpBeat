import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage } from './helpers/test-env.mjs'
import { generateWithDirectGemini } from '../src/services/geminiClient.js'
import { setStoredApiKey } from '../src/services/platformConfig.js'

test('generateWithDirectGemini aborts stalled endpoint via timeout and falls back cleanly', async () => {
  resetStorage()
  setStoredApiKey('AIzaFakeKeyForTestOnly')
  const calls = []
  const prevFetch = globalThis.fetch
  globalThis.fetch = (url, opts = {}) => {
    calls.push(url)
    if (url.includes('gemini-3.8-flash')) {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Here is your mix:\n```json\n{"playlist_title":"Monogatari Mix","tracks":[{"title":"Renai Circulation","artist":"Kana Hanazawa"}]}\n```'
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
  }

  try {
    const res = await generateWithDirectGemini('monogatari album', 'gemini-3.8-flash', { timeoutMs: 40 })
    assert.equal(res.playlist_title, 'Monogatari Mix')
    assert.equal(res.tracks.length, 1)
    assert.equal(res.is_fallback, true)
    assert.equal(res.used_model, 'gemini-4-argon')
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('generateWithDirectGemini retries on non-key HTTP 400 and aborts early on invalid key', async () => {
  resetStorage()
  setStoredApiKey('AIzaFakeKeyForTestOnly')
  const prevFetch = globalThis.fetch
  let hitCount = 0

  globalThis.fetch = async () => {
    hitCount += 1
    if (hitCount === 1) {
      return new Response(
        JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'thinkingLevel unsupported' } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"playlist_title":"Fallback Mix","tracks":[{"title":"Sapphire"}]}' }] } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    const ok = await generateWithDirectGemini('chill pop', 'gemini-4-argon', { timeoutMs: 1000 })
    assert.equal(ok.playlist_title, 'Fallback Mix')
    assert.equal(ok.is_fallback, true)
    assert.equal(hitCount, 2)

    hitCount = 0
    globalThis.fetch = async () => {
      hitCount += 1
      return new Response(
        JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'API key not valid' } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }
    await assert.rejects(
      () => generateWithDirectGemini('chill pop', 'gemini-4-argon', { timeoutMs: 1000 }),
      /API key not valid/i
    )
    assert.equal(hitCount, 1)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})
