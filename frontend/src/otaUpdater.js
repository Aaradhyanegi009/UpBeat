import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

const GITHUB_REPO = 'AaradhyaNegi009/UpBeat'
const CURRENT_BUILTIN_VERSION = 'v5.1.2'

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
  if (stored) return stored

  if (Capacitor.isNativePlatform()) {
    try {
      const cur = await CapacitorUpdater.current()
      if (cur?.bundle?.version && cur.bundle.version !== 'builtin') {
        return cur.bundle.version
      }
    } catch {}
  }
  return CURRENT_BUILTIN_VERSION
}

/**
 * Check GitHub Releases for newer dist.zip bundle
 */
export async function checkOtaUpdate({ silent = false, forceCheck = false, onUpdateReady = null } = {}) {
  if (!Capacitor.isNativePlatform()) {
    return { isNative: false, updateAvailable: false }
  }

  try {
    const currentVer = await getCurrentOtaVersion()
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' }
    })

    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`)
    }

    const release = await res.json()
    const latestTag = release.tag_name || ''
    if (!latestTag) {
      return { updateAvailable: false, currentVer }
    }

    // Find dist.zip in release assets
    const zipAsset = (release.assets || []).find((a) => a.name === 'dist.zip')
    if (!zipAsset || !zipAsset.browser_download_url) {
      return { updateAvailable: false, currentVer, latestTag, error: 'No dist.zip found in latest release' }
    }

    // Extract SHA-256 checksum from asset digest
    let checksum = (zipAsset.digest || '').replace(/^sha256:/i, '').trim()
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

    // Compare versions (e.g. v4.0.1 vs v4.0.0)
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
        downloadUrl: zipAsset.browser_download_url,
        checksum
      }
    }

    console.log(`[OTA] New update available: ${latestTag} (current: ${currentVer})`)

    if (onUpdateReady) {
      onUpdateReady({
        latestVersion: latestTag,
        currentVersion: currentVer,
        downloadUrl: zipAsset.browser_download_url,
        checksum,
        notes: release.body || '',
        autoApply: async () => {
          return applyOtaBundle(zipAsset.browser_download_url, latestTag, checksum)
        }
      })
    }

    return {
      updateAvailable: true,
      currentVer,
      latestTag,
      downloadUrl: zipAsset.browser_download_url,
      checksum,
      release
    }
  } catch (err) {
    if (!silent) console.error('[OTA] Check failed:', err)
    return { updateAvailable: false, error: err.message }
  }
}

/**
 * Download and install dist.zip OTA update
 */
export async function applyOtaBundle(downloadUrl, version, checksum = '') {
  if (!Capacitor.isNativePlatform()) {
    return false
  }

  try {
    console.log(`[OTA] Downloading bundle: ${version} (checksum: ${checksum || 'none'})...`)
    const downloadOpts = {
      url: downloadUrl,
      version: version
    }
    if (checksum) {
      downloadOpts.checksum = checksum
    }

    const bundle = await CapacitorUpdater.download(downloadOpts)
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
 * Helper to check if new tag is higher version
 */
function isVersionNewer(newVer, currentVer) {
  if (!newVer || !currentVer) return false
  if (newVer === currentVer) return false
  if (currentVer === 'builtin') return true

  const clean = (v) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const [nMaj = 0, nMin = 0, nPat = 0] = clean(newVer)
  const [cMaj = 0, cMin = 0, cPat = 0] = clean(currentVer)

  if (nMaj !== cMaj) return nMaj > cMaj
  if (nMin !== cMin) return nMin > cMin
  if (nPat !== cPat) return nPat > cPat

  return newVer !== currentVer
}
