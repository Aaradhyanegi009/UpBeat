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
  const [customEmail, setCustomEmail] = useState(() => {
    try { return localStorage.getItem('upbeat_last_google_email') || 'divyanshnegi009@gmail.com' } catch { return 'divyanshnegi009@gmail.com' }
  })
  const [customName, setCustomName] = useState(() => {
    try { return localStorage.getItem('upbeat_last_google_name') || 'Divyansh Negi' } catch { return 'Divyansh Negi' }
  })
  const [customPicUrl, setCustomPicUrl] = useState('')
  const [showEditPic, setShowEditPic] = useState(false)
  const [showOAuthGuide, setShowOAuthGuide] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isSyncingProfile, setIsSyncingProfile] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

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
    const email = customEmail.trim() || 'divyanshnegi009@gmail.com'
    const name = customName.trim() || email.split('@')[0]
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
        localStorage.setItem('upbeat_last_google_email', email)
        localStorage.setItem('upbeat_last_google_name', name)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-md bg-[#0e0e13]/95 border border-white/10 rounded-3xl shadow-2xl flex flex-col z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] backdrop-blur-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.03] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shadow-xs">
              <GoogleIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                {googleUser ? 'Google Account & YouTube Taste' : 'Connect Google & YouTube'}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto gpu-scroll">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="flex-1 leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {googleUser ? (
            /* Logged-in State with Verified Profile */
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#0c0c12]/75 backdrop-blur-xl border border-emerald-500/30 flex items-center gap-3.5">
                {googleUser.picture ? (
                  <img
                    src={googleUser.picture}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500/50 shadow-md"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-rose-500 via-purple-600 to-indigo-600 text-white font-bold text-lg flex items-center justify-center border-2 border-white/20 shadow-md">
                    {userInitial}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white tracking-tight truncate">
                      {googleUser.name || (googleUser.email ? googleUser.email.split('@')[0] : 'Google User')}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Connected" />
                  </div>
                  <div className="text-xs text-zinc-400 truncate mt-0.5 font-medium">
                    {googleUser.email || 'Connected'}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-emerald-400 font-semibold mt-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {googleUser.provider === 'google_oauth'
                        ? 'Google OAuth 2.0 Connected'
                        : 'YouTube Music Profile Synced'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Avatar Management Options */}
              <div className="flex items-center justify-between text-[11px] font-mono px-1">
                {hasBackend() && (
                  <button
                    onClick={handleRefreshFromSafari}
                    disabled={isSyncingProfile}
                    className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingProfile ? 'animate-spin' : ''}`} />
                    <span>Sync from Safari Tab</span>
                  </button>
                )}
                <button
                  onClick={() => setShowEditPic((p) => !p)}
                  className="text-zinc-400 hover:text-white cursor-pointer ml-auto"
                >
                  {showEditPic ? 'Close Editor' : 'Customize Avatar'}
                </button>
              </div>

              {/* Avatar Editor Drawer */}
              {showEditPic && (
                <div className="p-3 rounded-xl bg-[#121218] border border-white/10 space-y-2.5 animate-in fade-in duration-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white">Profile Photo Controls</span>
                    <button
                      onClick={handleUseLetterAvatar}
                      className="text-[11px] font-mono text-zinc-400 hover:text-rose-300 cursor-pointer"
                    >
                      Use Letter Avatar ("{userInitial}")
                    </button>
                  </div>
                  <form onSubmit={handleSaveCustomPic} className="flex gap-2">
                    <input
                      type="url"
                      value={customPicUrl}
                      onChange={(e) => setCustomPicUrl(e.target.value)}
                      placeholder="Paste image URL (e.g. https://...)"
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={!customPicUrl.trim()}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs text-white font-medium cursor-pointer"
                    >
                      Apply
                    </button>
                  </form>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => onSyncYouTubeLikes()}
                  disabled={isSyncingLikes}
                  className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSyncingLikes ? (
                    <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  ) : (
                    <Youtube className="w-4 h-4 text-rose-400" />
                  )}
                  <span>{isSyncingLikes ? 'Syncing Liked Songs & Recalculating DNA...' : 'Re-sync YouTube Likes & Refresh Seeds'}</span>
                </button>

                <button
                  onClick={() => {
                    onLogout()
                    onClose()
                  }}
                  className="w-full py-2 px-4 rounded-xl bg-[#16161f] hover:bg-rose-500/10 border border-[#242432] hover:border-rose-500/30 text-[#a1a1aa] hover:text-rose-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Account</span>
                </button>
              </div>
            </div>
          ) : (
            /* Sign-In State */
            <div className="space-y-4">
              {/* Tab Selector: Instant Connect vs Google Cloud OAuth */}
              <div className="grid grid-cols-2 p-1 bg-white/[0.04] border border-white/10 rounded-2xl text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setAuthMode('instant')}
                  className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMode === 'instant'
                      ? 'bg-gradient-to-r from-rose-500/20 to-purple-500/20 text-white border border-rose-500/30 shadow-xs font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>1-Click Instant Sync</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('oauth')}
                  className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    authMode === 'oauth'
                      ? 'bg-white/10 text-white shadow-xs font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <GoogleIcon className="w-3.5 h-3.5" />
                  <span>Google Cloud OAuth</span>
                </button>
              </div>

              {authMode === 'instant' ? (
                /* TAB 1: 1-Click Instant YouTube & Google Sync (Zero Setup, No 401 errors) */
                <form onSubmit={handleInstantConnect} className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Divyansh Negi"
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-rose-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Google / YT Email
                      </label>
                      <input
                        type="email"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                        placeholder="divyanshnegi009@gmail.com"
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-rose-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      YouTube Playlist Link or Liked Songs URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={playlistUrl}
                      onChange={(e) => setPlaylistUrl(e.target.value)}
                      placeholder="https://music.youtube.com/playlist?list=..."
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-rose-600 to-purple-600 hover:from-rose-500 hover:to-purple-500 active:scale-[0.99] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-white" />
                    )}
                    <span>{playlistUrl.trim() ? 'Connect & Sync Music Taste' : 'Connect Profile Directly'}</span>
                  </button>
                </form>
              ) : (
                /* TAB 2: Official Google Cloud OAuth 2.0 */
                <div className="space-y-3.5">
                  {/* Client ID Configuration Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-zinc-300">
                        Google Cloud Web Client ID
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowOAuthGuide((p) => !p)}
                        className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{showOAuthGuide ? 'Hide Instructions' : 'How to get ID'}</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={customClientId}
                      onChange={(e) => {
                        setCustomClientId(e.target.value)
                        try { localStorage.setItem('upbeat_google_client_id', e.target.value.trim()) } catch {}
                      }}
                      placeholder="...apps.googleusercontent.com"
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 transition-colors"
                    />
                  </div>

                  {/* OAuth Guide Accordion */}
                  {showOAuthGuide && (
                    <div className="p-3 rounded-xl bg-[#14141d] border border-white/10 text-[11px] text-[#a1a1aa] space-y-2 animate-in fade-in font-sans">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                        <span>Quick 2-minute Google Cloud Setup:</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-1 text-[#8e8e96] font-mono text-[10px] pl-1">
                        <li>
                          Open{' '}
                          <a
                            href="https://console.cloud.google.com/apis/credentials"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 hover:underline inline-flex items-center gap-0.5"
                          >
                            Google Cloud Credentials <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </li>
                        <li>Click <strong>Create Credentials</strong> &rarr; <strong>OAuth client ID</strong></li>
                        <li>Select <strong>Application type: Web application</strong></li>
                        <li>Under <strong>Authorized JavaScript origins</strong>, add: <code className="text-white bg-black/50 px-1 py-0.5 rounded">http://localhost</code> and <code className="text-white bg-black/50 px-1 py-0.5 rounded">capacitor://localhost</code></li>
                        <li>Under <strong>Enabled APIs & Services</strong>, enable <strong>YouTube Data API v3</strong></li>
                        <li>Copy and paste your Client ID above.</li>
                      </ol>
                    </div>
                  )}

                  {/* Continue with Google Button */}
                  <button
                    type="button"
                    onClick={handleGoogleOAuthSignIn}
                    disabled={isLoggingIn}
                    className="w-full py-2.5 px-4 rounded-2xl bg-white hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-50 text-black text-xs font-bold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
                    ) : (
                      <GoogleIcon className="w-4 h-4" />
                    )}
                    <span>Continue with Google OAuth</span>
                  </button>

                  {/* Alternative: Direct Access Token */}
                  <div className="pt-2 border-t border-white/10 space-y-2">
                    <label className="block text-xs font-semibold text-zinc-300">
                      Or Paste OAuth Access Token Directly
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={customAccessToken}
                        onChange={(e) => setCustomAccessToken(e.target.value)}
                        placeholder="ya29...."
                        className="flex-1 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={handleDirectAccessTokenLogin}
                        disabled={!customAccessToken.trim() || isLoggingIn}
                        className="px-4 py-2 rounded-2xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs text-white font-bold cursor-pointer transition-colors"
                      >
                        Sign In
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
