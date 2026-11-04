import React, { useState, useEffect } from 'react'
import {
  X, Users, Radio, Copy, Check, Share2, Shield, Sparkles,
  LogOut, Wifi, Crown, Music, QrCode, UserPlus, UserCheck,
  Play, Trash2, Send, RefreshCw
} from 'lucide-react'
import {
  jamManager,
  JAM_AVATARS,
  JAM_REACTION_PRESETS,
  loadJamUserProfile,
  normalizeFriendCode,
  renderEmoji
} from '../jamEngine'

function formatLastSeen(ts) {
  if (!ts) return 'Offline'
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'Last seen just now'
  if (diffSec < 3600) return `Last seen ${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `Last seen ${Math.floor(diffSec / 3600)}h ago`
  return `Last seen ${Math.floor(diffSec / 86400)}d ago`
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

  const handleSelectAvatar = (av) => {
    const cleanEmoji = renderEmoji(av, '🎧')
    setProfile((prev) => ({ ...prev, avatar: cleanEmoji }))
    jamManager.updateUserProfile({ avatar: cleanEmoji })
  }

  const handleStartHost = async () => {
    await jamManager.createJam(googleUser, djModePref)
  }

  const handleJoinRoom = async (e) => {
    if (e) e.preventDefault()
    if (!joinCodeInput.trim()) return
    await jamManager.joinJam(joinCodeInput.trim(), googleUser)
  }

  const handleAddFriendSubmit = (e) => {
    if (e) e.preventDefault()
    if (!friendCodeInput.trim()) return
    const res = jamManager.sendFriendRequest(friendCodeInput.trim())
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
        onNotify(`Listening along to "${friend.currentTrack.title}" with ${friend.name}`, 'info')
      }
    }
  }

  const shareJamUrl = jamState?.roomCode
    ? `${window.location.origin}${window.location.pathname}?jam=${encodeURIComponent(jamState.roomCode)}`
    : ''

  const shareFriendUrl = myFriendCode
    ? `${window.location.origin}${window.location.pathname}?addFriend=${encodeURIComponent(myFriendCode)}`
    : ''

  const handleCopyRoomCode = () => {
    if (!jamState?.roomCode) return
    navigator.clipboard?.writeText(jamState.roomCode).catch(() => {})
    setCopiedRoomCode(true)
    setTimeout(() => setCopiedRoomCode(false), 2000)
  }

  const handleCopyRoomLink = () => {
    if (!shareJamUrl) return
    navigator.clipboard?.writeText(shareJamUrl).catch(() => {})
    setCopiedRoomLink(true)
    setTimeout(() => setCopiedRoomLink(false), 2000)
  }

  const handleCopyFriendCode = () => {
    if (!myFriendCode) return
    navigator.clipboard?.writeText(myFriendCode).catch(() => {})
    setCopiedFriendCode(true)
    setTimeout(() => setCopiedFriendCode(false), 2000)
  }

  const handleCopyFriendLink = () => {
    if (!shareFriendUrl) return
    navigator.clipboard?.writeText(shareFriendUrl).catch(() => {})
    setCopiedFriendLink(true)
    setTimeout(() => setCopiedFriendLink(false), 2000)
  }

  const syncTier = jamState?.syncTier || 'LOCKED'
  const isInSync = syncTier === 'LOCKED' || syncTier === 'IN_SYNC'

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 select-none"
      style={{ fontFamily: 'inherit' }}
    >
      {/* Translucent Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Squircle Studio Glass Modal (border-radius: 20px) */}
      <div className="jam-glass-surface relative w-full max-w-lg rounded-[20px] shadow-2xl flex flex-col max-h-[88vh] z-10 overflow-hidden text-[var(--text-primary)]">
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-hover)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[14px] bg-[#F43F5E]/15 border border-[#F43F5E]/30 flex items-center justify-center text-[#F43F5E] shrink-0 relative">
              <Users className="w-5 h-5" />
              {(jamState?.active || onlineFriendsCount > 0) && (
                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] ring-2 ring-[var(--bg-primary)] absolute -top-0.5 -right-0.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                  Friends & Live Jam
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30">
                  P2P Studio Sync
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] truncate">
                Listen together in real time & see what friends are playing
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two Top Primary Navigation Tabs: 🎵 Live Jam & 👥 Friends (Online Count) */}
        <div className="px-5 pt-3.5 pb-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="grid grid-cols-2 gap-2 p-1 rounded-[14px] bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setMainTab('jam')}
              className={`py-2 px-3 rounded-[10px] text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                mainTab === 'jam'
                  ? 'bg-[#F43F5E] text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>🎵 Live Jam</span>
              {jamState?.active && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    mainTab === 'jam'
                      ? 'bg-white/20 text-white'
                      : 'bg-[#10B981]/20 text-[#10B981]'
                  }`}
                >
                  {jamState.participants?.length || 1}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMainTab('friends')
                jamManager.pingAllFriends()
              }}
              className={`py-2 px-3 rounded-[10px] text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer relative ${
                mainTab === 'friends'
                  ? 'bg-[#F43F5E] text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>👥 Friends ({onlineFriendsCount})</span>
              {incomingRequests.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#F59E0B] text-white shadow-xs">
                  +{incomingRequests.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 content-scroll-container">
          {/* Identity Card (Shared across Jam & Friends) */}
          <div className="p-3.5 rounded-[16px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Your Studio Identity
              </span>
              <span className="text-[11px] font-mono font-bold text-[#F43F5E]">
                ID: {myFriendCode}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#F43F5E]/15 border border-[#F43F5E]/30 flex items-center justify-center text-xl shrink-0">
                {renderEmoji(profile.avatar, '🎧')}
              </div>
              <input
                type="text"
                value={profile.name}
                onChange={handleNameChange}
                placeholder="Your display name..."
                maxLength={28}
                className="jam-input-field flex-1 rounded-[12px] px-3.5 py-2 text-sm font-semibold focus:outline-none transition-colors"
              />
            </div>

            {/* Avatar Selector */}
            <div className="flex items-center justify-between gap-1.5 pt-0.5">
              {JAM_AVATARS.map((item) => {
                const emojiChar = renderEmoji(item, '🎧')
                const isSelected = renderEmoji(profile.avatar, '🎧') === emojiChar
                return (
                  <button
                    key={emojiChar}
                    type="button"
                    onClick={() => handleSelectAvatar(emojiChar)}
                    className={`w-9 h-9 rounded-[11px] text-base flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#F43F5E]/20 border-2 border-[#F43F5E] scale-105 shadow-xs'
                        : 'bg-[var(--surface-hover)] border border-[var(--border-subtle)] opacity-75 hover:opacity-100'
                    }`}
                  >
                    {emojiChar}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ================================================================ */}
          {/* TAB 1: 🎵 LIVE JAM                                               */}
          {/* ================================================================ */}
          {mainTab === 'jam' ? (
            !jamState?.active ? (
              <>
                {/* Host vs Join Switcher */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-[14px] bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setJamSubTab('host')}
                    className={`py-2 rounded-[10px] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      jamSubTab === 'host'
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Crown className="w-3.5 h-3.5 text-[#F59E0B]" />
                    <span>Host a Jam</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setJamSubTab('join')}
                    className={`py-2 rounded-[10px] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      jamSubTab === 'join'
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 text-[#10B981]" />
                    <span>Join Friend's Jam</span>
                  </button>
                </div>

                {jamSubTab === 'host' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-[var(--text-secondary)]">
                        Room Control Permissions
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setDjModePref('open_party')}
                          className={`p-3.5 rounded-[16px] border text-left transition-all cursor-pointer ${
                            djModePref === 'open_party'
                              ? 'bg-[#10B981]/12 border-[#10B981]/45 text-[var(--text-primary)]'
                              : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold flex items-center gap-1.5 text-[var(--text-primary)]">
                              <Sparkles className="w-3.5 h-3.5 text-[#10B981]" />
                              Open Party Mode
                            </span>
                            {djModePref === 'open_party' && (
                              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            Anyone in the Jam can pause, skip, or add songs to the queue.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDjModePref('host_only')}
                          className={`p-3.5 rounded-[16px] border text-left transition-all cursor-pointer ${
                            djModePref === 'host_only'
                              ? 'bg-[#F59E0B]/12 border-[#F59E0B]/45 text-[var(--text-primary)]'
                              : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold flex items-center gap-1.5 text-[var(--text-primary)]">
                              <Shield className="w-3.5 h-3.5 text-[#F59E0B]" />
                              Host Only (DJ)
                            </span>
                            {djModePref === 'host_only' && (
                              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            Only you control playback and seeking; friends listen in sync.
                          </p>
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartHost}
                      className="w-full py-3.5 rounded-[14px] bg-[#F43F5E] hover:bg-rose-600 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Users className="w-4 h-4" />
                      <span>Start Live Jam Room</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleJoinRoom} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                        Enter 4-Digit Jam Code
                      </label>
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="JAM-4829 or 4829"
                        maxLength={10}
                        className="jam-input-field w-full rounded-[14px] px-4 py-3 text-center font-mono text-lg font-bold tracking-widest uppercase focus:outline-none transition-colors"
                      />
                      {jamState?.error && (
                        <p className="text-xs text-[#F43F5E] mt-2 text-center font-medium">
                          {jamState.error}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!joinCodeInput.trim()}
                      className="w-full py-3.5 rounded-[14px] bg-[#F43F5E] hover:bg-rose-600 disabled:opacity-40 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Radio className="w-4 h-4" />
                      <span>Connect & Sync Audio</span>
                    </button>
                  </form>
                )}
              </>
            ) : (
              /* ACTIVE JAM DASHBOARD */
              <div className="space-y-4">
                {/* Room Code & Invite Card */}
                <div className="p-4 rounded-[16px] bg-[var(--bg-card)] border border-[#10B981]/35 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#10B981] block">
                        {jamState.role === 'host' ? 'Hosting Live Jam' : `Connected to ${jamState.hostName || 'Host'}`}
                      </span>
                      <div className="text-2xl font-black font-mono tracking-wider text-[var(--text-primary)] mt-0.5">
                        {jamState.roomCode}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        className="px-3 py-2 rounded-[12px] bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Copy Room Code"
                      >
                        {copiedRoomCode ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedRoomCode ? 'Copied' : 'Code'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyRoomLink}
                        className="px-3 py-2 rounded-[12px] bg-[#F43F5E] hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        title="Copy Instant Join Link"
                      >
                        {copiedRoomLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{copiedRoomLink ? 'Link Copied' : 'Invite Link'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowQr((prev) => !prev)}
                        className="p-2 rounded-[12px] bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        title="Show QR Code"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Optional QR Code Drawer */}
                  {showQr && shareJamUrl && (
                    <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col items-center gap-2">
                      <div className="p-2.5 bg-white rounded-2xl shadow-md">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(shareJamUrl)}`}
                          alt="Jam QR Code"
                          className="w-32 h-32 rounded-lg"
                        />
                      </div>
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        Scan with phone camera to join {jamState.roomCode}
                      </span>
                    </div>
                  )}

                  {/* Acoustic Telemetry Bar */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-secondary)] font-mono">
                    <span className="flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5 text-[#10B981]" />
                      <span>
                        Status:{' '}
                        <strong className={isInSync ? 'text-[#10B981]' : 'text-[#F59E0B]'}>
                          {isInSync ? 'In Sync' : syncTier === 'RAMPING' ? 'Aligning' : 'Syncing'}
                        </strong>
                      </span>
                    </span>
                    <span>
                      RTT: {jamState.rttMs || 12}ms • Drift: {Math.abs(jamState.syncDeltaMs || 0)}ms
                    </span>
                  </div>
                </div>

                {/* Currently Playing in Jam */}
                {currentTrack && (
                  <div className="p-3 rounded-[14px] bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center gap-3">
                    {currentTrack.thumbnail ? (
                      <img
                        src={currentTrack.thumbnail}
                        alt=""
                        className="w-11 h-11 rounded-[10px] object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-[10px] bg-[#F43F5E]/15 flex items-center justify-center text-[#F43F5E] shrink-0">
                        <Music className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#10B981]">
                        {isPlaying ? '▶ Playing in Sync' : '⏸ Paused in Room'}
                      </div>
                      <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                        {currentTrack.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate">
                        {currentTrack.artist}
                      </div>
                    </div>
                  </div>
                )}

                {/* Host DJ Mode Switch */}
                {jamState.role === 'host' && (
                  <div className="flex items-center justify-between p-3 rounded-[14px] bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                    <div>
                      <div className="text-xs font-bold text-[var(--text-primary)]">
                        Open Party DJ Mode
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        Allow guests to change tracks & control playback
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        jamManager.setDjMode(jamState.djMode === 'open_party' ? 'host_only' : 'open_party')
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                        jamState.djMode === 'open_party'
                          ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                          : 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]'
                      }`}
                    >
                      {jamState.djMode === 'open_party' ? 'Open Party' : 'Host Only'}
                    </button>
                  </div>
                )}

                {/* Live Emoji Reactions Bar */}
                <div>
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Send Live Reaction
                  </span>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {JAM_REACTION_PRESETS.map((item) => {
                      const emojiChar = renderEmoji(item, '🔥')
                      const labelText = typeof item === 'object' && item?.label ? item.label : emojiChar
                      return (
                        <button
                          key={emojiChar}
                          type="button"
                          onClick={() => jamManager.sendReaction(emojiChar)}
                          className="py-2 rounded-[12px] bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] active:scale-90 border border-[var(--border-subtle)] flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer"
                          title={labelText}
                        >
                          <span className="text-lg">{emojiChar}</span>
                          <span className="text-[9px] font-semibold text-[var(--text-muted)]">
                            {labelText}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Participants List */}
                <div>
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Listeners in Room ({jamState.participants?.length || 1})
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {(jamState.participants || []).map((p, idx) => {
                      const avatarEmoji = renderEmoji(p?.avatar, '🎧')
                      return (
                        <div
                          key={p?.id || p?.peerId || idx}
                          className="flex items-center justify-between px-3 py-2 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-subtle)]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-sm shrink-0">
                              {avatarEmoji}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                                <span>{p?.name || 'Listener'}</span>
                                {p?.isHost && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded-full bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30">
                                    Host
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] font-mono">
                                {p?.friendCode || 'Synced Audio'}
                              </div>
                            </div>
                          </div>

                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Synced
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Quick Invite Online Friends inside Active Jam */}
                {friends.length > 0 && (
                  <div>
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Quick Invite Friends
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {friends.map((f) => (
                        <div
                          key={f.friendCode}
                          className="flex items-center justify-between px-3 py-2 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-subtle)]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base">{renderEmoji(f.avatar, '🎧')}</span>
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {f.name}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                f.online ? 'bg-[#10B981]' : 'bg-[var(--text-muted)] opacity-50'
                              }`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleInviteFriend(f.friendCode)}
                            className="px-2.5 py-1 rounded-full bg-[#F43F5E]/15 hover:bg-[#F43F5E] text-[#F43F5E] hover:text-white border border-[#F43F5E]/30 text-[11px] font-bold transition-all cursor-pointer"
                          >
                            {invitedCodes[f.friendCode] ? 'Invited ✓' : 'Invite'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Leave / End Jam Button */}
                <button
                  type="button"
                  onClick={() => jamManager.leaveJam(false)}
                  className="w-full py-2.5 rounded-[14px] bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 border border-[#F43F5E]/35 text-[#F43F5E] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{jamState.role === 'host' ? 'End Jam Session for All' : 'Leave Jam Session'}</span>
                </button>
              </div>
            )
          ) : (
            /* ================================================================ */
            /* TAB 2: 👥 FRIENDS (Real-Time Presence, Now Playing & Jam Invites) */
            /* ================================================================ */
            <div className="space-y-4">
              {/* Share Your Friend Code Card */}
              <div className="p-3.5 rounded-[16px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                      Your Personal Friend Code
                    </span>
                    <span className="text-lg font-black font-mono tracking-wider text-[var(--text-primary)]">
                      {myFriendCode}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyFriendCode}
                      className="px-3 py-1.5 rounded-[10px] bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedFriendCode ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedFriendCode ? 'Copied' : 'Copy ID'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyFriendLink}
                      className="px-3 py-1.5 rounded-[10px] bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 border border-[#F43F5E]/35 text-[#F43F5E] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedFriendLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                      <span>{copiedFriendLink ? 'Link Copied' : 'Share Link'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Send Friend Request Form */}
              <form onSubmit={handleAddFriendSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={friendCodeInput}
                  onChange={(e) => setFriendCodeInput(e.target.value.toUpperCase())}
                  placeholder="Enter friend's code (e.g. UP-7K4M9P)"
                  maxLength={12}
                  className="jam-input-field flex-1 rounded-[12px] px-3.5 py-2.5 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={!friendCodeInput.trim()}
                  className="px-4 py-2.5 rounded-[12px] bg-[#F43F5E] hover:bg-rose-600 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Send Request</span>
                </button>
              </form>

              {/* Incoming Friend Requests */}
              {incomingRequests.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-[#F59E0B]">
                    Incoming Friend Requests ({incomingRequests.length})
                  </span>
                  <div className="space-y-1.5">
                    {incomingRequests.map((req) => (
                      <div
                        key={req.friendCode}
                        className="flex items-center justify-between p-3 rounded-[14px] bg-[#F59E0B]/10 border border-[#F59E0B]/30"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-9 h-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-base shrink-0">
                            {renderEmoji(req.avatar, '🎧')}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {req.name}
                            </div>
                            <div className="text-[10px] font-mono text-[var(--text-secondary)]">
                              {req.friendCode}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => jamManager.acceptFriendRequest(req.friendCode)}
                            className="px-3 py-1.5 rounded-[10px] bg-[#10B981] hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => jamManager.declineFriendRequest(req.friendCode)}
                            className="px-2.5 py-1.5 rounded-[10px] bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-bold transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outgoing Pending Requests */}
              {outgoingRequests.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Outgoing Pending ({outgoingRequests.length})
                  </span>
                  {outgoingRequests.map((req) => (
                    <div
                      key={req.friendCode}
                      className="flex items-center justify-between px-3 py-2 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-subtle)]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{renderEmoji(req.avatar, '🎧')}</span>
                        <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                          {req.friendCode}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          • Waiting for acceptance
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => jamManager.cancelOutgoingRequest(req.friendCode)}
                        className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[#F43F5E] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* My Friends List & Live Activity Feed */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    My Friends ({friends.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => jamManager.pingAllFriends()}
                    className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer"
                    title="Refresh friend status"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {friends.length === 0 ? (
                  <div className="p-6 rounded-[16px] bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center space-y-1.5">
                    <UserCheck className="w-7 h-7 text-[var(--text-muted)] mx-auto opacity-60" />
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      No friends added yet
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] max-w-xs mx-auto leading-relaxed">
                      Share your <span className="font-mono font-bold text-[var(--text-primary)]">{myFriendCode}</span> code or enter a friend's code above to see their live music activity and send 1-click Jam invites.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {friends.map((f) => {
                      const friendEmoji = renderEmoji(f.avatar, '🎧')
                      const isOnline = Boolean(f.online)
                      const hasTrack = Boolean(f.currentTrack?.title)
                      return (
                        <div
                          key={f.friendCode}
                          className="p-3.5 rounded-[16px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-lg shrink-0 relative">
                                <span>{friendEmoji}</span>
                                <span
                                  className={`w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-primary)] absolute -bottom-0.5 -right-0.5 ${
                                    isOnline ? 'bg-[#10B981]' : 'bg-[var(--text-muted)]'
                                  }`}
                                />
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                                    {f.name}
                                  </span>
                                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                    ({f.friendCode})
                                  </span>
                                </div>

                                {/* Real-Time Status Line */}
                                {isOnline ? (
                                  hasTrack ? (
                                    <div className="text-[11px] text-[#10B981] font-medium truncate">
                                      🟢 Online — Listening to{' '}
                                      <span className="font-bold text-[var(--text-primary)]">
                                        {f.currentTrack.title}
                                      </span>{' '}
                                      <span className="text-[var(--text-secondary)]">
                                        - {f.currentTrack.artist}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-[#10B981] font-medium">
                                      🟢 Online — Idle in Studio
                                    </div>
                                  )
                                ) : (
                                  <div className="text-[11px] text-[var(--text-muted)]">
                                    ⚫ Offline • {formatLastSeen(f.lastSeen)}
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => jamManager.removeFriend(f.friendCode)}
                              className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[#F43F5E] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
                              title="Remove friend"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Action Buttons: Listen Along & 1-Click Invite to Jam */}
                          <div className="flex items-center justify-end gap-2 pt-1">
                            {(hasTrack || f.activeJamCode) && (
                              <button
                                type="button"
                                onClick={() => handleListenAlong(f)}
                                className="px-3 py-1.5 rounded-full bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/35 text-[#10B981] text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>
                                  {f.activeJamCode ? `Join Jam (${f.activeJamCode})` : 'Listen Along'}
                                </span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleInviteFriend(f.friendCode)}
                              className="px-3 py-1.5 rounded-full bg-[#F43F5E] hover:bg-rose-600 text-white text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                            >
                              <Send className="w-3 h-3" />
                              <span>
                                {invitedCodes[f.friendCode] ? 'Invite Sent ✓' : 'Invite to Jam'}
                              </span>
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
