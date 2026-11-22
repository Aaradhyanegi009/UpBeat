import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

const GITHUB_REPO = 'AaradhyaNegi009/UpBeat'
const CURRENT_BUILTIN_VERSION = 'v7.7.2'
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i
const OTA_FETCH_TIMEOUT_MS = 8000

/**
 * Normalize and strictly validate a 64-hex-character SHA-256 digest.
 */
export function normalizeSha256(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const token = raw.trim().replace(/^sha256:/i, '').trim().split(/\s+/)[0] || ''
  return SHA256_HEX_REGEX.test(token) ? token.toLowerCase() : ''
}

async function fetchWithTimeout(url, options = {}, timeoutMs = OTA_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('OTA request timeout')), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Initialize OTA updater on app startup.
 * Confirms JavaScript bundle health to native layer to prevent rollback.
 */
export async function initOtaUpdater(onUpdateReady) {
  if (!Capacitor.isNativePlatform()) {
    return
  }

  try {
    // Notify native layer that bundle loaded successfully (vital for CapacitorUpdater)
    await CapacitorUpdater.notifyAppReady()
  } catch (err) {
    console.warn('[OTA] notifyAppReady warning:', err)
  }

  // Check for updates in the background after app stabilizes
  setTimeout(() => {
    checkOtaUpdate({ silent: true, onUpdateReady }).catch((e) => {
      console.warn('[OTA] Background check error:', e)
    })
  }, 4000)
}

/**
 * Get current active OTA version.
 * Always consults CapacitorUpdater.current() first on native builds so native rollbacks
 * or APK updates are never masked by a stale localStorage value.
 */
export async function getCurrentOtaVersion() {
  if (Capacitor.isNativePlatform()) {
    try {
      const cur = await CapacitorUpdater.current()
      const activeVersion = cur?.bundle?.version
      if (activeVersion && activeVersion !== 'builtin' && isVersionNewer(activeVersion, CURRENT_BUILTIN_VERSION)) {
        try {
          localStorage.setItem('upbeat_ota_version', activeVersion)
        } catch {}
        return activeVersion
      }
      try {
        localStorage.removeItem('upbeat_ota_version')
      } catch {}
      return CURRENT_BUILTIN_VERSION
    } catch {
      // Fall back to localStorage only if native bundle query failed
    }
  }

  try {
    const stored = localStorage.getItem('upbeat_ota_version')
    if (stored && isVersionNewer(stored, CURRENT_BUILTIN_VERSION)) {
      return stored
    }
  } catch {}
  return CURRENT_BUILTIN_VERSION
}

async function fetchValidChecksum(url) {
  try {
    const shaRes = await fetchWithTimeout(url, { cache: 'no-store' })
    if (shaRes.ok) {
      return normalizeSha256(await shaRes.text())
    }
  } catch {}
  return ''
}

function buildImmutableReleaseUrls(tag) {
  const encodedTag = encodeURIComponent(tag)
  return {
    zipUrl: `https://github.com/${GITHUB_REPO}/releases/download/${encodedTag}/dist.zip`,
    shaUrl: `https://github.com/${GITHUB_REPO}/releases/download/${encodedTag}/dist.zip.sha256`
  }
}

/**
 * Resolve latest version, immutable release download URL, and required SHA-256 checksum.
 *
 * Strategy:
 * 1. Primary: GitHub Releases API (immutable tagged release assets & digest/.sha256)
 * 2. Secondary fallback (when GitHub REST API is rate-limited/unavailable): discover latest
 *    tag via GitHub releases redirect or CDN package.json, then resolve the immutable tagged
 *    release dist.zip + dist.zip.sha256 first (failing closed if no valid SHA-256 exists).
 */
