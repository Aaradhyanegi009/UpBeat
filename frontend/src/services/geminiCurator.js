/**
 * AI playlist curation and Sonic Taste DNA analysis backed by Gemini + Innertube grounding.
 */
import { isConfigured } from "./platformConfig.js"
import { generateWithDirectGemini } from "./geminiClient.js"
import {
  canonicalArtistName,
  canonicalSongTitle,
  searchYouTubeStandalone,
  ytmSearchItems
} from "./innertubeClient.js"

function artistsOverlap(rawA = '', rawB = '') {
  const a = canonicalArtistName(rawA)
  const b = canonicalArtistName(rawB)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const tokensA = a.split(/\s+/).filter((w) => w.length >= 2)
  const tokensB = new Set(b.split(/\s+/).filter((w) => w.length >= 2))
  return tokensA.some((tok) => tokensB.has(tok))
}

function findCatalogMatch(track, catalog = []) {
  if (!track || !Array.isArray(catalog) || !catalog.length) return null
  const tTitle = canonicalSongTitle(track.title)
  const tArtist = canonicalArtistName(track.artist)
  if (!tTitle) return null

  const valid = catalog.filter((c) => c && c.video_id)
  if (tArtist) {
    const exact = valid.find(
      (c) => canonicalSongTitle(c.title) === tTitle && canonicalArtistName(c.artist) === tArtist
    )
    if (exact) return exact
  }

  const titleMatches = valid.filter((c) => canonicalSongTitle(c.title) === tTitle)
  if (titleMatches.length === 1 && artistsOverlap(track.artist, titleMatches[0].artist)) {
    return titleMatches[0]
  }
  const overlapping = titleMatches.filter((c) => artistsOverlap(track.artist, c.artist))
  if (overlapping.length === 1) return overlapping[0]

  return null
}

// ---------------------------------------------------------------------------
// Standalone curation
// ---------------------------------------------------------------------------

