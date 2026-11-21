/**
 * Direct Gemini REST API transport with model fallback and JSON cleanup.
 */
import { getStoredApiKey } from "./platformConfig.js"

const MODEL_ALIASES = {
  'gemini-4-argon': 'gemini-2.5-flash-lite',
  'gemini-er-2-flash': 'gemini-2.5-flash-lite'
}
const LOW_THINKING_MODELS = new Set(['gemini-3.8-flash', 'gemini-3.7-flash'])
const ZERO_BUDGET_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-robotics-er-2-preview'])

// ---------------------------------------------------------------------------
// Gemini (direct)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 14000

function cleanJsonText(raw) {
  let s = (raw || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  try {
    return JSON.parse(s)
  } catch {
    const objStart = s.indexOf('{')
    const arrStart = s.indexOf('[')
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart)
    const endChar = start === arrStart ? ']' : '}'
    const end = s.lastIndexOf(endChar)
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1))
    }
    throw new SyntaxError('Gemini returned invalid JSON')
  }
}

function describeError(status, model) {
  if (status === 429) return `Free-tier quota reached (HTTP 429) on ${model}`
  if (status === 503) return `High server demand (HTTP 503) on ${model}`
  if (status === 401 || status === 403) return `API key rejected (HTTP ${status}) on ${model}`
  if (status === 400) return `Bad request (HTTP 400) on ${model}`
  if (status === 404) return `Model unavailable (HTTP 404): ${model}`
  return `HTTP ${status} on ${model}`
}

async function callGeminiDirect(modelId, prompt, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const endpoint = MODEL_ALIASES[modelId] || modelId
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpoint}:generateContent`

  const generationConfig = { temperature: 0.55 }
  if (!endpoint.includes('gemma')) generationConfig.responseMimeType = 'application/json'
  if (ZERO_BUDGET_MODELS.has(endpoint) || endpoint.includes('2.5-flash')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  } else if (LOW_THINKING_MODELS.has(endpoint)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'LOW' }
  } else if (endpoint.includes('gemini-3') || endpoint.includes('flash-lite') || endpoint.includes('gemma-4')) {
    generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      const timeoutErr = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s on ${modelId}`)
      timeoutErr.status = 408
      throw timeoutErr
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) {
    let errMsg = ''
    let errStatus = ''
    try {
      const errBody = await resp.json()
      errMsg = errBody?.error?.message || ''
      errStatus = errBody?.error?.status || ''
    } catch {}
    const baseMsg = describeError(resp.status, modelId)
    const err = new Error(errMsg ? `${baseMsg}: ${errMsg}` : baseMsg)
    err.status = resp.status
    err.isKeyError =
      resp.status === 401 ||
      resp.status === 403 ||
      errStatus === 'PERMISSION_DENIED' ||
      /api[_ ]?key.*(invalid|expired|not valid|missing)/i.test(errMsg)
    throw err
  }

  const body = await resp.json()
  const parts = body?.candidates?.[0]?.content?.parts || []
  let text = ''
  for (const p of parts) if (p.text && !p.thought) text += p.text
  if (!text && parts.length > 0) text = parts[parts.length - 1].text || ''

  let parsed = cleanJsonText(text)
  if (Array.isArray(parsed)) parsed = { tracks: parsed }
  return parsed
}

export async function generateWithDirectGemini(prompt, preferredModel = 'gemini-4-argon', { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const apiKey = getStoredApiKey()
  if (!apiKey) {
    throw new Error('Add your Gemini API key in Settings (key icon) to curate on this device.')
  }

  const pool = [
    preferredModel,
    'gemini-4-argon',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ].filter(Boolean)
  const seen = new Set()
  const candidates = pool.filter((m) => {
    const ep = MODEL_ALIASES[m] || m
    if (seen.has(ep)) return false
    seen.add(ep)
    return true
  })

  const attempts = []
  let primaryReason = ''
  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i]
    const t0 = performance.now()
    try {
      const res = await callGeminiDirect(m, prompt, apiKey, timeoutMs)
      const latency = Math.round(performance.now() - t0)
      attempts.push({ model: m, status: 'ok', latency_ms: latency })
      return {
        ...res,
        requested_model: preferredModel,
        used_model: m,
        is_fallback: i > 0,
        latency_ms: latency,
        model_attempts: attempts,
        fallback_reason: i > 0 ? primaryReason : '',
        fallback_note: i > 0 ? `${primaryReason} -> generated by ${m}` : ''
      }
    } catch (err) {
      const reason = err.message || `Error on ${m}`
      attempts.push({ model: m, status: 'error', reason, latency_ms: Math.round(performance.now() - t0) })
      if (i === 0) primaryReason = reason
      // Stop early only when Gemini confirms the API key / permission itself is invalid.
      if (err.isKeyError) throw new Error(reason)
    }
  }
  throw new Error(`All Gemini models failed (${primaryReason})`)
}
