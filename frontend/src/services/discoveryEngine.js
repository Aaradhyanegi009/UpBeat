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
const DISCOVERY_FEED_CACHE_KEY = 'upbeat_discovery_blocks_v771'
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

const GTA6_AND_LATEST_SEED_QUERIES = [
  'GTAVI Original Score Flower In A Hurricane',
  'Tom Petty Love Is A Long Road The Pointer Sisters Hot Together',
  'Lady Gaga Bruno Mars Die With A Smile ROSÉ APT',
  'The Weeknd Hurry Up Tomorrow Bad Bunny DtMF latest songs 2026'
]

const GTA6_AND_LATEST_THUMBS = [
  'https://i.ytimg.com/vi/JWxoRY7AFSw/maxresdefault.jpg',
  'https://i.ytimg.com/vi/H3Aay-47ZT0/maxresdefault.jpg',
  'https://i.ytimg.com/vi/xAgUYyosqVM/maxresdefault.jpg',
  'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
  'https://i.ytimg.com/vi/p8_ugAjWI5I/maxresdefault.jpg',
  'https://i.ytimg.com/vi/0lI_KzhfIBk/maxresdefault.jpg'
]

// UpBeat v7.7.1 Curated Starter Rotations (7 Structured Mood/Language, GTA VI & Latest Release Mixes)
const STARTER_ROTATION_CYCLES = [
  [
    {
      id: 'block_gta6_latest_anthems',
      tier: 2,
      isNewUserSeed: true,
      title: 'GTA VI & Latest Viral Anthems',
      subtitle: 'GTA 6 soundtrack, Vice City classics & newly launched 2026 drops',
      badge: 'NEW & GTA VI',
      query: 'Tom Petty Love Is A Long Road GTAVI Original Score',
      seedQueries: GTA6_AND_LATEST_SEED_QUERIES,
      thumbnail: 'https://i.ytimg.com/vi/JWxoRY7AFSw/maxresdefault.jpg',
      thumbnailPool: GTA6_AND_LATEST_THUMBS,
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & nocturnal chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Joji Keshi Cigarettes After Sex late night vibes',
      seedQueries: ['The Weeknd Hurry Up Tomorrow', 'Billie Eilish Birds of a Feather', 'Lana Del Rey Keshi chill songs'],
      thumbnail: 'https://i.ytimg.com/vi/GT8ornYrDEs/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/GT8ornYrDEs/maxresdefault.jpg',
        'https://i.ytimg.com/vi/V9PVRfjEBTI/maxresdefault.jpg',
        'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg'
      ],
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'Latest J-Pop drops, Tokyo hits & iconic anime OPs',
      badge: 'J-POP & ANIME',
      query: 'Kenshi Yonezu Plazma YOASOBI latest songs',
      seedQueries: ['Ado Eve King Gnu official songs', 'RADWIMPS LiSA anime official songs', 'Fujii Kaze Kenshi Yonezu latest'],
      thumbnail: 'https://i.ytimg.com/vi/02Ap3uMNiw8/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/02Ap3uMNiw8/maxresdefault.jpg',
        'https://i.ytimg.com/vi/tpnu2s-Agjg/maxresdefault.jpg',
        'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg'
      ],
      color: 'from-fuchsia-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Latest & Indie Vibe',
      subtitle: 'Newly launched Bollywood releases, Arijit & Hindi indie',
      badge: 'HINDI MIX',
      query: 'Arijit Singh latest songs 2026',
      seedQueries: ['Anuv Jain Prateek Kuhad hindi indie', 'Sai Abhyankkar Shashwat Sachdev new songs', 'Sachin-Jigar Pritam latest bollywood songs'],
      thumbnail: 'https://i.ytimg.com/vi/i1o1p_DD6TU/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/i1o1p_DD6TU/maxresdefault.jpg',
        'https://i.ytimg.com/vi/uT_HXrrmHX8/maxresdefault.jpg',
        'https://i.ytimg.com/vi/tOaizzQG8Cw/maxresdefault.jpg'
      ],
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Coldplay Post Malone The Weeknd official songs',
      seedQueries: ['Billie Eilish Dua Lipa Bruno Mars hits', 'Lady Gaga Bruno Mars Die With A Smile'],
      thumbnail: 'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
        'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg'
      ],
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'Global New Releases & Pop',
      subtitle: 'Freshly launched 2025–2026 pop, synth & global chart toppers',
      badge: 'LATEST DROPS',
      query: 'Lady Gaga Bruno Mars Die With A Smile ROSÉ APT',
      seedQueries: ['The Weeknd São Paulo Hurry Up Tomorrow', 'Kendrick Lamar SZA luther', 'Sabrina Carpenter Billie Eilish new songs'],
      thumbnail: 'https://i.ytimg.com/vi/u1iBReO1T9k/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/u1iBReO1T9k/maxresdefault.jpg',
        'https://i.ytimg.com/vi/p8_ugAjWI5I/maxresdefault.jpg',
        'https://i.ytimg.com/vi/TiebZllW8As/maxresdefault.jpg'
      ],
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries & new releases matching your taste',
      badge: 'TASTE RADAR',
      query: 'Arctic Monkeys Tame Impala Justice alt hits',
      seedQueries: ['The Neighbourhood Gorillaz alt songs', 'Tame Impala Neverender Justice'],
      thumbnail: 'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg',
        'https://i.ytimg.com/vi/Ucmo6hDZRSY/maxresdefault.jpg'
      ],
      color: 'from-cyan-600/40 to-black'
    }
  ],
  [
    {
      id: 'block_gta6_latest_anthems',
      tier: 2,
      isNewUserSeed: true,
      title: 'GTA VI & Vice City Radio',
      subtitle: 'GTA 6 trailer anthems, Vice City classics & fresh 2026 drops',
      badge: 'NEW & GTA VI',
      query: 'The Pointer Sisters Hot Together GTA 6 soundtrack',
      seedQueries: GTA6_AND_LATEST_SEED_QUERIES,
      thumbnail: 'https://i.ytimg.com/vi/H3Aay-47ZT0/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/H3Aay-47ZT0/maxresdefault.jpg',
        'https://i.ytimg.com/vi/0lI_KzhfIBk/maxresdefault.jpg',
        'https://i.ytimg.com/vi/xAgUYyosqVM/maxresdefault.jpg'
      ],
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_chill_late_night',
      tier: 2,
      isNewUserSeed: true,
      title: 'Chill & Late Night Vibes',
      subtitle: 'Atmospheric, melodic & nocturnal chill tailored for you',
      badge: 'CHILL MIX',
      query: 'Lana Del Rey Cigarettes After Sex late night chill',
      seedQueries: ['Joji Keshi Frank Ocean chill songs', 'Billie Eilish Wildflower atmospheric'],
      thumbnail: 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg', 'https://i.ytimg.com/vi/GT8ornYrDEs/maxresdefault.jpg'],
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_jpop_anime',
      tier: 2,
      isNewUserSeed: true,
      title: 'J-Pop & Anime Essentials',
      subtitle: 'Latest J-Pop drops, Tokyo hits & iconic anime OPs',
      badge: 'J-POP & ANIME',
      query: 'Fujii Kaze RADWIMPS YOASOBI official songs',
      seedQueries: ['Kenshi Yonezu BOW AND ARROW Plazma', 'LiSA Ado anime official songs'],
      thumbnail: 'https://i.ytimg.com/vi/tpnu2s-Agjg/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/tpnu2s-Agjg/maxresdefault.jpg', 'https://i.ytimg.com/vi/02Ap3uMNiw8/maxresdefault.jpg'],
      color: 'from-fuchsia-600/40 to-black'
    },
    {
      id: 'block_hindi_indie_bollywood',
      tier: 2,
      isNewUserSeed: true,
      title: 'Hindi Latest & Indie Vibe',
      subtitle: 'Newly launched Bollywood releases, Arijit & Hindi indie',
      badge: 'HINDI MIX',
      query: 'Shashwat Sachdev Arijit Singh latest songs 2026',
      seedQueries: ['Prateek Kuhad Anuv Jain hindi indie', 'Jasleen Royal Mitraz official songs'],
      thumbnail: 'https://i.ytimg.com/vi/uT_HXrrmHX8/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/uT_HXrrmHX8/maxresdefault.jpg', 'https://i.ytimg.com/vi/i1o1p_DD6TU/maxresdefault.jpg'],
      color: 'from-amber-600/40 to-black'
    },
    {
      id: 'block_rediscover_favorites',
      tier: 2,
      isNewUserSeed: true,
      title: 'Rediscover Favorites Mix',
      subtitle: 'Shuffled liked songs + closely related tracks',
      badge: 'REDISCOVER',
      query: 'Maroon 5 Ed Sheeran Dua Lipa pop hits',
      seedQueries: ['Lady Gaga Bruno Mars Die With A Smile', 'The Weeknd Starboy Blinding Lights'],
      thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg', 'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg'],
      color: 'from-pink-600/40 to-black',
      isHybridRediscover: true
    },
    {
      id: 'block_english_pop_alt',
      tier: 2,
      isNewUserSeed: true,
      title: 'Global New Releases & Pop',
      subtitle: 'Freshly launched 2025–2026 pop, synth & global chart toppers',
      badge: 'LATEST DROPS',
      query: 'Bad Bunny DtMF NUEVAYoL latest songs',
      seedQueries: ['The Weeknd São Paulo Hurry Up Tomorrow', 'ROSÉ Bruno Mars APT number one girl'],
      thumbnail: 'https://i.ytimg.com/vi/TiebZllW8As/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/TiebZllW8As/maxresdefault.jpg', 'https://i.ytimg.com/vi/WdSGEvDGZAo/maxresdefault.jpg'],
      color: 'from-purple-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      isNewUserSeed: true,
      title: 'Sonic DNA Radar',
      subtitle: 'Fresh discoveries & new releases matching your taste',
      badge: 'TASTE RADAR',
      query: 'Laura Branigan Self Control Anita Ward Ring My Bell',
      seedQueries: ['Billie Eilish Gracie Abrams new songs', 'Kendrick Lamar SZA luther'],
      thumbnail: 'https://i.ytimg.com/vi/Ucmo6hDZRSY/maxresdefault.jpg',
      thumbnailPool: ['https://i.ytimg.com/vi/Ucmo6hDZRSY/maxresdefault.jpg', 'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg'],
      color: 'from-cyan-600/40 to-black'
    }
  ]
]

