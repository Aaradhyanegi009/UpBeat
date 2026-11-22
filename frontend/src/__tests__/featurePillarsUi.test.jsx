import React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, act, waitFor, cleanup, fireEvent, screen, within } from '@testing-library/react'

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

import App from '../App'
import CreateView, { REFINEMENTS } from '../views/CreateView'
import CollectionView from '../views/CollectionView'
import SettingsView from '../views/SettingsView'
import LibraryView from '../views/LibraryView'
import HomeView from '../views/HomeView'
import QueueDrawer from '../components/QueueDrawer'
import NowPlayingView from '../components/NowPlayingView'
import JamModal from '../components/JamModal'
import PlayerBar from '../components/PlayerBar'
import ProfileEditModal from '../components/ProfileEditModal'
import ShortcutModal from '../components/ShortcutModal'
import SonicDnaView from '../components/SonicDnaView'
import { TopBar } from '../ui/Shell'
import { RightPanel } from '../ui/Panels'
import { AppContext } from '../ui/AppContext'
import { jamManager } from '../jamEngine'
import * as standaloneApi from '../standaloneApi'
import * as offlineStorage from '../offlineStorage'

const origMediaPlay = HTMLMediaElement.prototype.play
const origMediaPause = HTMLMediaElement.prototype.pause
const origMediaLoad = HTMLMediaElement.prototype.load

