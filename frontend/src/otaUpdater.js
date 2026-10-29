import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

const GITHUB_REPO = 'AaradhyaNegi009/UpBeat'
const CURRENT_BUILTIN_VERSION = 'v5.4.0'

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
 * Get current active OTA version
 */
export async function getCurrentOtaVersion() {
  const stored = localStorage.getItem('upbeat_ota_version')
  if (stored && isVersionNewer(stored, CURRENT_BUILTIN_VERSION)) {
    return stored
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const cur = await CapacitorUpdater.current()
      if (cur?.bundle?.version && cur.bundle.version !== 'builtin') {
        if (isVersionNewer(cur.bundle.version, CURRENT_BUILTIN_VERSION)) {
          return cur.bundle.version
        }
      }
    } catch {}
  }
  return CURRENT_BUILTIN_VERSION
}

/**
 * Resolve latest version, download URL, and SHA-256 checksum without hitting
 * GitHub's 60 req/hr unauthenticated REST API rate limit (HTTP 403).
 *
 * Strategy:
 * 1. Primary: raw.githubusercontent.com (Unlimited CDN, 0-second push latency, CORS *)
 * 2. Secondary: cdn.jsdelivr.net (Global multi-CDN mirror, CORS *)
 * 3. Tertiary fallback: api.github.com/repos/.../releases/latest
 */
async function resolveLatestReleaseInfo() {
  const cacheBust = Date.now()

  // 1. Try GitHub Raw CDN (Zero API rate limit, instant availability on push)
  try {
    const pkgRes = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/frontend/package.json?t=${cacheBust}`,
      { cache: 'no-store' }
    )
    if (pkgRes.ok) {
      const pkg = await pkgRes.json()
      if (pkg?.version) {
        const latestTag = pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`
        let checksum = ''
        try {
          const shaRes = await fetch(
            `https://raw.githubusercontent.com/${GITHUB_REPO}/main/dist.zip.sha256?t=${cacheBust}`,
            { cache: 'no-store' }
          )
          if (shaRes.ok) {
            checksum = (await shaRes.text()).trim().split(/\s+/)[0]
          }
        } catch {}

        const downloadUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/dist.zip?v=${encodeURIComponent(latestTag)}`
        return {
          latestTag,
          downloadUrl,
          fallbackDownloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${latestTag}/dist.zip`,
          checksum,
          notes: `UpBeat ${latestTag} OTA Update`
        }
      }
    }
  } catch (e) {
    console.warn('[OTA] Raw GitHub check fallback:', e)
  }

  // 2. Try jsDelivr CDN (Zero API rate limit)
  try {
    const jsdRes = await fetch(
      `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/frontend/package.json?t=${cacheBust}`,
      { cache: 'no-store' }
    )
    if (jsdRes.ok) {
      const pkg = await jsdRes.json()
      if (pkg?.version) {
        const latestTag = pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`
        let checksum = ''
        try {
          const shaRes = await fetch(
            `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/dist.zip.sha256?t=${cacheBust}`,
            { cache: 'no-store' }
          )
          if (shaRes.ok) {
            checksum = (await shaRes.text()).trim().split(/\s+/)[0]
          }
        } catch {}

        return {
          latestTag,
          downloadUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/main/dist.zip?v=${encodeURIComponent(latestTag)}`,
          fallbackDownloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${latestTag}/dist.zip`,
          checksum,
          notes: `UpBeat ${latestTag} OTA Update`
        }
      }
    }
  } catch (e) {
    console.warn('[OTA] jsDelivr check fallback:', e)
  }

  // 3. Tertiary fallback: GitHub Releases API
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github.v3+json' }
  })

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      // Rate-limited on api.github.com; use direct latest release download URL
      return {
        latestTag: CURRENT_BUILTIN_VERSION,
        downloadUrl: `https://github.com/${GITHUB_REPO}/releases/latest/download/dist.zip`,
        checksum: '',
        notes: ''
      }
    }
    throw new Error(`Update server returned HTTP ${res.status}`)
  }

  const release = await res.json()
  const latestTag = release.tag_name || ''
  const zipAsset = (release.assets || []).find((a) => a.name === 'dist.zip')
  let checksum = (zipAsset?.digest || '').replace(/^sha256:/i, '').trim()

  if (!checksum) {
    const shaAsset = (release.assets || []).find((a) => a.name === 'dist.zip.sha256')
    if (shaAsset?.browser_download_url) {
      try {
        const shaRes = await fetch(shaAsset.browser_download_url)
        if (shaRes.ok) {
          checksum = (await shaRes.text()).trim().split(/\s+/)[0]
        }
      } catch {}
    }
  }

  return {
    latestTag,
    downloadUrl: zipAsset?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases/latest/download/dist.zip`,
    checksum,
    notes: release.body || ''
  }
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
    const { latestTag, downloadUrl, fallbackDownloadUrl, checksum, notes } = info

    if (!latestTag) {
      return { updateAvailable: false, currentVer, upToDate: true }
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
 * Download and install dist.zip OTA update (with automatic fallback URL retry)
 */
export async function applyOtaBundle(downloadUrl, version, checksum = '', fallbackUrl = '') {
  if (!Capacitor.isNativePlatform()) {
    return false
  }

  const tryDownload = async (url, useChecksum) => {
    const downloadOpts = { url, version }
    if (useChecksum) {
      downloadOpts.checksum = useChecksum
    }
    return await CapacitorUpdater.download(downloadOpts)
  }

  try {
    console.log(`[OTA] Downloading bundle: ${version} from ${downloadUrl}...`)
    let bundle
    try {
      bundle = await tryDownload(downloadUrl, checksum)
    } catch (primaryErr) {
      console.warn('[OTA] Primary download failed, trying fallback without strict checksum:', primaryErr)
      const altUrl = fallbackUrl || `https://github.com/${GITHUB_REPO}/releases/latest/download/dist.zip`
      bundle = await tryDownload(altUrl, '')
    }

    console.log(`[OTA] Bundle downloaded successfully:`, bundle)
    localStorage.setItem('upbeat_ota_version', version)

    // Set active and reload instantly
    await CapacitorUpdater.set(bundle)
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
