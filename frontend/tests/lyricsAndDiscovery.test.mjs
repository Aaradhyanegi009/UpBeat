import './helpers/test-env.mjs'
import { resetStorage } from './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanTrackMetadataForLyrics,
  parseLrcLyrics,
  formatDurationSeconds,
  fisherYatesShuffle,
  resolveRankedChartBlocks,
  getInitialDiscoveryBlocks,
  fetchListenTogetherFeed,
  fetchRelatedCompanionTracks,
  buildHybridRediscoverBlock,
  fetchTrackLyrics
} from '../src/standaloneApi.js'
import { clearLyricsCache } from '../src/services/lyricsClient.js'

test('cleanTrackMetadataForLyrics strips noisy YouTube tags and label channels', () => {
  const res1 = cleanTrackMetadataForLyrics(
    'Arijit Singh - Tum Hi Ho (Official Video) [4K]',
    'T-Series'
  )
  assert.equal(res1.coreTitle, 'Tum Hi Ho')
  assert.equal(res1.cleanArtist, 'Arijit Singh')

  const res2 = cleanTrackMetadataForLyrics(
    'Renai Circulation「恋愛サーキュレーション」【Official Audio】',
    'Kana Hanazawa - Topic'
  )
  assert.equal(res2.coreTitle, 'Renai Circulation')
  assert.equal(res2.cleanArtist, 'Kana Hanazawa')
})

test('parseLrcLyrics parses timestamps, offsets, and intro/instrumental indicators', () => {
  const lrc = [
    '[offset:1000]',
    '[00:08.50] First vocal line',
    '[00:12.00] Second line',
    '[00:20.00] ',
    '[00:29.00] Back after break'
  ].join('\n')

  const lines = parseLrcLyrics(lrc)
  assert.equal(lines[0].isInstrumental, true)
  assert.equal(lines[0].time, 0)
  assert.equal(lines[1].text, 'First vocal line')
  assert.ok(Math.abs(lines[1].time - 7.5) < 0.01)
  assert.equal(lines[3].isInstrumental, true)
  assert.equal(lines[4].text, 'Back after break')
})

test('formatDurationSeconds formats m:ss and h:mm:ss cleanly and returns empty string for non-positive values', () => {
  assert.equal(formatDurationSeconds(0), '')
  assert.equal(formatDurationSeconds(-5), '')
  assert.equal(formatDurationSeconds(185), '3:05')
  assert.equal(formatDurationSeconds(61), '1:01')
  assert.equal(formatDurationSeconds(3665), '1:01:05')
})

test('fisherYatesShuffle returns permutation without mutating input array', () => {
  const input = [1, 2, 3, 4, 5, 6]
  const out = fisherYatesShuffle(input)
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6])
  assert.equal(out.length, 6)
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5, 6])
})

test('resolveRankedChartBlocks prioritizes user preferences and returns 7 daily charts', () => {
  resetStorage()
  localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['block_japan_top_daily', 'block_kpop_top_daily']))

  const charts = resolveRankedChartBlocks(0)
  assert.equal(charts.length, 7)
  assert.equal(charts[0].id, 'block_japan_top_daily')
  assert.equal(charts[1].id, 'block_kpop_top_daily')
  assert.ok(charts.every((c) => c.tier === 1 && c.thumbnail && Array.isArray(c.thumbnailPool)))
})

test('getInitialDiscoveryBlocks provides 7 tier-1 charts and 7 tier-2 Made for You mixes', () => {
  resetStorage()
  const blocks = getInitialDiscoveryBlocks()
  const tier1 = blocks.filter((b) => b.tier === 1)
  const tier2 = blocks.filter((b) => b.tier === 2)
  assert.equal(tier1.length, 7)
  assert.equal(tier2.length, 7)
})

