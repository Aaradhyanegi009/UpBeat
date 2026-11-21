import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8')
}

test('cross-platform version parity matches root package.json across all targets', () => {
  const rootPkg = JSON.parse(read('package.json'))
  const expected = rootPkg.version
  assert.match(expected, /^\d+\.\d+\.\d+/)

  const frontendPkg = JSON.parse(read('frontend/package.json'))
  assert.equal(frontendPkg.version, expected, 'frontend/package.json version mismatch')

  const electronPkg = JSON.parse(read('electron/package.json'))
  assert.equal(electronPkg.version, expected, 'electron/package.json version mismatch')

  const preload = read('electron/preload.cjs')
  assert.match(preload, new RegExp(`appVersion:\\s*'${expected.replace(/\./g, '\\.')}'`))

  const mainJs = read('electron/main.cjs')
  assert.match(mainJs, new RegExp(`app\\.getVersion\\(\\)\\s*\\|\\|\\s*'${expected.replace(/\./g, '\\.')}'`))

  const serverJs = read('electron/server.cjs')
  assert.match(serverJs, new RegExp(`options\\.version\\s*\\|\\|\\s*'${expected.replace(/\./g, '\\.')}'`))

  const ota = read('frontend/src/otaUpdater.js')
  assert.match(ota, new RegExp(`CURRENT_BUILTIN_VERSION\\s*=\\s*'v${expected.replace(/\./g, '\\.')}'`))

  const plist = read('macos/Info.plist')
  assert.match(plist, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${expected.replace(/\./g, '\\.')}</string>`))

  const swift = read('macos/UpBeatApp.swift')
  assert.match(swift, new RegExp(`return\\s+"${expected.replace(/\./g, '\\.')}"`))

  const gradle = read('android/app/build.gradle')
  assert.match(gradle, new RegExp(`versionName\\s+"${expected.replace(/\./g, '\\.')}"`))
})

test('no stale 7.3.1 release literals or hardcoded Android keystore credentials remain', () => {
  for (const rel of [
    'electron/preload.cjs',
    'electron/main.cjs',
    'electron/server.cjs',
    '.github/workflows/build-windows.yml'
  ]) {
    assert.equal(read(rel).includes('7.3.1'), false, `${rel} still contains stale 7.3.1 literal`)
  }

  const gradle = read('android/app/build.gradle')
  assert.equal(gradle.includes('upbeat-sideload'), false, 'android/app/build.gradle still contains hardcoded keystore credentials')
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'android/app/upbeat-sideload.keystore')),
    false,
    'android/app/upbeat-sideload.keystore must not exist in repository'
  )

  const manifest = read('android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:allowBackup="false"/)
  assert.equal(manifest.includes('android:showWhenLocked="true"'), false)
  assert.equal(manifest.includes('android:inheritShowWhenLocked="true"'), false)
})
