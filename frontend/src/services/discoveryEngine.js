/**
 * Home Discovery, Ranked Daily Top Charts, Made For You rotations, and block hydration engine.
 */
import { callInnertube } from "./platformConfig.js"
import {
  COMEDY_PODCAST_REGEX,
  DEVOTIONAL_RELIGIOUS_REGEX,
  NON_MUSIC_REGEX
} from "../config/musicFilters.js"
import { isStrictMusicTrack, isValidMusicTrack } from "./musicFilter.js"
import { YTM_CONTEXT, browsePlaylistStandalone, directSearchStandalone, findNodes } from "./innertubeClient.js"

// ---------------------------------------------------------------------------
// Universal Fisher-Yates Queue & Track Shuffle
// ---------------------------------------------------------------------------
export function fisherYatesShuffle(array) {
  if (!Array.isArray(array)) return []
  const copy = [...array]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// ---------------------------------------------------------------------------
// UpBeat v5.5 Dynamic "Listen Together" / Home Discovery Engine (8–9 Live Blocks)
// ---------------------------------------------------------------------------
const ROTATION_CURSOR_KEY = 'upbeat_made_for_you_rotation_idx'
const DISCOVERY_FEED_CACHE_KEY = 'upbeat_discovery_blocks_v632'
const DISCOVERY_FEED_CACHE_TTL = 3 * 60 * 1000 // 3-minute stale-while-revalidate TTL
let _discoveryFeedMemoryCache = null

export function getRotationCursor() {
  try {
    const raw = localStorage.getItem(ROTATION_CURSOR_KEY) || sessionStorage.getItem(ROTATION_CURSOR_KEY)
    const val = parseInt(raw || '0', 10)
    return isNaN(val) ? 0 : val
  } catch {
    return 0
  }
}

export function advanceRotationCursor(delta = 1) {
  try {
    const cur = getRotationCursor()
    const next = (cur + delta) % 1000000
    localStorage.setItem(ROTATION_CURSOR_KEY, String(next))
    sessionStorage.setItem(ROTATION_CURSOR_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

const DYNAMIC_ROTATION_TAGS = [
  'latest hits',
  'trending viral',
  'top charting rotation',
  'essential mix',
  'heavy rotation radio',
  'fresh picks 2026'
]

function getRandomRotationTag() {
  return DYNAMIC_ROTATION_TAGS[Math.floor(Math.random() * DYNAMIC_ROTATION_TAGS.length)]
}

export const DEFAULT_SEED_IDS = new Set([
  'F8xpmTmdf6o', 'F_Cr9vZ08Ws', '0VpGoDp3FCE',
  'CXDUXjsU5ao', 'TCd6PfxOy0Y', 'QpxFcMYRV08'
])

// Mood/Vibe presets that cycle dynamically across rotations
const MOOD_VIBE_PRESETS = [
  { name: 'Eclectic Pop & Indie', desc: 'Alternative pop and melodic hooks', query: 'indie pop alternative sound vibes mix', color: 'from-cyan-600/40 to-black' },
  { name: 'Late Night Synth & Alt', desc: 'Nocturnal synths and introspective beats', query: 'late night synthwave alternative electro chill mix', color: 'from-violet-600/40 to-black' },
  { name: 'High-Energy Drive & Beats', desc: 'Punchy basslines and driving percussion', query: 'high energy electronic bass driving beat playlist', color: 'from-emerald-600/40 to-black' },
  { name: 'Acoustic & Melodic Warmth', desc: 'Warm guitars and intimate acoustic melodies', query: 'acoustic guitar warm emotional melody tracks', color: 'from-amber-600/40 to-black' },
  { name: 'Hypnotic R&B & Nu-Soul', desc: 'Lush neo-soul chords and smooth vocals', query: 'smooth modern r&b neo soul grooves playlist', color: 'from-rose-600/40 to-black' },
  { name: 'Cinematic Soundscapes & Media', desc: 'Dramatic atmospheric arrangements', query: 'cinematic instrumental dramatic soundtrack hits', color: 'from-sky-600/40 to-black' },
  { name: 'Sun-Drenched Summer Anthems', desc: 'Feel-good rhythms and bright chords', query: 'feel good upbeat sunny day indie dance pop', color: 'from-yellow-600/40 to-black' },
  { name: 'Moody Lo-Fi & Downtempo', desc: 'Relaxed chillhop textures and steady groove', query: 'lofi downtempo chill atmospheric study beats', color: 'from-indigo-600/40 to-black' }
]

// UpBeat v7.5.1 Curated Starter Rotations (7 Structured Mood/Language & Library Mixes, zero gym/lofi/comedy)
const STARTER_ROTATION_CYCLES = [
  [
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Joji The Weeknd Keshi Cigarettes After Sex Billie Eilish chill late night vibes songs playlist -comedy -podcast',
      thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: 'YOASOBI Kenshi Yonezu Ado Eve King Gnu LiSA Fujii Kaze official anime jpop songs playlist -shorts',
      thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: 'Arijit Singh Prateek Kuhad Anuv Jain The Local Train Mitraz Aditya Rikhari soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy',
      thumbnail: 'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: 'Post Malone The Weeknd Maroon 5 Coldplay Imagine Dragons Dua Lipa Arctic Monkeys top western pop rock songs playlist -podcast',
      thumbnail: 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Coldplay Imagine Dragons The Weeknd Post Malone official songs radio playlist',
      thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      isNewUserSeed: true,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: 'Dua Lipa Harry Styles The Weeknd Post Malone heavy rotation pop hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg',
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: 'Arctic Monkeys The Neighbourhood Kendrick Lamar deep cuts alternative songs playlist',
      thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg',
      color: 'from-cyan-600/40 to-black'
    }
  ],
  [
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Lana Del Rey Cigarettes After Sex Joji Keshi late night dream pop chill hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg',
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: 'Fujii Kaze Radwimps YOASOBI Kenshi Yonezu anime soundtrack hits playlist',
      thumbnail: 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: 'Prateek Kuhad Jasleen Royal Anuv Jain The Local Train modern acoustic hindi indie playlist',
      thumbnail: 'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: 'Dua Lipa Elton John Harry Styles Bruno Mars Anderson Paak western pop anthems playlist',
      thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Maroon 5 Charlie Puth Shawn Mendes Ed Sheeran essential pop radio playlist',
      thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg',
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      isNewUserSeed: true,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: 'Post Malone Swae Lee Kendrick Lamar SZA melodic hip hop and pop playlist',
      thumbnail: 'https://i.ytimg.com/vi/T6eK-2OQtew/maxresdefault.jpg',
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: 'Billie Eilish Finneas Taylor Swift Gracie Abrams acoustic storytelling hits',
      thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
      color: 'from-cyan-600/40 to-black'
    }
  ]
]

/**
 * Fetches related/radio companion tracks for anchor songs using Innertube automix (v1/next)
 * or targeted search fallback, filtered by isValidMusicTrack.
 */
export async function fetchRelatedCompanionTracks(anchorTracks = [], targetCount = 10) {
  if (!Array.isArray(anchorTracks) || anchorTracks.length === 0) return []

  const companions = []
  const seenVids = new Set(anchorTracks.map((a) => a.video_id).filter(Boolean))

  for (const anchor of anchorTracks) {
    if (companions.length >= targetCount) break
    const vid = anchor?.video_id
    if (!vid || vid.length !== 11) continue

    // 1. Try Innertube /next automix endpoint (native YouTube Music radio companion)
    try {
      const resp = await callInnertube('next', {
        context: YTM_CONTEXT,
        videoId: vid,
        playlistId: `RDAMVM${vid}`,
        isAudioOnly: true
      }, 'music')

      if (resp.ok) {
        const data = await resp.json()
        for (const item of findNodes(data, 'playlistPanelVideoRenderer')) {
          if (companions.length >= targetCount) break
          const candVid = item.videoId
          if (!candVid || candVid.length !== 11 || seenVids.has(candVid)) continue

          const title = item.title?.runs?.[0]?.text || ''
          const artist = item.shortBylineText?.runs?.[0]?.text || item.longBylineText?.runs?.[0]?.text || ''
          const duration_text = item.lengthText?.runs?.[0]?.text || ''
          const thumb = item.thumbnail?.thumbnails?.[item.thumbnail.thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${candVid}/hqdefault.jpg`

          const candTrack = {
            video_id: candVid,
            title,
            artist,
            duration_text,
            thumbnail: thumb,
            source: 'radio_companion'
          }

          if (isValidMusicTrack(candTrack)) {
            seenVids.add(candVid)
            companions.push(candTrack)
          }
        }
      }
    } catch {}

    // 2. Fallback to targeted search if next returned fewer than 3 companions for this anchor
    if (companions.length < targetCount) {
      try {
        const searchQ = anchor.artist && anchor.title
          ? `${anchor.artist} ${anchor.title} similar songs`
          : `${anchor.artist || anchor.title} radio mix songs`
        const searchRes = await directSearchStandalone(searchQ, 'songs')
        for (const cand of (searchRes?.tracks || [])) {
          if (companions.length >= targetCount) break
          if (!cand?.video_id || seenVids.has(cand.video_id)) continue
          if (isValidMusicTrack(cand)) {
            seenVids.add(cand.video_id)
            companions.push({ ...cand, source: 'radio_companion' })
          }
        }
      } catch {}
    }
  }

  return companions
}

/**
 * Builds the hybrid "Rediscover Favorites Mix" card:
 * Unbiased Fisher-Yates shuffle of user Liked Songs / Favourites (~50%)
 * interleaved with dynamically fetched related companion tracks (~50%).
 */
export async function buildHybridRediscoverBlock({
  userTracks = [],
  usedCoverUrls = new Set(),
  rotationIndex = 0,
  forceShuffle = false
} = {}) {
  // Aggregate user tracks: passed userTracks + localStorage favorites and seeds
  const pool = []
  const seen = new Set()

  const addTracks = (list) => {
    if (!Array.isArray(list)) return
    for (const t of list) {
      if (!t?.video_id || seen.has(t.video_id) || DEFAULT_SEED_IDS.has(t.video_id)) continue
      if (isValidMusicTrack(t)) {
        seen.add(t.video_id)
        pool.push(t)
      }
    }
  }

  addTracks(userTracks)
  try {
    const rawFavs = localStorage.getItem('argon_favs_v2') || localStorage.getItem('upbeat_favorites_v1')
    if (rawFavs) addTracks(JSON.parse(rawFavs))
  } catch {}
  try {
    const rawSeeds = localStorage.getItem('argon_seeds_v2') || localStorage.getItem('upbeat_extracted_tracks_v1')
    if (rawSeeds) addTracks(JSON.parse(rawSeeds))
  } catch {}

  const hasUserLibrary = pool.length >= 3

  let coreAnchors = []
  let companionTracks = []

  if (hasUserLibrary) {
    // True Fisher-Yates Shuffle on entire user favorites pool
    const shuffledPool = fisherYatesShuffle([...pool])
    // Select 6 to 8 Core Anchor Tracks
    const anchorCount = Math.min(8, Math.max(6, Math.floor(shuffledPool.length / 2)))
    coreAnchors = shuffledPool.slice(0, anchorCount)

    // Pick 2 to 3 anchors to fetch related radio companions
    const queryAnchors = fisherYatesShuffle([...coreAnchors]).slice(0, Math.min(3, coreAnchors.length))
    try {
      companionTracks = await fetchRelatedCompanionTracks(queryAnchors, 10)
    } catch {}
  } else {
    // Brand new user fallback: curated starter anchors
    const starterSeeds = [
      { video_id: 'ApXoWvfEYVU', title: 'Sunflower', artist: 'Post Malone, Swae Lee', duration_text: '2:38', thumbnail: 'https://i.ytimg.com/vi/ApXoWvfEYVU/hqdefault.jpg' },
      { video_id: '34Na4j8AVgA', title: 'Starboy', artist: 'The Weeknd, Daft Punk', duration_text: '3:50', thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg' },
      { video_id: '09R8_2nJtjg', title: 'Sugar', artist: 'Maroon 5', duration_text: '3:55', thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg' },
      { video_id: 'V1Pl8CzNzCw', title: 'Birds of a Feather', artist: 'Billie Eilish', duration_text: '3:18', thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/hqdefault.jpg' },
      { video_id: 'TUVcZfQe-Kw', title: 'Levitating', artist: 'Dua Lipa', duration_text: '3:23', thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg' },
      { video_id: 'dvgZkm1xWPE', title: 'Viva La Vida', artist: 'Coldplay', duration_text: '4:02', thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/hqdefault.jpg' }
    ]
    coreAnchors = fisherYatesShuffle(starterSeeds).slice(0, 4)
    try {
      companionTracks = await fetchRelatedCompanionTracks(coreAnchors.slice(0, 2), 8)
    } catch {}
  }

  // Interleave Shuffled Liked Songs (~50%) and Related Companions (~50%)
  const interleaved = []
  const maxLen = Math.max(coreAnchors.length, companionTracks.length)
  const finalSeen = new Set()

  for (let i = 0; i < maxLen; i++) {
    if (i < coreAnchors.length && !finalSeen.has(coreAnchors[i].video_id)) {
      interleaved.push({ ...coreAnchors[i], isAnchorFavorite: true })
      finalSeen.add(coreAnchors[i].video_id)
    }
    if (i < companionTracks.length && !finalSeen.has(companionTracks[i].video_id)) {
      interleaved.push({ ...companionTracks[i], isCompanionTrack: true })
      finalSeen.add(companionTracks[i].video_id)
    }
  }

  // If we still have remaining liked tracks from the pool, append up to 24 tracks total
  if (interleaved.length < 16 && pool.length > coreAnchors.length) {
    for (const t of pool) {
      if (interleaved.length >= 24) break
      if (!finalSeen.has(t.video_id)) {
        interleaved.push({ ...t, isAnchorFavorite: true })
        finalSeen.add(t.video_id)
      }
    }
  }

  // Determine dynamic cover thumbnail based on lead track (avoiding collision with adjacent cards)
  const thumbPool = []
  for (const t of interleaved) {
    const candidateThumb = t.video_id
      ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg`
      : t.thumbnail || ''
    if (candidateThumb && !thumbPool.includes(candidateThumb)) {
      thumbPool.push(candidateThumb)
    }
  }

  let chosenThumb = ''
  const startIdx = thumbPool.length ? rotationIndex % thumbPool.length : 0
  for (let i = 0; i < thumbPool.length; i++) {
    const candidateThumb = thumbPool[(startIdx + i) % thumbPool.length]
    if (candidateThumb && !usedCoverUrls.has(candidateThumb)) {
      chosenThumb = candidateThumb
      break
    }
  }
  if (!chosenThumb) {
    chosenThumb = thumbPool[0] || interleaved[0]?.thumbnail || 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'
  }
  usedCoverUrls.add(chosenThumb)

  const leadSongTitle = interleaved[0]?.title || 'Favorites'
  const anchorArtist = coreAnchors[0]?.artist || 'Curated'

  return {
    id: 'block_rediscover',
    tier: 2,
    title: 'Rediscover Favorites Mix',
    subtitle: hasUserLibrary ? 'Shuffled favorites & related radio' : 'Essential favorites & related radio',
    badge: 'Rediscover',
    query: `${anchorArtist} ${leadSongTitle} favorites radio mix`,
    preloadedTracks: interleaved,
    thumbnail: chosenThumb,
    thumbnailPool: thumbPool.length ? thumbPool : [chosenThumb],
    color: 'from-purple-600/40 to-black',
    isHybridRediscover: true
  }
}

export const AVAILABLE_CHARTS = [
  {
    id: 'block_india_top_daily',
    tier: 1,
    title: 'India Top Daily Chart',
    subtitle: 'Top Charting Hits Across India Today',
    badge: 'India Chart',
    flag: '🇮🇳',
    regionKey: 'india',
    browse_id: 'VLOLAK5uy_lSTp1DIuzZBUyee3kDsXwPgP25WdfwB40',
    query: 'Trending 20 India top daily chart hit songs playlist',
    color: 'from-amber-600/40 to-black'
  },
  {
    id: 'block_india_trendy',
    tier: 1,
    title: 'India Trendy Songs',
    subtitle: 'Viral Indian Reels, Indie & Bollywood Heat',
    badge: 'Trending Heat',
    flag: '🇮🇳',
    regionKey: 'india',
    browse_id: 'VLPL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX',
    query: 'viral trending songs reels Bollywood Punjabi indie hits playlist',
    color: 'from-emerald-600/40 to-black'
  },
  {
    id: 'block_global_top_daily',
    tier: 1,
    title: 'Global Top 50 Daily Chart',
    subtitle: 'Most Played Songs Worldwide Today',
    badge: 'Global Chart',
    flag: '🌎',
    regionKey: 'global',
    browse_id: 'VLPL4fGSI40qSUHh345w2bH37X8Y5lQ2VzF4',
    query: 'Global Top 50 daily chart hits playlist',
    color: 'from-cyan-600/40 to-black'
  },
  {
    id: 'block_us_top_daily',
    tier: 1,
    title: 'US Top Daily Chart',
    subtitle: 'Billboard Hot 100 & US Top 50 Daily Hits',
    badge: 'US Chart',
    flag: '🇺🇸',
    regionKey: 'us',
    browse_id: 'VLPL4fGSI40qSUHnL3G30wzCvhLqLqBw8Fw_',
    query: 'Billboard Hot 100 US top daily chart hits playlist',
    color: 'from-blue-600/40 to-black'
  },
  {
    id: 'block_uk_top_daily',
    tier: 1,
    title: 'UK Top Daily Chart',
    subtitle: 'Official UK Top 40 & British Daily Chart',
    badge: 'UK Chart',
    flag: '🇬🇧',
    regionKey: 'uk',
    browse_id: 'VLPL4fGSI40qSUEq8sS2e293D6fR0PqHwKz',
    query: 'Official UK Top 40 singles chart daily hits playlist',
    color: 'from-violet-600/40 to-black'
  },
  {
    id: 'block_japan_top_daily',
    tier: 1,
    title: 'Japan Top Daily Chart',
    subtitle: 'J-Pop, Anime & Tokyo Hot 100 Daily Chart',
    badge: 'Japan Chart',
    flag: '🇯🇵',
    regionKey: 'japan',
    browse_id: 'VLPL4fGSI1pDJn43_Z-8f0nJ0Fp_b5sT6',
    query: 'Tokyo Hot 100 J-Pop anime daily top chart hits playlist',
    color: 'from-rose-600/40 to-black'
  },
  {
    id: 'block_viral_top_daily',
    tier: 1,
    title: 'Global Viral Daily Hits',
    subtitle: 'Trending TikTok, Reels & Viral Daily Tracks',
    badge: 'Viral Chart',
    flag: '🔥',
    regionKey: 'viral',
    browse_id: 'VLPL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX',
    query: 'viral trending songs reels TikTok hits playlist',
    color: 'from-pink-600/40 to-black'
  },
  {
    id: 'block_kpop_top_daily',
    tier: 1,
    title: 'K-Pop Top Daily Chart',
    subtitle: 'Top K-Pop, Idol & Asian Hot 50 Daily',
    badge: 'K-Pop Chart',
    flag: '🇰🇷',
    regionKey: 'kpop',
    browse_id: 'VLPL4fGSI40qSUHfCj3c4sJ4Xj5g1B6KqV4F',
    query: 'K-Pop top daily chart hits newjeans bts blackpink playlist',
    color: 'from-fuchsia-600/40 to-black'
  },
  {
    id: 'block_latin_top_daily',
    tier: 1,
    title: 'Latin Top Daily Chart',
    subtitle: 'Reggaeton, Latin Pop & Hot Daily Rhythms',
    badge: 'Latin Chart',
    flag: '🌴',
    regionKey: 'latin',
    browse_id: 'VLPL4fGSI40qSUFa1B5mB3Fj8M4Z2vY5lX1K',
    query: 'Latin top daily chart hits Bad Bunny Shakira reggaeton playlist',
    color: 'from-orange-600/40 to-black'
  }
]

const CHART_THUMB_POOLS = {
  us: [
    'https://i.ytimg.com/vi/eVli-tstM5E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V9PVRfjEBTI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg',
    'https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/H5v3kku4y6Q/maxresdefault.jpg'
  ],
  india: [
    'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/RLzC55ai0eo/maxresdefault.jpg',
    'https://i.ytimg.com/vi/VAdGW7QDJiU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/VuG7ge_8I2Y/maxresdefault.jpg',
    'https://i.ytimg.com/vi/SlPhMPnQ58k/maxresdefault.jpg'
  ],
  japan: [
    'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dy90tA3TT1c/maxresdefault.jpg',
    'https://i.ytimg.com/vi/mLW35YMzELE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/by4SYYWlhEs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/x8VYWazR5mE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/GJI4Gv7NbmE/maxresdefault.jpg'
  ],
  viral: [
    'https://i.ytimg.com/vi/LK7-_dgAVQE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/k3g_WjLCsXM/maxresdefault.jpg',
    'https://i.ytimg.com/vi/XTp5jaRU3Ws/maxresdefault.jpg',
    'https://i.ytimg.com/vi/nCD2hj6zJEc/maxresdefault.jpg',
    'https://i.ytimg.com/vi/muds1gFUTN8/maxresdefault.jpg',
    'https://i.ytimg.com/vi/6d5SS0gS5bU/maxresdefault.jpg'
  ],
  global: [
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/H5v3kku4y6Q/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'
  ],
  uk: [
    'https://i.ytimg.com/vi/JGwWNGJdvx8/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg',
    'https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/eVli-tstM5E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/YQHsXMglC9A/maxresdefault.jpg'
  ],
  kpop: [
    'https://i.ytimg.com/vi/js1CtxSY38I/maxresdefault.jpg',
    'https://i.ytimg.com/vi/gdZLi9oWNZg/maxresdefault.jpg',
    'https://i.ytimg.com/vi/2S24h70Qi3o/maxresdefault.jpg',
    'https://i.ytimg.com/vi/armNy0vT12E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/pG6iaOMV46I/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TQTlCHxyuu8/maxresdefault.jpg'
  ],
  latin: [
    'https://i.ytimg.com/vi/b8m9zhNA4Ao/maxresdefault.jpg',
    'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg',
    'https://i.ytimg.com/vi/CocEMWdc7Ck/maxresdefault.jpg',
    'https://i.ytimg.com/vi/p38Hgze4k7E/maxresdefault.jpg',
    'https://i.ytimg.com/vi/qj3P_B8Z5dE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/wXhTHyIgQ_U/maxresdefault.jpg'
  ]
}

const LEGACY_CHART_ID_ALIASES = {
  india: 'block_india_top_daily',
  in: 'block_india_top_daily',
  india_trendy: 'block_india_trendy',
  global50: 'block_global_top_daily',
  us_billboard: 'block_us_top_daily',
  us: 'block_us_top_daily',
  uk: 'block_uk_top_daily',
  japan: 'block_japan_top_daily',
  viral: 'block_viral_top_daily',
  kpop: 'block_kpop_top_daily',
  latin: 'block_latin_top_daily'
}

export function resolveRankedChartBlocks(cursor = 0) {
  let preferredChartIds = []
  try {
    const rawChartPrefs = localStorage.getItem('upbeat_chart_prefs_v1')
    if (rawChartPrefs) {
      const parsed = JSON.parse(rawChartPrefs)
      if (Array.isArray(parsed)) {
        preferredChartIds = parsed.map((id) => LEGACY_CHART_ID_ALIASES[id] || id)
      }
    }
  } catch {}

  let genres = []
  let artists = []
  try {
    const rawTaste = localStorage.getItem('upbeat_taste_prefs_v1')
    if (rawTaste) {
      const parsed = JSON.parse(rawTaste)
      genres = parsed.genres || []
      artists = parsed.artists || []
    }
  } catch {}

  const scoreMap = new Map()
  AVAILABLE_CHARTS.forEach((chart, idx) => {
    let score = 100 - idx
    if (preferredChartIds.length > 0) {
      const prefIdx = preferredChartIds.indexOf(chart.id)
      if (prefIdx !== -1) {
        score += 500 - prefIdx * 25
      }
    } else {
      // Inferred preferences from user genres and artists
      const isDesi = genres.some((g) => ['bollywood', 'punjabi'].includes(g)) ||
        artists.some((a) => /arijit|atif|diljit|karan|pritam|shreya|jubin|anuv|sidhu|badshah/i.test(a))
      const isJapanese = genres.includes('jpop') ||
        artists.some((a) => /yoasobi|kenshi|fujii|higuchi|lisa|radwimps|sawano/i.test(a))
      const isKpop = genres.includes('kpop') ||
        artists.some((a) => /bts|blackpink|newjeans|stray|twice|jungkook/i.test(a))
      const isLatin = genres.includes('latin') ||
        artists.some((a) => /bad bunny|shakira|karol|balvin|peso pluma/i.test(a))
      const isWestern = genres.some((g) => ['pop', 'hiphop', 'rock', 'electronic'].includes(g))

      if (isDesi && (chart.id === 'block_india_top_daily' || chart.id === 'block_india_trendy')) {
        score += 300
      }
      if (isJapanese && chart.id === 'block_japan_top_daily') {
        score += 350
      }
      if (isKpop && chart.id === 'block_kpop_top_daily') {
        score += 350
      }
      if (isLatin && chart.id === 'block_latin_top_daily') {
        score += 350
      }
      if (isWestern && (chart.id === 'block_global_top_daily' || chart.id === 'block_us_top_daily' || chart.id === 'block_uk_top_daily')) {
        score += 150
      }
    }
    scoreMap.set(chart.id, score)
  })

  const sorted = [...AVAILABLE_CHARTS].sort((a, b) => scoreMap.get(b.id) - scoreMap.get(a.id))
  // Return top 7 daily charts (at least 6-7 charts)
  const selectedCharts = sorted.slice(0, 7)

  return selectedCharts.map((c) => {
    const pool = CHART_THUMB_POOLS[c.regionKey] || CHART_THUMB_POOLS.global
    const thumb = pool[cursor % pool.length]
    return {
      ...c,
      thumbnail: thumb,
      thumbnailPool: pool
    }
  })
}

export function getInitialDiscoveryBlocks() {
  const cursor = getRotationCursor()
  const starterCycle = STARTER_ROTATION_CYCLES[cursor % STARTER_ROTATION_CYCLES.length]
  const rankedCharts = resolveRankedChartBlocks(cursor)

  return [
    ...rankedCharts,
    ...starterCycle
  ]
}

export const THIRTY_MINUTES_MS = 30 * 60 * 1000 // 1,800,000ms
let hasBootRefreshedThisSession = false

export async function fetchListenTogetherFeed({
  userTracks = [],
  tasteDna = null,
  forceRefresh = false,
  timeInfo = null,
  rotationIndex = undefined
} = {}) {
  const now = Date.now()
  const lastRefresh = Number(localStorage.getItem('upbeat_last_discovery_refresh') || 0)
  const isColdBoot = !hasBootRefreshedThisSession
  const hasExpired = now - lastRefresh >= THIRTY_MINUTES_MS

  if (isColdBoot) {
    hasBootRefreshedThisSession = true
    advanceRotationCursor(1)
  }

  // 30-minute + Cold-Boot Cache Lifecycle
  if (!forceRefresh && !hasExpired && !isColdBoot) {
    if (_discoveryFeedMemoryCache && _discoveryFeedMemoryCache.blocks?.length >= 14 && now - (_discoveryFeedMemoryCache.ts || 0) < THIRTY_MINUTES_MS) {
      return _discoveryFeedMemoryCache.blocks
    }
    try {
      const raw = sessionStorage.getItem(DISCOVERY_FEED_CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.blocks?.length >= 14 && now - (parsed.ts || 0) < THIRTY_MINUTES_MS) {
          _discoveryFeedMemoryCache = parsed
          return parsed.blocks
        }
      }
    } catch {}
  }

  const cursor = typeof rotationIndex === 'number' ? rotationIndex : getRotationCursor()

  // 1. Determine User Profile Readiness with strict music filter
  const validUserTracks = (userTracks || []).filter(
    (t) => t?.title && t?.artist && !DEFAULT_SEED_IDS.has(t?.video_id) && isStrictMusicTrack(t)
  )

  // Map each unique clean artist to their tracks and high-res artwork pool
  const artistMap = new Map()
  for (const t of validUserTracks) {
    const rawArtist = (t.artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim()
    const cleanArt = rawArtist.split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,\s*/i)[0].trim()
    if (
      cleanArt &&
      cleanArt.length >= 2 &&
      !/^\d+[\d.,]*\s*[kKmMbB]?\s*(?:views?|subscribers?|watching|likes?)?$/i.test(cleanArt) &&
      !/^(?:\d+\s*(?:views?|subscribers?|ago)|streamed|youtube|unknown)$/i.test(cleanArt) &&
      !NON_MUSIC_REGEX.test(cleanArt) &&
      !COMEDY_PODCAST_REGEX.test(cleanArt) &&
      !DEVOTIONAL_RELIGIOUS_REGEX.test(cleanArt)
    ) {
      const key = cleanArt.toLowerCase()
      const thumb = t.video_id
        ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg`
        : t.thumbnail || ''
      if (!artistMap.has(key)) {
        artistMap.set(key, { name: cleanArt, tracks: [], thumb, thumbs: [] })
      }
      const entry = artistMap.get(key)
      entry.tracks.push(t)
      if (thumb && !entry.thumbs.includes(thumb)) entry.thumbs.push(thumb)
      if (!entry.thumb && thumb) entry.thumb = thumb
    }
  }

  // Also include user's preferred artists from onboarding/settings if library has few items
  try {
    const rawTaste = localStorage.getItem('upbeat_taste_prefs_v1')
    if (rawTaste) {
      const parsed = JSON.parse(rawTaste)
      for (const aName of parsed.artists || []) {
        const cleanA = aName.trim()
        const key = cleanA.toLowerCase()
        if (
          cleanA &&
          !artistMap.has(key) &&
          !NON_MUSIC_REGEX.test(cleanA) &&
          !COMEDY_PODCAST_REGEX.test(cleanA) &&
          !DEVOTIONAL_RELIGIOUS_REGEX.test(cleanA)
        ) {
          artistMap.set(key, { name: cleanA, tracks: [], thumb: '', thumbs: [] })
        }
      }
    }
  } catch {}

  const artists = Array.from(artistMap.values())
  const isNewUser = artists.length < 2

  // Tier 1 — 7 Ranked Regional & Global Daily Chart Blocks based on User Preferences
  const tier1Blocks = resolveRankedChartBlocks(cursor)
  const usedCoverUrls = new Set(tier1Blocks.map((b) => b.thumbnail))

  // Group A: 4 Personalized Mood & Language Mixes
  // 1. Chill & Late Night Vibes (Badge: CHILL MIX)
  const chillArtists = artists
    .filter((a) => /joji|keshi|cigarettes|billie|finneas|kuhad|the weeknd|charlie|lana|laufey/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const chillQuery = chillArtists.length
    ? `${chillArtists.join(' ')} Joji Keshi Cigarettes After Sex chill late night vibes songs playlist -comedy -podcast`
    : 'Joji The Weeknd Keshi Cigarettes After Sex Billie Eilish chill late night vibes songs playlist -comedy -podcast'
  const chillPool = [
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg'
  ]

  // 2. J-Pop & Anime Essentials (Badge: J-POP & ANIME)
  const jpopArtists = artists
    .filter((a) => /yoasobi|kenshi|ado|eve|sawano|lisa|fujii|king gnu|radwimps|vaundy/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const jpopQuery = jpopArtists.length
    ? `${jpopArtists.join(' ')} YOASOBI Kenshi Yonezu Ado official anime jpop songs playlist -shorts`
    : 'YOASOBI Kenshi Yonezu Ado Eve King Gnu LiSA Fujii Kaze official anime jpop songs playlist -shorts'
  const jpopPool = [
    'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg'
  ]

  // 3. Hindi Indie & Bollywood Vibe (Badge: HINDI MIX)
  const hindiArtists = artists
    .filter((a) => /anuv|kuhad|local train|arijit|pritam|vishal|shekhar|mitraz|rikhari|atif|jasleen/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const hindiQuery = hindiArtists.length
    ? `${hindiArtists.join(' ')} Arijit Singh Prateek Kuhad Anuv Jain soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy`
    : 'Arijit Singh Prateek Kuhad Anuv Jain The Local Train Mitraz Aditya Rikhari soulful hindi indie bollywood songs playlist -bhajan -aarti -devotional -comedy'
  const hindiPool = [
    'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg',
    'https://i.ytimg.com/vi/AX6OrbgS8lI/maxresdefault.jpg',
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'
  ]

  // 4. English Pop & Alt Anthems (Badge: ENGLISH MIX)
  const westernArtists = artists
    .filter((a) => /post malone|the weeknd|maroon 5|arctic monkeys|imagine dragons|dua lipa|travis scott|coldplay|swift|styles/i.test(a.name))
    .map((a) => a.name)
    .slice(0, 3)
  const westernQuery = westernArtists.length
    ? `${westernArtists.join(' ')} Post Malone The Weeknd Coldplay Imagine Dragons top western pop rock songs playlist -podcast`
    : 'Post Malone The Weeknd Maroon 5 Coldplay Imagine Dragons Dua Lipa Arctic Monkeys top western pop rock songs playlist -podcast'
  const westernPool = [
    'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg',
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg'
  ]

  // Group B: 3 Personal Library & Similar-to-What-You-Hear Mixes
  // 5. Rediscover Favorites Mix (Badge: REDISCOVER)
  const rediscoverBlock = await buildHybridRediscoverBlock({
    userTracks: validUserTracks,
    usedCoverUrls,
    rotationIndex: cursor,
    forceShuffle: forceRefresh
  })

  // 6. On Repeat & Similar Vibes (Badge: HEAVY ROTATION)
  const recentTrack = validUserTracks[0] || null
  const onRepeatQuery = recentTrack
    ? `${recentTrack.artist} ${recentTrack.title} radio songs playlist -comedy -podcast -bhajan`
    : 'Dua Lipa Post Malone The Weeknd Harry Styles heavy rotation pop hits playlist'
  const onRepeatThumb = (recentTrack?.thumbnail && !recentTrack.thumbnail.includes('default'))
    ? recentTrack.thumbnail
    : 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'

  // 7. Sonic DNA Radar (Badge: TASTE RADAR)
  const topCoreArtists = artists.slice(0, 3).map((a) => a.name)
  const radarQuery = topCoreArtists.length
    ? `${topCoreArtists.join(' ')} deep cuts rare tracks official songs playlist -comedy -podcast -bhajan`
    : 'Arctic Monkeys The Neighbourhood Kendrick Lamar deep cuts alternative songs playlist'
  const radarThumb = 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg'

  const tier2Blocks = [
    {
      id: 'block_chill_late_night',
      tier: 2,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & lo-fi chill tailored for you',
      badge: 'CHILL MIX',
      query: chillQuery,
      thumbnail: chillPool[cursor % chillPool.length],
      thumbnailPool: chillPool,
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'High-energy J-Pop, iconic OP/EDs & Tokyo hits',
      badge: 'J-POP & ANIME',
      query: jpopQuery,
      thumbnail: jpopPool[cursor % jpopPool.length],
      thumbnailPool: jpopPool,
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      title: 'Hindi Indie & Bollywood Vibe',
      subtitle: 'Modern Hindi indie, Arijit & soulful melodies',
      badge: 'HINDI MIX',
      query: hindiQuery,
      thumbnail: hindiPool[cursor % hindiPool.length],
      thumbnailPool: hindiPool,
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      title: 'English Pop & Alt Anthems',
      subtitle: 'Chart-topping Western pop, alt-rock & synth',
      badge: 'ENGLISH MIX',
      query: westernQuery,
      thumbnail: westernPool[cursor % westernPool.length],
      thumbnailPool: westernPool,
      color: 'from-purple-600/40 to-black'
    },
    rediscoverBlock,
    {
      id: 'block_on_repeat_vibes',
      tier: 2,
      title: 'On Repeat & Similar Vibes',
      subtitle: "Inspired by what you've been playing lately",
      badge: 'HEAVY ROTATION',
      query: onRepeatQuery,
      thumbnail: onRepeatThumb,
      thumbnailPool: [onRepeatThumb, 'https://i.ytimg.com/vi/ic8j13gfnM8/maxresdefault.jpg'],
      color: 'from-indigo-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: radarQuery,
      thumbnail: radarThumb,
      thumbnailPool: [radarThumb, 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'],
      color: 'from-cyan-600/40 to-black'
    }
  ]

  const allBlocks = [...tier1Blocks, ...tier2Blocks]
  _discoveryFeedMemoryCache = { blocks: allBlocks, isNewUser, ts: now }
  try {
    sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
    localStorage.setItem('upbeat_last_discovery_refresh', String(now))
  } catch {}

  return allBlocks
}

export async function rerollDiscoveryBlock(blockId, { userTracks = [], tasteDna = null, timeInfo = null } = {}) {
  const currentFeed = _discoveryFeedMemoryCache?.blocks || []
  const existingIdx = currentFeed.findIndex((b) => b.id === blockId)
  if (existingIdx === -1) return null

  // 1. Rediscover Mix: Trigger freshly shuffled favorites + newly fetched companion radio tracks (< 1s)
  if (blockId === 'block_rediscover') {
    const usedCovers = new Set(currentFeed.filter((b) => b.id !== blockId).map((b) => b.thumbnail))
    const nextCursor = advanceRotationCursor(1)
    const freshRediscover = await buildHybridRediscoverBlock({
      userTracks,
      usedCoverUrls: usedCovers,
      forceShuffle: true,
      rotationIndex: nextCursor
    })
    currentFeed[existingIdx] = freshRediscover
    _discoveryFeedMemoryCache = { blocks: currentFeed, ts: Date.now() }
    try {
      sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
    } catch {}
    return freshRediscover
  }

  // 2. Other Tier 2 & Tier 1 blocks: Advance cursor and query fresh candidate tracks/artwork
  const block = { ...currentFeed[existingIdx] }
  advanceRotationCursor(1)
  block.query = `${block.query.replace(/\s+(latest hits|trending viral|top charting rotation|essential mix|heavy rotation radio|fresh picks 2026)/g, '')} ${getRandomRotationTag()}`

  try {
    const freshRes = await directSearchStandalone(block.query, 'songs')
    const candidateTracks = freshRes?.tracks || []
    if (candidateTracks.length > 0) {
      const topThumb = candidateTracks[0]?.thumbnail || (candidateTracks[0]?.video_id ? `https://i.ytimg.com/vi/${candidateTracks[0].video_id}/hqdefault.jpg` : '')
      if (topThumb) block.thumbnail = topThumb
      block.preloadedTracks = candidateTracks
    }
  } catch {}

  currentFeed[existingIdx] = block
  _discoveryFeedMemoryCache = { blocks: currentFeed, ts: Date.now() }
  try {
    sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
  } catch {}

  return block
}

export async function loadBlockTracks(block) {
  if (!block) return []
  if (block.preloadedTracks && block.preloadedTracks.length > 0) {
    return block.preloadedTracks.filter(isStrictMusicTrack)
  }

  // Hybrid rediscover mix on-demand generation
  if (block.id === 'block_rediscover' || block.id === 'block_rediscover_favorites') {
    const hybrid = await buildHybridRediscoverBlock()
    if (hybrid?.preloadedTracks?.length > 0) {
      return hybrid.preloadedTracks.filter(isStrictMusicTrack)
    }
  }

  // 1. Direct search (fastest, most reliable across all environments)
  if (block.query) {
    try {
      const res = await directSearchStandalone(block.query, 'songs')
      if (res?.tracks?.length > 0) return res.tracks.filter(isStrictMusicTrack)
    } catch {}
  }

  // 2. Playlist browse fallback
  if (block.browse_id) {
    try {
      const plTracks = await browsePlaylistStandalone(block.browse_id, block.title, block.subtitle)
      if (plTracks && plTracks.length > 0) return plTracks.filter(isStrictMusicTrack)
    } catch {}
  }

  return []
}
