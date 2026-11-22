import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage, withWindowStub } from './helpers/test-env.mjs'
import * as barrel from '../src/standaloneApi.js'
import {
  parseDurationText,
  getAudioSource,
  getCachedAudioSource,
  prewarmTrack
} from '../src/services/audioResolver.js'
import { generateWithDirectGemini } from '../src/services/geminiClient.js'

const EXPECTED_BARREL_EXPORTS = [
  'AVAILABLE_CHARTS',
  'COMEDY_PODCAST_REGEX',
  'DEFAULT_SEED_IDS',
  'DEFAULT_YT_CHARTS_STATIONS',
  'DEVOTIONAL_RELIGIOUS_REGEX',
  'NON_MUSIC_GENERAL_REGEX',
  'NON_MUSIC_REGEX',
  'STRICT_VIDEO_ID_REGEX',
  'THIRTY_MINUTES_MS',
  'VERIFIED_MODELS',
  'advanceRotationCursor',
  'analyzeTasteDnaStandalone',
  'apiUrl',
  'browsePlaylistStandalone',
  'buildHybridRediscoverBlock',
  'callInnertube',
  'cleanTrackMetadataForLyrics',
  'clearGeminiCooldowns',
  'curateStandalone',
  'directSearchStandalone',
  'fetchListenTogetherFeed',
  'fetchOfficialYoutubeCharts',
  'fetchRelatedCompanionTracks',
  'fetchTrackExtendedMeta',
  'fetchTrackLyrics',
  'fisherYatesShuffle',
  'formatDurationSeconds',
  'generateWithDirectGemini',
  'getApiBase',
  'getAudioSource',
  'getCachedAudioSource',
  'getInitialDiscoveryBlocks',
  'getRotationCursor',
  'getStoredApiKey',
  'getStoredServerUrl',
  'getTrackDownloadUrl',
  'hasBackend',
  'importYouTubePlaylistStandalone',
  'invalidateCachedAudioSource',
  'isConfigured',
  'isNativeApp',
  'isStrictArtistName',
  'isStrictMusicTrack',
  'isValidMusicTrack',
  'loadBlockTracks',
  'openExternalUrl',
  'parseLrcLyrics',
  'prewarmTrack',
  'rerollDiscoveryBlock',
  'resolveRankedChartBlocks',
  'resolveStandaloneAudio',
  'sanitizeLocalMusicLibrary',
  'searchYouTubeMusicList',
  'searchYouTubeStandalone',
  'setStoredApiKey',
  'setStoredServerUrl'
]

test('standaloneApi barrel preserves exact public export surface', () => {
  const actualExports = Object.keys(barrel).sort()
  assert.deepEqual(actualExports, EXPECTED_BARREL_EXPORTS)
  for (const name of EXPECTED_BARREL_EXPORTS) {
    assert.notEqual(barrel[name], undefined, `Export ${name} should be defined`)
  }
})

test('parseDurationText parses m:ss, h:mm:ss, raw numbers, and invalid markers', () => {
  assert.equal(parseDurationText('3:45'), 225)
  assert.equal(parseDurationText('1:02:03'), 3723)
  assert.equal(parseDurationText('198'), 198)
  assert.equal(parseDurationText(240.4), 240)
  assert.equal(parseDurationText('--:--'), 0)
  assert.equal(parseDurationText(null), 0)
})

test('getAudioSource sends expected_duration to backend using parseDurationText', async () => {
  resetStorage()
  localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
  const requestedUrls = []
  const prevFetch = globalThis.fetch

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    return {
      ok: true,
      json: async () => ({ duration: 215, video_id: 'dQw4w9WgXcQ' })
    }
  }

  try {
    const entry = await withWindowStub(() =>
      getAudioSource('dQw4w9WgXcQ', {
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        duration_text: '3:35'
      })
    )

    assert.equal(requestedUrls.length, 1)
    assert.match(requestedUrls[0], /\/api\/audio-info\/dQw4w9WgXcQ\?/)
    assert.match(requestedUrls[0], /expected_duration=215/)
    assert.equal(entry.duration, 215)
    assert.match(entry.url, /\/api\/audio\/dQw4w9WgXcQ\?/)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('generateWithDirectGemini requires configured API key and parses mocked JSON', async () => {
  resetStorage()
  await assert.rejects(
    () => generateWithDirectGemini('test prompt'),
    /Add your Gemini API key in Settings/
  )

  barrel.setStoredApiKey('test-key-123')
  const prevFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: '```json\n{"ok":true,"songs":["A","B"]}\n```' }]
        }
      }]
    })
  })

  try {
    const result = await generateWithDirectGemini('test prompt', 'gemini-2.5-flash')
    assert.equal(result.ok, true)
    assert.deepEqual(result.songs, ['A', 'B'])
    assert.equal(result.used_model, 'gemini-2.5-flash')
    assert.equal(result.is_fallback, false)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('prewarmTrack(track) pre-resolves full source, deduplicates in-flight/cached calls, and exposes getCachedAudioSource', async () => {
  resetStorage()
  localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
  const vid = 'pwTrack0001'
  assert.equal(getCachedAudioSource(vid), null)

  let fetchCount = 0
  let resolveFetch
  const pendingFetch = new Promise((r) => { resolveFetch = r })
  const seenUrls = []
  const prevFetch = globalThis.fetch

  globalThis.fetch = async (url) => {
    fetchCount++
    seenUrls.push(String(url))
    await pendingFetch
    return new Response(
      JSON.stringify({ duration: 245, video_id: vid }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    const track = {
      video_id: vid,
      title: 'Prewarm Song',
      artist: 'Prewarm Artist',
      duration_text: '4:05'
    }

    let p1
    let p2
    await withWindowStub(async () => {
      p1 = prewarmTrack(track)
      p2 = prewarmTrack(vid)
      assert.equal(p1, p2, 'concurrent prewarmTrack calls share the same in-flight Promise')
      resolveFetch()
      const [e1, e2] = await Promise.all([p1, p2])
      assert.ok(e1?.url)
      assert.equal(e1, e2)
      assert.equal(e1.duration, 245)
    })

    assert.equal(fetchCount, 1)
    assert.match(seenUrls[0], /expected_duration=245/)

    const syncCached = getCachedAudioSource(vid)
    assert.ok(syncCached?.url)
    assert.equal(syncCached.video_id, vid)

    // Subsequent prewarmTrack hits memory cache synchronously with zero extra fetches
    const e3 = await withWindowStub(() => prewarmTrack(track))
    assert.equal(e3, syncCached)
    assert.equal(fetchCount, 1)

    // Invalid video ID returns null cleanly without throwing
    assert.equal(await prewarmTrack('bad'), null)
    assert.equal(getCachedAudioSource('nonexistent1'), null)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})
