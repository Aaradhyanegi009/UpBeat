import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const capState = {
  isNative: true,
  currentVersion: 'builtin',
  downloadCalls: [],
  downloadBehavior: async () => ({ id: 'b1', version: 'v7.7.0' }),
  setShouldFail: false
}

const memStorage = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStorage.has(String(k)) ? memStorage.get(String(k)) : null),
  setItem: (k, v) => memStorage.set(String(k), String(v)),
  removeItem: (k) => memStorage.delete(String(k)),
  clear: () => memStorage.clear()
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@capacitor/core') {
      return { shortCircuit: true, url: 'mock:cap-core' }
    }
    if (specifier === '@capgo/capacitor-updater') {
      return { shortCircuit: true, url: 'mock:cap-updater' }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mock:cap-core') {
      return {
        shortCircuit: true,
        format: 'module',
        source: `
          export const Capacitor = {
            isNativePlatform: () => globalThis.__UPBEAT_CAP_STATE__.isNative
          }
        `
      }
    }
    if (url === 'mock:cap-updater') {
      return {
        shortCircuit: true,
        format: 'module',
        source: `
          export const CapacitorUpdater = {
            notifyAppReady: async () => {},
            current: async () => ({ bundle: { version: globalThis.__UPBEAT_CAP_STATE__.currentVersion } }),
            download: async (opts) => {
              globalThis.__UPBEAT_CAP_STATE__.downloadCalls.push(opts)
              return globalThis.__UPBEAT_CAP_STATE__.downloadBehavior(opts)
            },
            set: async () => {
              if (globalThis.__UPBEAT_CAP_STATE__.setShouldFail) {
                throw new Error('Set bundle failed')
              }
            },
            reload: async () => {}
          }
        `
      }
    }
    return nextLoad(url, context)
  }
})

globalThis.__UPBEAT_CAP_STATE__ = capState

const {
  getCurrentOtaVersion,
  checkOtaUpdate,
  applyOtaBundle,
  normalizeSha256
} = await import('../../frontend/src/otaUpdater.js')

const VALID_SHA = 'a'.repeat(64)

test('getCurrentOtaVersion prioritizes CapacitorUpdater.current() and clears masked rollbacks', async () => {
  memStorage.clear()
  capState.isNative = true
  capState.currentVersion = 'builtin'
  localStorage.setItem('upbeat_ota_version', 'v9.9.9')

  const verAfterRollback = await getCurrentOtaVersion()
  assert.equal(verAfterRollback, 'v7.7.2')
  assert.equal(localStorage.getItem('upbeat_ota_version'), null)

  capState.currentVersion = 'v7.8.0'
  const activeVer = await getCurrentOtaVersion()
  assert.equal(activeVer, 'v7.8.0')
  assert.equal(localStorage.getItem('upbeat_ota_version'), 'v7.8.0')
})

test('applyOtaBundle fails closed without valid SHA-256 and never retries with empty checksum', async () => {
  memStorage.clear()
  capState.isNative = true
  capState.downloadCalls = []
  capState.setShouldFail = false

  // Empty checksum rejected immediately
  await assert.rejects(
    () => applyOtaBundle('https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.7.0/dist.zip', 'v7.7.0', ''),
    /missing or invalid SHA-256 checksum/
  )
  assert.equal(capState.downloadCalls.length, 0)

  // Non-HTTPS URL rejected immediately
  await assert.rejects(
    () => applyOtaBundle('http://example.com/dist.zip', 'v7.7.0', VALID_SHA),
    /invalid HTTPS bundle URL/
  )

  // Checksum mismatch error must fail closed without falling back
  capState.downloadCalls = []
  capState.downloadBehavior = async () => {
    throw new Error('SHA-256 checksum mismatch')
  }
  await assert.rejects(
    () =>
      applyOtaBundle(
        'https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.7.0/dist.zip',
        'v7.7.0',
        VALID_SHA,
        'https://cdn.jsdelivr.net/gh/AaradhyaNegi009/UpBeat@main/dist.zip'
      ),
    /checksum mismatch/
  )
  assert.equal(capState.downloadCalls.length, 1)

  // Network error on primary retries fallback WITH the exact same required SHA-256 checksum
  capState.downloadCalls = []
  let attempt = 0
  capState.downloadBehavior = async () => {
    attempt += 1
    if (attempt === 1) throw new Error('Network timeout')
    return { id: 'ok', version: 'v7.7.0' }
  }
  const ok = await applyOtaBundle(
    'https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.7.0/dist.zip',
    'v7.7.0',
    VALID_SHA,
    'https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.7.0/dist.zip.mirror'
  )
  assert.equal(ok, true)
  assert.equal(capState.downloadCalls.length, 2)
  assert.equal(capState.downloadCalls[0].checksum, VALID_SHA)
  assert.equal(capState.downloadCalls[1].checksum, VALID_SHA)

  // localStorage is not mutated if CapacitorUpdater.set fails
  memStorage.clear()
  capState.downloadCalls = []
  capState.downloadBehavior = async () => ({ id: 'ok', version: 'v7.8.0' })
  capState.setShouldFail = true
  await assert.rejects(
    () => applyOtaBundle('https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.8.0/dist.zip', 'v7.8.0', VALID_SHA),
    /Set bundle failed/
  )
  assert.equal(localStorage.getItem('upbeat_ota_version'), null)
  capState.setShouldFail = false
})

test('checkOtaUpdate prefers immutable GitHub Releases assets and fails closed on missing SHA-256', async () => {
  capState.isNative = true
  capState.currentVersion = 'builtin'
  const origFetch = globalThis.fetch

  try {
    globalThis.fetch = async (target) => {
      const u = String(target)
      if (u.startsWith('https://api.github.com/repos/')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v7.8.0',
            body: 'Release notes',
            assets: [
              {
                name: 'dist.zip',
                browser_download_url: 'https://github.com/AaradhyaNegi009/UpBeat/releases/download/v7.8.0/dist.zip',
                digest: `sha256:${VALID_SHA}`
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      throw new Error(`Unexpected URL ${u}`)
    }

    const res = await checkOtaUpdate({ silent: true })
    assert.equal(res.updateAvailable, true)
    assert.equal(res.latestTag, 'v7.8.0')
    assert.equal(res.checksum, VALID_SHA)
    assert.match(res.downloadUrl, /releases\/download\/v7\.8\.0\/dist\.zip/)

    // Rate-limited API with no checksum anywhere must fail closed (never offer update with empty checksum)
    globalThis.fetch = async (target) => {
      const u = String(target)
      if (u.startsWith('https://api.github.com/')) return new Response('rate limit', { status: 403 })
      if (u.includes('/releases/latest')) return { ok: true, url: 'https://github.com/AaradhyaNegi009/UpBeat/releases/tag/v7.8.0' }
      return new Response('Not found', { status: 404 })
    }
    const failRes = await checkOtaUpdate({ silent: true })
    assert.equal(failRes.updateAvailable, false)
    assert.match(failRes.error || '', /SHA-256/)
    assert.equal(normalizeSha256('invalid'), '')
    assert.equal(normalizeSha256(`sha256:${VALID_SHA.toUpperCase()}`), VALID_SHA)
  } finally {
    globalThis.fetch = origFetch
  }
})