const GENRE_MIX_CATALOG = {
  rock: {
    id: 'block_mix_rock',
    label: 'Rock & Alt',
    title: 'Rock & Alt Anthems',
    subtitle: 'Driving guitars, latest alt releases & iconic riffs',
    badge: 'ROCK MIX',
    query: 'Arctic Monkeys Linkin Park latest rock songs',
    seedQueries: ['Linkin Park The Emptiness Machine latest', 'Coldplay Moon Music Arctic Monkeys AM', 'Foo Fighters Queen Imagine Dragons rock'],
    color: 'from-red-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/SRXH9AbT280/maxresdefault.jpg', 'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg', 'https://i.ytimg.com/vi/VsxlqmSDmBU/maxresdefault.jpg']
  },
  indie: {
    id: 'block_mix_indie',
    label: 'Indie & Acoustic',
    title: 'Indie & Acoustic Drift',
    subtitle: 'Dreamy indie textures, new alt releases & warm hooks',
    badge: 'INDIE MIX',
    query: 'Tame Impala Cigarettes After Sex indie songs',
    seedQueries: ['The 1975 Lana Del Rey indie hits', 'Justice Tame Impala Neverender', 'Clairo Beabadoobee latest indie songs'],
    color: 'from-teal-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg', 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg', 'https://i.ytimg.com/vi/V9PVRfjEBTI/maxresdefault.jpg']
  },
  electronic: {
    id: 'block_mix_electronic',
    label: 'Electronic & Dance',
    title: 'Electronic & Synth Pulse',
    subtitle: 'Fresh electronic drops, analog synths & club energy',
    badge: 'ELECTRONIC',
    query: 'Fred again Calvin Harris electronic dance songs',
    seedQueries: ['Justice Tame Impala Neverender', 'Daft Punk Disclosure synth songs', 'Martin Garrix Avicii latest electronic'],
    color: 'from-cyan-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg', 'https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg', 'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg']
  },
  hiphop: {
    id: 'block_mix_hiphop',
    label: 'Hip-Hop & Rap',
    title: 'Hip-Hop & Rap Rotation',
    subtitle: 'Latest 2025–2026 rap drops, hard beats & flows',
    badge: 'HIP-HOP MIX',
    query: 'Kendrick Lamar Playboi Carti latest hip hop songs',
    seedQueries: ['Kendrick Lamar SZA luther GNX', 'Travis Scott Future Metro Boomin songs', 'Drake J Cole Tyler The Creator'],
    color: 'from-amber-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/sNY_2TEmzho/maxresdefault.jpg', 'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg', 'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg']
  },
  pop: {
    id: 'block_mix_pop',
    label: 'Pop',
    title: 'Modern Pop & Chart Mix',
    subtitle: 'Latest global pop drops, hooks & chart favorites',
    badge: 'POP MIX',
    query: 'Lady Gaga Bruno Mars The Weeknd latest pop songs',
    seedQueries: ['The Weeknd Hurry Up Tomorrow São Paulo', 'Sabrina Carpenter Dua Lipa Taylor Swift', 'ROSÉ Bruno Mars APT Billie Eilish'],
    color: 'from-purple-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg', 'https://i.ytimg.com/vi/p8_ugAjWI5I/maxresdefault.jpg', 'https://i.ytimg.com/vi/eVli-tstM5E/maxresdefault.jpg']
  },
  rnb: {
    id: 'block_mix_rnb',
    label: 'R&B & Soul',
    title: 'R&B & Neo-Soul Grooves',
    subtitle: 'Velvet vocals, new R&B releases & midnight grooves',
    badge: 'R&B SOUL',
    query: 'SZA Frank Ocean Bruno Mars r&b songs',
    seedQueries: ['Daniel Caesar Giveon Summer Walker', 'The Weeknd SZA Die For You Snooze', 'Silk Sonic Anderson Paak Bruno Mars'],
    color: 'from-rose-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/adLGHcj_fmA/maxresdefault.jpg', 'https://i.ytimg.com/vi/T6eK-2OQtew/maxresdefault.jpg', 'https://i.ytimg.com/vi/V1Pl8CzNzCw/maxresdefault.jpg']
  },
  jazz: {
    id: 'block_mix_jazz',
    label: 'Jazz',
    title: 'Jazz & Nu-Jazz Sessions',
    subtitle: 'Smoky brass, Laufey classics & modern jazz grooves',
    badge: 'JAZZ MIX',
    query: 'Laufey Kamasi Washington modern jazz songs',
    seedQueries: ['Robert Glasper Miles Davis jazz', 'Laufey From The Start Bewitched', 'Norah Jones Chet Baker jazz'],
    color: 'from-yellow-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/H5v3kku4y6Q/maxresdefault.jpg', 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg']
  },
  classical: {
    id: 'block_mix_classical',
    label: 'Classical & Film Score',
    title: 'Orchestral & Score Epics',
    subtitle: 'Sweeping strings, piano minimalism & iconic scores',
    badge: 'CLASSICAL SCORE',
    query: 'Hans Zimmer Ludovico Einaudi soundtrack themes',
    seedQueries: ['Ludovico Einaudi Max Richter piano', 'Two Steps From Hell Thomas Bergersen epic score', 'Hans Zimmer Interstellar Inception theme'],
    color: 'from-sky-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/ahDLQbhgW5Y/maxresdefault.jpg', 'https://i.ytimg.com/vi/YQHsXMglC9A/maxresdefault.jpg']
  },
  metal: {
    id: 'block_mix_metal',
    label: 'Metal & Heavy',
    title: 'Heavy Riffs & Metalcore',
    subtitle: 'Crushing guitars, double-kick precision & raw energy',
    badge: 'METAL MIX',
    query: 'Metallica Bring Me The Horizon metal songs',
    seedQueries: ['Slipknot Avenged Sevenfold metal', 'Spiritbox Sleep Token latest songs'],
    color: 'from-zinc-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/4NRXx6U8ABQ/maxresdefault.jpg', 'https://i.ytimg.com/vi/SRXH9AbT280/maxresdefault.jpg']
  },
  country: {
    id: 'block_mix_country',
    label: 'Country & Folk',
    title: 'Country, Roots & Folk',
    subtitle: 'Storytelling acoustics, GTA VI & Americana anthems',
    badge: 'COUNTRY FOLK',
    query: 'Tom Petty Zach Bryan Morgan Wallen songs',
    seedQueries: ['Chris Stapleton Luke Combs country', 'Tom Petty Love Is A Long Road classics'],
    color: 'from-orange-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/xAgUYyosqVM/maxresdefault.jpg', 'https://i.ytimg.com/vi/PIuAFrLeXfY/maxresdefault.jpg']
  },
  chill: {
    id: 'block_chill_late_night',
    label: 'Chill & Downtempo',
    title: 'Chill & Late Night Vibes',
    subtitle: 'Atmospheric, melodic & nocturnal chill tailored for you',
    badge: 'CHILL MIX',
    query: 'Joji Keshi Cigarettes After Sex chill songs',
    seedQueries: ['Billie Eilish Lana Del Rey chill', 'The Weeknd Late Night R&B songs'],
    color: 'from-teal-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/GT8ornYrDEs/maxresdefault.jpg', 'https://i.ytimg.com/vi/TdrL3QxjyVw/maxresdefault.jpg']
  },
  bollywood: {
    id: 'block_hindi_indie_bollywood',
    label: 'Hindi & Bollywood',
    title: 'Hindi Latest & Indie Vibe',
    subtitle: 'Newly launched Bollywood releases, Arijit & Hindi indie',
    badge: 'HINDI MIX',
    query: 'Arijit Singh latest songs 2026',
    seedQueries: ['Prateek Kuhad Anuv Jain hindi indie', 'Shashwat Sachdev Sai Abhyankkar new songs', 'AR Rahman Pritam Bollywood songs'],
    color: 'from-amber-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/i1o1p_DD6TU/maxresdefault.jpg', 'https://i.ytimg.com/vi/uT_HXrrmHX8/maxresdefault.jpg', 'https://i.ytimg.com/vi/BddP6PYo2gs/maxresdefault.jpg']
  },
  punjabi: {
    id: 'block_mix_punjabi',
    label: 'Punjabi & Desi',
    title: 'Punjabi & Desi Heat',
    subtitle: 'New Punjabi drops, Karan Aujla & Diljit drive hits',
    badge: 'PUNJABI MIX',
    query: 'Diljit Dosanjh Karan Aujla latest punjabi songs',
    seedQueries: ['AP Dhillon Shubh punjabi hits', 'Sidhu Moose Wala latest hits'],
    color: 'from-emerald-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/RLzC55ai0eo/maxresdefault.jpg', 'https://i.ytimg.com/vi/VuG7ge_8I2Y/maxresdefault.jpg']
  },
  jpop: {
    id: 'block_jpop_anime',
    label: 'J-Pop & Anime',
    title: 'J-Pop & Anime Essentials',
    subtitle: 'Latest J-Pop releases, Tokyo hits & iconic anime OPs',
    badge: 'J-POP & ANIME',
    query: 'Kenshi Yonezu Plazma YOASOBI latest songs',
    seedQueries: ['Ado Eve King Gnu official songs', 'RADWIMPS LiSA Hiroyuki Sawano anime', 'Fujii Kaze YUI anime soundtrack'],
    color: 'from-rose-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/02Ap3uMNiw8/maxresdefault.jpg', 'https://i.ytimg.com/vi/tpnu2s-Agjg/maxresdefault.jpg', 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/maxresdefault.jpg']
  },
  kpop: {
    id: 'block_mix_kpop',
    label: 'K-Pop',
    title: 'K-Pop & Seoul Spotlight',
    subtitle: 'Latest K-Pop releases, ROSÉ, NewJeans & BTS hits',
    badge: 'K-POP MIX',
    query: 'ROSÉ APT NewJeans aespa latest kpop songs',
    seedQueries: ['BTS BLACKPINK Stray Kids TWICE songs', 'aespa LE SSERAFIM ILLIT latest'],
    color: 'from-fuchsia-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/ekr2nIex040/maxresdefault.jpg', 'https://i.ytimg.com/vi/js1CtxSY38I/maxresdefault.jpg', 'https://i.ytimg.com/vi/gdZLi9oWNZg/maxresdefault.jpg']
  },
  latin: {
    id: 'block_mix_latin',
    label: 'Latin & Reggaeton',
    title: 'Latin & Reggaeton Fuego',
    subtitle: 'New Bad Bunny DtMF drops, Karol G & reggaeton rhythms',
    badge: 'LATIN MIX',
    query: 'Bad Bunny DtMF NUEVAYoL latest latin songs',
    seedQueries: ['Karol G Feid Rauw Alejandro reggaeton', 'Shakira J Balvin Peso Pluma'],
    color: 'from-orange-600/40 to-black',
    thumbs: ['https://i.ytimg.com/vi/TiebZllW8As/maxresdefault.jpg', 'https://i.ytimg.com/vi/WdSGEvDGZAo/maxresdefault.jpg', 'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg']
  }
}

