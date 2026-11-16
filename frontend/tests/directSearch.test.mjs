import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isUnrequestedVariant,
  canonicalSongTitle,
  canonicalArtistName,
  deduplicateSearchSongs,
  buildCuratedSongResults,
} from '../src/services/innertubeClient.js'

test('isUnrequestedVariant rejects unrequested remix/slowed/reverb unless explicitly queried', () => {
  const remix = { video_id: 'rem12345678', title: 'Sapphire (Remix)', artist: 'DJ X', duration_sec: 205 }
  const slowed = { video_id: 'slw12345678', title: 'Sapphire - Slowed + Reverb', artist: 'AudioLab', duration_sec: 220 }
  const clean = { video_id: 'edS12345678', title: 'Sapphire', artist: 'Ed Sheeran', duration_sec: 195 }

  assert.equal(isUnrequestedVariant(remix, 'Sapphire'), true)
  assert.equal(isUnrequestedVariant(slowed, 'Sapphire'), true)
  assert.equal(isUnrequestedVariant(clean, 'Sapphire'), false)

  assert.equal(isUnrequestedVariant(remix, 'Sapphire remix'), false)
  assert.equal(isUnrequestedVariant(slowed, 'Sapphire slowed reverb'), false)
})

test('canonicalSongTitle & canonicalArtistName normalize upload suffixes cleanly', () => {
  assert.equal(canonicalSongTitle('Sapphire (Official Video) [HD]'), 'sapphire')
  assert.equal(canonicalSongTitle('Sapphire - Lyric Video'), 'sapphire')
  assert.equal(canonicalArtistName('Ed Sheeran - Topic'), 'ed sheeran')
  assert.equal(canonicalArtistName('Ed Sheeran feat. Arijit Singh'), 'ed sheeran')
})

test('deduplicateSearchSongs ranks Sapphire by Ed Sheeran #1, drops variants, and collapses duplicates into fallback_ids', () => {
  const candidates = [
    { video_id: 'bad00000001', title: 'Sapphire (Slowed + Reverb)', artist: 'LoFi Lab', duration_sec: 210, vibe: 'YT Search' },
    { video_id: 'dup00000002', title: 'Sapphire (Official Lyric Video)', artist: 'Ed Sheeran', duration_sec: 196, play_count_text: '2M views', play_count_num: 2000000, vibe: 'YT Search', fallback_ids: [] },
    { video_id: 'main0000001', title: 'Sapphire', artist: 'Ed Sheeran', duration_sec: 195, play_count_text: '45M plays', play_count_num: 45000000, vibe: 'YT Music', fallback_ids: [] },
    { video_id: 'rem00000003', title: 'Sapphire 8D Audio Remix', artist: 'DJ Remix', duration_sec: 200, vibe: 'YT Search' },
  ]

  const ranked = deduplicateSearchSongs(candidates, 'Sapphire', new Set(['ed sheeran']))
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].video_id, 'main0000001')
  assert.deepEqual(ranked[0].fallback_ids, ['dup00000002'])
})

test('buildCuratedSongResults keeps #1 Best Match and interleaves same-artist & Watch Radio vibe tracks without duplicates', () => {
  const ranked = deduplicateSearchSongs([
    { video_id: 'sapph123456', title: 'Sapphire', artist: 'Ed Sheeran', duration_sec: 195, vibe: 'YT Music', play_count_num: 50000000, fallback_ids: [] }
  ], 'Sapphire', new Set(['ed sheeran']))

  const sameArtist = [
    { video_id: 'shivers1234', title: 'Shivers', artist: 'Ed Sheeran', duration_sec: 207, vibe: 'YT Music', fallback_ids: [] },
    { video_id: 'sapphDup999', title: 'Sapphire (Audio)', artist: 'Ed Sheeran', duration_sec: 196, vibe: 'YT Music', fallback_ids: [] },
    { video_id: 'perfect1234', title: 'Perfect', artist: 'Ed Sheeran', duration_sec: 263, vibe: 'YT Music', fallback_ids: [] },
  ]

  const watchRadio = [
    { video_id: 'vibe1111111', title: 'As It Was', artist: 'Harry Styles', duration_sec: 167, vibe: 'YT Music', fallback_ids: [] },
    { video_id: 'slowed99999', title: 'Sapphire (Slowed + Reverb)', artist: 'Reverb Studio', duration_sec: 220, vibe: 'YT Music', fallback_ids: [] },
    { video_id: 'vibe2222222', title: 'Stargazing', artist: 'Myles Smith', duration_sec: 172, vibe: 'YT Music', fallback_ids: [] },
  ]

  const curated = buildCuratedSongResults(ranked, sameArtist, watchRadio, 'Sapphire', 10)
  assert.equal(curated[0].video_id, 'sapph123456')
  assert.equal(curated[0].match_tier, 'Best Match')

  const ids = curated.map((t) => t.video_id)
  assert.equal(ids.includes('sapphDup999'), false)
  assert.equal(ids.includes('slowed99999'), false)
  assert.deepEqual(ids, ['sapph123456', 'shivers1234', 'vibe1111111', 'perfect1234', 'vibe2222222'])
})
