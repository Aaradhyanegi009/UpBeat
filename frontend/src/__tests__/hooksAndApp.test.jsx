import React from 'react'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { render, renderHook, act, waitFor, cleanup, fireEvent } from '@testing-library/react'

vi.mock('peerjs', () => {
  return {
    Peer: class MockPeer {
      on() {}
      connect() {
        return { open: true, on() {}, send() {}, close() {} }
      }
      reconnect() {}
      destroy() {}
    }
  }
})

import { useLibraryStorage } from '../hooks/useLibraryStorage'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { jamManager } from '../jamEngine'
import App from '../App'

describe('Phase 4 custom hooks & App smoke render', () => {
  afterAll(() => {
    jamManager.destroy()
  })

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ tracks: [], favorites: [], blocks: [] }),
      text: async () => ''
    })))
    if (typeof window !== 'undefined' && !window.matchMedia) {
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {}
      })
    }
    if (typeof globalThis.IntersectionObserver === 'undefined') {
      globalThis.IntersectionObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    }
  })

  it('useLibraryStorage purges non-music boot items and manages user playlists cleanly', () => {
    localStorage.setItem(
      'argon_favs_v2',
      JSON.stringify([
        { video_id: 'dQw4w9WgXcQ', title: 'Valid Song', artist: 'Artist One', duration_text: '3:32' },
        { video_id: 'badvid00001', title: 'Stand-up Comedy Special', artist: 'Comic', duration_text: '3:32' }
      ])
    )
    const showNotify = vi.fn()
    const navigate = vi.fn()
    const goBack = vi.fn()

    const { result } = renderHook(() =>
      useLibraryStorage({ showNotify, navigate, goBack, initialSearchQuery: '' })
    )

    expect(result.current.favorites).toHaveLength(1)
    expect(result.current.favorites[0].video_id).toBe('dQw4w9WgXcQ')

    const extraTrack = { video_id: '9bZkp7q19f0', title: 'Track Two', artist: 'Artist Two', duration_text: '3:40' }
    act(() => {
      result.current.createPlaylist('Roadtrip', extraTrack)
    })

    expect(result.current.savedCollections).toHaveLength(1)
    expect(result.current.savedCollections[0].title).toBe('Roadtrip')
    expect(result.current.savedCollections[0].tracks).toHaveLength(1)

    const pl = result.current.savedCollections[0]
    act(() => {
      result.current.addTrackToPlaylist(pl, result.current.favorites[0])
    })
    expect(result.current.savedCollections[0].tracks).toHaveLength(2)

    act(() => {
      result.current.removeFromPlaylist(pl.id, 0)
    })
    expect(result.current.savedCollections[0].tracks).toHaveLength(1)
  })

  it('useAudioPlayback manages queue, play/next/prev, shuffle roundtrip, and standalone favorites', async () => {
    const t1 = { video_id: 'dQw4w9WgXcQ', title: 'One', artist: 'Artist A', duration_text: '3:10' }
    const t2 = { video_id: '9bZkp7q19f0', title: 'Two', artist: 'Artist B', duration_text: '3:20' }
    const t3 = { video_id: '3JZ_D3ELwOQ', title: 'Three', artist: 'Artist C', duration_text: '3:30' }

    const Wrapper = () => {
      const [playlist, setPlaylist] = React.useState({ id: 'mix1', title: 'Test Mix', tracks: [t1, t2, t3] })
      const [favorites, setFavorites] = React.useState([])
      const [queue, setQueue] = React.useState([t2, t3])
      const remoteJamGuardRef = React.useRef(false)
      return useAudioPlayback({
        playlist,
        setPlaylist,
        favorites,
        setFavorites,
        extractedTracks: [],
        offlineTracks: [],
        queue,
        setQueue,
        activeTab: 'curator',
        setPlayingFrom: () => {},
        remoteJamGuardRef,
        onPushToSafari: () => {},
        showNotify: () => {}
      })
    }

    const { result } = renderHook(() => Wrapper())

    act(() => {
      result.current.handlePlayTrack(t1, 0, [t1, t2, t3])
    })
    expect(result.current.currentTrack?.video_id).toBe('dQw4w9WgXcQ')
    expect(result.current.isPlaying).toBe(true)

    act(() => {
      result.current.handleNext()
    })
    expect(result.current.currentTrack?.video_id).toBe('9bZkp7q19f0')

    act(() => {
      result.current.handleToggleShuffle()
    })
    expect(result.current.isShuffle).toBe(true)

    act(() => {
      result.current.handleToggleShuffle()
    })
    expect(result.current.isShuffle).toBe(false)

    window.Capacitor = { isNativePlatform: () => true }
    try {
      await act(async () => {
        await result.current.handleToggleFavorite(t1)
      })
      expect(result.current.isTrackFavorite(t1)).toBe(true)

    await act(async () => {
      await result.current.handleToggleFavorite(t1)
    })
    expect(result.current.isTrackFavorite(t1)).toBe(false)
    } finally {
      delete window.Capacitor
    }
  })

  it('useAudioPlayback cycles and persists single-song repeatMode and syncs UpBeatNative', () => {
    const syncRepeatMode = vi.fn()
    window.UpBeatNative = { syncRepeatMode }
    try {
      const Wrapper = () => {
        const [playlist, setPlaylist] = React.useState(null)
        const [favorites, setFavorites] = React.useState([])
        const [queue, setQueue] = React.useState([])
        const remoteJamGuardRef = React.useRef(false)
        return useAudioPlayback({
          playlist,
          setPlaylist,
          favorites,
          setFavorites,
          extractedTracks: [],
          offlineTracks: [],
          queue,
          setQueue,
          activeTab: 'curator',
          setPlayingFrom: () => {},
          remoteJamGuardRef,
          onPushToSafari: () => {},
          showNotify: () => {}
        })
      }

      const { result } = renderHook(() => Wrapper())
      expect(result.current.repeatMode).toBe('off')

      act(() => result.current.cycleRepeatMode())
      expect(result.current.repeatMode).toBe('all')

      act(() => result.current.cycleRepeatMode())
      expect(result.current.repeatMode).toBe('one')
      expect(localStorage.getItem('upbeat_repeat_mode')).toBe('one')

      act(() => result.current.cycleRepeatMode())
      expect(result.current.repeatMode).toBe('off')

      act(() => result.current.toggleLoopSong())
      expect(result.current.repeatMode).toBe('one')
      expect(syncRepeatMode).toHaveBeenCalledWith('one')

      act(() => result.current.toggleLoopSong())
      expect(result.current.repeatMode).toBe('off')
    } finally {
      delete window.UpBeatNative
    }
  })

  it('App smoke renders without runtime ReferenceError when onboarded', async () => {
    window.location.hash = '#/'
    localStorage.setItem('upbeat_onboarded_v1', '1')
    localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['in', 'us']))

    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.firstChild).not.toBeNull()
    })
  })

  it('AI Curator Create -> "Make my mix" and Search -> "Make a mix" both curate without ReferenceError', async () => {
    localStorage.setItem('upbeat_onboarded_v1', '1')
    localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['in', 'us']))
    localStorage.setItem('upbeat_gemini_api_key', 'AIzaTestGeminiKey')

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url || '')
      if (target.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        playlist_title: 'Monogatari Chronology',
                        subtitle: 'Bakemonogatari essentials',
                        tracks: [
                          {
                            title: 'chocolate insomnia',
                            artist: 'Tsubasa Hanekawa',
                            search_query: 'chocolate insomnia monogatari',
                            match_tier: 'Direct Match',
                            reason: 'Dreamy synth-pop opening with delicate strings',
                            vibe: 'Dreamy'
                          }
                        ]
                      })
                    }
                  ]
                }
              }
            ]
          })
        }
      }
      if (target.includes('/api/innertube') || target.includes('youtube.com/youtubei')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
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
                                contents: [
                                  {
                                    musicResponsiveListItemRenderer: {
                                      playlistItemData: { videoId: '4BP_NJ41bB8' },
                                      flexColumns: [
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'chocolate insomnia' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song • Tsubasa Hanekawa • 4:40' }] } } }
                                      ],
                                      fixedColumns: [
                                        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '4:40' }] } } }
                                      ]
                                    }
                                  }
                                ]
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
          })
        }
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ tracks: [], favorites: [], blocks: [] }),
        text: async () => ''
      }
    }))

    // 1) Test Create -> Make my mix
    window.location.hash = '#/create'
    const view1 = render(<App />)
    const textarea = await view1.findByLabelText(/describe the music you want/i)
    fireEvent.change(textarea, { target: { value: 'monogatari album' } })
    const makeBtn = view1.getByRole('button', { name: /make my mix/i })
    fireEvent.click(makeBtn)

    await waitFor(() => {
      expect(view1.getAllByText('Monogatari Chronology').length).toBeGreaterThan(0)
      expect(view1.getAllByText('chocolate insomnia').length).toBeGreaterThan(0)
    })
    cleanup()

    // 2) Test Search -> Make a mix from "monogatari album"
    window.location.hash = '#/search?q=monogatari%20album'
    const view2 = render(<App />)
    const searchMixBtn = await view2.findByRole('button', { name: /make a mix from/i })
    fireEvent.click(searchMixBtn)

    await waitFor(() => {
      expect(view2.getAllByText('Monogatari Chronology').length).toBeGreaterThan(0)
      expect(view2.getAllByText('chocolate insomnia').length).toBeGreaterThan(0)
    })
  })
})