const GENRE_ALIAS_PATTERNS = [
  [/bollywood|hindi|desi\s*pop/i, 'bollywood'],
  [/punjabi|bhangra/i, 'punjabi'],
  [/j-?pop|anime|japanese|tokyo/i, 'jpop'],
  [/k-?pop|korean|seoul/i, 'kpop'],
  [/latin|reggaeton|salsa|urbano/i, 'latin'],
  [/hip[\s-]?hop|rap|trap|drill/i, 'hiphop'],
  [/electronic|edm|dance|house|techno|synthwave|dubstep|drum/i, 'electronic'],
  [/indie|acoustic|shoegaze|bedroom|dream\s*pop/i, 'indie'],
  [/alt(ernative)?[\s-]?rock|\brock\b|punk|grunge/i, 'rock'],
  [/metal|heavy|hardcore/i, 'metal'],
  [/r&b|rnb|neo[\s-]?soul|\bsoul\b/i, 'rnb'],
  [/jazz|blues|bossa/i, 'jazz'],
  [/classical|orchestr|soundtrack|score|film|piano|instrumental/i, 'classical'],
  [/country|folk|americana/i, 'country'],
  [/chill|lo-?fi|ambient|downtempo/i, 'chill'],
  [/\bpop\b|synth-?pop|mainstream/i, 'pop']
]