async function resolveLatestReleaseInfo() {
  const cacheBust = Date.now()

  // 1. Primary: Immutable GitHub Releases API
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github.v3+json' },
        cache: 'no-store'
      }
    )

    if (res.ok) {
      const release = await res.json()
      const latestTag = release?.tag_name || ''
      if (latestTag) {
        const assets = Array.isArray(release.assets) ? release.assets : []
        const zipAsset = assets.find((a) => a.name === 'dist.zip')
        const shaAsset = assets.find((a) => a.name === 'dist.zip.sha256')
        const { zipUrl, shaUrl } = buildImmutableReleaseUrls(latestTag)

        let checksum = normalizeSha256(zipAsset?.digest)
        if (!checksum) {
          checksum = await fetchValidChecksum(shaAsset?.browser_download_url || shaUrl)
        }

        if (checksum) {
          return {
            latestTag,
            downloadUrl: zipAsset?.browser_download_url || zipUrl,
            fallbackDownloadUrl: '',
            checksum,
            notes: release.body || `UpBeat ${latestTag} OTA Update`
          }
        }
      }
    }
  } catch (e) {
    console.warn('[OTA] GitHub Releases API check fallback:', e)
  }

  // 2. Secondary fallback: Discover latest tag without API rate limit, then prefer immutable release assets
  let discoveredTag = ''

  try {
    const latestRedirectRes = await fetchWithTimeout(
      `https://github.com/${GITHUB_REPO}/releases/latest`,
      { cache: 'no-store' }
    )
    const match = (latestRedirectRes?.url || '').match(/\/releases\/tag\/([^/?#]+)/)
    if (match && match[1]) {
      discoveredTag = decodeURIComponent(match[1])
    }
  } catch {}

  if (!discoveredTag) {
    const pkgUrls = [
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/frontend/package.json?t=${cacheBust}`,
      `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/frontend/package.json?t=${cacheBust}`
    ]
    for (const pkgUrl of pkgUrls) {
      try {
        const pkgRes = await fetchWithTimeout(pkgUrl, { cache: 'no-store' })
        if (pkgRes.ok) {
          const pkg = await pkgRes.json()
          if (pkg?.version) {
            discoveredTag = pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`
            break
          }
        }
      } catch {}
    }
  }

  if (!discoveredTag) {
    throw new Error('Unable to resolve latest OTA release version')
  }

  const { zipUrl, shaUrl } = buildImmutableReleaseUrls(discoveredTag)
  const releaseChecksum = await fetchValidChecksum(shaUrl)
  if (releaseChecksum) {
    return {
      latestTag: discoveredTag,
      downloadUrl: zipUrl,
      fallbackDownloadUrl: '',
      checksum: releaseChecksum,
      notes: `UpBeat ${discoveredTag} OTA Update`
    }
  }

  // Only if immutable release asset checksum is unavailable, verify main CDN bundle matches discovered tag
  const cdnShaUrls = [
    `https://raw.githubusercontent.com/${GITHUB_REPO}/main/dist.zip.sha256?t=${cacheBust}`,
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/dist.zip.sha256?t=${cacheBust}`
  ]
  for (const cdnShaUrl of cdnShaUrls) {
    const cdnChecksum = await fetchValidChecksum(cdnShaUrl)
    if (cdnChecksum) {
      return {
        latestTag: discoveredTag,
        downloadUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/main/dist.zip?v=${encodeURIComponent(discoveredTag)}`,
        fallbackDownloadUrl: `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/dist.zip`,
        checksum: cdnChecksum,
        notes: `UpBeat ${discoveredTag} OTA Update`
      }
    }
  }

  throw new Error(`Missing valid SHA-256 checksum for OTA release ${discoveredTag}`)
}

/**
 * Check for newer dist.zip OTA bundle
 */
