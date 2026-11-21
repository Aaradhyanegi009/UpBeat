/**
 * Mac companion backend sync, Safari bridge controls, and Google YouTube profile integration.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  getApiBase,
  hasBackend,
  isNativeApp,
  openExternalUrl,
  isValidMusicTrack,
  isStrictMusicTrack,
  analyzeTasteDnaStandalone,
  directSearchStandalone
} from '../standaloneApi'
import { jamManager } from '../jamEngine'
import { loadStorage } from './useLibraryStorage'

export function useCompanionSync({
  favorites,
  setFavorites,
  extractedTracks,
  setExtractedTracks,
  setTasteDna,
  selectedModel,
  currentTrackRef,
  showNotify
}) {
  const [safariStatus, setSafariStatus] = useState(null)
  const [safariNowPlaying, setSafariNowPlaying] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showGoogleModal, setShowGoogleModal] = useState(false)
  const [isSyncingLikes, setIsSyncingLikes] = useState(false)
  const [googleUser, setGoogleUser] = useState(() => loadStorage('upbeat_google_user', null))

  useEffect(() => {
    try {
      if (googleUser) {
        localStorage.setItem('upbeat_google_user', JSON.stringify(googleUser))
      } else {
        localStorage.removeItem('upbeat_google_user')
      }
    } catch {}
  }, [googleUser])

  // Sync saved profile & favorites from Mac backend when available
  useEffect(() => {
    if (!hasBackend()) return
    fetch(`${getApiBase()}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((saved) => {
        if (saved && (saved.name || saved.picture)) {
          setGoogleUser((prev) => {
            if (prev?.picture && (prev.customPicture || prev.picture.startsWith('data:'))) return prev
            return { ...(prev || {}), ...saved }
          })
        }
      })
      .catch(() => {})

    fetch(`${getApiBase()}/safari/profile`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.picture) {
          setGoogleUser((prev) => {
            if (!prev) return prev
            if (prev.customPicture || prev.picture?.startsWith('data:')) return prev
            if (prev.picture !== data.picture) return { ...prev, picture: data.picture }
            return prev
          })
        }
      })
      .catch(() => {})

    fetch(`${getApiBase()}/favorites`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.favorites) setFavorites(data.favorites)
      })
      .catch(() => {})
  }, [setFavorites])

  const checkSafari = useCallback(async () => {
    if (!hasBackend()) return null
    try {
      const res = await fetch(`${getApiBase()}/safari/tabs`)
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json()
        setSafariStatus(data)
        return data
      }
    } catch {}
    return null
  }, [])

  const checkNowPlaying = useCallback(async () => {
    if (!hasBackend()) return
    try {
      const res = await fetch(`${getApiBase()}/safari/now-playing`)
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json()
        setSafariNowPlaying(data.now_playing)
      }
    } catch {}
  }, [])

  const handleSaveProfile = useCallback((updatedProfile) => {
    const profileWithFlag = {
      ...updatedProfile,
      customPicture: Boolean(updatedProfile.picture)
    }
    setGoogleUser(profileWithFlag)
    try {
      localStorage.setItem('upbeat_google_user', JSON.stringify(profileWithFlag))
      localStorage.setItem(
        'upbeat_jam_profile',
        JSON.stringify({
          name: profileWithFlag.name,
          picture: profileWithFlag.picture,
          avatar: '🎧'
        })
      )
    } catch {}
    if (hasBackend()) {
      fetch(`${getApiBase()}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileWithFlag)
      }).catch(() => {})
    }
    jamManager.refreshProfile(profileWithFlag)
    jamManager.broadcastPresenceStatus()
    showNotify('Profile updated', 'success')
  }, [showNotify])

  const handleSyncSafari = useCallback(async (silent = false) => {
    if (!hasBackend()) {
      if (!silent) showNotify('Safari sync requires a Mac server connection', 'info')
      return []
    }
    setIsSyncing(true)
    if (!silent) showNotify('Syncing tracks from Safari...', 'info')
    try {
      const extractRes = await fetch(`${getApiBase()}/safari/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (!extractRes.ok) {
        if (!silent) {
          const err = await extractRes.json().catch(() => ({}))
          showNotify(err.detail || 'No YouTube tab found in Safari', 'error')
        }
        return []
      }

      const extractData = await extractRes.json()
      const newTracks = (extractData.tracks || []).filter(isStrictMusicTrack)

      if (newTracks.length > 0) {
        setExtractedTracks(newTracks)
        if (!silent) showNotify(`Synced ${newTracks.length} tracks from Safari`, 'success')

        fetch(`${getApiBase()}/taste-dna`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: newTracks, model_name: selectedModel })
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((dna) => {
            if (dna) setTasteDna(dna)
          })
          .catch(() => {})
        return newTracks
      }
      if (!silent) showNotify('Safari tab open, but 0 video items found on page', 'warning')
      return []
    } catch (e) {
      if (!silent) showNotify(`Sync failed: ${e.message}`, 'error')
      return []
    } finally {
      setIsSyncing(false)
    }
  }, [selectedModel, setExtractedTracks, setTasteDna, showNotify])

  const handlePushToSafari = useCallback(async (track) => {
    if (!track) return
    const fallbackVid = currentTrackRef?.current?.video_id
    const targetUrl =
      track.url ||
      (track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : (fallbackVid ? `https://www.youtube.com/watch?v=${fallbackVid}` : ''))
    if (!targetUrl) return

    if (!hasBackend() || isNativeApp()) {
      openExternalUrl(targetUrl)
      showNotify('Opening in browser...', 'info')
      return
    }

    try {
      await fetch(`${getApiBase()}/safari/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'custom', custom_url: targetUrl })
      })
      showNotify(`Opened "${track.title}" in Safari`, 'info')
    } catch {
      openExternalUrl(targetUrl)
      showNotify('Opened in browser', 'info')
    }
  }, [currentTrackRef, showNotify])

  const handleSafariControl = useCallback(async (action) => {
    try {
      const res = await fetch(`${getApiBase()}/safari/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json()
      if (data.status !== 'success') {
        showNotify(data.message || 'Safari control unavailable', 'warning')
      }
      setTimeout(checkNowPlaying, 400)
    } catch (e) {
      showNotify(`Safari error: ${e.message}`, 'error')
    }
  }, [checkNowPlaying, showNotify])

  const handleOpenSafari = useCallback(async (destination = 'yt_liked') => {
    if (!hasBackend() || isNativeApp()) {
      const url = destination === 'yt_liked' ? 'https://www.youtube.com/playlist?list=LL' : 'https://www.youtube.com/'
      openExternalUrl(url)
      return
    }
    try {
      await fetch(`${getApiBase()}/safari/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination })
      })
    } catch {}
  }, [])

  const handleSyncGoogleYouTubeLikes = useCallback(async (overrideUser) => {
    const activeU = overrideUser || googleUser
    if (!activeU) {
      setShowGoogleModal(true)
      return
    }
    setIsSyncingLikes(true)
    showNotify(`Syncing ${activeU.name}'s YouTube Music profile...`, 'info')
    try {
      if (activeU.importedTracks && activeU.importedTracks.length > 0) {
        const clean = activeU.importedTracks.filter(isValidMusicTrack)
        if (clean.length > 0) {
          setFavorites(clean)
          setExtractedTracks(clean)
          try { localStorage.setItem('argon_seeds_v2', JSON.stringify(clean)) } catch {}
          const dna = await analyzeTasteDnaStandalone(clean)
          if (dna) setTasteDna(dna)
          showNotify(`Imported ${clean.length} songs & tailored taste DNA for ${activeU.name}!`, 'success')
          return
        }
      }

      if (activeU.accessToken) {
        try {
          const ytRes = await fetch(
            'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=LL&maxResults=50',
            { headers: { Authorization: `Bearer ${activeU.accessToken}` } }
          )
          if (ytRes.ok) {
            const data = await ytRes.json()
            const realTracks = (data.items || [])
              .map((item) => ({
                title: item.snippet?.title || 'Unknown Title',
                artist: item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube Artist',
                video_id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
                thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
                vibe: 'YouTube Liked',
                liked_at: Date.now()
              }))
              .filter((t) => t.video_id && !t.title.includes('Deleted video') && !t.title.includes('Private video') && isValidMusicTrack(t))

            if (realTracks.length > 0) {
              setFavorites(realTracks)
              setExtractedTracks(realTracks)
              try { localStorage.setItem('argon_seeds_v2', JSON.stringify(realTracks)) } catch {}
              const dna = await analyzeTasteDnaStandalone(realTracks)
              if (dna) setTasteDna(dna)
              showNotify(`Synced ${realTracks.length} authentic liked songs from ${activeU.name}'s YouTube account!`, 'success')
              return
            }
          } else {
            const errJson = await ytRes.json().catch(() => ({}))
            const errMsg = errJson?.error?.message || `Status ${ytRes.status}`
            showNotify(`YouTube API notice: ${errMsg}`, 'info')
          }
        } catch (oauthErr) {
          console.warn('YouTube API Liked Videos error, trying fallback:', oauthErr)
        }
      }

      if (hasBackend()) {
        try {
          const res = await fetch(`${getApiBase()}/safari/liked`)
          if (res.ok) {
            const data = await res.json()
            if (data.tracks && data.tracks.length) {
              const clean = data.tracks.filter(isValidMusicTrack)
              if (clean.length > 0) {
                setFavorites(clean)
                setExtractedTracks(clean)
                try { localStorage.setItem('argon_seeds_v2', JSON.stringify(clean)) } catch {}
                const dna = await analyzeTasteDnaStandalone(clean)
                if (dna) setTasteDna(dna)
                showNotify(`Synced ${clean.length} songs from YouTube Music`, 'success')
                return
              }
            }
          }
        } catch {}
      }

      if (favorites && favorites.length > 0) {
        const cleanFavs = favorites.filter(isValidMusicTrack)
        setExtractedTracks((prev) => {
          const cleanPrev = prev.filter(isValidMusicTrack)
          const existingIds = new Set(cleanPrev.map((t) => t.video_id))
          const newSeeds = cleanFavs.filter((f) => !existingIds.has(f.video_id))
          const updated = [...newSeeds, ...cleanPrev]
          try { localStorage.setItem('argon_seeds_v2', JSON.stringify(updated)) } catch {}
          return updated
        })
        const dna = await analyzeTasteDnaStandalone(cleanFavs)
        if (dna) setTasteDna(dna)
        showNotify(`Analyzed ${cleanFavs.length} saved songs into ${activeU.name}'s taste profile!`, 'success')
        return
      }

      if (extractedTracks && extractedTracks.length > 0) {
        const cleanSeeds = extractedTracks.filter(isValidMusicTrack)
        const dna = await analyzeTasteDnaStandalone(cleanSeeds)
        if (dna) setTasteDna(dna)
        showNotify(`Generated taste profile for ${activeU.name} from seed tracks!`, 'success')
        return
      }

      const searchRes = await directSearchStandalone('Top Hits 2026', 'songs')
      const starterTracks = (searchRes?.tracks || []).filter(isValidMusicTrack).slice(0, 6)
      if (starterTracks.length > 0) {
        setExtractedTracks(starterTracks)
        try { localStorage.setItem('argon_seeds_v2', JSON.stringify(starterTracks)) } catch {}
        const dna = await analyzeTasteDnaStandalone(starterTracks)
        if (dna) setTasteDna(dna)
        showNotify(`Synced starter music feed for ${activeU.name}!`, 'success')
      } else {
        showNotify(`Connected ${activeU.name}! Search or heart songs to build your profile.`, 'success')
      }
    } catch (err) {
      showNotify(`Sync error: ${err.message}`, 'error')
    } finally {
      setIsSyncingLikes(false)
    }
  }, [googleUser, favorites, extractedTracks, setFavorites, setExtractedTracks, setTasteDna, showNotify])

  const handleGoogleLogin = useCallback((user) => {
    setGoogleUser(user)
    showNotify(`Connected Google Account: ${user.name}`, 'success')
    handleSyncGoogleYouTubeLikes(user)
  }, [handleSyncGoogleYouTubeLikes, showNotify])

  const handleGoogleLogout = useCallback(() => {
    setGoogleUser(null)
    showNotify('Disconnected Google account', 'info')
  }, [showNotify])

  return {
    safariStatus,
    setSafariStatus,
    safariNowPlaying,
    isSyncing,
    setIsSyncing,
    googleUser,
    setGoogleUser,
    showGoogleModal,
    setShowGoogleModal,
    isSyncingLikes,
    checkSafari,
    checkNowPlaying,
    handleSaveProfile,
    handleSyncSafari,
    handleOpenSafari,
    handlePushToSafari,
    handleSafariControl,
    handleGoogleLogin,
    handleGoogleLogout,
    handleSyncGoogleYouTubeLikes
  }
}