const REGION_TO_GENRE = {
  india: 'bollywood',
  in: 'bollywood',
  japan: 'jpop',
  jp: 'jpop',
  korea: 'kpop',
  kr: 'kpop',
  latin: 'latin',
  latam: 'latin',
  us: 'pop',
  uk: 'rock',
  europe: 'electronic'
}

const ARTIST_GENRE_HINTS = [
  [/yoasobi|kenshi|fujii|higuchi|lisa|radwimps|sawano|ado|eve|king gnu/i, 'jpop'],
  [/arijit|shreya|pritam|rahman|jubin|anuv|prateek|local train|mitraz/i, 'bollywood'],
  [/diljit|karan aujla|ap dhillon|sidhu|shubh/i, 'punjabi'],
  [/bts|blackpink|newjeans|stray|twice|jung kook/i, 'kpop'],
  [/bad bunny|shakira|karol|balvin|peso pluma/i, 'latin'],
  [/arctic monkeys|coldplay|linkin park|queen|foo fighters|nirvana|radiohead/i, 'rock'],
  [/tame impala|the 1975|cigarettes after sex|lana del rey|phoebe bridgers/i, 'indie'],
  [/daft punk|fred again|calvin harris|avicii|martin garrix|deadmau5|skrillex/i, 'electronic'],
  [/kendrick|drake|travis scott|eminem|tyler|j\.? cole|kanye/i, 'hiphop'],
  [/sza|frank ocean|daniel caesar|giveon|bruno mars/i, 'rnb'],
  [/hans zimmer|ludovico|max richter|hisaishi|mozart|beethoven|chopin/i, 'classical'],
  [/miles davis|kamasi|glasper|coltrane|laufey|norah jones/i, 'jazz'],
  [/metallica|bring me the horizon|slipknot|avenged sevenfold/i, 'metal'],
  [/zach bryan|chris stapleton|morgan wallen|luke combs/i, 'country']
]

function normalizeGenreKey(raw = '') {
  const clean = String(raw || '').trim()
  if (!clean) return ''
  const lower = clean.toLowerCase()
  if (GENRE_MIX_CATALOG[lower]) return lower
  if (REGION_TO_GENRE[lower]) return REGION_TO_GENRE[lower]
  for (const [re, key] of GENRE_ALIAS_PATTERNS) {
    if (re.test(clean)) return key
  }
  return lower
}

function readPersonalizationPrefs(tasteDnaOverride = null) {
  let genres = []
  let regions = []
  let artists = []
  try {
    const rawTaste = localStorage.getItem('upbeat_taste_prefs_v1')
    if (rawTaste) {
      const parsed = JSON.parse(rawTaste)
      if (Array.isArray(parsed?.genres)) genres = parsed.genres.filter(Boolean).map(String)
      if (Array.isArray(parsed?.regions)) regions = parsed.regions.filter(Boolean).map(String)
      if (Array.isArray(parsed?.artists)) artists = parsed.artists.filter(Boolean).map(String)
    }
  } catch {}

  let dna = tasteDnaOverride && typeof tasteDnaOverride === 'object' ? tasteDnaOverride : null
  if (!dna) {
    try {
      const rawDna = localStorage.getItem('argon_dna_v2')
      if (rawDna) dna = JSON.parse(rawDna)
    } catch {}
  }
  const dnaGenres = Array.isArray(dna?.primary_genres) ? dna.primary_genres.filter(Boolean).map(String) : []
  const dnaArtists = Array.isArray(dna?.key_artists) ? dna.key_artists.filter(Boolean).map(String) : []

  return { genres, regions, artists, dna, dnaGenres, dnaArtists }
}

