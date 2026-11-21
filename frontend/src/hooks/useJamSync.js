/**
 * Live Jam session synchronization, deep-link routing, remote playback control guards, and friends actions.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  jamManager,
  evaluateAudioDrift,
  extractDeepLinkParams,
  renderEmoji
} from '../jamEngine'

export function useJamSync({
  currentTrack,
  isPlaying,
  queue,
  setCurrentTrack,
  setIsPlaying,
  setQueue,
  currentTrackRef,
  isPlayingRef,
  queueRef,
  handleNextRef,
  handlePrevRef,
  remoteJamGuardRef,
  handlePlayTrack,
  playList,
  setPlayingFrom,
  googleUser,
  showNotify
}) {
  const [jamState, setJamState] = useState(() => jamManager.state)
  const [isJamModalOpen, setIsJamModalOpen] = useState(false)
  const [initialJamCode, setInitialJamCode] = useState('')
  const [initialFriendCode, setInitialFriendCode] = useState('')
  const [initialJamSection, setInitialJamSection] = useState('')
  const [jamReactions, setJamReactions] = useState([])
  const remoteJamGuardTimerRef = useRef(null)

  const activateRemoteJamGuard = useCallback((durationMs = 350) => {
    remoteJamGuardRef.current = true
    if (remoteJamGuardTimerRef.current) clearTimeout(remoteJamGuardTimerRef.current)
    remoteJamGuardTimerRef.current = setTimeout(() => {
      remoteJamGuardRef.current = false
      remoteJamGuardTimerRef.current = null
    }, durationMs)
  }, [remoteJamGuardRef])

  // Sync JamModal open state to jamManager so polling cadence speeds up while open
  useEffect(() => {
    jamManager.setModalOpen(Boolean(isJamModalOpen))
  }, [isJamModalOpen])

  const handleDeepLinkUrl = useCallback(async (rawUrl = '') => {
    const { jamCode, friendCode } = extractDeepLinkParams(rawUrl)

    if (jamCode && jamCode.length >= 6) {
      try {
        window.history.replaceState({}, document.title, window.location.pathname)
      } catch {}
      setInitialJamCode(jamCode)
      showNotify(`Connecting to Live Jam (${jamCode})...`, 'info')
      const ok = await jamManager.joinJam(jamCode, googleUser)
      if (ok) showNotify(`Connected to Jam ${jamCode}! Audio syncing.`, 'success')
    } else if (friendCode && friendCode.length >= 7) {
      try {
        window.history.replaceState({}, document.title, window.location.pathname)
      } catch {}
      setInitialFriendCode(friendCode)
      setInitialJamSection('friends')
      setIsJamModalOpen(true)
    }
  }, [googleUser, showNotify])

  useEffect(() => {
    const unsub = jamManager.subscribe((nextState) => setJamState(nextState))
    handleDeepLinkUrl()

    const onPop = () => handleDeepLinkUrl()
    const onHash = () => handleDeepLinkUrl()
    const onCustomDeepLink = (e) => { if (e?.detail) handleDeepLinkUrl(e.detail) }
    const onPostMsg = (e) => {
      if (e?.data?.type === 'UPBEAT_DEEP_LINK' && e.data.url) handleDeepLinkUrl(e.data.url)
    }

    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('upbeat-deep-link', onCustomDeepLink)
    window.addEventListener('message', onPostMsg)

    return () => {
      unsub()
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('upbeat-deep-link', onCustomDeepLink)
      window.removeEventListener('message', onPostMsg)
    }
  }, [handleDeepLinkUrl])

  useEffect(() => {
    jamManager.setHandlers({
      getHostPlaybackSnapshot: () => ({
        track: currentTrackRef.current,
        isPlaying: isPlayingRef.current,
        currentTime: window.UpBeatControls?.getCurrentTime?.() || 0,
        queue: queueRef.current || []
      }),
      onRemoteSync: (data, clockOffsetMs) => {
        if (!data) return
        activateRemoteJamGuard(350)
        try {
          const trackChanged = Boolean(data.track?.video_id && data.track.video_id !== currentTrackRef.current?.video_id)
          if (trackChanged) {
            currentTrackRef.current = data.track
            setCurrentTrack(data.track)
          }
          if (Array.isArray(data.queue)) {
            queueRef.current = data.queue
            setQueue(data.queue)
          }
          if (data.isPlaying === false) {
            isPlayingRef.current = false
            setIsPlaying(false)
            window.UpBeatControls?.forcePause?.(typeof data.currentTime === 'number' ? data.currentTime : undefined)
            jamManager.reportDriftStatus(0, 'LOCKED')
            return
          }
          if (data.isPlaying === true) {
            if (!isPlayingRef.current || data.forcePlayState) {
              isPlayingRef.current = true
              setIsPlaying(true)
              window.UpBeatControls?.forcePlay?.()
            }
          }
          if (data.track?.video_id || currentTrackRef.current?.video_id) {
            const localTime = trackChanged ? 0 : (window.UpBeatControls?.getCurrentTime?.() || 0)
            const drift = evaluateAudioDrift(
              localTime,
              Number(data.currentTime) || 0,
              Number(data.hostTimestamp) || Date.now(),
              clockOffsetMs || 0,
              Boolean(data.isPlaying)
            )
            if (drift.action === 'SEEK') {
              window.UpBeatControls?.seekTo?.(drift.targetTime, true)
              if (trackChanged && drift.targetTime > 0.5) {
                setTimeout(() => window.UpBeatControls?.seekTo?.(drift.targetTime, true), 80)
              }
              window.UpBeatControls?.setPlaybackRate?.(1.0)
            } else if (drift.action === 'RAMP') {
              window.UpBeatControls?.setPlaybackRate?.(drift.playbackRate)
            } else {
              window.UpBeatControls?.setPlaybackRate?.(1.0)
            }
            jamManager.reportDriftStatus(drift.driftMs, drift.syncTier)
          }
        } catch {}
      },
      onRemoteControl: (data) => {
        if (!data || !data.action) return
        activateRemoteJamGuard(350)
        try {
          if (data.action === 'SELECT_TRACK' && data.track) {
            currentTrackRef.current = data.track
            setCurrentTrack(data.track)
            isPlayingRef.current = true
            setIsPlaying(true)
            window.UpBeatControls?.seekTo?.(0, true)
            window.UpBeatControls?.forcePlay?.(0)
          } else if (data.action === 'PLAY') {
            isPlayingRef.current = true
            setIsPlaying(true)
            window.UpBeatControls?.forcePlay?.(typeof data.currentTime === 'number' ? data.currentTime : undefined)
          } else if (data.action === 'PAUSE') {
            isPlayingRef.current = false
            setIsPlaying(false)
            window.UpBeatControls?.forcePause?.(typeof data.currentTime === 'number' ? data.currentTime : undefined)
          } else if (data.action === 'SEEK' && typeof data.currentTime === 'number') {
            window.UpBeatControls?.seekTo?.(data.currentTime, true)
          } else if (data.action === 'NEXT') {
            handleNextRef.current?.(true)
          } else if (data.action === 'PREV') {
            handlePrevRef.current?.(true)
          }

          if (jamManager.state.active && jamManager.state.isHost) {
            setTimeout(() => jamManager.broadcastHostSync(), 60)
          }
        } catch {}
      },
      onRemoteQueueAdd: (track, addedBy) => {
        if (!track) return
        setQueue((prev) => {
          const nextQ = [...prev, track]
          if (jamManager.state.active && jamManager.state.isHost) {
            setTimeout(() => jamManager.broadcastHostSync({ queue: nextQ }), 50)
          }
          return nextQ
        })
        showNotify(`${addedBy?.name || 'Friend'} added "${track.title}" to Jam queue`, 'info')
      },
      onReaction: (packet) => {
        const rawEmoji = packet?.emoji || packet?.reaction
        if (!rawEmoji) return
        const id = packet.id || `${Date.now()}_${Math.random()}`
        const xOffset = 18 + Math.floor(Math.random() * 64)
        setJamReactions((prev) => [
          ...prev.slice(-14),
          {
            id,
            emoji: renderEmoji(rawEmoji, '🔥'),
            senderName: packet.senderName || 'Listener',
            senderAvatar: renderEmoji(packet.senderAvatar, '🎧'),
            xOffset
          }
        ])
        setTimeout(() => setJamReactions((prev) => prev.filter((r) => r.id !== id)), 2650)
      },
      onNotify: (msg, type) => showNotify(msg, type || 'info')
    })
  }, [activateRemoteJamGuard, currentTrackRef, handleNextRef, handlePrevRef, isPlayingRef, queueRef, setCurrentTrack, setIsPlaying, setQueue, showNotify])

  useEffect(() => {
    jamManager.broadcastPresenceStatus()
    if (!jamState.active || !jamState.isHost || remoteJamGuardRef.current) return
    jamManager.broadcastHostSync({
      track: currentTrack,
      isPlaying,
      currentTime: window.UpBeatControls?.getCurrentTime?.() || 0,
      queue
    })
  }, [currentTrack?.video_id, isPlaying, queue.length, jamState.active, jamState.isHost])

  const openFriends = useCallback(() => {
    setInitialJamSection('friends')
    setIsJamModalOpen(true)
  }, [])

  const listenAlong = useCallback(async (friend) => {
    if (!friend) return
    if (friend.activeJamCode) {
      const ok = await jamManager.joinJam(friend.activeJamCode, googleUser)
      if (ok) showNotify(`Listening along with ${friend.name}`, 'success')
    } else if (friend.currentTrack) {
      handlePlayTrack(friend.currentTrack, 0, [friend.currentTrack])
      setPlayingFrom?.({ id: null, title: `${friend.name}'s pick` })
    }
  }, [googleUser, handlePlayTrack, setPlayingFrom, showNotify])

  const startJamWith = useCallback((c) => {
    playList(c.tracks, { from: { id: c.id, title: c.title } })
    setInitialJamSection('')
    setIsJamModalOpen(true)
  }, [playList])

  return {
    jamState,
    isJamModalOpen,
    setIsJamModalOpen,
    initialJamCode,
    setInitialJamCode,
    initialFriendCode,
    setInitialFriendCode,
    initialJamSection,
    setInitialJamSection,
    jamReactions,
    handleDeepLinkUrl,
    openFriends,
    listenAlong,
    startJamWith
  }
}
