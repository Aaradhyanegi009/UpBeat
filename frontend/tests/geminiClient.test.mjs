import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage } from './helpers/test-env.mjs'
import {
  VERIFIED_MODELS,
  clearGeminiCooldowns,
  generateWithDirectGemini
} from '../src/services/geminiClient.js'
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

test('generateWithDirectGemini sends API key via x-goog-api-key header instead of ?key= query string', async () => {
  resetStorage()
  const testKey = 'AIzaHeaderOnlyTestKey123'
  setStoredApiKey(testKey)
  const prevFetch = globalThis.fetch
  const captured = []

  globalThis.fetch = async (url, opts = {}) => {
    captured.push({ url: String(url), headers: opts.headers || {} })
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"playlist_title":"Header Mix","tracks":[{"title":"Starboy","artist":"The Weeknd"}]}' }] } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    const res = await generateWithDirectGemini('header test', 'gemini-2.5-flash', { timeoutMs: 1000 })
    assert.equal(res.playlist_title, 'Header Mix')
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url.includes('?key='), false)
    assert.equal(captured[0].url.includes(testKey), false)
    assert.equal(captured[0].headers['x-goog-api-key'], testKey)
  } finally {
    globalThis.fetch = prevFetch
    clearGeminiCooldowns()
    resetStorage()
  }
})

test('VERIFIED_MODELS lists verified endpoints and 429 cooldown skips cooled models unless all cooled down', async () => {
  resetStorage()
  clearGeminiCooldowns()
  assert.deepEqual(VERIFIED_MODELS, [
    'gemini-2.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ])

  setStoredApiKey('AIzaCooldownTestKey')
  const prevFetch = globalThis.fetch
  const hitModels = []

  globalThis.fetch = async (url) => {
    const m = String(url).match(/models\/([^:]+):generateContent/)?.[1] || ''
    hitModels.push(m)
    if (m === 'gemini-2.5-flash-lite') {
      return new Response(
        JSON.stringify({ error: { message: 'Quota exceeded' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: `{"playlist_title":"Ok from ${m}","tracks":[{"title":"Track"}]}` }] } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    // 1st call: gemini-4-argon (alias -> gemini-2.5-flash-lite) gets 429 and falls back to gemini-flash-lite-latest
    const res1 = await generateWithDirectGemini('night drive', 'gemini-4-argon', { timeoutMs: 1000 })
    assert.equal(res1.used_model, 'gemini-flash-lite-latest')
    assert.equal(res1.is_fallback, true)
    assert.deepEqual(hitModels, ['gemini-2.5-flash-lite', 'gemini-flash-lite-latest'])

    // 2nd call within 60s: gemini-2.5-flash-lite is skipped immediately without a wasted 429 request
    hitModels.length = 0
    const res2 = await generateWithDirectGemini('morning run', 'gemini-4-argon', { timeoutMs: 1000 })
    assert.equal(res2.used_model, 'gemini-flash-lite-latest')
    assert.equal(res2.is_fallback, true)
    assert.match(res2.fallback_reason, /429 cooldown/i)
    assert.deepEqual(hitModels, ['gemini-flash-lite-latest'])

    // If ALL models are cooled down, fallback tries full candidate pool instead of returning empty
    clearGeminiCooldowns()
    hitModels.length = 0
    globalThis.fetch = async (url) => {
      const m = String(url).match(/models\/([^:]+):generateContent/)?.[1] || ''
      hitModels.push(m)
      return new Response(
        JSON.stringify({ error: { message: 'Rate limited' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    }
    await assert.rejects(() => generateWithDirectGemini('all 429', 'gemini-4-argon', { timeoutMs: 1000 }))
    assert.equal(hitModels.length, 4)

    // Now all 4 models are cooled down; next call when fetch recovers must still try candidates!
    hitModels.length = 0
    globalThis.fetch = async (url) => {
      const m = String(url).match(/models\/([^:]+):generateContent/)?.[1] || ''
      hitModels.push(m)
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"playlist_title":"Recovered","tracks":[]}' }] } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    const res3 = await generateWithDirectGemini('recovered', 'gemini-4-argon', { timeoutMs: 1000 })
    assert.equal(res3.playlist_title, 'Recovered')
    assert.deepEqual(hitModels, ['gemini-2.5-flash-lite'])
  } finally {
    globalThis.fetch = prevFetch
    clearGeminiCooldowns()
    resetStorage()
  }
})