function buildDynamicTier2Blocks({
  prefs,
  userTracks = [],
  rediscoverBlock = null,
  cursor = 0,
  isSeed = false
}) {
  const { genres, regions, artists, dna, dnaGenres, dnaArtists } = prefs
  const hasOnboardingPrefs =
    genres.length > 0 ||
    regions.length > 0 ||
    artists.length > 0 ||
    dnaGenres.length > 0 ||
    dnaArtists.length > 0 ||
    Boolean(dna?.archetype)

  // Clean artist pool from onboarding picks, Sonic DNA, and user library tracks
  const artistPool = []
  const seenArtistKeys = new Set()
  const addArtist = (name) => {
    const clean = String(name || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim()
    if (!clean || clean.length < 2) return
    if (NON_MUSIC_REGEX.test(clean) || COMEDY_PODCAST_REGEX.test(clean) || DEVOTIONAL_RELIGIOUS_REGEX.test(clean)) return
    const k = clean.toLowerCase()
    if (seenArtistKeys.has(k)) return
    seenArtistKeys.add(k)
    artistPool.push(clean)
  }

  for (const a of artists) addArtist(a)
  for (const a of dnaArtists) addArtist(a)
  for (const t of userTracks) {
    const primary = String(t?.artist || '').split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,\s*/i)[0].trim()
    addArtist(primary)
  }

  if (!hasOnboardingPrefs && userTracks.length === 0) {
    const starter = STARTER_ROTATION_CYCLES[cursor % STARTER_ROTATION_CYCLES.length]
    if (!rediscoverBlock) return starter
    return starter.map((b) => (b.id === 'block_rediscover_favorites' ? rediscoverBlock : b))
  }

  // Ordered, deduplicated genre tokens from user's explicit genres, regions, DNA genres, or artist hints
  const rawGenreEntries = [...genres, ...regions, ...dnaGenres]
  const genreTokens = []
  const seenGenres = new Set()
  for (const raw of rawGenreEntries) {
    const key = normalizeGenreKey(raw)
    if (!key || seenGenres.has(key)) continue
    seenGenres.add(key)
    genreTokens.push({ key, raw: String(raw).trim() })
  }

  if (!genreTokens.length && artistPool.length > 0) {
    for (const a of artistPool) {
      for (const [re, key] of ARTIST_GENRE_HINTS) {
        if (re.test(a) && !seenGenres.has(key)) {
          seenGenres.add(key)
          genreTokens.push({ key, raw: GENRE_MIX_CATALOG[key]?.label || key })
        }
      }
    }
  }

  const groupABlocks = []
  const usedIds = new Set()
  const defaultThumbs = [
    'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
    'https://i.ytimg.com/vi/34Na4j8AVgA/maxresdefault.jpg',
    'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
    'https://i.ytimg.com/vi/UNZqm3dxd2w/maxresdefault.jpg'
  ]

  for (let i = 0; i < genreTokens.length && groupABlocks.length < 3; i++) {
    const { key, raw } = genreTokens[i]
    const preset = GENRE_MIX_CATALOG[key]
    const matchingArtists = artistPool.filter((a) =>
      ARTIST_GENRE_HINTS.some(([re, k]) => k === key && re.test(a))
    )
    const leadArtists = (matchingArtists.length ? matchingArtists : artistPool).slice(0, 2)
    const artistHint = leadArtists.join(' ')
    const artistThumbPool = userTracks
      .filter((t) => leadArtists.some((a) => String(t?.artist || '').toLowerCase().includes(a.toLowerCase())))
      .map((t) => (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg` : t.thumbnail))
      .filter(Boolean)

    if (preset && !usedIds.has(preset.id)) {
      usedIds.add(preset.id)
      const thumbPool = [...new Set([...artistThumbPool, ...preset.thumbs])]
      const seedQueries = [
        ...(leadArtists[0] ? [`${leadArtists[0]} latest songs`, `${leadArtists[0]} top songs`] : []),
        ...(preset.seedQueries || [])
      ]
      groupABlocks.push({
        id: preset.id,
        tier: 2,
        ...(isSeed ? { isNewUserSeed: true } : {}),
        title: preset.title,
        subtitle: matchingArtists.length
          ? `${matchingArtists.slice(0, 2).join(', ')} & ${preset.label} favorites`
          : preset.subtitle,
        badge: preset.badge,
        query: artistHint ? `${artistHint} ${preset.label} songs` : preset.query,
        seedQueries,
        thumbnail: thumbPool[cursor % thumbPool.length],
        thumbnailPool: thumbPool,
        color: preset.color
      })
    } else if (!usedIds.has(`block_mix_${key}`)) {
      const cleanLabel = raw.replace(/[^a-zA-Z0-9\s&-]/g, '').trim() || key
      const blockId = `block_mix_${key.replace(/[^a-z0-9]+/g, '_')}`
      usedIds.add(blockId)
      const thumbPool = [...new Set([...artistThumbPool, ...defaultThumbs])]
      const thumb = thumbPool[(cursor + i) % thumbPool.length]
      groupABlocks.push({
        id: blockId,
        tier: 2,
        ...(isSeed ? { isNewUserSeed: true } : {}),
        title: `${cleanLabel} Essentials`,
        subtitle: artistHint ? `Curated ${cleanLabel} & ${artistPool.slice(0, 2).join(', ')}` : `Tailored ${cleanLabel} songs & deep cuts`,
        badge: `${cleanLabel.slice(0, 12).toUpperCase()} MIX`,
        query: `${artistHint} ${cleanLabel} official songs`.trim(),
        seedQueries: [
          `${cleanLabel} latest releases 2026`,
          ...(leadArtists[0] ? [`${leadArtists[0]} top songs`] : [])
        ],
        thumbnail: thumb,
        thumbnailPool: thumbPool,
        color: 'from-indigo-600/40 to-black'
      })
    }
  }

  // Fill remaining slots up to 4 purely from the user's own artists, primary genre mood variants, or neutral mood presets (never unrelated J-Pop/Hindi!)
  const primaryGenreObj = genreTokens[0]
  const primaryLabel = GENRE_MIX_CATALOG[primaryGenreObj?.key]?.label || primaryGenreObj?.raw || 'Your Taste'
  const primaryArtistsPair = artistPool.slice(0, 2).join(' ')
  const fillerCandidates = []

  if (artistPool.length > 0) {
    fillerCandidates.push({
      id: 'block_artist_spotlight',
      title: `${artistPool.slice(0, 2).join(' & ')} Radio`,
      subtitle: `Built from your favorite artists`,
      badge: 'ARTIST MIX',
      query: `${artistPool[0]} latest top songs`,
      seedQueries: [
        ...artistPool.slice(0, 3).map((a) => `${a} official songs`),
        `${primaryArtistsPair} radio songs`
      ],
      thumbnail: userTracks[0]?.video_id
        ? `https://i.ytimg.com/vi/${userTracks[0].video_id}/maxresdefault.jpg`
        : 'https://i.ytimg.com/vi/kPa7bsKwL-c/maxresdefault.jpg',
      color: 'from-violet-600/40 to-black'
    })
  }

  fillerCandidates.push(
    {
      id: 'block_late_night_personalized',
      title: genreTokens.length ? `Late Night ${primaryLabel}` : 'Chill & Late Night Vibes',
      subtitle: artistPool.length
        ? `Atmospheric ${primaryLabel} with ${artistPool[0]}`
        : `Atmospheric ${primaryLabel} & nocturnal grooves`,
      badge: 'CHILL MIX',
      query: `${primaryArtistsPair} ${primaryLabel} chill songs`.trim(),
      seedQueries: [
        `${primaryLabel} late night chill songs`,
        ...(artistPool[0] ? [`${artistPool[0]} acoustic chill songs`] : [])
      ],
      thumbnail: 'https://i.ytimg.com/vi/GT8ornYrDEs/maxresdefault.jpg',
      color: 'from-teal-600/40 to-black'
    },
    {
      id: 'block_energy_drive_personalized',
      title: genreTokens.length ? `High-Energy ${primaryLabel}` : 'High-Energy Drive Mix',
      subtitle: artistPool.length
        ? `Up-tempo picks inspired by ${artistPool.slice(0, 2).join(' & ')}`
        : `Driving rhythms & upbeat ${primaryLabel} anthems`,
      badge: 'ENERGY MIX',
      query: `${primaryArtistsPair} ${primaryLabel} upbeat songs`.trim(),
      seedQueries: [
        `${primaryLabel} high energy hits`,
        ...(artistPool[1] ? [`${artistPool[1]} upbeat songs`] : [])
      ],
      thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/maxresdefault.jpg',
      color: 'from-emerald-600/40 to-black'
    },
    {
      id: 'block_deep_cuts_personalized',
      title: `${primaryLabel} Deep Cuts`,
      subtitle: 'Hidden gems & B-sides matching your sound',
      badge: 'DEEP CUTS',
      query: `${primaryArtistsPair} ${primaryLabel} deep cuts songs`.trim(),
      seedQueries: [`${primaryLabel} underrated songs`, `${artistPool[0] || primaryLabel} album tracks`],
      thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
      color: 'from-cyan-600/40 to-black'
    }
  )

  for (const filler of fillerCandidates) {
    if (groupABlocks.length >= 4) break
    if (usedIds.has(filler.id)) continue
    usedIds.add(filler.id)
    groupABlocks.push({
      ...filler,
      tier: 2,
      ...(isSeed ? { isNewUserSeed: true } : {}),
      thumbnailPool: [filler.thumbnail]
    })
  }

  // Group B (3 blocks): Rediscover + GTA VI & Latest Releases + Sonic DNA Radar
  const genreLabelsQuery = genreTokens
    .slice(0, 2)
    .map((g) => GENRE_MIX_CATALOG[g.key]?.label || g.raw)
    .join(' ')

  const slot5Rediscover = rediscoverBlock || {
    id: 'block_rediscover_favorites',
    tier: 2,
    ...(isSeed ? { isNewUserSeed: true } : {}),
    title: 'Rediscover Favorites Mix',
    subtitle: artistPool.length
      ? `Shuffled favorites & ${artistPool.slice(0, 2).join(', ')} radio`
      : 'Shuffled liked songs + closely related tracks',
    badge: 'REDISCOVER',
    query: `${primaryArtistsPair || genreLabelsQuery} official songs`.trim(),
    seedQueries: artistPool.slice(0, 2).map((a) => `${a} top songs`),
    thumbnail: 'https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg',
    thumbnailPool: ['https://i.ytimg.com/vi/dvgZkm1xWPE/maxresdefault.jpg'],
    color: 'from-pink-600/40 to-black',
    isHybridRediscover: true
  }

  const gtaQuery = cursor % 2 === 0
    ? 'Tom Petty Love Is A Long Road GTAVI Original Score'
    : 'The Pointer Sisters Hot Together GTA 6 soundtrack'
  const gtaSeedQueries = [
    ...(artistPool[0] ? [`${artistPool[0]} latest songs 2026`] : []),
    ...GTA6_AND_LATEST_SEED_QUERIES
  ]

  const radarQuery = artistPool.length
    ? `${artistPool[0]} ${genreLabelsQuery} new songs`.trim()
    : `${genreLabelsQuery} official songs`.trim()
  const radarSeedQueries = [
    ...(artistPool.slice(1, 3).map((a) => `${a} top songs`)),
    ...(genreTokens.slice(0, 2).map((g) => `${GENRE_MIX_CATALOG[g.key]?.label || g.raw} latest songs`))
  ]

  return [
    ...groupABlocks.slice(0, 4),
    slot5Rediscover,
    {
      id: 'block_gta6_latest_anthems',
      tier: 2,
      ...(isSeed ? { isNewUserSeed: true } : {}),
      title: 'GTA VI & Latest Viral Anthems',
      subtitle: artistPool.length
        ? `New 2026 album launches, GTA VI soundtrack & ${artistPool[0]}`
        : 'GTA 6 soundtrack hits, Vice City radio & newly launched 2026 drops',
      badge: 'NEW & GTA VI',
      query: gtaQuery,
      seedQueries: gtaSeedQueries,
      thumbnail: GTA6_AND_LATEST_THUMBS[cursor % GTA6_AND_LATEST_THUMBS.length],
      thumbnailPool: GTA6_AND_LATEST_THUMBS,
      color: 'from-rose-600/40 to-black'
    },
    {
      id: 'block_sonic_dna_radar',
      tier: 2,
      ...(isSeed ? { isNewUserSeed: true } : {}),
      title: 'Sonic DNA Radar',
      subtitle: dna?.archetype
        ? `${dna.archetype} • Discoveries matching your taste`
        : 'Fresh discoveries matching your core artists',
      badge: 'TASTE RADAR',
      query: radarQuery,
      seedQueries: radarSeedQueries,
      thumbnail: 'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg',
      thumbnailPool: [
        'https://i.ytimg.com/vi/fPKVETKHwGk/maxresdefault.jpg',
        'https://i.ytimg.com/vi/p8_ugAjWI5I/maxresdefault.jpg',
        'https://i.ytimg.com/vi/ApXoWvfEYVU/maxresdefault.jpg'
      ],
      color: 'from-cyan-600/40 to-black'
    }
  ]
}

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
    coreAnchors = fisherYatesShuffle(pool.length > 0 ? [...pool, ...starterSeeds.filter((s) => !seen.has(s.video_id))].slice(0, 4) : starterSeeds).slice(0, 4)
    if (pool.length > 0) {
      coreAnchors = [...pool, ...coreAnchors.filter((s) => !seen.has(s.video_id))].slice(0, 4)
    }
    try {
      companionTracks = await fetchRelatedCompanionTracks(coreAnchors.slice(0, 2), 14)
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

  const { genres, regions, artists } = readPersonalizationPrefs()

  const scoreMap = new Map()
  AVAILABLE_CHARTS.forEach((chart, idx) => {
    let score = 100 - idx
    if (preferredChartIds.length > 0) {
      const prefIdx = preferredChartIds.indexOf(chart.id)
      if (prefIdx !== -1) {
        score += 500 - prefIdx * 25
      }
    } else {
      // Inferred preferences from user genres, regions, and artists
      const normTokens = [...genres, ...regions].map((g) => String(g || '').toLowerCase())
      const isDesi = normTokens.some((g) => /bollywood|punjabi|hindi|desi|india/.test(g)) ||
        artists.some((a) => /arijit|atif|diljit|karan|pritam|shreya|jubin|anuv|sidhu|badshah/i.test(a))
      const isJapanese = normTokens.some((g) => /j-?pop|anime|japan/.test(g)) ||
        artists.some((a) => /yoasobi|kenshi|fujii|higuchi|lisa|radwimps|sawano/i.test(a))
      const isKpop = normTokens.some((g) => /k-?pop|korea/.test(g)) ||
        artists.some((a) => /bts|blackpink|newjeans|stray|twice|jungkook/i.test(a))
      const isLatin = normTokens.some((g) => /latin|reggaeton/.test(g)) ||
        artists.some((a) => /bad bunny|shakira|karol|balvin|peso pluma/i.test(a))
      const isWestern = normTokens.some((g) => /pop|hip|rap|rock|indie|electronic|jazz|classical|metal|country|r&b|rnb|us|uk/.test(g))

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
  const prefs = readPersonalizationPrefs()
  const rankedCharts = resolveRankedChartBlocks(cursor)
  const tier2Blocks = buildDynamicTier2Blocks({ prefs, cursor, isSeed: true })

  return [
    ...rankedCharts,
    ...tier2Blocks
  ]
}

export const THIRTY_MINUTES_MS = 30 * 60 * 1000 // 1,800,000ms
let hasBootRefreshedThisSession = false

async function withTimeoutClean(promise, ms) {
  let timerId
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timerId = setTimeout(() => resolve(null), ms)
      })
    ])
  } finally {
    if (timerId) clearTimeout(timerId)
  }
}