export async function checkOtaUpdate({ silent = false, forceCheck = false, onUpdateReady = null } = {}) {
  if (!Capacitor.isNativePlatform()) {
    return { isNative: false, updateAvailable: false }
  }

  try {
    const currentVer = await getCurrentOtaVersion()
    const info = await resolveLatestReleaseInfo()
    const { latestTag, downloadUrl, fallbackDownloadUrl, notes } = info
    const checksum = normalizeSha256(info.checksum)

    if (!latestTag) {
      return { updateAvailable: false, currentVer, upToDate: true }
    }

    if (!checksum) {
      throw new Error(`Missing valid SHA-256 checksum for ${latestTag}`)
    }

    const isNewer = isVersionNewer(latestTag, currentVer)
    if (!isNewer && !forceCheck) {
      return { updateAvailable: false, currentVer, latestTag, upToDate: true }
    }

    if (!isNewer && forceCheck) {
      return {
        updateAvailable: false,
        upToDate: true,
        currentVer,
        latestTag,
        downloadUrl,
        checksum
      }
    }

    console.log(`[OTA] New update available: ${latestTag} (current: ${currentVer})`)

    if (onUpdateReady) {
      onUpdateReady({
        latestVersion: latestTag,
        currentVersion: currentVer,
        downloadUrl,
        checksum,
        notes,
        autoApply: async () => {
          return applyOtaBundle(downloadUrl, latestTag, checksum, fallbackDownloadUrl)
        }
      })
    }

    return {
      updateAvailable: true,
      currentVer,
      latestTag,
      downloadUrl,
      fallbackDownloadUrl,
      checksum
    }
  } catch (err) {
    if (!silent) console.error('[OTA] Check failed:', err)
    return { updateAvailable: false, error: err.message }
  }
}

/**
 * Download and install dist.zip OTA update (fail-closed on missing or mismatched SHA-256).
 */
export async function applyOtaBundle(downloadUrl, version, checksum = '', fallbackUrl = '') {
  if (!Capacitor.isNativePlatform()) {
    return false
  }

  const validChecksum = normalizeSha256(checksum)
  if (!validChecksum) {
    throw new Error('Refusing OTA install: missing or invalid SHA-256 checksum')
  }
  if (!downloadUrl || !/^https:\/\//i.test(downloadUrl)) {
    throw new Error('Refusing OTA install: invalid HTTPS bundle URL')
  }

  const tryDownload = async (url) => {
    return await CapacitorUpdater.download({
      url,
      version,
      checksum: validChecksum
    })
  }

  try {
    console.log(`[OTA] Downloading verified bundle: ${version} from ${downloadUrl}...`)
    let bundle
    try {
      bundle = await tryDownload(downloadUrl)
    } catch (primaryErr) {
      const errMsg = String(primaryErr?.message || primaryErr || '')
      const isIntegrityFailure = /checksum|sha-?256|digest|hash|integrity|mismatch|verify/i.test(errMsg)
      if (!isIntegrityFailure && fallbackUrl && fallbackUrl !== downloadUrl && /^https:\/\//i.test(fallbackUrl)) {
        console.warn('[OTA] Primary download failed, retrying fallback mirror with required SHA-256:', primaryErr)
        bundle = await tryDownload(fallbackUrl)
      } else {
        throw primaryErr
      }
    }

    console.log('[OTA] Bundle downloaded and verified successfully:', bundle)

    // Set active and reload instantly; only record localStorage marker after set succeeds
    await CapacitorUpdater.set(bundle)
    try {
      localStorage.setItem('upbeat_ota_version', version)
    } catch {}
    await CapacitorUpdater.reload()
    return true
  } catch (err) {
    console.error('[OTA] Failed to apply update bundle:', err)
    throw err
  }
}

/**
 * Helper to check if new tag is higher version (supports 3 or 4 segments e.g. v5.1.3.2)
 */
function isVersionNewer(newVer, currentVer) {
  if (!newVer || !currentVer) return false
  if (newVer === currentVer) return false
  if (currentVer === 'builtin') return true

  const clean = (v) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const nParts = clean(newVer)
  const cParts = clean(currentVer)
  const len = Math.max(nParts.length, cParts.length, 3)

  for (let i = 0; i < len; i++) {
    const n = nParts[i] || 0
    const c = cParts[i] || 0
    if (n !== c) return n > c
  }

  return false
}
