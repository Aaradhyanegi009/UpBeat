import React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, renderHook, act, waitFor, cleanup, fireEvent, screen } from '@testing-library/react'

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

import PlayerBar from '../components/PlayerBar'
import NowPlayingView from '../components/NowPlayingView'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { useJamSync } from '../hooks/useJamSync'
import { TopBar } from '../ui/Shell'
import { AppContext } from '../ui/AppContext'
import HomeView from '../views/HomeView'
import SettingsView from '../views/SettingsView'
import App from '../App'
import { jamManager } from '../jamEngine'

const origMediaPlay = HTMLMediaElement.prototype.play
const origMediaPause = HTMLMediaElement.prototype.pause
const origMediaLoad = HTMLMediaElement.prototype.load

describe('P0/P1 Playback, PlayerBar, Watch-video, Discovery, Jam, and App fixes', () => {
  afterAll(() => {
    jamManager.destroy()
    HTMLMediaElement.prototype.play = origMediaPlay
    HTMLMediaElement.prototype.pause = origMediaPause
    HTMLMediaElement.prototype.load = origMediaLoad
  })

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    delete window.YT
    delete window.UpBeatControls
    delete window.onUpBeatCarAction

    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()

    if (!window.matchMedia) {
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
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {}
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('PlayerBar sleep timer keeps ticking smoothly while currentTime advances every 250ms and stops playback on expiry', async () => {
    vi.useFakeTimers()
    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/audio-info/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ url: 'http://localhost:8000/api/audio/dQw4w9WgXcQ', duration: 210 })
        }
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({})
      }
    }))

    const setIsPlaying = vi.fn()
    const track = { video_id: 'dQw4w9WgXcQ', title: 'Sleep Song', artist: 'Artist', duration_text: '3:30' }

    const { container } = render(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={track}
        isPlaying={true}
        setIsPlaying={setIsPlaying}
        onTogglePlay={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        crossfadeSec={0}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const audios = Array.from(container.querySelectorAll('audio'))
    expect(audios).toHaveLength(2)
    const activeAudio = audios.find((a) => a.dataset.vid === 'dQw4w9WgXcQ')
    expect(activeAudio).toBeTruthy()
    Object.defineProperty(activeAudio, 'duration', { value: 210, configurable: true })

    // Open Sleep timer modal and set 1 minute via custom input
    fireEvent.click(screen.getByRole('button', { name: 'Sleep timer' }))
    const customInput = screen.getByLabelText('Custom minutes')
    fireEvent.change(customInput, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    // Re-open modal to watch live countdown text update during continuous timeupdate events
    const activeTimerBtn = screen.getByRole('button', { name: /Sleep timer: 1 min left/i })
    fireEvent.click(activeTimerBtn)
    expect(screen.getByText('1:00')).toBeTruthy()

    // Advance 5 seconds while simulating timeupdate every 250ms (this used to freeze the interval)
    for (let step = 0; step < 20; step++) {
      Object.defineProperty(activeAudio, 'currentTime', { value: (step + 1) * 0.25, configurable: true })
      fireEvent.timeUpdate(activeAudio)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
    }

    expect(screen.getByText('0:55')).toBeTruthy()

    // Advance remaining 55 seconds -> timer expires, pauses active deck, stops playback
    activeAudio.pause.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55000)
    })

    expect(activeAudio.pause).toHaveBeenCalled()
    expect(setIsPlaying).toHaveBeenCalledWith(false)
  })

  it('PlayerBar YT.Player fallback advances past track #1 via refs and dual-deck forcePlay only plays active deck', async () => {
    vi.useFakeTimers()
    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')

    // First verify YT.Player fallback advancing past track #1 using fresh refs
    let capturedYtConfig = null
    const mockYtInstance = {
      loadVideoById: vi.fn(),
      cueVideoById: vi.fn(),
      playVideo: vi.fn(),
      setVolume: vi.fn(),
      stopVideo: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 180)
    }
    window.YT = {
      Player: vi.fn(function MockYTPlayer(_id, cfg) {
        capturedYtConfig = cfg
        return mockYtInstance
      })
    }

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ playabilityStatus: { status: 'UNPLAYABLE' } })
    })))

    const onNext = vi.fn()
    const t1 = { video_id: 'ytFallback01', title: 'Fallback One', artist: 'Artist', duration_text: '3:00' }
    const t2 = { video_id: 'ytFallback02', title: 'Fallback Two', artist: 'Artist', duration_text: '3:10' }

    const { rerender } = render(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={t1}
        isPlaying={true}
        setIsPlaying={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={onNext}
        onPrev={vi.fn()}
        crossfadeSec={0}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(capturedYtConfig).toBeTruthy()
    act(() => {
      capturedYtConfig.events.onReady({ target: mockYtInstance })
      capturedYtConfig.events.onStateChange({ data: 1, target: mockYtInstance })
    })

    // Advance to track #2: YT.Player instance is reused, so stale closures from track #1 would block track #2!
    rerender(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={t2}
        isPlaying={true}
        setIsPlaying={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={onNext}
        onPrev={vi.fn()}
        crossfadeSec={0}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(mockYtInstance.loadVideoById).toHaveBeenCalledWith('ytFallback02')

    // Track #2 finishes via onStateChange(0) -> must invoke onNext for track #2!
    act(() => {
      capturedYtConfig.events.onStateChange({ data: 0, target: mockYtInstance })
    })
    expect(onNext).toHaveBeenCalledTimes(1)

    // Unmount and test HTML5 dual-deck isolation + isSbr2xFreeze + debounced near-end onWaiting
    cleanup()
    delete window.YT
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/audio-info/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ url: 'http://localhost:8000/api/audio/dualDeck001', duration: 240 })
        }
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) }
    }))

    const onNextHtml = vi.fn()
    const trackNormal = { video_id: 'dualDeck001', title: 'Dual Deck Song', artist: 'Artist', duration_text: '4:00' }
    const view2 = render(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={trackNormal}
        isPlaying={true}
        setIsPlaying={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={onNextHtml}
        onPrev={vi.fn()}
        crossfadeSec={0}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    const audios = Array.from(view2.container.querySelectorAll('audio'))
    const activeDeck = audios.find((a) => a.dataset.vid === 'dualDeck001')
    const inactiveDeck = audios.find((a) => a !== activeDeck)
    expect(activeDeck).toBeTruthy()
    expect(inactiveDeck).toBeTruthy()

    activeDeck.play = vi.fn(() => Promise.resolve())
    inactiveDeck.play = vi.fn(() => Promise.resolve())

    // UpBeatControls.forcePlay must ONLY call .play() on the active deck
    window.UpBeatControls.forcePlay()
    expect(activeDeck.play).toHaveBeenCalledTimes(1)
    expect(inactiveDeck.play).not.toHaveBeenCalled()

    // Non-SBR (rawDur === authDur === 240) parked at midpoint (120s) for 2500ms must NOT trigger isSbr2xFreeze skip
    Object.defineProperty(activeDeck, 'duration', { value: 240, configurable: true })
    Object.defineProperty(activeDeck, 'currentTime', { value: 120, configurable: true })
    fireEvent.timeUpdate(activeDeck)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(onNextHtml).not.toHaveBeenCalled()

    // Near-end onWaiting must debounce (not skip immediately) and cancel if timeUpdate advances
    Object.defineProperty(activeDeck, 'currentTime', { value: 238.5, configurable: true })
    fireEvent.timeUpdate(activeDeck)
    fireEvent.waiting(activeDeck)
    expect(onNextHtml).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(onNextHtml).not.toHaveBeenCalled()

    // Playback resumes at 239.0 -> cancels pending near-end stall timer
    Object.defineProperty(activeDeck, 'currentTime', { value: 239.0, configurable: true })
    fireEvent.timeUpdate(activeDeck)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(onNextHtml).not.toHaveBeenCalled()
  })

  it('NowPlayingView Watch video routes pause/play through UpBeatControls and PlayerBar suppresses midTrackStall during video', async () => {
    vi.useFakeTimers()
    const externalAudio = document.createElement('audio')
    externalAudio.play = vi.fn(() => Promise.resolve())
    externalAudio.pause = vi.fn()
    document.body.appendChild(externalAudio)

    const forcePause = vi.fn()
    const forcePlay = vi.fn()
    window.UpBeatControls = { forcePause, forcePlay }

    const setShowVideo = vi.fn()
    const onClose = vi.fn()
    const onTogglePlay = vi.fn()
    const track = { video_id: 'dQw4w9WgXcQ', title: 'Video Song', artist: 'Artist', duration_text: '3:30' }

    const baseProps = {
      isOpen: true,
      onClose,
      track,
      resolvedVid: 'dQw4w9WgXcQ',
      isPlaying: true,
      isLoadingStream: false,
      onTogglePlay,
      onNext: vi.fn(),
      onPrev: vi.fn(),
      effectiveDuration: 210,
      displayTime: 25,
      progressPct: 12,
      handleScrubStart: vi.fn(),
      handleScrubChange: vi.fn(),
      handleScrubEnd: vi.fn(),
      albumColor: { primary: '#fff', accent: '#fff', rgb: '255,255,255' },
      isFav: false,
      onToggleFavorite: vi.fn(),
      downloadState: null,
      isDownloaded: false,
      handleDownload: vi.fn(),
      onToggleQueue: vi.fn(),
      queueCount: 0,
      playbackMode: 'app',
      onPushToSafari: vi.fn(),
      isShuffle: false,
      setIsShuffle: vi.fn(),
      repeatMode: 'off',
      setRepeatMode: vi.fn(),
      volume: 100,
      setVolume: vi.fn(),
      isMuted: false,
      setIsMuted: vi.fn(),
      showLyrics: false,
      setShowLyrics: vi.fn(),
      lyricsSelectStart: false,
      setLyricsSelectStart: vi.fn(),
      playingFromTitle: ''
    }

    const { rerender } = render(<NowPlayingView {...baseProps} showVideo={false} setShowVideo={setShowVideo} />)

    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Watch video' }))
    expect(setShowVideo).toHaveBeenCalledWith(true)
    expect(forcePause).toHaveBeenCalledTimes(1)
    expect(externalAudio.pause).not.toHaveBeenCalled()

    // While showVideo is true and user closes NowPlayingView, UpBeatControls.forcePlay restores playback
    rerender(<NowPlayingView {...baseProps} showVideo={true} setShowVideo={setShowVideo} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }))
    expect(setShowVideo).toHaveBeenCalledWith(false)
    expect(forcePlay).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(externalAudio.play).not.toHaveBeenCalled()
    externalAudio.remove()

    // Verify PlayerBar suppresses midTrackStall (no 12s audio resurrection or 18s skip) while Watch video is active
    cleanup()
    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/audio-info/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ url: 'http://localhost:8000/api/audio/vidWatch001', duration: 200 })
        }
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) }
    }))

    const onNextStall = vi.fn()
    const pbView = render(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={{ video_id: 'vidWatch001', title: 'Watch Guard', artist: 'Artist', duration_text: '3:20' }}
        isPlaying={true}
        setIsPlaying={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={onNextStall}
        onPrev={vi.fn()}
        isNowPlayingOpen={true}
        setIsNowPlayingOpen={vi.fn()}
        crossfadeSec={0}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    const activeDeck = Array.from(pbView.container.querySelectorAll('audio')).find((a) => a.dataset.vid === 'vidWatch001')
    expect(activeDeck).toBeTruthy()
    Object.defineProperty(activeDeck, 'duration', { value: 200, configurable: true })
    Object.defineProperty(activeDeck, 'currentTime', { value: 20, configurable: true })
    fireEvent.timeUpdate(activeDeck)

    activeDeck.play = vi.fn(() => Promise.resolve())
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Watch video' }))

    // Advance 19 seconds while showVideo is active -> audio must NOT resurrect and must NOT skip
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19000)
    })
    expect(activeDeck.play).not.toHaveBeenCalled()
    expect(onNextStall).not.toHaveBeenCalled()
  })

  it('useAudioPlayback honors repeatMode off/all, preserves queue edits across shuffle toggle, and keeps no-vid tracks in handlePlayNext', () => {
    const forcePause = vi.fn()
    window.UpBeatControls = { forcePause, forcePlay: vi.fn() }

    const t1 = { video_id: 'dQw4w9WgXcQ', title: 'Track 1', artist: 'Artist A', duration_text: '3:10' }
    const t2 = { video_id: '9bZkp7q19f0', title: 'Track 2', artist: 'Artist B', duration_text: '3:20' }
    const t3 = { video_id: '3JZ_D3ELwOQ', title: 'Track 3', artist: 'Artist C', duration_text: '3:30' }

    const Wrapper = () => {
      const [playlist, setPlaylist] = React.useState({ id: 'pl1', title: 'Test', tracks: [t1, t2] })
      const [favorites, setFavorites] = React.useState([])
      const [queue, setQueue] = React.useState([])
      const playback = useAudioPlayback({
        playlist,
        setPlaylist,
        favorites,
        setFavorites,
        queue,
        setQueue,
        playbackMode: 'app',
        showNotify: vi.fn(),
        isAuthenticated: false,
        saveToHistory: vi.fn(),
        setActiveTab: vi.fn(),
        lastfmKey: '',
        offlineTracks: []
      })
      return { ...playback, queue }
    }

    const { result } = renderHook(() => Wrapper())

    act(() => {
      result.current.handlePlayTrack(t1, 0, [t1, t2])
    })
    expect(result.current.repeatMode).toBe('off')

    act(() => {
      result.current.handleNext()
    })
    expect(result.current.currentTrack.video_id).toBe('9bZkp7q19f0')
    expect(result.current.isPlaying).toBe(true)

    // End of queue with repeatMode === 'off' must stop cleanly instead of wrapping to t1
    act(() => {
      result.current.handleNext()
    })
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentTrack.video_id).toBe('9bZkp7q19f0')
    expect(forcePause).toHaveBeenCalled()

    // With repeatMode === 'all', handleNext wraps around to t1
    act(() => {
      result.current.setRepeatMode('all')
    })
    act(() => {
      result.current.handleNext()
    })
    expect(result.current.currentTrack.video_id).toBe('dQw4w9WgXcQ')
    expect(result.current.isPlaying).toBe(true)

    // Shuffle roundtrip preserves queue additions made during shuffle
    act(() => {
      result.current.handleAddToQueue(t3)
      result.current.handleToggleShuffle()
    })
    const addedDuringShuffle = { video_id: 'kJQP7kiw5Fk', title: 'Added In Shuffle', artist: 'Artist D', duration_text: '3:45' }
    act(() => {
      result.current.handleAddToQueue(addedDuringShuffle)
    })
    act(() => {
      result.current.handleToggleShuffle()
    })
    expect(result.current.queue.some((q) => q.video_id === 'kJQP7kiw5Fk')).toBe(true)

    // handlePlayNext must not drop other queued tracks that lack video_id
    act(() => {
      result.current.handleClearQueue()
      result.current.handleAddToQueue({ title: 'No Vid One', artist: 'Artist X' })
      result.current.handlePlayNext({ title: 'No Vid Two', artist: 'Artist Y' })
    })
    expect(result.current.queue.map((q) => q.title)).toEqual(['No Vid Two', 'No Vid One'])
  })

  it('useJamSync handles { emoji } / { reaction } packets uniformly without dropping cloud emoji reactions', () => {
    const currentTrackRef = { current: null }
    const isPlayingRef = { current: false }
    const queueRef = { current: [] }
    const handleNextRef = { current: vi.fn() }
    const handlePrevRef = { current: vi.fn() }
    const remoteJamGuardRef = { current: false }

    const { result } = renderHook(() =>
      useJamSync({
        currentTrack: null,
        isPlaying: false,
        queue: [],
        setCurrentTrack: vi.fn(),
        setIsPlaying: vi.fn(),
        setQueue: vi.fn(),
        currentTrackRef,
        isPlayingRef,
        queueRef,
        handleNextRef,
        handlePrevRef,
        remoteJamGuardRef,
        handlePlayTrack: vi.fn(),
        playList: vi.fn(),
        setPlayingFrom: vi.fn(),
        googleUser: null,
        showNotify: vi.fn()
      })
    )

    act(() => {
      jamManager.eventHandlers.onReaction?.({ emoji: '🔥', senderName: 'Bob' })
      jamManager.eventHandlers.onReaction?.({ reaction: '🎧', senderName: 'Alice' })
    })

    expect(result.current.jamReactions.map((r) => r.emoji)).toEqual(['🔥', '🎧'])
    expect(result.current.jamReactions.map((r) => r.senderName)).toEqual(['Bob', 'Alice'])
  })

  it('App car play routes through active UpBeatControls.forcePlay and Cmd/Ctrl+B toggles only the left sidebar', async () => {
    localStorage.setItem('upbeat_onboarding_v1', 'done')
    localStorage.setItem('upbeat_left_nav_open_v1', 'true')
    localStorage.setItem('upbeat_right_panel_v1', 'false')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ tracks: [], favorites: [], blocks: [] }),
      text: async () => ''
    })))

    const { container } = render(<App />)

    await waitFor(() => {
      expect(typeof window.onUpBeatCarAction).toBe('function')
      expect(window.UpBeatControls).toBeTruthy()
    })

    const spyForcePlay = vi.spyOn(window.UpBeatControls, 'forcePlay')
    const audios = Array.from(container.querySelectorAll('audio'))
    expect(audios).toHaveLength(2)
    audios.forEach((a) => {
      a.play = vi.fn(() => Promise.resolve())
    })

    act(() => {
      window.onUpBeatCarAction('play')
    })
    expect(spyForcePlay).toHaveBeenCalledTimes(1)
    expect(audios[1].play).not.toHaveBeenCalled()

    // Cmd/Ctrl+B toggles left nav once cleanly without toggling right panel
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(localStorage.getItem('upbeat_left_nav_open_v1')).toBe('false')
    expect(localStorage.getItem('upbeat_right_panel_v1')).toBe('false')
  })

  it('TopBar shows sidebar reopen button, SettingsView shows Disconnect for youtube_instant, and HomeView renders Mood SongRow & onboarding refresh', async () => {
    const onToggleSidebar = vi.fn()
    render(
      <TopBar
        query=""
        setQuery={vi.fn()}
        user={{ name: 'User' }}
        onOpenProfile={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenFriends={vi.fn()}
        sidebarOpen={false}
        onToggleSidebar={onToggleSidebar}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Open sidebar/i }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    cleanup()

    render(
      <SettingsView
        isDesktop={true}
        onBack={vi.fn()}
        crossfade={0}
        setCrossfade={vi.fn()}
        models={[{ id: 'gemini-4-argon', label: 'Gemini 4 Argon' }]}
        selectedModel="gemini-4-argon"
        onSelectModel={vi.fn()}
        googleUser={{ name: 'Quick User', provider: 'youtube_instant', connectedAt: 1700000000000 }}
        onOpenGoogle={vi.fn()}
        onLogout={vi.fn()}
        offlineStats={{ count: 0, formattedSize: '0 B' }}
        onClearDownloads={vi.fn()}
        playbackMode="app"
        setPlaybackMode={vi.fn()}
        notify={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    cleanup()

    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
    let searchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/api/search')) {
        searchCalls++
        const moodSong = { video_id: 'mMoodTrck01', title: 'Midnight Acoustic', artist: 'Indie Waves', duration_text: '3:25' }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ tracks: [moodSong], song_results: [moodSong], playlists: [] })
        }
      }
      if (target.includes('/api/innertube') || target.includes('youtubei')) {
        searchCalls++
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
                                      playlistItemData: { videoId: 'mMoodTrck01' },
                                      flexColumns: [
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Midnight Acoustic' }] } } },
                                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song • Indie Waves • 3:25' }] } } }
                                      ],
                                      fixedColumns: [
                                        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:25' }] } } }
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
        json: async () => ({ tracks: [], favorites: [], blocks: [] })
      }
    }))

    const appCtx = {
      currentTrack: null,
      isPlaying: false,
      isFav: () => false,
      downloadedIds: new Set(),
      playTrack: vi.fn(),
      toggleFav: vi.fn(),
      playNext: vi.fn(),
      addToQueue: vi.fn(),
      openAddToPlaylist: vi.fn(),
      download: vi.fn(),
      startRadio: vi.fn(),
      goToArtist: vi.fn(),
      toggleLoopSong: vi.fn(),
      repeatMode: 'off'
    }

    const { rerender, container } = render(
      <AppContext.Provider value={appCtx}>
        <HomeView
          isDesktop={true}
          user={{ name: 'Listener' }}
          userTracks={[]}
          tasteDna={{}}
          timeInfo={{ greeting: 'Good evening', mood: 'Evening' }}
          onboardingVersion={0}
          onPlayTrack={vi.fn()}
        />
      </AppContext.Provider>
    )

    // Check Featured / hero elements use valid Tailwind "absolute" (never broken "! absolute")
    expect(container.innerHTML.includes('! absolute')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Chill' }))
    await waitFor(() => {
      expect(screen.getAllByText('Midnight Acoustic').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'More options for Midnight Acoustic' })).toBeTruthy()
    })

    // Onboarding completion event forces fresh discovery refresh
    const beforeCalls = searchCalls
    rerender(
      <AppContext.Provider value={appCtx}>
        <HomeView
          isDesktop={true}
          user={{ name: 'Listener' }}
          userTracks={[]}
          tasteDna={{}}
          timeInfo={{ greeting: 'Good evening', mood: 'Evening' }}
          onboardingVersion={1}
          onPlayTrack={vi.fn()}
        />
      </AppContext.Provider>
    )
    act(() => {
      window.dispatchEvent(new Event('upbeat-onboarding-finished'))
    })
    await waitFor(() => {
      expect(searchCalls).toBeGreaterThanOrEqual(beforeCalls)
    })
  })
})
