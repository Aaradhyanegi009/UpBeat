import React, { useState, useEffect } from 'react'
import {
  X, Users, Radio, Copy, Check, Share2, Shield, Sparkles,
  LogOut, Wifi, Loader2, Crown, Music, QrCode
} from 'lucide-react'
import {
  jamManager,
  JAM_AVATARS,
  JAM_REACTIONS,
  loadJamUserProfile,
  saveJamUserProfile,
  normalizeRoomCode
} from '../jamEngine'

export default function JamModal({
  isOpen,
  onClose,
  jamState,
  googleUser,
  currentTrack,
  isPlaying,
  initialJoinCode = ''
}) {
  const [tab, setTab] = useState(initialJoinCode ? 'join' : 'host') // 'host' | 'join'
  const [joinCodeInput, setJoinCodeInput] = useState(initialJoinCode || '')
  const [djModePref, setDjModePref] = useState('open_party')
  const [profile, setProfile] = useState(() => loadJamUserProfile(googleUser))
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    if (initialJoinCode) {
      setTab('join')
      setJoinCodeInput(initialJoinCode)
    }
  }, [initialJoinCode])

  useEffect(() => {
    if (googleUser) {
      setProfile(loadJamUserProfile(googleUser))
    }
  }, [googleUser])

  if (!isOpen) return null

  const handleNameChange = (e) => {
    const val = e.target.value
    setProfile((prev) => ({ ...prev, name: val }))
    saveJamUserProfile({ name: val })
  }

  const handleSelectAvatar = (av) => {
    setProfile((prev) => ({ ...prev, avatar: av }))
    saveJamUserProfile({ avatar: av })
  }

  const handleStartHost = async () => {
    await jamManager.createJam(googleUser, djModePref)
  }

  const handleJoinRoom = async (e) => {
    if (e) e.preventDefault()
    if (!joinCodeInput.trim()) return
    await jamManager.joinJam(joinCodeInput.trim(), googleUser)
  }

  const shareUrl = jamState.roomCode
    ? `${window.location.origin}${window.location.pathname}?jam=${encodeURIComponent(jamState.roomCode)}`
    : ''

  const handleCopyCode = () => {
    if (!jamState.roomCode) return
    navigator.clipboard?.writeText(jamState.roomCode).catch(() => {})
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleCopyLink = () => {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).catch(() => {})
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/65 dark:bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Window */}
      <div className="relative w-full max-w-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-3xl shadow-2xl flex flex-col max-h-[88vh] z-10 overflow-hidden backdrop-blur-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-hover)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shadow-xs relative">
              <Users className="w-5 h-5" />
              {jamState.active && jamState.status === 'CONNECTED' && (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute -top-0.5 -right-0.5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                  UpBeat Jam
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  Live P2P Sync
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Listen to the exact same song in real time with friends
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          {!jamState.active ? (
            <>
              {/* Profile Customizer */}
              <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Your Jam Identity
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">Visible to friends</span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-xl shrink-0">
                    {profile.avatar}
                  </div>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={handleNameChange}
                    placeholder="Your display name..."
                    maxLength={24}
                    className="flex-1 bg-[var(--surface-hover)] border border-[var(--border-subtle)] focus:border-emerald-500/50 rounded-xl px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-1.5 justify-between pt-0.5">
                  {JAM_AVATARS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => handleSelectAvatar(av)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm transition-all cursor-pointer border ${
                        profile.avatar === av
                          ? 'bg-emerald-500/20 border-emerald-500 text-white scale-105 shadow-xs'
                          : 'bg-[var(--surface-hover)] border-transparent hover:border-[var(--border-subtle)]'
                      }`}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Switch Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setTab('host')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    tab === 'host'
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Host a Jam</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('join')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    tab === 'join'
                      ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Join Friend&apos;s Jam</span>
                </button>
              </div>

              {tab === 'host' ? (
                <div className="flex flex-col gap-3.5">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-[var(--text-secondary)]">
                      Room Control Permissions
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setDjModePref('open_party')}
                        className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          djModePref === 'open_party'
                            ? 'bg-emerald-500/15 border-emerald-500/50 text-[var(--text-primary)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-emerald-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Open Party Mode</span>
                          </span>
                          {djModePref === 'open_party' && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          Anyone in the Jam can pause, skip, or add songs to the queue.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDjModePref('host_only')}
                        className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          djModePref === 'host_only'
                            ? 'bg-amber-500/15 border-amber-500/50 text-[var(--text-primary)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-amber-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-amber-500" />
                            <span>Host Only (DJ)</span>
                          </span>
                          {djModePref === 'host_only' && (
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
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
                    className="w-full py-3.5 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-98"
                  >
                    <Users className="w-4 h-4" />
                    <span>Start Live Jam Room</span>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleJoinRoom} className="flex flex-col gap-3.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[var(--text-secondary)]">
                      Enter Friend&apos;s Jam Code
                    </label>
                    <input
                      type="text"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      placeholder="e.g. JAM-4829"
                      maxLength={10}
                      className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] focus:border-emerald-500 rounded-2xl px-4 py-3 text-center text-lg font-mono font-bold tracking-widest text-[var(--text-primary)] uppercase focus:outline-none"
                    />
                    <p className="text-[11px] text-[var(--text-muted)] text-center">
                      Ask the host for their 4-character Jam PIN or invite link
                    </p>
                  </div>

                  {jamState.error && (
                    <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-medium text-center">
                      {jamState.error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!joinCodeInput.trim()}
                    className="w-full py-3.5 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-98"
                  >
                    <Radio className="w-4 h-4" />
                    <span>Connect &amp; Sync Audio</span>
                  </button>
                </form>
              )}
            </>
          ) : (
            /* ACTIVE JAM DASHBOARD */
            <div className="flex flex-col gap-4">
              {/* Room Code & Share Banner */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5" />
                      <span>
                        {jamState.status === 'CONNECTING'
                          ? 'Connecting Room...'
                          : jamState.role === 'host'
                          ? 'Hosting Live Jam'
                          : `Synced with ${jamState.hostName || 'Host'}`}
                      </span>
                    </span>
                    <div className="text-2xl font-mono font-extrabold tracking-widest text-[var(--text-primary)] mt-0.5">
                      {jamState.roomCode}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="px-3 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      title="Copy Room Code"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCode ? 'Copied' : 'Code'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      title="Copy Invite Link"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Link Copied!' : 'Share Link'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowQr((prev) => !prev)}
                      className="p-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                      title="Show QR Code"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Optional Scannable QR Code */}
                {showQr && shareUrl && (
                  <div className="p-3 rounded-2xl bg-white flex flex-col items-center justify-center gap-2 self-center shadow-md">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareUrl)}`}
                      alt="Jam Room QR Code"
                      className="w-36 h-36 rounded-lg"
                    />
                    <span className="text-[11px] font-bold text-slate-700">
                      Scan with phone camera to join {jamState.roomCode}
                    </span>
                  </div>
                )}

                {/* Acoustic Sync Telemetry Bar */}
                <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)] font-medium">
                    {jamState.role === 'host'
                      ? 'Master Clock Active (2.0s pulse)'
                      : `Latency: ~${jamState.rttMs}ms • Drift: ${jamState.syncDeltaMs}ms`}
                  </span>
                  <span className="font-bold text-emerald-500">
                    {jamState.syncTier === 'IN_SYNC'
                      ? '● Locked In Sync'
                      : jamState.syncTier === 'RAMPING'
                      ? '⚡ Micro-Phase Adjusting'
                      : '↻ Seeking to Host'}
                  </span>
                </div>
              </div>

              {/* Currently Playing in Jam */}
              {currentTrack && (
                <div className="p-3 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center gap-3">
                  <img
                    src={currentTrack.thumbnail || `https://i.ytimg.com/vi/${currentTrack.video_id}/hqdefault.jpg`}
                    alt=""
                    className="w-11 h-11 rounded-xl object-cover shrink-0 border border-[var(--border-subtle)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Music className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                        {isPlaying ? 'Now Jamming' : 'Paused in Jam'}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {currentTrack.title}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)] truncate">
                      {currentTrack.artist}
                    </p>
                  </div>
                </div>
              )}

              {/* Host Permission Toggle */}
              {jamState.role === 'host' && (
                <div className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <span className="text-xs font-bold text-[var(--text-primary)] block">
                      Guest DJ Controls
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {jamState.djMode === 'open_party'
                        ? 'Friends can play, pause, skip & queue songs'
                        : 'Only you can control playback'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      jamManager.setDjMode(jamState.djMode === 'open_party' ? 'host_only' : 'open_party')
                    }
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      jamState.djMode === 'open_party'
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-500'
                        : 'bg-amber-500/15 border-amber-500/40 text-amber-500'
                    }`}
                  >
                    {jamState.djMode === 'open_party' ? '🎉 Open Party' : '🔒 Host Only'}
                  </button>
                </div>
              )}

              {/* Connected Friends List */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Listeners in Room ({jamState.participants.length})
                  </span>
                </div>

                <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                  {jamState.participants.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-sm shrink-0">
                          {p.avatar || '🎧'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {p.name}
                            </span>
                            {p.isHost && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                👑 Host
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {p.isHost ? 'Master Audio Clock' : 'Synced via WebRTC'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>In Sync</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Live Emoji Reactions */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  Send Live Reaction
                </span>
                <div className="grid grid-cols-6 gap-2">
                  {JAM_REACTIONS.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => jamManager.sendReaction(r.emoji)}
                      className="py-2.5 rounded-2xl bg-[var(--surface-hover)] hover:bg-emerald-500/15 border border-[var(--border-subtle)] hover:border-emerald-500/40 flex flex-col items-center gap-0.5 transition-all cursor-pointer active:scale-90"
                    >
                      <span className="text-lg">{r.emoji}</span>
                      <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                        {r.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Leave / End Session Button */}
              <button
                type="button"
                onClick={() => jamManager.leaveJam()}
                className="w-full py-3 px-4 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-500 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>{jamState.role === 'host' ? 'End Jam Session for All' : 'Leave Jam Room'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
