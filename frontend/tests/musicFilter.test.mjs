import './helpers/test-env.mjs'
import { resetStorage, withWindowStub } from './helpers/test-env.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isStrictMusicTrack,
  isValidMusicTrack,
  isStrictArtistName,
  sanitizeLocalMusicLibrary
} from '../src/standaloneApi.js'
import { MIN_DURATION_SEC, MAX_DURATION_SEC } from '../src/config/musicFilters.js'

test('isValidMusicTrack is aliased to isStrictMusicTrack', () => {
  assert.equal(isValidMusicTrack, isStrictMusicTrack)
})

test('accepts valid music tracks across languages and duration formats', () => {
  assert.equal(
    isStrictMusicTrack({ title: 'Shinunoga E-Wa', artist: 'Fujii Kaze', video_id: 'dawrQnvwMTY', duration_text: '3:05' }),
    true
  )
  assert.equal(
    isStrictMusicTrack({ title: 'Tum Hi Ho', artist: 'Arijit Singh', video_id: 'Umqb9KENgmk', duration: 262 }),
    true
  )
  assert.equal(
    isStrictMusicTrack({ title: 'Starboy', artist: 'The Weeknd', video_id: '34Na4j8AVgA', duration_seconds: 230 }),
    true
  )
  // Exact boundary durations: MIN_DURATION_SEC and MAX_DURATION_SEC should be allowed
  assert.equal(
    isStrictMusicTrack({ title: 'Intro Interlude Song', artist: 'Synth Artist', video_id: 'abcdefghijk', duration: MIN_DURATION_SEC }),
    true
  )
  assert.equal(
    isStrictMusicTrack({ title: 'Progressive Track', artist: 'Band Name', video_id: 'abcdefghij1', duration: MAX_DURATION_SEC }),
    true
  )
})

test('rejects stand-up comedy, podcasts, devotional, kids music, gaming, and academic videos', () => {
  const rejected = [
    { title: 'Stand Up Comedy Special', artist: 'Aakash Gupta', video_id: 'dQw4w9WgXcQ', duration: 240 },
    { title: 'Late Night Crowd Work', artist: 'Zakir Khan', video_id: 'dQw4w9WgXcQ', duration: 240 },
    { title: 'Indias Got Latent Episode 5', artist: 'Samay Raina', video_id: 'dQw4w9WgXcQ', duration: 300 },
    { title: 'Sampoorna Ganesh Aarti', artist: 'Rahul Vaidya', video_id: 'dQw4w9WgXcQ', duration: 280 },
    { title: 'Dawn of Serenity Krishna Bhajan', artist: 'Bhakti Channel', video_id: 'dQw4w9WgXcQ', duration: 220 },
    { title: 'Hanuman Chalisa Full', artist: 'Hariharan', video_id: 'dQw4w9WgXcQ', duration: 300 },
    { title: 'Kids Music Playlist', artist: 'Fun Family', video_id: 'dQw4w9WgXcQ', duration: 180 },
    { title: 'Laplace Transform Lecture 4', artist: 'NPTEL', video_id: 'dQw4w9WgXcQ', duration: 310 },
    { title: 'Minecraft Survival Gameplay', artist: 'Dream', video_id: 'dQw4w9WgXcQ', duration: 210 }
  ]
  for (const track of rejected) {
    assert.equal(isStrictMusicTrack(track), false, `Expected rejection for: ${track.title} / ${track.artist}`)
  }
})

test('rejects view counts, invalid video IDs, missing metadata, and out-of-range durations', () => {
  assert.equal(isStrictMusicTrack(null), false)
  assert.equal(isStrictMusicTrack({ title: '', artist: 'Artist' }), false)
  assert.equal(isStrictMusicTrack({ title: 'Song', artist: '' }), false)
  assert.equal(isStrictMusicTrack({ title: 'Song', artist: '1.2M views', duration: 200 }), false)
  assert.equal(isStrictMusicTrack({ title: 'Song', artist: 'unknown', duration: 200 }), false)
  assert.equal(isStrictMusicTrack({ title: 'Song', artist: 'Artist', video_id: 'short_id', duration: 200 }), false)
  // Out-of-bounds durations (<MIN_DURATION_SEC or >MAX_DURATION_SEC when known)
  assert.equal(isStrictMusicTrack({ title: 'Clip', artist: 'Artist', video_id: 'dQw4w9WgXcQ', duration: MIN_DURATION_SEC - 1 }), false)
  assert.equal(isStrictMusicTrack({ title: 'Long Mix', artist: 'Artist', video_id: 'dQw4w9WgXcQ', duration: MAX_DURATION_SEC + 1 }), false)
  assert.equal(isStrictMusicTrack({ title: 'Two Hour Podcast', artist: 'Host', duration_text: '1:05:00' }), false)
})

test('isStrictArtistName rejects polluted non-music artist strings', () => {
  assert.equal(isStrictArtistName('Arijit Singh'), true)
  assert.equal(isStrictArtistName('YOASOBI'), true)
  assert.equal(isStrictArtistName('A'), false)
  assert.equal(isStrictArtistName('Aakash Gupta'), false)
  assert.equal(isStrictArtistName('T-Series Bhakti'), false)
})

test('sanitizeLocalMusicLibrary strips polluted tracks, recents, mixes, DNA artists, and stale caches', () => {
  resetStorage()
  localStorage.setItem(
    'argon_seeds_v2',
    JSON.stringify([
      { title: 'Kesariya', artist: 'Arijit Singh', video_id: 'BddP6PYo2gs', duration: 268 },
      { title: 'Comedy Clip', artist: 'Aakash Gupta', video_id: 'dQw4w9WgXcQ', duration: 210 }
    ])
  )
  localStorage.setItem(
    'argon_dna_v2',
    JSON.stringify({ top_artists: ['Arijit Singh', 'Aakash Gupta', 'Zakir Khan'], genres: ['Bollywood'] })
  )
  localStorage.setItem(
    'upbeat_recents_v1',
    JSON.stringify([
      { key: '1', title: 'Hindi Indie & Bollywood Vibe' },
      { key: '2', title: 'Kids Music Playlist' },
      { key: '3', title: 'Sampoorna Ganesh Aarti' }
    ])
  )
  localStorage.setItem(
    'upbeat_mixes_v1',
    JSON.stringify([
      { id: 'm1', title: 'Chill & Late Night Vibes' },
      { id: 'm2', title: 'Aakash Gupta x Hoppo Mashup' }
    ])
  )
  sessionStorage.setItem('upbeat_discovery_feed_cache_v7', 'stale')
  localStorage.setItem('upbeat_discovery_cache', 'stale')

  withWindowStub(() => sanitizeLocalMusicLibrary())

  const seeds = JSON.parse(localStorage.getItem('argon_seeds_v2'))
  assert.equal(seeds.length, 1)
  assert.equal(seeds[0].title, 'Kesariya')

  const dna = JSON.parse(localStorage.getItem('argon_dna_v2'))
  assert.deepEqual(dna.top_artists, ['Arijit Singh'])

  const recents = JSON.parse(localStorage.getItem('upbeat_recents_v1'))
  assert.deepEqual(recents.map((r) => r.key), ['1'])

  const mixes = JSON.parse(localStorage.getItem('upbeat_mixes_v1'))
  assert.deepEqual(mixes.map((m) => m.id), ['m1'])

  assert.equal(sessionStorage.getItem('upbeat_discovery_feed_cache_v7'), null)
  assert.equal(localStorage.getItem('upbeat_discovery_cache'), null)
})
