import React, { useState, useEffect } from 'react'
import {
  X, Users, Radio, Copy, Check, Share2, Shield, Sparkles,
  LogOut, Wifi, Crown, Music, QrCode, UserPlus, UserCheck,
  Play, Trash2, Send, RefreshCw
} from 'lucide-react'
import {
  jamManager,
  loadJamUserProfile,
  normalizeRoomCode,
  normalizeFriendCode,
  buildJamInviteUrl,
  buildFriendInviteUrl
} from '../jamEngine'

function formatLastSeen(ts) {
  if (!ts) return 'Offline'
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'Just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export default function JamModal({
  isOpen,
  onClose,
  jamState,
  googleUser,
  currentTrack,
  isPlaying,
  initialJoinCode = '',
  initialFriendCode = '',
  initialSection = '',
  onPlayTrack,
  onNotify
}) {
  const [mainTab, setMainTab] = useState('jam') // 'jam' | 'friends'
  const [jamSubTab, setJamSubTab] = useState(initialJoinCode ? 'join' : 'host') // 'host' | 'join'
  const [joinCodeInput, setJoinCodeInput] = useState(initialJoinCode || '')
  const [friendCodeInput, setFriendCodeInput] = useState(initialFriendCode || '')
  const [djModePref, setDjModePref] = useState('open_party')
  const [profile, setProfile] = useState(() => loadJamUserProfile(googleUser))

  const [copiedRoomCode, setCopiedRoomCode] = useState(false)
  const [copiedRoomLink, setCopiedRoomLink] = useState(false)
  const [copiedFriendCode, setCopiedFriendCode] = useState(false)
  const [copiedFriendLink, setCopiedFriendLink] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [showFriendQr, setShowFriendQr] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [invitedCodes, setInvitedCodes] = useState({})

  useEffect(() => {
    if (initialJoinCode) {
      setMainTab('jam')
      setJamSubTab('join')
      setJoinCodeInput(initialJoinCode)
    }
  }, [initialJoinCode])

  useEffect(() => {
    if (initialFriendCode) {
      setMainTab('friends')
      setFriendCodeInput(initialFriendCode)
    } else if (initialSection === 'friends') {
      setMainTab('friends')
    }
  }, [initialFriendCode, initialSection])

  useEffect(() => {
    if (googleUser) {
      setProfile(jamManager.refreshProfile(googleUser))
    } else {
      setProfile(loadJamUserProfile())
    }
  }, [googleUser, isOpen])

  if (!isOpen) return null

  const friends = jamState?.friends || []
  const incomingRequests = jamState?.incomingRequests || []
  const outgoingRequests = jamState?.outgoingRequests || []
  const onlineFriendsCount = friends.filter((f) => f.online).length
  const myFriendCode = profile?.friendCode || jamState?.userProfile?.friendCode || 'UP-STUDIO'

  const handleNameChange = (e) => {
    const val = e.target.value
    setProfile((prev) => ({ ...prev, name: val }))
    jamManager.updateUserProfile({ name: val })
  }

  const handleStartHost = async () => {
    await jamManager.createJam(googleUser, djModePref)
  }

  const handleJoinRoom = async (e) => {
    if (e) e.preventDefault()
    if (!joinCodeInput.trim() || isJoining) return
    setIsJoining(true)
    try {
      await jamManager.joinJam(joinCodeInput.trim(), googleUser)
    } finally {
      setIsJoining(false)
    }
  }

  const handleAddFriendSubmit = (e) => {
    if (e) e.preventDefault()
    if (!friendCodeInput.trim()) return
    const clean = normalizeFriendCode(friendCodeInput.trim())
    const res = jamManager.sendFriendRequest(clean || friendCodeInput.trim())
    if (res?.ok) {
      setFriendCodeInput('')
    }
  }

  const handleInviteFriend = async (friendCode) => {
    if (!friendCode) return
    await jamManager.inviteFriendToJam(friendCode, googleUser)
    setInvitedCodes((prev) => ({ ...prev, [friendCode]: true }))
    setTimeout(() => {
      setInvitedCodes((prev) => ({ ...prev, [friendCode]: false }))
    }, 2500)
  }

  const handleListenAlong = async (friend) => {
    if (!friend) return
    if (friend.activeJamCode) {
      await jamManager.joinJam(friend.activeJamCode, googleUser)
      setMainTab('jam')
      return
    }
    if (friend.currentTrack && onPlayTrack) {
      onPlayTrack(friend.currentTrack, 0, [friend.currentTrack])
      if (onNotify) {
        onNotify(`Listening along with ${friend.name}`, 'info')
      }
    }
  }

  const shareJamUrl = jamState?.roomCode ? buildJamInviteUrl(jamState.roomCode) : ''
  const shareFriendUrl = myFriendCode ? buildFriendInviteUrl(myFriendCode) : ''

  const handleCopyRoomCode = () => {
    if (!jamState?.roomCode) return
    navigator.clipboard?.writeText(jamState.roomCode).catch(() => {})
    setCopiedRoomCode(true)
    setTimeout(() => setCopiedRoomCode(false), 2000)
    onNotify?.(`Room code ${jamState.roomCode} copied!`, 'success')
  }

  const handleCopyRoomLink = async () => {
    if (!shareJamUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my UpBeat Live Jam',
          text: `Join my live listening session on UpBeat! Room: ${jamState?.roomCode}`,
          url: shareJamUrl
        })
        return
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    navigator.clipboard?.writeText(shareJamUrl).catch(() => {})
    setCopiedRoomLink(true)
    setTimeout(() => setCopiedRoomLink(false), 2000)
    onNotify?.('Jam invite link copied to clipboard!', 'success')
  }

  const handleCopyFriendCode = () => {
    if (!myFriendCode) return
    navigator.clipboard?.writeText(myFriendCode).catch(() => {})
    setCopiedFriendCode(true)
    setTimeout(() => setCopiedFriendCode(false), 2000)
    onNotify?.(`Friend code ${myFriendCode} copied!`, 'success')
  }

  const handleCopyFriendLink = async () => {
    if (!shareFriendUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Connect on UpBeat',
          text: `Add me on UpBeat to listen in real time! Friend Code: ${myFriendCode}`,
          url: shareFriendUrl
        })
        return
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    navigator.clipboard?.writeText(shareFriendUrl).catch(() => {})
    setCopiedFriendLink(true)
    setTimeout(() => setCopiedFriendLink(false), 2000)
    onNotify?.('Friend invite link copied to clipboard!', 'success')
  }

  const syncTier = jamState?.syncTier || 'LOCKED'
  const isInSync = syncTier === 'LOCKED' || syncTier === 'IN_SYNC'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-white dark:bg-[#101015]/95 border border-slate-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-2xl flex flex-col max-h-[88vh] overflow-hidden text-slate-900 dark:text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-500">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Friends & Live Jam</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Real-time synchronized listening</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/10 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary Navigation Tabs */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-semibold my-4 shrink-0">
          <button
            type="button"
            onClick={() => setMainTab('jam')}
            className={`py-2 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mainTab === 'jam'
                ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-white/10 font-bold'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-rose-500" />
            <span>Live Jam</span>
            {jamState?.active && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMainTab('friends')
              jamManager.pingAllFriends()
            }}
            className={`py-2 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mainTab === 'friends'
                ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-white/10 font-bold'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-sky-500" />
            <span>Friends</span>
            {onlineFriendsCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                {onlineFriendsCount}
              </span>
            )}
            {incomingRequests.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-bold">
                +{incomingRequests.length}
              </span>
            )}
          </button>
        </div>

        {/* Identity Row (Clean inline display name + friend code) */}
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 mb-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {googleUser?.picture || profile?.picture ? (
              <img
                src={googleUser?.picture || profile?.picture}
                alt=""
                className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-white/10 shrink-0 shadow-sm"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-500 via-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-md shrink-0">
                {(profile?.name || googleUser?.name || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={profile.name}
                onChange={handleNameChange}
                placeholder="Your display name..."
                maxLength={28}
                className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none border-b border-transparent focus:border-rose-500 py-0.5 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-zinc-300 shrink-0">
            <span>{myFriendCode}</span>
            <button
              type="button"
              onClick={handleCopyFriendCode}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer ml-0.5 transition-colors"
              title="Copy friend code"
            >
              {copiedFriendCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleCopyFriendLink}
              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer ml-0.5 transition-colors"
              title="Share friend invite link"
            >
              {copiedFriendLink ? <Check className="w-3 h-3 text-emerald-500" /> : <Share2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => setShowFriendQr((p) => !p)}
              className={`cursor-pointer ml-0.5 transition-colors ${showFriendQr ? 'text-rose-500' : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'}`}
              title="Toggle friend QR code"
            >
              <QrCode className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Friend QR Code Display */}
        {showFriendQr && shareFriendUrl && (
          <div className="mb-4 p-3.5 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 flex flex-col items-center gap-2 shrink-0">
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Friend Profile QR
              </span>
              <button
                type="button"
                onClick={() => setShowFriendQr(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-2.5 bg-white rounded-2xl shadow-md">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareFriendUrl)}`}
                alt="Friend QR"
                className="w-32 h-32 rounded-lg"
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 text-center max-w-xs">
              Scan with camera to instantly send a friend request to <strong className="text-slate-900 dark:text-white font-mono">{myFriendCode}</strong>
            </p>
            <button
              type="button"
              onClick={handleCopyFriendLink}
              className="px-3 py-1.5 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-800 dark:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedFriendLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copiedFriendLink ? 'Link Copied' : 'Copy Direct Link'}</span>
            </button>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="space-y-4 overflow-y-auto flex-1 content-scroll-container pr-0.5">
          {mainTab === 'jam' ? (
            !jamState?.active ? (
              /* NOT IN A JAM: Start or Join */
              <div className="space-y-4">
                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => setJamSubTab('host')}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      jamSubTab === 'host'
                        ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-xs font-bold border border-slate-200 dark:border-white/10'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    <span>Host Room</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setJamSubTab('join')}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      jamSubTab === 'join'
                        ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-xs font-bold border border-slate-200 dark:border-white/10'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Join with Code</span>
                  </button>
                </div>

                {jamSubTab === 'host' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300">
                        Playback Permissions
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setDjModePref('open_party')}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                            djModePref === 'open_party'
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-200'
                              : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-400'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                              Open Party
                            </span>
                            {djModePref === 'open_party' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-tight">
                            Anyone can play, pause, or add songs to queue
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDjModePref('host_only')}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                            djModePref === 'host_only'
                              ? 'bg-amber-500/10 border-amber-500/40 text-amber-950 dark:text-amber-200'
                              : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-400'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5 text-amber-500" />
                              Host Only
                            </span>
                            {djModePref === 'host_only' && <Check className="w-3.5 h-3.5 text-amber-500" />}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-tight">
                            Only you control playback; friends listen in sync
                          </p>
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartHost}
                      className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-rose-600/20"
                    >
                      <Radio className="w-4 h-4" />
                      <span>Start Live Jam Session</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleJoinRoom} className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300">
                          Room Code or Invite Link
                        </label>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                          Paste link or enter code
                        </span>
                      </div>
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => {
                          const val = e.target.value
                          const norm = normalizeRoomCode(val)
                          setJoinCodeInput(norm || val.toUpperCase())
                        }}
                        placeholder="JAM-XXXX or paste invite link"
                        maxLength={90}
                        className="w-full bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 focus:border-rose-500 rounded-2xl px-4 py-3 text-center font-mono text-base font-bold tracking-widest uppercase text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none transition-colors"
                      />
                      {jamState?.error && (
                        <p className="text-xs text-rose-500 mt-2 text-center font-medium">
                          {jamState.error}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!joinCodeInput.trim() || isJoining}
                      className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-rose-600/20"
                    >
                      <Radio className="w-4 h-4" />
                      <span>{isJoining ? 'Connecting...' : 'Connect to Jam'}</span>
                    </button>
                  </form>
                )}
              </div>
            ) : (
              /* ACTIVE JAM CONTROLS */
              <div className="space-y-4">
                {/* Room Info Card */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/[0.04] border border-emerald-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        {jamState.role === 'host' ? 'Hosting Session' : `Listening with ${jamState.hostName || 'Host'}`}
                      </span>
                      <div className="text-xl font-bold font-mono text-slate-900 dark:text-white tracking-wider mt-0.5">
                        {jamState.roomCode}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        className="px-3 py-1.5 rounded-full bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-slate-700 dark:text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Copy code"
                      >
                        {copiedRoomCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedRoomCode ? 'Copied' : 'Code'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyRoomLink}
                        className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-sm"
                        title="Copy invite link"
                      >
                        {copiedRoomLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{copiedRoomLink ? 'Copied' : 'Invite'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowQr((p) => !p)}
                        className="p-1.5 rounded-full bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-slate-700 dark:text-zinc-300 transition-colors cursor-pointer"
                        title="Toggle QR code"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* QR Code */}
                  {showQr && shareJamUrl && (
                    <div className="pt-3 border-t border-slate-200 dark:border-white/10 flex flex-col items-center gap-2">
                      <div className="p-2.5 bg-white rounded-2xl shadow-md">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareJamUrl)}`}
                          alt="Jam QR"
                          className="w-32 h-32 rounded-lg"
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400 text-center">
                        Scan with camera to instantly join <strong className="text-slate-900 dark:text-white font-mono">{jamState.roomCode}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyRoomLink}
                        className="px-3 py-1.5 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-800 dark:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {copiedRoomLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{copiedRoomLink ? 'Link Copied' : 'Copy Direct Link'}</span>
                      </button>
                    </div>
                  )}

                  {/* Telemetry */}
                  <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
                    <span className="flex items-center gap-1.5">
                      <Wifi className="w-3 h-3 text-emerald-500" />
                      <span>Status: <strong className={isInSync ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>{isInSync ? 'In Sync' : 'Aligning'}</strong></span>
                    </span>
                    <span>RTT: {jamState.rttMs || 12}ms</span>
                  </div>
                </div>

                {/* Now Playing in Room */}
                {currentTrack && (
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 flex items-center gap-3">
                    {currentTrack.thumbnail ? (
                      <img
                        src={currentTrack.thumbnail}
                        alt=""
                        className="w-10 h-10 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-500 shrink-0">
                        <Music className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        {isPlaying ? 'Playing in Sync' : 'Paused in Room'}
                      </div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {currentTrack.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                        {currentTrack.artist}
                      </div>
                    </div>
                  </div>
                )}

                {/* Host Mode Toggle */}
                {jamState.role === 'host' && (
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        Open Party Permissions
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                        Allow guests to change songs and control playback
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        jamManager.setDjMode(jamState.djMode === 'open_party' ? 'host_only' : 'open_party')
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                        jamState.djMode === 'open_party'
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                          : 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-300'
                      }`}
                    >
                      {jamState.djMode === 'open_party' ? 'Open Party' : 'Host Only'}
                    </button>
                  </div>
                )}

                {/* Listeners in Room */}
                <div>
                  <span className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-2">
                    Listeners ({jamState.participants?.length || 1})
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {(jamState.participants || []).map((p, idx) => (
                      <div
                        key={p.peerId || p.id || idx}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-rose-500 to-indigo-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                            {(p.name || 'U')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate block">
                              {p.name || 'Listener'}
                            </span>
                          </div>
                        </div>

                        {p.isHost ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            Host
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            Synced
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick Invite Friends */}
                {friends.length > 0 && (
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-2">
                      Invite Friends
                    </span>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {friends.map((f) => (
                        <div
                          key={f.friendCode}
                          className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-700 dark:text-zinc-300 text-[10px] font-bold shrink-0">
                              {(f.name || 'U')[0].toUpperCase()}
                            </div>
                            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                              {f.name}
                            </span>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                f.online ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-zinc-600'
                              }`}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleInviteFriend(f.friendCode)}
                            className="px-2.5 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            {invitedCodes[f.friendCode] ? 'Invited' : 'Invite'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Leave Room Button */}
                <button
                  type="button"
                  onClick={() => jamManager.leaveJam(false)}
                  className="w-full py-2.5 rounded-2xl bg-slate-100 hover:bg-rose-50 dark:bg-white/[0.05] dark:hover:bg-rose-500/10 border border-slate-200 dark:border-white/10 hover:border-rose-300 dark:hover:border-rose-500/30 text-slate-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{jamState.role === 'host' ? 'End Session for All' : 'Leave Session'}</span>
                </button>
              </div>
            )
          ) : (
            /* TAB 2: FRIENDS (Online status, now playing, invite) */
            <div className="space-y-4">
              {/* Add Friend Form */}
              <form onSubmit={handleAddFriendSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={friendCodeInput}
                  onChange={(e) => {
                    const val = e.target.value
                    const norm = normalizeFriendCode(val)
                    setFriendCodeInput(norm || val.toUpperCase())
                  }}
                  placeholder="Enter Friend Code or paste link"
                  maxLength={90}
                  className="flex-1 bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 focus:border-rose-500 rounded-2xl px-3.5 py-2 text-xs font-mono font-bold uppercase text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={!friendCodeInput.trim()}
                  className="px-4 py-2 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Friend</span>
                </button>
              </form>

              {/* Incoming Requests */}
              {incomingRequests.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Incoming Requests ({incomingRequests.length})
                  </span>
                  <div className="space-y-1.5">
                    {incomingRequests.map((req) => (
                      <div
                        key={req.friendCode}
                        className="flex items-center justify-between p-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-700 dark:text-white text-xs font-bold shrink-0">
                            {(req.name || 'U')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {req.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 dark:text-zinc-400">
                              {req.friendCode}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => jamManager.acceptFriendRequest(req.friendCode)}
                            className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => jamManager.declineFriendRequest(req.friendCode)}
                            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
                            title="Decline"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outgoing Requests */}
              {outgoingRequests.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                    Pending ({outgoingRequests.length})
                  </span>
                  {outgoingRequests.map((req) => (
                    <div
                      key={req.friendCode}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-xs"
                    >
                      <span className="font-mono text-slate-700 dark:text-zinc-300 font-semibold">{req.friendCode}</span>
                      <button
                        type="button"
                        onClick={() => jamManager.cancelOutgoingRequest(req.friendCode)}
                        className="text-[11px] text-slate-400 hover:text-rose-500 cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Friends List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    Friends ({friends.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => jamManager.pingAllFriends()}
                    className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {friends.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 text-center space-y-2.5">
                    <UserCheck className="w-7 h-7 text-slate-400 dark:text-zinc-500 mx-auto opacity-60" />
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      No friends added yet
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed">
                      Share your code <span className="font-mono font-bold text-slate-900 dark:text-white">{myFriendCode}</span> or send your invite link to listen together.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleCopyFriendLink}
                        className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                      >
                        {copiedFriendLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{copiedFriendLink ? 'Link Copied' : 'Share Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFriendQr((p) => !p)}
                        className="px-3 py-1.5 rounded-full bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-slate-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Show QR</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {friends.map((f) => {
                      const isOnline = Boolean(f.online)
                      const hasTrack = Boolean(f.currentTrack?.title)
                      return (
                        <div
                          key={f.friendCode}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-800 dark:text-white text-xs font-bold shrink-0 relative">
                                <span>{(f.name || 'U')[0].toUpperCase()}</span>
                                <span
                                  className={`w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#101015] absolute -bottom-0.5 -right-0.5 ${
                                    isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-zinc-600'
                                  }`}
                                />
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    {f.name}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                                    ({f.friendCode})
                                  </span>
                                </div>

                                {isOnline ? (
                                  hasTrack ? (
                                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium truncate">
                                      Listening to <strong className="font-bold text-slate-900 dark:text-white">{f.currentTrack.title}</strong> • {f.currentTrack.artist}
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                      Online in Studio
                                    </div>
                                  )
                                ) : (
                                  <div className="text-[11px] text-slate-400 dark:text-zinc-500">
                                    Offline • {formatLastSeen(f.lastSeen)}
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => jamManager.removeFriend(f.friendCode)}
                              className="p-1 rounded-full text-slate-400 hover:text-rose-500 transition-colors cursor-pointer shrink-0"
                              title="Remove friend"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-0.5">
                            {(hasTrack || f.activeJamCode) && (
                              <button
                                type="button"
                                onClick={() => handleListenAlong(f)}
                                className="px-3 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>{f.activeJamCode ? `Join Jam (${f.activeJamCode})` : 'Listen Along'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleInviteFriend(f.friendCode)}
                              className="px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                            >
                              <Send className="w-3 h-3" />
                              <span>{invitedCodes[f.friendCode] ? 'Invited' : 'Invite to Jam'}</span>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