test('fetchRelatedCompanionTracks uses exported findNodes for YTM RDAMVM radio automix', async () => {
  resetStorage()
  const prevFetch = globalThis.fetch
  const requested = []

  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {}
    requested.push({ url: String(url), endpoint: body.endpoint, playlistId: body.body?.playlistId })
    if (body.endpoint === 'next') {
      return new Response(
        JSON.stringify({
          contents: {
            singleColumnMusicWatchNextResultsRenderer: {
              tabbedRenderer: {
                watchNextTabbedResultsRenderer: {
                  tabs: [
                    {
                      tabRenderer: {
                        content: {
                          musicQueueRenderer: {
                            content: {
                              playlistPanelRenderer: {
                                contents: [
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: 'dQw4w9WgXcQ',
                                      title: { runs: [{ text: 'Radio Track One' }] },
                                      shortBylineText: { runs: [{ text: 'Artist Radio' }] },
                                      lengthText: { runs: [{ text: '3:32' }] }
                                    }
                                  },
                                  {
                                    playlistPanelVideoRenderer: {
                                      videoId: '9bZkp7q19f0',
                                      title: { runs: [{ text: 'Radio Track Two' }] },
                                      shortBylineText: { runs: [{ text: 'Second Artist' }] },
                                      lengthText: { runs: [{ text: '4:12' }] }
                                    }
                                  }
                                ]
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const companions = await fetchRelatedCompanionTracks(
      [{ video_id: '34Na4j8AVgA', title: 'Starboy', artist: 'The Weeknd' }],
      2
    )
    assert.equal(companions.length, 2)
    assert.equal(companions[0].video_id, 'dQw4w9WgXcQ')
    assert.equal(companions[0].source, 'radio_companion')
    assert.equal(requested.some((r) => r.endpoint === 'next' && r.playlistId === 'RDAMVM34Na4j8AVgA'), true)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('buildHybridRediscoverBlock reads argon_favs_v2 and argon_seeds_v2 from localStorage', async () => {
  resetStorage()
  localStorage.setItem(
    'argon_favs_v2',
    JSON.stringify([
      { video_id: 'dQw4w9WgXcQ', title: 'Fav Track A', artist: 'Artist A', duration_text: '3:30' },
      { video_id: '9bZkp7q19f0', title: 'Fav Track B', artist: 'Artist B', duration_text: '3:45' }
    ])
  )
  localStorage.setItem(
    'argon_seeds_v2',
    JSON.stringify([
      { video_id: '3JZ_D3ELwOQ', title: 'Seed Track C', artist: 'Artist C', duration_text: '4:00' }
    ])
  )

  const prevFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })

  try {
    const block = await buildHybridRediscoverBlock()
    const vids = new Set((block.preloadedTracks || []).map((t) => t.video_id))
    assert.equal(vids.has('dQw4w9WgXcQ'), true)
    assert.equal(vids.has('9bZkp7q19f0'), true)
    assert.equal(vids.has('3JZ_D3ELwOQ'), true)
    assert.equal(block.subtitle, 'Shuffled favorites & related radio')
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('getInitialDiscoveryBlocks dynamically personalizes Made For You mixes without hardcoded J-Pop/Hindi for other genres', () => {
  resetStorage()
  localStorage.setItem(
    'upbeat_taste_prefs_v1',
    JSON.stringify({
      genres: ['rock', 'indie', 'electronic'],
      regions: ['uk'],
      artists: ['Arctic Monkeys', 'Tame Impala', 'Daft Punk']
    })
  )

  const blocks = getInitialDiscoveryBlocks()
  const tier1 = blocks.filter((b) => b.tier === 1)
  const tier2 = blocks.filter((b) => b.tier === 2)
  assert.equal(tier1.length, 7)
  assert.equal(tier2.length, 7)

  const tier2Blob = tier2.map((b) => `${b.id} ${b.title} ${b.badge} ${b.query}`).join(' | ')
  assert.equal(/j-?pop|anime|yoasobi|hindi|bollywood|arijit/i.test(tier2Blob), false, 'Must not force J-Pop or Hindi mixes for Rock/Indie/Electronic user')
  assert.match(tier2Blob, /Rock/i)
  assert.match(tier2Blob, /Indie/i)
  assert.match(tier2Blob, /Electronic/i)
  assert.match(tier2Blob, /Arctic Monkeys/i)

  // Classical + Jazz + Sonic DNA archetype
  resetStorage()
  localStorage.setItem(
    'upbeat_taste_prefs_v1',
    JSON.stringify({
      genres: ['Classical', 'Jazz'],
      artists: ['Hans Zimmer', 'Miles Davis']
    })
  )
  localStorage.setItem(
    'argon_dna_v2',
    JSON.stringify({
      archetype: 'Symphonic Jazz Explorer',
      primary_genres: ['Classical', 'Jazz'],
      key_artists: ['Hans Zimmer', 'Kamasi Washington']
    })
  )
  const dnaBlocks = getInitialDiscoveryBlocks()
  const dnaTier2 = dnaBlocks.filter((b) => b.tier === 2)
  assert.equal(dnaTier2.length, 7)
  const dnaBlob = dnaTier2.map((b) => `${b.id} ${b.title} ${b.subtitle} ${b.query}`).join(' | ')
  assert.equal(/j-?pop|anime|hindi|bollywood/i.test(dnaBlob), false)
  assert.match(dnaBlob, /Classical|Score|Orchestral/i)
  assert.match(dnaBlob, /Jazz/i)
  assert.match(dnaBlob, /Symphonic Jazz Explorer/i)

  // Users who actually pick J-Pop / Bollywood do get those mixes
  resetStorage()
  localStorage.setItem(
    'upbeat_taste_prefs_v1',
    JSON.stringify({
      genres: ['jpop', 'bollywood'],
      artists: ['YOASOBI', 'Arijit Singh']
    })
  )
  const jpopHindiBlocks = getInitialDiscoveryBlocks().filter((b) => b.tier === 2)
  const jhBlob = jpopHindiBlocks.map((b) => `${b.title} ${b.query}`).join(' | ')
  assert.match(jhBlob, /J-Pop/i)
  assert.match(jhBlob, /Hindi/i)
  resetStorage()
})

test('fetchListenTogetherFeed respects onboarding genres/artists dynamically', async () => {
  resetStorage()
  localStorage.setItem(
    'upbeat_taste_prefs_v1',
    JSON.stringify({
      genres: ['hiphop', 'rnb'],
      artists: ['Kendrick Lamar', 'Frank Ocean']
    })
  )
  const prevFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 })

  try {
    const feed = await fetchListenTogetherFeed({ forceRefresh: true })
    const tier2 = feed.filter((b) => b.tier === 2)
    assert.equal(tier2.length, 7)
    const blob = tier2.map((b) => `${b.title} ${b.query}`).join(' | ')
    assert.equal(/j-?pop|anime|yoasobi|hindi|bollywood|arijit/i.test(blob), false)
    assert.match(blob, /Hip-Hop/i)
    assert.match(blob, /R&B/i)
    assert.match(blob, /Kendrick Lamar/i)
    assert.match(blob, /GTA VI/i)
  } finally {
    globalThis.fetch = prevFetch
    resetStorage()
  }
})

test('fetchTrackLyrics tries /api/get duration-matched lookup first, verifies <=12s diff, falls back cleanly, and bounds cache at 200', async () => {
  resetStorage()
  clearLyricsCache()
  const prevFetch = globalThis.fetch
  const requestedUrls = []

  // 1. Direct /api/get hit with duration diff <= 12s skips /api/search completely
  globalThis.fetch = async (url) => {
    const s = String(url)
    requestedUrls.push(s)
    if (s.startsWith('https://lrclib.net/api/get?')) {
      return new Response(
        JSON.stringify({
          trackName: 'Starboy',
          artistName: 'The Weeknd',
          duration: 232,
          syncedLyrics: '[00:10.00] I am tryna put you in the worst mood'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const res1 = await fetchTrackLyrics(
      { video_id: 'lyrExact001', title: 'Starboy (Official Video)', artist: 'The Weeknd - Topic' },
      230
    )
    assert.equal(res1?.synced, true)
    assert.equal(res1.lines[1].text, 'I am tryna put you in the worst mood')
    assert.equal(requestedUrls.length, 1)
    assert.match(requestedUrls[0], /^https:\/\/lrclib\.net\/api\/get\?track_name=Starboy&artist_name=The%20Weeknd&duration=230/)

    // 2. Duration mismatch > 12s on /api/get rejects exact hit and falls back to backend /api/lyrics proxy
    requestedUrls.length = 0
    globalThis.fetch = async (url) => {
      const s = String(url)
      requestedUrls.push(s)
      if (s.startsWith('https://lrclib.net/api/get?')) {
        return new Response(
          JSON.stringify({
            trackName: 'Numb',
            artistName: 'Linkin Park',
            duration: 300, // 115s mismatch vs 185s!
            syncedLyrics: '[00:05.00] Wrong live version'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (s.includes('/api/lyrics?track_name=')) {
        return new Response(
          JSON.stringify([
            {
              trackName: 'Numb',
              artistName: 'Linkin Park',
              duration: 187,
              syncedLyrics: '[00:06.00] I am tired of being what you want me to be'
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }

    const res2 = await fetchTrackLyrics(
      { video_id: 'lyrProxy002', title: 'Numb', artist: 'Linkin Park' },
      185
    )
    assert.equal(res2?.synced, true)
    assert.equal(res2.lines[1].text, 'I am tired of being what you want me to be')
    assert.equal(requestedUrls.some((u) => u.includes('/api/lyrics?track_name=Numb&artist_name=Linkin%20Park&duration=185')), true)
    assert.equal(requestedUrls.some((u) => u.includes('/api/search')), false)

    // 3. Cache bound at 200 entries: inserting 201 entries evicts entry #0
    clearLyricsCache()
    const fetchedTitles = []
    globalThis.fetch = async (url) => {
      const s = String(url)
      const nameMatch = s.match(/track_name=([^&]+)/)
      if (nameMatch) fetchedTitles.push(decodeURIComponent(nameMatch[1]))
      return new Response(
        JSON.stringify({
          trackName: 'Song',
          artistName: 'Artist',
          duration: 180,
          syncedLyrics: '[00:01.00] Line'
        }),
        { status: 200 }
      )
    }

    for (let i = 0; i < 201; i++) {
      await fetchTrackLyrics({ video_id: `cacheVid${i}`, title: `Track ${i}`, artist: 'Artist' }, 180)
    }
    fetchedTitles.length = 0
    // Entry 200 should still be cached (0 fetches)
    await fetchTrackLyrics({ video_id: 'cacheVid200', title: 'Track 200', artist: 'Artist' }, 180)
    assert.equal(fetchedTitles.length, 0)
    // Entry 0 was evicted when 201st entry was inserted (triggers fresh fetch)
    await fetchTrackLyrics({ video_id: 'cacheVid0', title: 'Track 0', artist: 'Artist' }, 180)
    assert.equal(fetchedTitles.length, 1)
  } finally {
    globalThis.fetch = prevFetch
    clearLyricsCache()
    resetStorage()
  }
})
