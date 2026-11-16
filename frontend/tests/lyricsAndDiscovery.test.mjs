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
  getInitialDiscoveryBlocks
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