function canonicalTitleKey(t) {
  const title = String(t?.title || '')
    .replace(/(\([^)]*\)|\[[^\]]*\])/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const artist = String(t?.artist || '').split(',')[0].trim().toLowerCase()
  return title ? `${title}::${artist}` : (t?.video_id || '')
}

function dedupeAndInterleaveTracks(lists = [], maxTracks = 25) {
  const out = []
  const seenVids = new Set()
  const seenKeys = new Set()
  const maxLen = lists.reduce((m, l) => Math.max(m, Array.isArray(l) ? l.length : 0), 0)

  for (let i = 0; i < maxLen && out.length < maxTracks; i++) {
    for (const list of lists) {
      if (out.length >= maxTracks) break
      if (!Array.isArray(list) || i >= list.length) continue
      const t = list[i]
      if (!t?.video_id || seenVids.has(t.video_id) || !isStrictMusicTrack(t)) continue
      const key = canonicalTitleKey(t)
      if (key && seenKeys.has(key)) continue
      seenVids.add(t.video_id)
      if (key) seenKeys.add(key)
      out.push(t)
    }
  }
  return out
}

function updateBlockArtworkFromTracks(block, tracks = [], usedCovers = null) {
  if (!block || !Array.isArray(tracks) || tracks.length === 0) return block
  const freshPool = []
  for (const t of tracks) {
    const thumb = t?.video_id
      ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg`
      : (t?.thumbnail || '')
    if (thumb && !freshPool.includes(thumb)) freshPool.push(thumb)
    if (freshPool.length >= 8) break
  }
  for (const oldThumb of (block.thumbnailPool || [])) {
    if (oldThumb && !freshPool.includes(oldThumb)) freshPool.push(oldThumb)
  }
  if (freshPool.length > 0) {
    block.thumbnailPool = freshPool
    let chosen = ''
    if (usedCovers) {
      chosen = freshPool.find((u) => !usedCovers.has(u)) || ''
    }
    block.thumbnail = chosen || freshPool[0]
    if (usedCovers && block.thumbnail) usedCovers.add(block.thumbnail)
  }
  return block
}

function dedupeBlockCovers(blocks = [], startCursor = 0) {
  const used = new Set()
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx]
    if (!b) continue
    const pool = []
    if (Array.isArray(b.preloadedTracks)) {
      for (const t of b.preloadedTracks) {
        const u = t?.video_id ? `https://i.ytimg.com/vi/${t.video_id}/maxresdefault.jpg` : t?.thumbnail
        if (u && !pool.includes(u)) pool.push(u)
      }
    }
    if (b.thumbnail && !pool.includes(b.thumbnail)) pool.push(b.thumbnail)
    for (const u of (b.thumbnailPool || [])) {
      if (u && !pool.includes(u)) pool.push(u)
    }

    let chosen = ''
    if (pool.length > 0) {
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[(startCursor + i) % pool.length]
        if (cand && !used.has(cand)) {
          chosen = cand
          break
        }
      }
      if (!chosen) chosen = pool[0]
    }
    if (chosen) {
      b.thumbnail = chosen
      b.thumbnailPool = pool
      used.add(chosen)
    }
  }
  return used
}

