import React, { useState, useEffect } from 'react'
import {
  X, Check, Sparkles, Heart, LogOut, ArrowRight, Loader2, Music, ShieldCheck, RefreshCw,
  Image, User, Link as LinkIcon, Key, ChevronDown, ChevronUp, AlertCircle, ExternalLink,
  CheckCircle2, Zap, HelpCircle
} from 'lucide-react'
import { Youtube } from './YouTubeTasteSyncModal'
import { getApiBase, hasBackend, importYouTubePlaylistStandalone } from '../standaloneApi'

export function GoogleIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.17 0 9.97 0 12s.45 3.83 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  )
}

export default function GoogleAuthModal({
  isOpen,
  onClose,
  googleUser,
  onLogin,
  onLogout,
  onSyncYouTubeLikes,
  isSyncingLikes = false
}) {
  // 'instant' (default, zero setup needed) | 'oauth' (Google Cloud OAuth 2.0)
  const [authMode, setAuthMode] = useState('instant')
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [customClientId, setCustomClientId] = useState(() => {
    try { return localStorage.getItem('upbeat_google_client_id') || '' } catch { return '' }
  })
  const [customAccessToken, setCustomAccessToken] = useState('')
  // Old builds pre-filled one developer's name/email for everyone; ignore those values.
  const [customEmail, setCustomEmail] = useState(() => {
    try {
      const v = localStorage.getItem('upbeat_last_google_email') || ''
      return /divyanshnegi009/i.test(v) ? '' : v
    } catch {
      return ''
    }
  })
  const [customName, setCustomName] = useState(() => {
    try {
      const v = localStorage.getItem('upbeat_last_google_name') || ''
      return /divyansh negi/i.test(v) ? '' : v
    } catch {
      return ''
    }
  })
  const [customPicUrl, setCustomPicUrl] = useState('')
  const [showEditPic, setShowEditPic] = useState(false)
  const [showOAuthGuide, setShowOAuthGuide] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isSyncingProfile, setIsSyncingProfile] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Clean any stale hardcoded personal developer email/name on mount
  useEffect(() => {
    try {
      const storedEmail = localStorage.getItem('upbeat_last_google_email') || ''
      const storedName = localStorage.getItem('upbeat_last_google_name') || ''
      if (/divyansh|negi/i.test(storedEmail)) localStorage.removeItem('upbeat_last_google_email')
      if (/divyansh|negi/i.test(storedName)) localStorage.removeItem('upbeat_last_google_name')
    } catch {}
  }, [])

  // Try to sync authentic avatar from active Safari YouTube Music session
  useEffect(() => {
    if (isOpen && googleUser && hasBackend()) {
      fetch(`${getApiBase()}/safari/profile`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.picture && data.picture !== googleUser.picture) {
            onLogin({ ...googleUser, picture: data.picture })
          }
        })
        .catch(() => {})
    }
  }, [isOpen, googleUser])

  if (!isOpen) return null

  // 1. Instant YouTube Taste & Google Profile Connect (Zero Setup)
  const handleInstantConnect = async (e) => {
    if (e) e.preventDefault()
    setErrorMsg('')
    const email = customEmail.trim()
    const name = customName.trim() || (email ? email.split('@')[0] : 'You')
    const url = playlistUrl.trim()

    setIsLoggingIn(true)
    try {
      let importedTracks = []
      if (url) {
        importedTracks = await importYouTubePlaylistStandalone(url)
        if (!importedTracks || importedTracks.length === 0) {
          setErrorMsg('Could not find songs in that playlist URL. Check that it is Public or Unlisted, or continue without playlist.')
          setIsLoggingIn(false)
          return
        }
      }

      try {
        if (customEmail.trim()) localStorage.setItem('upbeat_last_google_email', customEmail.trim())
        if (customName.trim()) localStorage.setItem('upbeat_last_google_name', customName.trim())
      } catch {}

      const userObj = {
        name,
        email,
        picture: customPicUrl.trim() || (importedTracks[0]?.thumbnail || ''),
        connectedAt: Date.now(),
        provider: 'youtube_instant',
        importedTracks: importedTracks
      }

      onLogin(userObj)
      setIsLoggingIn(false)
      onClose()
    } catch (err) {
      console.error('Instant connect error:', err)
      setErrorMsg('Failed to connect: ' + err.message)
      setIsLoggingIn(false)
    }
  }

  // 2. Real Google OAuth 2.0 Sign-In via Google Identity Services (GSI)
  const handleGoogleOAuthSignIn = () => {
    setErrorMsg('')
    const clientId = customClientId.trim()

    if (!clientId) {
      setErrorMsg('Google Cloud Client ID required for OAuth. Enter your Client ID below, or use 1-Click Instant Connect.')
      setShowOAuthGuide(true)
      return
    }

    if (!clientId.includes('.apps.googleusercontent.com')) {
      setErrorMsg('Invalid Client ID format. It must end with .apps.googleusercontent.com')
      return
    }

    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
      setErrorMsg('Google Identity Services is initializing. Please check internet connection or use Instant Connect.')
      return
    }

    try {
      setIsLoggingIn(true)
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/youtube.readonly',
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error('Google OAuth error:', tokenResponse)
            if (tokenResponse.error === 'invalid_client') {
              setErrorMsg('Google returned 401 (invalid_client): The Client ID was not found in Google Cloud Console. Check that your Client ID is correct and active.')
            } else if (tokenResponse.error === 'access_denied') {
              setErrorMsg('Google sign-in was cancelled or access was denied.')
            } else {
              setErrorMsg(tokenResponse.error_description || tokenResponse.error || 'Google sign-in error.')
            }
            setIsLoggingIn(false)
            return
          }

          try {
            // Fetch real Google profile info
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
            })
            const profile = await profileRes.json()

            const userObj = {
              name: profile.name || profile.given_name || 'Google User',
              email: profile.email || 'connected@gmail.com',
              picture: profile.picture || '',
              accessToken: tokenResponse.access_token,
              connectedAt: Date.now(),
              provider: 'google_oauth'
            }

            try { localStorage.setItem('upbeat_google_client_id', clientId) } catch {}

            onLogin(userObj)
            setIsLoggingIn(false)
            onClose()
          } catch (err) {
            console.error('Error fetching Google profile:', err)
            setErrorMsg('Authenticated, but failed to fetch profile: ' + err.message)
            setIsLoggingIn(false)
          }
        }
      })

      tokenClient.requestAccessToken({ prompt: 'consent' })
    } catch (err) {
      console.error('Failed to trigger token client:', err)
      setErrorMsg('OAuth initialization error: ' + err.message)
      setIsLoggingIn(false)
    }
  }

  // 3. Direct OAuth Access Token Login (e.g. from Google OAuth Playground)
  const handleDirectAccessTokenLogin = async (e) => {
    if (e) e.preventDefault()
    const token = customAccessToken.trim()
    if (!token) {
      setErrorMsg('Please paste a valid Google OAuth Access Token (starts with ya29...)')
      return
    }
    setErrorMsg('')
    setIsLoggingIn(true)
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!profileRes.ok) {
        throw new Error(`Google returned status ${profileRes.status}. Token may be expired or invalid.`)
      }
      const profile = await profileRes.json()
      const userObj = {
        name: profile.name || profile.given_name || customName.trim() || 'Google User',
        email: profile.email || customEmail.trim() || 'connected@gmail.com',
        picture: profile.picture || '',
        accessToken: token,
        connectedAt: Date.now(),
        provider: 'google_oauth'
      }
      onLogin(userObj)
      setIsLoggingIn(false)
      onClose()
    } catch (err) {
      console.error('Direct token login error:', err)
      setErrorMsg('Token sign-in failed: ' + err.message)
      setIsLoggingIn(false)
    }
  }

  const handleRefreshFromSafari = async () => {
    if (!hasBackend()) return
    setIsSyncingProfile(true)
    try {
      const res = await fetch(`${getApiBase()}/safari/profile`)
      if (res.ok) {
        const data = await res.json()
        if (data?.picture) {
          onLogin({ ...googleUser, picture: data.picture })
        }
      }
    } catch (e) {
      console.error('Profile refresh error:', e)
    } finally {
      setIsSyncingProfile(false)
    }
  }

  const handleUseLetterAvatar = () => {
    if (!googleUser) return
    onLogin({ ...googleUser, picture: '' })
    setShowEditPic(false)
  }

  const handleSaveCustomPic = (e) => {
    if (e) e.preventDefault()
    if (!googleUser) return
    onLogin({ ...googleUser, picture: customPicUrl.trim() })
    setShowEditPic(false)
  }

  const userInitial = (googleUser?.name || googleUser?.email || 'U')[0].toUpperCase()

  const displayName = googleUser?.name || (googleUser?.email ? googleUser.email.split('@')[0] : 'You')
  const inputCls =
    'w-full min-w-0 h-12 rounded-xl bg-s2 px-4 text-[15px] font-medium box-border placeholder:text-t3 focus:outline-none focus:ring-1 focus:ring-white/25'

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none" role="dialog" aria-modal="true" aria-labelledby="google-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div className="relative w-full max-w-full sm:w-[460px] max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 pb-safe overflow-x-hidden overflow-y-hidden box-border">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-center justify-between px-4 sm:px-5 pt-3 sm:pt-5 shrink-0">
          <h2 id="google-title" className="text-xl font-extrabold tracking-[-0.015em] flex items-center gap-2.5 min-w-0 truncate">
            <GoogleIcon className="w-5 h-5 shrink-0" />
            <span className="truncate">{googleUser ? 'Your account' : 'Bring your music in'}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-t2 hover:text-t1 hover:bg-white/[0.06] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 sm:px-5 pb-6 pt-3 overflow-y-auto overflow-x-hidden flex flex-col gap-4 w-full box-border">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-[#2A1512] text-[#FFB4A6] text-[13px] flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {googleUser ? (
            <>
              <div className="flex items-center gap-3.5 p-4 rounded-2xl bg-s2">
                {googleUser.picture ? (
                  <img src={googleUser.picture} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#F2C6B4] text-[#0A0A0B] font-extrabold text-lg flex items-center justify-center">{userInitial}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold truncate">{displayName}</div>
                  {googleUser.email && <div className="text-[13px] text-t2 truncate">{googleUser.email}</div>}
                  <div className="text-xs font-semibold text-live mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {googleUser.provider === 'google_oauth' ? 'Signed in with Google' : 'YouTube profile connected'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSyncYouTubeLikes()}
                disabled={isSyncingLikes}
                className="h-12 rounded-full bg-t1 text-[#0A0A0B] font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isSyncingLikes ? <Loader2 className="w-5 h-5 animate-spin" /> : <Youtube className="w-5 h-5" />}
                {isSyncingLikes ? 'Importing your likes…' : 'Import my YouTube likes again'}
              </button>

              <div className="flex items-center justify-between text-sm">
                {hasBackend() && (
                  <button type="button" onClick={handleRefreshFromSafari} disabled={isSyncingProfile} className="font-semibold text-t2 hover:text-t1 inline-flex items-center gap-1.5 cursor-pointer">
                    <RefreshCw className={`w-4 h-4 ${isSyncingProfile ? 'animate-spin' : ''}`} />
                    Photo from Safari
                  </button>
                )}
                <button type="button" onClick={() => setShowEditPic((p) => !p)} className="font-semibold text-t2 hover:text-t1 ml-auto cursor-pointer">
                  {showEditPic ? 'Done' : 'Change photo'}
                </button>
              </div>

              {showEditPic && (
                <div className="flex flex-col gap-2.5 w-full min-w-0">
                  <form onSubmit={handleSaveCustomPic} className="flex flex-col sm:flex-row gap-2 w-full min-w-0">
                    <label htmlFor="pic-url" className="sr-only">
                      Image link
                    </label>
                    <input id="pic-url" type="url" value={customPicUrl} onChange={(e) => setCustomPicUrl(e.target.value)} placeholder="Paste an image link" className={`${inputCls} flex-1`} />
                    <button type="submit" disabled={!customPicUrl.trim()} className="w-full sm:w-auto h-12 px-4 rounded-xl bg-t1 text-[#0A0A0B] font-bold cursor-pointer disabled:opacity-40 shrink-0">
                      Use
                    </button>
                  </form>
                  <button type="button" onClick={handleUseLetterAvatar} className="text-sm font-semibold text-t2 hover:text-t1 self-start cursor-pointer">
                    Use the letter “{userInitial}” instead
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  onLogout()
                  onClose()
                }}
                className="h-12 rounded-full ring-1 ring-inset ring-white/15 text-t1 font-semibold text-[15px] flex items-center justify-center gap-2 cursor-pointer hover:bg-white/[0.05]"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-t2 leading-relaxed -mt-1">Import your YouTube likes so recommendations and AI mixes start from what you already love.</p>

              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-s2" role="tablist">
                {[
                  { id: 'instant', label: 'Quick import' },
                  { id: 'oauth', label: 'Sign in with Google' }
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={authMode === t.id}
                    onClick={() => setAuthMode(t.id)}
                    className={`h-9 rounded-[9px] text-sm font-bold cursor-pointer transition-colors ${authMode === t.id ? 'bg-t1 text-[#0A0A0B]' : 'text-t2 hover:text-t1'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {authMode === 'instant' ? (
                <form onSubmit={handleInstantConnect} className="flex flex-col gap-3">
                  <div>
                    <label htmlFor="g-name" className="block text-[13px] font-semibold text-t2 mb-1.5">
                      Your name
                    </label>
                    <input id="g-name" type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="What friends see" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="g-playlist" className="block text-[13px] font-semibold text-t2 mb-1.5">
                      YouTube or YouTube Music playlist link
                    </label>
                    <input id="g-playlist" type="url" value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://music.youtube.com/playlist?list=…" className={inputCls} />
                    <p className="text-xs text-t3 mt-1.5">Public or unlisted. Your liked-songs playlist works best.</p>
                  </div>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="h-12 rounded-full bg-accent text-on-accent font-extrabold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 mt-1"
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    {playlistUrl.trim() ? 'Import and connect' : 'Connect without importing'}
                  </button>
                </form>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-t2 leading-relaxed">Reads your YouTube likes directly. Needs a Google Cloud web client ID (one-time setup).</p>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="g-client" className="text-[13px] font-semibold text-t2">
                        Client ID
                      </label>
                      <button type="button" onClick={() => setShowOAuthGuide((p) => !p)} className="text-[13px] font-semibold text-t1 hover:underline inline-flex items-center gap-1 cursor-pointer">
                        <HelpCircle className="w-3.5 h-3.5" />
                        {showOAuthGuide ? 'Hide steps' : 'How to get one'}
                      </button>
                    </div>
                    <input
                      id="g-client"
                      type="text"
                      value={customClientId}
                      onChange={(e) => {
                        setCustomClientId(e.target.value)
                        try {
                          localStorage.setItem('upbeat_google_client_id', e.target.value.trim())
                        } catch {}
                      }}
                      placeholder="…apps.googleusercontent.com"
                      className={inputCls}
                    />
                  </div>
                  {showOAuthGuide && (
                    <ol className="list-decimal pl-5 space-y-1 text-[13px] text-t2 rounded-xl bg-s2 p-3.5 pl-8">
                      <li>
                        Open{' '}
                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-t1 underline inline-flex items-center gap-0.5">
                          Google Cloud credentials <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                      <li>Create credentials → OAuth client ID → Web application</li>
                      <li>
                        Add <code className="text-t1">http://localhost</code> and <code className="text-t1">capacitor://localhost</code> as JavaScript origins
                      </li>
                      <li>Enable the YouTube Data API v3</li>
                      <li>Paste the client ID above</li>
                    </ol>
                  )}
                  <button
                    type="button"
                    onClick={handleGoogleOAuthSignIn}
                    disabled={isLoggingIn}
                    className="h-12 rounded-full bg-t1 text-[#0A0A0B] font-bold text-[15px] flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon className="w-5 h-5" />}
                    Continue with Google
                  </button>
                  <details className="text-[13px] text-t2 w-full min-w-0">
                    <summary className="cursor-pointer font-semibold hover:text-t1">Have an access token instead?</summary>
                    <div className="flex flex-col sm:flex-row gap-2 mt-2.5 w-full min-w-0">
                      <label htmlFor="g-token" className="sr-only">
                        Access token
                      </label>
                      <input id="g-token" type="password" value={customAccessToken} onChange={(e) => setCustomAccessToken(e.target.value)} placeholder="ya29…" className={`${inputCls} flex-1`} />
                      <button
                        type="button"
                        onClick={handleDirectAccessTokenLogin}
                        disabled={!customAccessToken.trim() || isLoggingIn}
                        className="w-full sm:w-auto h-12 px-4 rounded-xl bg-s3 text-t1 font-bold cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        Sign in
                      </button>
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
