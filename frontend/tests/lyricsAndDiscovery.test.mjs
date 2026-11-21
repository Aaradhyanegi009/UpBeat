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
  fetchRelatedCompanionTracks,
  buildHybridRediscoverBlock
} from '../src/standaloneApi.js'

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