function syncBlockHydrationToCache(block) {
  if (!block?.id) return
  if (_discoveryFeedMemoryCache?.blocks) {
    const idx = _discoveryFeedMemoryCache.blocks.findIndex((b) => b.id === block.id)
    if (idx !== -1) {
      _discoveryFeedMemoryCache.blocks[idx] = { ..._discoveryFeedMemoryCache.blocks[idx], ...block }
      try {
        sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
      } catch {}
    }
  }
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('upbeat-discovery-block-hydrated', { detail: block }))
    } catch {}
  }
}

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

  try {
    sessionStorage.removeItem('upbeat_discovery_blocks_v632')
  } catch {}

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

  const prefs = readPersonalizationPrefs(tasteDna)
  const uniqueArtistCount = new Set([
    ...prefs.artists.map((a) => a.toLowerCase()),
    ...prefs.dnaArtists.map((a) => a.toLowerCase()),
    ...validUserTracks.map((t) => String(t.artist || '').toLowerCase()).filter(Boolean)
  ]).size
  const isNewUser = uniqueArtistCount < 2

  // Tier 1 — 7 Ranked Regional & Global Daily Chart Blocks based on User Preferences
  const tier1Blocks = resolveRankedChartBlocks(cursor)
  const usedCoverUrls = new Set(tier1Blocks.map((b) => b.thumbnail))

  // Tier 2 — 7 Dynamically Personalized Made For You Mixes (no hardcoded J-Pop/Hindi for other genres)
  const rediscoverBlock = await buildHybridRediscoverBlock({
    userTracks: validUserTracks,
    usedCoverUrls,
    rotationIndex: cursor,
    forceShuffle: forceRefresh
  })

  const tier2Blocks = buildDynamicTier2Blocks({
    prefs,
    userTracks: validUserTracks,
    rediscoverBlock,
    cursor,
    isSeed: false
  })

  const allBlocks = [...tier1Blocks, ...tier2Blocks]
  dedupeBlockCovers(allBlocks, cursor)

  // Live background-safe parallel hydration so cards preload 18-25 valid songs and live updated covers
  await withTimeoutClean(
    Promise.allSettled([
      ...tier2Blocks
        .filter((b) => !(b.preloadedTracks && b.preloadedTracks.length >= 16))
        .map((b) => loadBlockTracks(b, { maxQueries: 2 })),
      ...tier1Blocks.slice(0, 4).map((b) => loadBlockTracks(b, { maxQueries: 1 }))
    ]),
    4200
  )

  dedupeBlockCovers(allBlocks, cursor)

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
  if (blockId === 'block_rediscover' || blockId === 'block_rediscover_favorites') {
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

  // 2. Other Tier 2 & Tier 1 blocks: Rotate tag/seed query and reload fresh tracks + thumbnail
  const block = { ...currentFeed[existingIdx] }
  const nextCursor = advanceRotationCursor(1)
  const usedCovers = new Set(currentFeed.filter((b) => b.id !== blockId).map((b) => b.thumbnail))
  const cleanBaseQuery = String(block.query || '').replace(/\s+(latest hits|trending viral|top charting rotation|essential mix|heavy rotation radio|fresh picks 2026)/gi, '').trim()
  const seedPool = Array.isArray(block.seedQueries) ? block.seedQueries : []
  const nextPrimary = seedPool.length ? seedPool[nextCursor % seedPool.length] : cleanBaseQuery
  block.query = `${nextPrimary} ${getRandomRotationTag()}`.trim()
  block.preloadedTracks = []

  try {
    const freshTracks = await loadBlockTracks(block, { force: true, maxQueries: 3 })
    if (freshTracks.length > 0) {
      updateBlockArtworkFromTracks(block, freshTracks, usedCovers)
      block.preloadedTracks = freshTracks
    }
  } catch {}

  currentFeed[existingIdx] = block
  _discoveryFeedMemoryCache = { blocks: currentFeed, ts: Date.now() }
  try {
    sessionStorage.setItem(DISCOVERY_FEED_CACHE_KEY, JSON.stringify(_discoveryFeedMemoryCache))
  } catch {}

  return block
}

