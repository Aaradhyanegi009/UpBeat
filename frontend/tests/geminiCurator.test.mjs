import test from 'node:test'
import assert from 'node:assert/strict'
import { resetStorage, withWindowStub } from './helpers/test-env.mjs'
import { curateStandalone } from '../src/services/geminiCurator.js'
import { clearGeminiCooldowns } from '../src/services/geminiClient.js'
import { setStoredApiKey } from '../src/services/platformConfig.js'

function makeYtmSearchResponse(items) {
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        contents: items.map((it) => ({
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: it.videoId },
                            flexColumns: [
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: { runs: [{ text: it.title }] }
                                }
                              },
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: { runs: [{ text: `Song • ${it.artist} • ${it.duration}` }] }
                                }
                              }
                            ],
                            fixedColumns: [
                              {
                                musicResponsiveListItemFixedColumnRenderer: {
                                  text: { runs: [{ text: it.duration }] }
                                }
                              }
                            ]
                          }
                        }))
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  }
}

test('curateStandalone hydrates matching catalog tracks directly and fires onProgress stages', async () => {
  resetStorage()
  clearGeminiCooldowns()
  setStoredApiKey('AIzaCuratorTestKey')

  const prevFetch = globalThis.fetch
  const stages = []
  const innertubeQueries = []

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('generativelanguage.googleapis.com')) {
      stages.push('gemini_called')
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      playlist_title: 'Tailored Curated Mix',
                      subtitle: 'Grounding test',
                      tracks: [
                        {
                          title: 'Starboy (Official Audio)',
                          artist: 'The Weeknd - Topic',
                          search_query: 'Starboy The Weeknd',
                          match_tier: 'Direct Match',
                          reason: 'Pulsing synth-pop basslines with crisp vocal hooks'
                        },
                        {
                          title: 'Midnight City',
                          artist: 'M83',
                          search_query: 'Midnight City M83',
                          match_tier: 'Close Fit',
                          reason: 'Euphoric French electro synths with soaring saxophone climax'
                        },
                        {
                          title: 'Hello',
                          artist: 'Lionel Richie',
                          search_query: 'Hello Lionel Richie',
                          match_tier: 'Exploratory',
                          reason: 'Warm acoustic ballad with classic piano phrasing'
                        }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (target.includes('/api/innertube') || target.includes('youtubei/v1/search')) {
      const body = init.body ? JSON.parse(init.body) : {}
      const q = body.body?.query || body.query || ''
      innertubeQueries.push(q)
      stages.push(`search:${q}`)

      if (q === 'synth night drive') {
        return new Response(
          JSON.stringify(
            makeYtmSearchResponse([
              { videoId: '34Na4j8AVgA', title: 'Starboy', artist: 'The Weeknd', duration: '3:50' },
              { videoId: 'dX3k_QDnzHE', title: 'Midnight City (2011 Remaster)', artist: 'M83 Official', duration: '4:03' },
              { videoId: 'YQHsXMglC9A', title: 'Hello', artist: 'Adele', duration: '4:55' }
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (q === 'Hello Lionel Richie') {
        return new Response(
          JSON.stringify(
            makeYtmSearchResponse([
              { videoId: 'UBsQ83j6p5M', title: 'Hello', artist: 'Lionel Richie', duration: '4:15' }
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const result = await withWindowStub(() =>
      curateStandalone({
        mood_prompt: 'synth night drive',
        energy_level: 80,
        count: 3,
        onProgress: (stage) => stages.push(`progress:${stage}`)
      })
    )

    assert.equal(result.playlist_title, 'Tailored Curated Mix')
    assert.equal(result.tracks.length, 3)

    // Progress stage ordering: curating before Gemini, resolving before fallback searches
    const curatingIdx = stages.indexOf('progress:curating')
    const geminiIdx = stages.indexOf('gemini_called')
    const resolvingIdx = stages.indexOf('progress:resolving')
    const fallbackSearchIdx = stages.indexOf('search:Hello Lionel Richie')
    assert.ok(curatingIdx >= 0 && curatingIdx < geminiIdx, 'curating reported before Gemini call')
    assert.ok(resolvingIdx > geminiIdx && resolvingIdx < fallbackSearchIdx, 'resolving reported before fallback searches')

    // Track 1 & Track 2 hydrated directly from catalog without extra searchYouTubeStandalone calls
    assert.equal(innertubeQueries.includes('Starboy The Weeknd'), false)
    assert.equal(innertubeQueries.includes('Midnight City M83'), false)

    const t1 = result.tracks.find((t) => t.title.includes('Starboy'))
    assert.equal(t1.video_id, '34Na4j8AVgA')
    assert.equal(t1.duration_text, '3:50')
    assert.equal(t1.thumbnail, 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg')
    assert.equal(t1.url, 'https://www.youtube.com/watch?v=34Na4j8AVgA')

    const t2 = result.tracks.find((t) => t.title === 'Midnight City')
    assert.equal(t2.video_id, 'dX3k_QDnzHE')
    assert.equal(t2.duration_text, '4:03')

    // Track 3 had same title as catalog "Hello" (Adele), non-overlapping artist -> fell back to searchYouTubeStandalone!
    assert.equal(innertubeQueries.includes('Hello Lionel Richie'), true)
    const t3 = result.tracks.find((t) => t.artist === 'Lionel Richie')
    assert.equal(t3.video_id, 'UBsQ83j6p5M')
    assert.equal(t3.duration_text, '4:15')

    // Backwards compatibility when onProgress is omitted
    const resultNoProgress = await withWindowStub(() =>
      curateStandalone({ mood_prompt: 'synth night drive' })
    )
    assert.equal(resultNoProgress.tracks.length, 3)
  } finally {
    globalThis.fetch = prevFetch
    clearGeminiCooldowns()
    resetStorage()
  }
})