describe('All 6 Feature Pillars UI & Integration', () => {
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
    window.location.hash = '#/'
    delete window.UpBeatControls
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()

    window.matchMedia = () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {}
    })
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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ tracks: [], favorites: [], blocks: [] }),
      text: async () => ''
    })))
  })

  afterEach(() => {
    jamManager.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    cleanup()
  })

  it('CreateView refinement chips append/refine prompt without wiping user text', () => {
    function ControlledCreate() {
      const [prompt, setPrompt] = React.useState('rainy drive')
      return (
        <CreateView
          isDesktop={true}
          prompt={prompt}
          setPrompt={setPrompt}
          energy={60}
          setEnergy={vi.fn()}
          discovery={50}
          setDiscovery={vi.fn()}
          length={20}
          setLength={vi.fn()}
          seed={null}
          setSeed={vi.fn()}
          onMake={vi.fn()}
        />
      )
    }

    render(<ControlledCreate />)
    const textarea = screen.getByLabelText(/describe the music you want/i)
    expect(textarea.value).toBe('rainy drive')

    for (const label of REFINEMENTS) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('button', { name: '90s acoustic' }))
    expect(textarea.value).toBe('rainy drive, 90s acoustic')

    fireEvent.click(screen.getByRole('button', { name: 'Deep cuts' }))
    expect(textarea.value).toBe('rainy drive, 90s acoustic, Deep cuts')

    // Tapping again removes that refinement while preserving original text
    fireEvent.click(screen.getByRole('button', { name: '90s acoustic' }))
    expect(textarea.value).toBe('rainy drive, Deep cuts')
  })

  it('App tracks multi-stage curationStage ("Curating with AI…" -> "Resolving tracks…") and verified model labels', async () => {
    localStorage.setItem('upbeat_onboarded_v1', '1')
    localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['in']))
    localStorage.setItem('upbeat_gemini_api_key', 'AIzaTestKey123')

    let resolveCuration
    const curateSpy = vi.spyOn(standaloneApi, 'curateStandalone').mockImplementation(async ({ onProgress }) => {
      onProgress?.('curating')
      await new Promise((r) => { resolveCuration = r })
      onProgress?.('resolving')
      await new Promise((r) => setTimeout(r, 20))
      return {
        playlist_title: 'Staged Mix',
        subtitle: 'Multi-stage test',
        tracks: [
          { video_id: 'dQw4w9WgXcQ', title: 'Staged Song', artist: 'Artist One', duration_text: '3:32' }
        ]
      }
    })

    // First verify SettingsView lists verified model labels when opening Advanced
    window.location.hash = '#/settings'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /advanced/i }))
    const modelSelect = await screen.findByLabelText(/model/i)
    const optionTexts = Array.from(modelSelect.querySelectorAll('option')).map((o) => o.textContent)
    expect(optionTexts).toContain('Gemini 2.5 Flash Lite (⚡ Fastest)')
    expect(optionTexts).toContain('Gemini 2.5 Flash Lite')
    expect(optionTexts).toContain('Gemini Flash Lite Latest')
    expect(optionTexts).toContain('Gemini 2.5 Flash')
    expect(optionTexts).toContain('Gemini 2.0 Flash')
    cleanup()

    // Now test multi-stage curation progress in CollectionView
    window.location.hash = '#/create'
    render(<App />)
    const textarea = await screen.findByLabelText(/describe the music you want/i)
    fireEvent.change(textarea, { target: { value: 'night synthwave' } })
    fireEvent.click(screen.getByRole('button', { name: /make my mix/i }))

    await waitFor(() => {
      expect(screen.getByText('Curating with AI…')).toBeTruthy()
    })

    await act(async () => {
      resolveCuration?.()
    })

    await waitFor(() => {
      expect(screen.getByText('Resolving tracks…')).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getAllByText('Staged Mix').length).toBeGreaterThan(0)
    })
    expect(curateSpy).toHaveBeenCalled()
  })

  it('App shows "Curating with Mac companion…" while companion fetch is in flight', async () => {
    localStorage.setItem('upbeat_onboarded_v1', '1')
    localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['in']))
    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')

    let resolveCompanion
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('/api/curate')) {
        return new Promise((resolve) => {
          resolveCompanion = () => resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              playlist_title: 'Companion Mix',
              tracks: [{ video_id: 'dQw4w9WgXcQ', title: 'Track C', artist: 'Artist C', duration_text: '3:10' }]
            })
          })
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ tracks: [], favorites: [], blocks: [] }),
        text: async () => ''
      })
    }))

    window.location.hash = '#/create'
    render(<App />)
    fireEvent.change(await screen.findByLabelText(/describe the music you want/i), { target: { value: 'companion test' } })
    fireEvent.click(screen.getByRole('button', { name: /make my mix/i }))

    await waitFor(() => {
      expect(screen.getByText('Curating with Mac companion…')).toBeTruthy()
    })

    await act(async () => {
      resolveCompanion?.()
    })

    await waitFor(() => {
      expect(screen.getAllByText('Companion Mix').length).toBeGreaterThan(0)
    })
  })

  it('QueueDrawer & RightPanel wire Autoplay toggle, Save queue as playlist, drag reorder & Move Up/Down', () => {
    const t1 = { video_id: 'vidQueue0001', title: 'First Queued', artist: 'Artist 1', duration_text: '3:00' }
    const t2 = { video_id: 'vidQueue0002', title: 'Second Queued', artist: 'Artist 2', duration_text: '3:15' }
    const tNow = { video_id: 'vidNow00001', title: 'Current Track', artist: 'Artist 0', duration_text: '3:30' }

    const onToggleAutoplay = vi.fn()
    const onSaveQueue = vi.fn()
    const onReorderQueue = vi.fn()

    render(
      <QueueDrawer
        isOpen={true}
        onClose={vi.fn()}
        queue={[t1, t2]}
        currentTrack={tNow}
        isPlaying={true}
        onPlayTrack={vi.fn()}
        onRemoveFromQueue={vi.fn()}
        onClearQueue={vi.fn()}
        onAddToQueue={vi.fn()}
        onReorderQueue={onReorderQueue}
        autoplay={false}
        onToggleAutoplay={onToggleAutoplay}
        onSaveQueue={onSaveQueue}
        upcomingTracks={[]}
      />
    )

    // Autoplay switch
    const autoplaySwitch = screen.getByRole('switch', { name: /autoplay radio/i })
    expect(autoplaySwitch.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(autoplaySwitch)
    expect(onToggleAutoplay).toHaveBeenCalledTimes(1)

    // Save queue as playlist button
    fireEvent.click(screen.getByRole('button', { name: /save queue as playlist/i }))
    expect(onSaveQueue).toHaveBeenCalledTimes(1)

    // Accessible Move Up / Move Down buttons
    fireEvent.click(screen.getByRole('button', { name: 'Move First Queued down' }))
    expect(onReorderQueue).toHaveBeenCalledWith(0, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Move Second Queued up' }))
    expect(onReorderQueue).toHaveBeenCalledWith(1, 0)

    // Drag-to-reorder
    const row0 = screen.getByText('First Queued').closest('[draggable="true"]')
    const row1 = screen.getByText('Second Queued').closest('[draggable="true"]')
    expect(row0).toBeTruthy()
    expect(row1).toBeTruthy()
    const dataTransfer = { data: {}, setData(k, v) { this.data[k] = v }, getData(k) { return this.data[k] } }
    fireEvent.dragStart(row0, { dataTransfer })
    fireEvent.dragOver(row1, { dataTransfer })
    fireEvent.drop(row1, { dataTransfer })
    expect(onReorderQueue).toHaveBeenCalledWith(0, 1)

    cleanup()

    // Also verify RightPanel Up Next tab
    const appCtx = {
      currentTrack: tNow,
      isPlaying: true,
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
    const rpToggleAutoplay = vi.fn()
    const rpSaveQueue = vi.fn()
    const rpReorder = vi.fn()

    render(
      <AppContext.Provider value={appCtx}>
        <RightPanel
          track={tNow}
          upNext={[t1, t2]}
          queueCount={2}
          friends={[]}
          tab="next"
          setTab={vi.fn()}
          isFav={false}
          onToggleFav={vi.fn()}
          onClose={vi.fn()}
          autoplay={true}
          onToggleAutoplay={rpToggleAutoplay}
          onSaveQueue={rpSaveQueue}
          onReorderQueue={rpReorder}
        />
      </AppContext.Provider>
    )

    fireEvent.click(screen.getByRole('switch', { name: /autoplay radio/i }))
    expect(rpToggleAutoplay).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /save queue as playlist/i }))
    expect(rpSaveQueue).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move First Queued down' }))
    expect(rpReorder).toHaveBeenCalledWith(0, 1)
  })

  it('PlayerBar keeps standby audio deck unloaded during active playback (v7.6.2 single-stream architecture) and prewarms metadata at cur > 5s', async () => {
    vi.useFakeTimers()
    localStorage.setItem('upbeat_server_url', 'http://localhost:8000')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const s = String(url)
      if (s.includes('/api/audio-info/trackAAA001')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ url: 'http://localhost:8000/api/audio/trackAAA001', duration: 200 })
        }
      }
      if (s.includes('/api/audio-info/trackBBB002')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ url: 'http://localhost:8000/api/audio/trackBBB002', duration: 190 })
        }
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) }
    }))

    const playTargets = []
    HTMLMediaElement.prototype.play = vi.fn(function () {
      playTargets.push({ vid: this.dataset.vid || '' })
      return Promise.resolve()
    })

    const pruneSpy = vi.spyOn(offlineStorage, 'pruneIdleAudioUrls')
    const prewarmSpy = vi.spyOn(standaloneApi, 'prewarmTrack')

    const t1 = { video_id: 'trackAAA001', title: 'Track A', artist: 'Artist A', duration_text: '3:20' }
    const t2 = { video_id: 'trackBBB002', title: 'Track B', artist: 'Artist B', duration_text: '3:10' }

    const { container } = render(
      <PlayerBar
        isDesktop={true}
        playbackMode="app"
        currentTrack={t1}
        upNextTrack={t2}
        isPlaying={true}
        setIsPlaying={vi.fn()}
        onTogglePlay={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        crossfadeSec={0}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(pruneSpy).toHaveBeenCalledWith(['trackAAA001', 'trackBBB002'])

    const audios = Array.from(container.querySelectorAll('audio'))
    const activeDeck = audios.find((a) => a.dataset.vid === 'trackAAA001')
    const standbyDeck = audios.find((a) => a !== activeDeck)
    expect(activeDeck).toBeTruthy()
    expect(standbyDeck).toBeTruthy()
    // Standby deck must NOT open a concurrent /api/audio/ stream while active deck is playing
    expect(standbyDeck.getAttribute('src')).toBeFalsy()
    expect(playTargets.every((p) => p.vid === 'trackAAA001')).toBe(true)

    // Once active deck progresses past 5s, upNextTrack metadata is prewarmed without loading standby deck
    Object.defineProperty(activeDeck, 'currentTime', { value: 6, configurable: true })
    fireEvent.timeUpdate(activeDeck)
    expect(prewarmSpy).toHaveBeenCalledWith(t2)
    expect(standbyDeck.getAttribute('src')).toBeFalsy()
  })

  it('NowPlayingView preserves Watch video &start= timestamp without reloading on tick and renders Jam reactions', () => {
    window.UpBeatControls = {
      forcePause: vi.fn(),
      forcePlay: vi.fn(),
      getCurrentTime: vi.fn(() => 47.8)
    }
    const sendReactionSpy = vi.spyOn(jamManager, 'sendReaction').mockImplementation(() => {})

    function Wrapper({ displayTime, reactions }) {
      const [showVideo, setShowVideo] = React.useState(false)
      return (
        <NowPlayingView
          isOpen={true}
          onClose={vi.fn()}
          track={{ video_id: 'dQw4w9WgXcQ', title: 'Sync Song', artist: 'Artist', duration_text: '3:30' }}
          resolvedVid="dQw4w9WgXcQ"
          isPlaying={true}
          isLoadingStream={false}
          onTogglePlay={vi.fn()}
          onNext={vi.fn()}
          onPrev={vi.fn()}
          effectiveDuration={210}
          displayTime={displayTime}
          progressPct={20}
          handleScrubStart={vi.fn()}
          handleScrubChange={vi.fn()}
          handleScrubEnd={vi.fn()}
          albumColor={{ primary: '#fff', accent: '#fff', rgb: '255,255,255' }}
          showVideo={showVideo}
          setShowVideo={setShowVideo}
          jamActive={true}
          jamReactions={reactions}
        />
      )
    }

    const reactions = [{ id: 'rx_1', emoji: '🔥', senderName: 'Maya', xOffset: 42 }]
    const { rerender } = render(<Wrapper displayTime={47} reactions={reactions} />)

    // Verify floating reaction bubble + reaction bar
    expect(screen.getByText('Maya')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'React 💜' }))
    expect(sendReactionSpy).toHaveBeenCalledWith('💜')

    // Toggle Watch video ON
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Watch video' }))

    const iframe = screen.getByTitle('Sync Song')
    expect(iframe.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(iframe.getAttribute('src')).toContain('&start=47')

    // Subsequent displayTime ticks must NOT change iframe src
    window.UpBeatControls.getCurrentTime.mockReturnValue(55)
    rerender(<Wrapper displayTime={55} reactions={reactions} />)
    expect(screen.getByTitle('Sync Song').getAttribute('src')).toContain('&start=47')
  })

  it('JamModal renders offline SVG QR (zero api.qrserver.com), Sync Health, Resync now, and live reaction feed', () => {
    const resyncSpy = vi.spyOn(jamManager, 'resyncNow').mockReturnValue(true)
    const reactSpy = vi.spyOn(jamManager, 'sendReaction').mockImplementation(() => {})
    const onNotify = vi.fn()

    const jamState = {
      active: true,
      isHost: false,
      role: 'guest',
      roomCode: 'JAM-4821',
      status: 'CONNECTED',
      djMode: 'open_party',
      hostName: 'Alex',
      rttMs: 24,
      syncDeltaMs: 12,
      syncTier: 'LOCKED',
      userProfile: { name: 'Me', friendCode: 'UP-123456' },
      participants: [{ id: 'p1', name: 'Alex', isHost: true }],
      friends: [],
      incomingRequests: [],
      outgoingRequests: []
    }

    const { container } = render(
      <JamModal
        isOpen={true}
        onClose={vi.fn()}
        jamState={jamState}
        jamReactions={[{ id: 'r1', emoji: '🎧', senderName: 'Alex' }]}
        googleUser={{ name: 'Me' }}
        currentTrack={{ video_id: 'dQw4w9WgXcQ', title: 'Jam Track', artist: 'Artist' }}
        onNotify={onNotify}
      />
    )

    // Sync health metrics + Resync now
    expect(screen.getByText('LOCKED')).toBeTruthy()
    expect(screen.getByText(/Latency 24 ms/i)).toBeTruthy()
    expect(screen.getByText(/Drift 12 ms/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /resync now/i }))
    expect(resyncSpy).toHaveBeenCalledTimes(1)

    // Reaction bar + feed strip
    expect(screen.getAllByText('Alex').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: 'React 🔥' }))
    expect(reactSpy).toHaveBeenCalledWith('🔥')

    // Offline SVG QR for Room
    fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
    const roomQr = screen.getByAltText(/QR code to join room JAM-4821/i)
    expect(roomQr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(container.innerHTML).not.toContain('api.qrserver.com')

    // Offline SVG QR for Friend
    fireEvent.click(screen.getByRole('tab', { name: /friends/i }))
    fireEvent.click(screen.getByRole('button', { name: /^QR$/i }))
    const friendQr = screen.getByAltText(/QR code to add you as a friend/i)
    expect(friendQr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(container.innerHTML).not.toContain('api.qrserver.com')

    // Host mode (isHost: true) renders <Switch> without crashing and supports DJ toggle, Resync, and reactions
    cleanup()
    const setDjSpy = vi.spyOn(jamManager, 'setDjMode').mockImplementation(() => {})
    const hostJamState = {
      ...jamState,
      isHost: true,
      role: 'host',
      djMode: 'open_party',
      participants: [{ id: 'host1', name: 'Me', isHost: true }]
    }
    const { container: hostContainer } = render(
      <JamModal
        isOpen={true}
        onClose={vi.fn()}
        jamState={hostJamState}
        jamReactions={[]}
        googleUser={{ name: 'Me' }}
        currentTrack={{ video_id: 'dQw4w9WgXcQ', title: 'Host Track', artist: 'Artist' }}
        onNotify={onNotify}
      />
    )
    const controlSwitch = screen.getByRole('switch', { name: /everyone can control playback/i })
    expect(controlSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(controlSwitch)
    expect(setDjSpy).toHaveBeenCalledWith('host_only')

    fireEvent.click(screen.getByRole('button', { name: /resync now/i }))
    expect(resyncSpy).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'React 🎧' }))
    expect(reactSpy).toHaveBeenCalledWith('🎧')
    expect(hostContainer.innerHTML).not.toContain('api.qrserver.com')
  })

  it('CollectionView shows per-track progress & Cancel download button, and SettingsView renders Offline mode switch', () => {
    const onCancelDownload = vi.fn()
    const collection = {
      id: 'col_1',
      kind: 'playlist',
      title: 'Offline Ready Mix',
      tracks: [
        { video_id: 'dlTrack0001', title: 'Downloading Song', artist: 'Artist A', duration_text: '3:05' },
        { video_id: 'dlTrack0002', title: 'Queued Song', artist: 'Artist B', duration_text: '3:15' }
      ]
    }
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

    render(
      <AppContext.Provider value={appCtx}>
        <CollectionView
          collection={collection}
          isDesktop={true}
          onPlay={vi.fn()}
          onDownloadAll={vi.fn()}
          onCancelDownload={onCancelDownload}
          downloadState={{ busy: true, done: 1, total: 2, allDone: false }}
          downloadProgress={{ dlTrack0001: 64 }}
          onBack={vi.fn()}
        />
      </AppContext.Provider>
    )

    expect(screen.getByText('64%')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /cancel download/i }))
    expect(onCancelDownload).toHaveBeenCalledTimes(1)

    cleanup()

    const onToggleOfflineMode = vi.fn()
    render(
      <SettingsView
        isDesktop={true}
        onBack={vi.fn()}
        crossfade={5}
        setCrossfade={vi.fn()}
        models={[{ id: 'gemini-4-argon', name: 'Gemini 2.5 Flash Lite (⚡ Fastest)' }]}
        selectedModel="gemini-4-argon"
        googleUser={null}
        onOpenGoogle={vi.fn()}
        onLogout={vi.fn()}
        offlineStats={{ count: 3, formattedSize: '12.0 MB' }}
        offlineMode={true}
        onToggleOfflineMode={onToggleOfflineMode}
        onClearDownloads={vi.fn()}
        playbackMode="app"
        notify={vi.fn()}
      />
    )

    const offlineSwitch = screen.getByRole('switch', { name: /offline mode/i })
    expect(offlineSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(offlineSwitch)
    expect(onToggleOfflineMode).toHaveBeenCalledTimes(1)
  })

  it('ShortcutModal, App keyboard shortcuts (?, ArrowLeft/ArrowRight, M, N, P, Cmd+\\), and TopBar panel reopen controls work cleanly', async () => {
    localStorage.setItem('upbeat_onboarded_v1', '1')
    localStorage.setItem('upbeat_chart_prefs_v1', JSON.stringify(['in']))
    localStorage.setItem('upbeat_left_nav_open_v1', 'true')
    localStorage.setItem('upbeat_right_panel_v1', 'true')
    localStorage.setItem(
      'argon_playlist_v2',
      JSON.stringify({
        id: 'pl_keys',
        title: 'Keyboard Mix',
        tracks: [
          {
            video_id: 'keyVid00001',
            title: 'Track Alpha',
            artist: 'Artist One',
            duration_text: '3:12',
            thumbnail: 'https://i.ytimg.com/vi/keyVid00001/hqdefault.jpg'
          },
          {
            video_id: 'keyVid00002',
            title: 'Track Beta',
            artist: 'Artist Two',
            duration_text: '3:25',
            thumbnail: 'https://i.ytimg.com/vi/keyVid00002/hqdefault.jpg'
          }
        ]
      })
    )

    render(<App />)

    await waitFor(() => {
      expect(window.UpBeatControls).toBeTruthy()
      expect(screen.getAllByText('Track Alpha').length).toBeGreaterThan(0)
    })

    const seekBySpy = vi.spyOn(window.UpBeatControls, 'seekBy')
    const toggleMuteSpy = vi.spyOn(window.UpBeatControls, 'toggleMute')

    // ? opens ShortcutModal
    fireEvent.keyDown(window, { key: '?' })
    const dialog = await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByText(/Play \/ Pause/i)).toBeTruthy()
    expect(within(dialog).getByText(/Seek backward \/ forward 10s/i)).toBeTruthy()
    expect(within(dialog).getByText(/Mute \/ Unmute/i)).toBeTruthy()
    expect(within(dialog).getByText(/Toggle right panel/i)).toBeTruthy()

    // Escape closes ShortcutModal
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
    })

    // ArrowRight / ArrowLeft seek +-10s
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(seekBySpy).toHaveBeenCalledWith(10)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(seekBySpy).toHaveBeenCalledWith(-10)

    // M toggles mute
    fireEvent.keyDown(window, { key: 'm' })
    expect(toggleMuteSpy).toHaveBeenCalledTimes(1)

    // N advances to Track Beta, P goes back to Track Alpha
    fireEvent.keyDown(window, { key: 'n' })
    await waitFor(() => {
      expect(screen.getAllByText('Track Beta').length).toBeGreaterThan(0)
    })
    fireEvent.keyDown(window, { key: 'p' })
    await waitFor(() => {
      expect(screen.getAllByText('Track Alpha').length).toBeGreaterThan(0)
    })

    // L toggles loop song, S toggles shuffle
    fireEvent.keyDown(window, { key: 'l' })
    expect(localStorage.getItem('upbeat_repeat_mode')).toBe('one')
    fireEvent.keyDown(window, { key: 'l' })
    expect(localStorage.getItem('upbeat_repeat_mode')).toBe('off')

    // Shortcuts MUST be ignored when focused in input / textarea / contentEditable
    const searchInput = screen.getByPlaceholderText(/search, or describe a vibe/i)
    fireEvent.keyDown(searchInput, { key: '?' })
    fireEvent.keyDown(searchInput, { key: 'm' })
    fireEvent.keyDown(searchInput, { key: 'ArrowRight' })

    const tempTextarea = document.createElement('textarea')
    const tempEditable = document.createElement('div')
    tempEditable.setAttribute('contenteditable', 'true')
    document.body.appendChild(tempTextarea)
    document.body.appendChild(tempEditable)
    fireEvent.keyDown(tempTextarea, { key: '?' })
    fireEvent.keyDown(tempTextarea, { key: 'm' })
    fireEvent.keyDown(tempEditable, { key: '?' })
    fireEvent.keyDown(tempEditable, { key: 'm' })
    tempTextarea.remove()
    tempEditable.remove()

    expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
    expect(toggleMuteSpy).toHaveBeenCalledTimes(1)
    expect(seekBySpy).toHaveBeenCalledTimes(2)

    // S toggles shuffle
    expect(screen.getByRole('button', { name: 'Shuffle off' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 's' })
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toBeTruthy()

    // Cmd/Ctrl+\ toggles right panel only (leaving left nav open)
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(localStorage.getItem('upbeat_right_panel_v1')).toBe('false')
    expect(localStorage.getItem('upbeat_left_nav_open_v1')).toBe('true')

    // TopBar shows reopen button for collapsed right panel & collapsed left sidebar
    cleanup()
    const onToggleSidebar = vi.fn()
    const onToggleRightPanel = vi.fn()
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
        rightPanelOpen={false}
        onToggleRightPanel={onToggleRightPanel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /open sidebar/i }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /open right panel/i }))
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1)
  })

  it('LibraryView, ProfileEditModal, and HomeView expose /you Sonic DNA navigation and rerollDiscoveryBlock', async () => {
    window.location.hash = '#/'
    render(
      <LibraryView
        isDesktop={true}
        favorites={[]}
        offlineTracks={[]}
        saved={[]}
        history={[]}
        downloadedIds={new Set()}
        onOpenSaved={vi.fn()}
        onOpenLiked={vi.fn()}
        onOpenDownloads={vi.fn()}
        onNewPlaylist={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /your sonic dna/i }))
    expect(window.location.hash).toBe('#/you')
    cleanup()

    window.location.hash = '#/'
    const onCloseProfile = vi.fn()
    render(
      <ProfileEditModal
        isOpen={true}
        onClose={onCloseProfile}
        user={{ name: 'Listener' }}
        onSave={vi.fn()}
        onNotify={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /your sonic dna/i }))
    expect(onCloseProfile).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/you')
    cleanup()

    // SonicDnaView renders cleanly for dna & library modes (dead favorites branch removed)
    render(<SonicDnaView mode="dna" favorites={[]} extractedTracks={[]} />)
    expect(screen.getByText('Your taste')).toBeTruthy()
    cleanup()

    // HomeView Taste DNA pill & Tier-2 rerollDiscoveryBlock
    const rerollSpy = vi.spyOn(standaloneApi, 'rerollDiscoveryBlock').mockResolvedValue({
      id: 'block_chill_late_night',
      tier: 2,
      title: 'Rerolled Chill Mix',
      subtitle: 'Freshly rerolled vibes',
      badge: 'CHILL MIX',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    })

    window.location.hash = '#/'
    render(
      <HomeView
        isDesktop={true}
        user={{ name: 'Listener' }}
        userTracks={[]}
        tasteDna={{}}
        timeInfo={{ greeting: 'Good evening', mood: 'Evening' }}
        onboardingVersion={0}
        onPlayTrack={vi.fn()}
      />
    )

    const refreshBtn = await screen.findByRole('button', { name: /refresh chill & late night vibes/i })
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(rerollSpy).toHaveBeenCalledWith('block_chill_late_night', expect.any(Object))
      expect(screen.getAllByText('Rerolled Chill Mix').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /taste dna/i }))
    expect(window.location.hash).toBe('#/you')
  })
})