export async function loadBlockTracks(block, { force = false, maxQueries = 4 } = {}) {
  if (!block) return []
  const existingValid = Array.isArray(block.preloadedTracks)
    ? block.preloadedTracks.filter(isStrictMusicTrack)
    : []
  if (!force && existingValid.length >= 18) {
    return existingValid
  }

  const candidateLists = []
  if (existingValid.length > 0) {
    candidateLists.push(existingValid)
  }

  // Hybrid rediscover mix on-demand generation
  if ((block.id === 'block_rediscover' || block.id === 'block_rediscover_favorites') && existingValid.length === 0) {
    try {
      const hybrid = await buildHybridRediscoverBlock()
      const hybValid = (hybrid?.preloadedTracks || []).filter(isStrictMusicTrack)
      if (hybValid.length > 0) candidateLists.push(hybValid)
    } catch {}
  }

  // Tier 1 official charts: try playlist browse alongside queries
  const browsePromise = block.browse_id
    ? browsePlaylistStandalone(block.browse_id, block.title, block.subtitle, 25).catch(() => [])
    : Promise.resolve([])

  const searchQueries = [
    block.query,
    ...(Array.isArray(block.seedQueries) ? block.seedQueries : [])
  ]
    .filter(Boolean)
    .filter((q, idx, arr) => arr.indexOf(q) === idx)
    .slice(0, maxQueries)

  const [plTracks, ...searchResults] = await Promise.all([
    browsePromise,
    ...searchQueries.map((q) => directSearchStandalone(q, 'songs').catch(() => null))
  ])

  if (block.tier === 1 && Array.isArray(plTracks) && plTracks.length > 0) {
    candidateLists.push(plTracks)
  }
  for (const res of searchResults) {
    if (Array.isArray(res?.tracks) && res.tracks.length > 0) {
      candidateLists.push(res.tracks)
    }
  }
  if (block.tier !== 1 && Array.isArray(plTracks) && plTracks.length > 0) {
    candidateLists.push(plTracks)
  }

  let merged = dedupeAndInterleaveTracks(candidateLists, 25)

  // If still fewer than 15 tracks and we have at least 1 anchor track, supplement via Watch Radio
  if (merged.length > 0 && merged.length < 15) {
    try {
      const extra = await fetchRelatedCompanionTracks(merged.slice(0, 3), 20)
      if (extra.length > 0) {
        merged = dedupeAndInterleaveTracks([merged, extra], 25)
      }
    } catch {}
  }

  if (merged.length > 0) {
    block.preloadedTracks = merged
    updateBlockArtworkFromTracks(block, merged)
    syncBlockHydrationToCache(block)
  }

  return merged
}