export async function curateStandalone({
  mood_prompt,
  energy_level = 78,
  count = 8,
  model_name = 'gemini-4-argon',
  favorites = [],
  onProgress = null
}) {
  // Ground the model in real catalog results for the query
  let catalog = []
  let catalogBlock = ''
  try {
    catalog = (await ytmSearchItems(mood_prompt)).slice(0, 12)
    if (catalog.length) {
      catalogBlock =
        'Verified YouTube Music tracks matching the query (use as ground truth where relevant):\n' +
        catalog.map((c) => `- "${c.title}" by ${c.artist}`).join('\n') +
        '\n\n'
    }
  } catch {}

  const favBlock = favorites.length
    ? 'Listener favorites (use only for general mood prompts, never to dilute a specific franchise/artist request):\n' +
      favorites.slice(0, 8).map((f) => `- ${f.title} by ${f.artist}`).join('\n') +
      '\n\n'
    : ''

  const prompt = `You are an expert musicologist and playlist curator for UpBeat.

${catalogBlock}${favBlock}User Request:
- Prompt: "${mood_prompt}"
- Target Intensity: ${energy_level}/100
- Track Count: ${count}

STRICT RULES:
1. If the prompt names a specific anime, movie, game, franchise, or artist (e.g. "monogatari bests", "ramayan movie song"), 100% of tracks MUST belong to that exact franchise/artist. Never mix unrelated shows. Use real, canonical song titles only.
2. Otherwise, curate tracks that genuinely match the mood and intensity.
3. "reason": 8-13 words describing the music itself (instrumentation, vocals, rhythm, atmosphere). Never write meta-talk like "appeals to the user".
4. "search_query": exact title + artist + series/album so YouTube Music finds the official audio.

Return ONLY a valid JSON object:
{
  "playlist_title": "string",
  "subtitle": "string",
  "vibe_description": "string",
  "tracks": [
    {
      "title": "string",
      "artist": "string",
      "search_query": "string",
      "match_tier": "Direct Match | Close Fit | Exploratory",
      "reason": "string",
      "detail": "string (1 sentence)",
      "vibe": "string (1-2 words)",
      "energy": 78
    }
  ]
}`

  if (typeof onProgress === 'function') {
    try { onProgress('curating') } catch {}
  }
  const res = await generateWithDirectGemini(prompt, model_name)
  const tracks = Array.isArray(res.tracks) ? res.tracks : []
  const tierOrder = { 'Direct Match': 0, 'Close Fit': 1, Exploratory: 2 }

  if (typeof onProgress === 'function') {
    try { onProgress('resolving') } catch {}
  }

  const resolved = await Promise.all(
    tracks.map(async (t) => {
      const q = t.search_query || `${t.title} ${t.artist}`
      const tier = tierOrder[t.match_tier] !== undefined ? t.match_tier : 'Direct Match'
      const catalogHit = findCatalogMatch(t, catalog)
      if (catalogHit) {
        const vid = catalogHit.video_id
        const extraFallbacks = catalog
          .filter((c) => c?.video_id && c.video_id !== vid && canonicalSongTitle(c.title) === canonicalSongTitle(t.title))
          .map((c) => c.video_id)
        const fallbackIds = Array.from(new Set([...(catalogHit.fallback_ids || []), ...extraFallbacks]))
        return {
          ...t,
          match_tier: tier,
          video_id: vid,
          fallback_ids: fallbackIds,
          duration_text: catalogHit.duration_text || '',
          thumbnail: catalogHit.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          url: catalogHit.url || `https://www.youtube.com/watch?v=${vid}`
        }
      }
      const found = await searchYouTubeStandalone(q)
      if (found) return { ...t, match_tier: tier, ...found, duration_text: found.duration_text || '' }
      return { ...t, match_tier: tier, video_id: '', fallback_ids: [], duration_text: '', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` }
    })
  )

  // Never play the same video twice in one playlist
  const used = new Set()
  for (const tr of resolved) {
    if (tr.video_id && used.has(tr.video_id)) {
      const alt = (tr.fallback_ids || []).find((id) => !used.has(id))
      if (alt) {
        tr.video_id = alt
        tr.thumbnail = `https://i.ytimg.com/vi/${alt}/hqdefault.jpg`
        tr.url = `https://www.youtube.com/watch?v=${alt}`
      }
    }
    if (tr.video_id) used.add(tr.video_id)
  }

  resolved.sort((a, b) => (tierOrder[a.match_tier] ?? 0) - (tierOrder[b.match_tier] ?? 0))
  return { ...res, tracks: resolved }
}

/**
 * Analyzes seed tracks and hearted favorites to produce a rich Sonic Taste DNA profile.
 * Works on Android / mobile without needing a Mac host or Safari.
 */
export async function analyzeTasteDnaStandalone(tracks) {
  if (!tracks || !tracks.length) return null

  const trackListStr = tracks
    .slice(0, 15)
    .map((t) => `"${t.title}" by ${t.artist}`)
    .join(', ')

  if (isConfigured()) {
    try {
      const prompt = `Analyze this user's music taste based purely on their actual favorite and seed tracks:
${trackListStr}

Determine their authentic listener archetype, genres, and key artists based ONLY on the musical styles and artists in their list above.

Return JSON with this exact schema:
{
  "archetype": "A creative 2-4 word listener archetype tailored specifically to their artists and songs (e.g. 'Melodic Pop Harmonist', 'High-Octane Rock Voyager', 'Soulful Urban Rhythmist', 'Electronic Sound Architect')",
  "summary": "A rich 2-3 sentence paragraph analyzing their musical preferences, mood, timbre, and emotional dynamics.",
  "sonic_attributes": {
    "tempo": "A tempo range e.g. '115-135 BPM'",
    "electronic_balance": 55
  },
  "primary_genres": ["3-5 genre strings reflecting the specific genres of their tracks above"],
  "key_artists": ["3-5 distinct artist strings based directly on the tracks above"]
}`
      const res = await generateWithDirectGemini(prompt, 'gemini-4-argon')
      if (res && res.archetype) {
        return res
      }
    } catch (e) {
      console.warn('Gemini taste analysis fallback:', e)
    }
  }

  // Heuristic Sonic DNA generation if Gemini is offline
  const artists = Array.from(new Set(tracks.map((t) => t.artist).filter(Boolean)))
  const topArtists = artists.slice(0, 4)
  const isHighEnergy = tracks.some((t) => /rock|epic|metal|hyper|phonk|battle|dance|club|party/i.test(`${t.title} ${t.artist}`))
  const isAtmospheric = tracks.some((t) => /theme|lofi|piano|acoustic|synth|vibe|ambient|slow|chill/i.test(`${t.title} ${t.artist}`))

  let archetype = 'Eclectic Audio Connoisseur'
  if (isHighEnergy) archetype = 'High-Octane Sonic Voyager'
  else if (isAtmospheric) archetype = 'Atmospheric Soundscape Curator'

  const leadArtists = topArtists.length ? topArtists.slice(0, 2).join(' and ') : 'diverse musical styles'

  return {
    archetype,
    summary: `Drawn to dynamic melodies, evocative vocals, and rhythmic harmony. Their taste profile bridges ${leadArtists} with rich musical textures and memorable hooks.`,
    sonic_attributes: {
      tempo: isHighEnergy ? '130-160 BPM' : '110-135 BPM',
      electronic_balance: isHighEnergy ? 70 : 45
    },
    primary_genres: isHighEnergy
      ? ['Alternative Rock', 'Electronic Beats', 'High-Energy Pop', 'Dynamic Rhythms']
      : ['Indie & Alternative', 'Contemporary Pop', 'Atmospheric Ambient', 'Acoustic Melodies'],
    key_artists: topArtists.length ? topArtists : artists.slice(0, 3)
  }
}
