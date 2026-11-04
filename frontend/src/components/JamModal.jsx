import React, { useEffect, useState } from 'react'
import { X, Copy, Check, Share2, QrCode, UserPlus, Trash2, LogOut, Radio, Users, Crown, Play } from 'lucide-react'
import { jamManager, loadJamUserProfile, normalizeFriendCode, buildJamInviteUrl, buildFriendInviteUrl } from '../jamEngine'
import { Avatar, Art, Chip, IconButton, ActionMenu, Spinner } from '../ui/primitives'

function lastSeen(ts) {
  if (!ts) return 'Offline'
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'Seen just now'
  if (s < 3600) return `Seen ${Math.floor(s / 60)} min ago`
  if (s < 86400) return `Seen ${Math.floor(s / 3600)} h ago`
  return `Seen ${Math.floor(s / 86400)} d ago`
}

async function shareOrCopy({ title, text, url }, onCopied) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    onCopied?.()
  } catch {}
}

function qrUrl(data) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(data)}`
}

/** Friends & Jam hub. Same props as before so App doesn't change. */
export default function JamModal({ isOpen, onClose, jamState, googleUser, currentTrack, initialJoinCode = '', initialFriendCode = '', initialSection = '', onPlayTrack, onNotify }) {
  const [tab, setTab] = useState('jam')
  const [joinCode, setJoinCode] = useState(initialJoinCode || '')
  const [friendCode, setFriendCode] = useState(initialFriendCode || '')
  const [everyoneControls, setEveryoneControls] = useState(true)
  const [profile, setProfile] = useState(() => loadJamUserProfile(googleUser))
  const [qrFor, setQrFor] = useState('') // '' | 'room' | 'friend'
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const [invited, setInvited] = useState({})

  useEffect(() => {
    if (initialJoinCode) {
      setTab('jam')
      setJoinCode(initialJoinCode)
    }
  }, [initialJoinCode])

  useEffect(() => {
    if (initialFriendCode) {
      setTab('friends')
      setFriendCode(initialFriendCode)
    } else if (initialSection === 'friends') setTab('friends')
    else if (initialSection === '') setTab('jam')
  }, [initialFriendCode, initialSection, isOpen])

  useEffect(() => {
    setProfile(googleUser ? jamManager.refreshProfile(googleUser) : loadJamUserProfile())
  }, [googleUser, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const active = Boolean(jamState?.active)
  const isHost = Boolean(jamState?.isHost)
  const friends = jamState?.friends || []
  const incoming = jamState?.incomingRequests || []
  const outgoing = jamState?.outgoingRequests || []
  const online = friends.filter((f) => f.online)
  const sortedFriends = [...friends].sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeen || 0) - (a.lastSeen || 0))
  const myCode = profile?.friendCode || jamState?.userProfile?.friendCode || ''
  const roomUrl = jamState?.roomCode ? buildJamInviteUrl(jamState.roomCode) : ''
  const friendUrl = myCode ? buildFriendInviteUrl(myCode) : ''
  const participants = jamState?.participants || []
  const inSync = ['LOCKED', 'IN_SYNC'].includes(jamState?.syncTier || 'LOCKED')
  const connecting = jamState?.status === 'CONNECTING'

  const flash = (key) => {
    setCopied(key)
    setTimeout(() => setCopied(''), 1800)
  }
  const copyText = async (text, key, msg) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {}
    flash(key)
    onNotify?.(msg, 'success')
  }

  const startJam = async () => {
    setBusy('start')
    try {
      await jamManager.createJam(googleUser, everyoneControls ? 'open_party' : 'host_only')
    } finally {
      setBusy('')
    }
  }

  const joinJam = async (e) => {
    e?.preventDefault()
    if (!joinCode.trim() || busy) return
    setBusy('join')
    try {
      await jamManager.joinJam(joinCode.trim(), googleUser)
    } finally {
      setBusy('')
    }
  }

  const addFriend = (e) => {
    e?.preventDefault()
    const raw = friendCode.trim()
    if (!raw) return
    const res = jamManager.sendFriendRequest(normalizeFriendCode(raw) || raw)
    if (res?.ok) {
      setFriendCode('')
      onNotify?.(res.status === 'already_friends' ? 'You are already friends' : res.status === 'accepted' ? 'Friend added' : 'Request sent', 'success')
    }
  }

  const invite = async (code) => {
    await jamManager.inviteFriendToJam(code, googleUser)
    setInvited((p) => ({ ...p, [code]: true }))
    setTimeout(() => setInvited((p) => ({ ...p, [code]: false })), 2500)
  }

  const listenAlong = async (f) => {
    if (f.activeJamCode) {
      await jamManager.joinJam(f.activeJamCode, googleUser)
      setTab('jam')
    } else if (f.currentTrack) {
      onPlayTrack?.(f.currentTrack, 0, [f.currentTrack])
      onNotify?.(`Playing what ${f.name} is listening to`, 'info')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center select-none" role="dialog" aria-modal="true" aria-labelledby="jam-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div className="relative w-full sm:w-[520px] h-[92dvh] sm:h-auto sm:max-h-[86vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 overflow-hidden">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 shrink-0">
          <h2 id="jam-title" className="text-xl font-extrabold tracking-[-0.015em]">
            Listen together
          </h2>
          <IconButton label="Close" size={40} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 mx-5 mt-3 rounded-xl bg-s2 shrink-0" role="tablist">
          {[
            { id: 'jam', label: active ? 'Jam · live' : 'Jam' },
            { id: 'friends', label: online.length ? `Friends · ${online.length} online` : incoming.length ? `Friends · ${incoming.length} new` : 'Friends' }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`h-9 rounded-[9px] text-sm font-bold cursor-pointer transition-colors ${tab === t.id ? 'bg-t1 text-[#0A0A0B]' : 'text-t2 hover:text-t1'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6 pt-4 pb-safe">
          {tab === 'jam' &&
            (active ? (
              <div className="flex flex-col gap-4">
                {/* Room */}
                <div className="rounded-2xl bg-s2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-live">
                      <span className="relative flex w-2.5 h-2.5">
                        <span className="absolute inset-0 rounded-full bg-live animate-ping opacity-60" />
                        <span className="relative w-2.5 h-2.5 rounded-full bg-live" />
                      </span>
                      Live · {participants.length || 1} listening
                    </div>
                    <span className="text-xs font-semibold text-t2">
                      {connecting ? 'Connecting…' : isHost ? 'You’re hosting' : inSync ? 'In sync' : 'Catching up…'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-t2">Room code</div>
                      <div className="text-[28px] font-extrabold tracking-[0.06em] tabular-nums leading-tight">{jamState.roomCode}</div>
                    </div>
                    <div className="flex gap-1">
                      <IconButton label="Copy code" variant="filled" onClick={() => copyText(jamState.roomCode, 'room', 'Room code copied')}>
                        {copied === 'room' ? <Check className="w-5 h-5 text-live" /> : <Copy className="w-5 h-5" />}
                      </IconButton>
                      <IconButton label="Show QR code" variant="filled" active={qrFor === 'room'} onClick={() => setQrFor(qrFor === 'room' ? '' : 'room')}>
                        <QrCode className="w-5 h-5" />
                      </IconButton>
                      <IconButton
                        label="Share invite link"
                        variant="light"
                        onClick={() =>
                          shareOrCopy({ title: 'Join my UpBeat Jam', text: `Listen with me on UpBeat. Room ${jamState.roomCode}`, url: roomUrl }, () => {
                            flash('roomlink')
                            onNotify?.('Invite link copied', 'success')
                          })
                        }
                      >
                        {copied === 'roomlink' ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
                      </IconButton>
                    </div>
                  </div>
                  {qrFor === 'room' && roomUrl && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <img src={qrUrl(roomUrl)} alt={`QR code to join room ${jamState.roomCode}`} className="w-44 h-44 rounded-xl bg-white p-1" />
                      <span className="text-xs text-t2">Scan with a phone camera to join</span>
                    </div>
                  )}
                </div>

                {/* Now playing in the room */}
                {currentTrack && (
                  <div className="flex items-center gap-3">
                    <Art track={currentTrack} className="w-12 h-12" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-t2">Playing in the room</div>
                      <div className="text-[15px] font-bold truncate">{currentTrack.title}</div>
                      <div className="text-[13px] text-t2 truncate">{currentTrack.artist}</div>
                    </div>
                  </div>
                )}

                {/* Who can control */}
                {isHost ? (
                  <label className="flex items-center gap-3 rounded-2xl bg-s2 p-4 cursor-pointer">
                    <div className="flex-1">
                      <div className="text-[15px] font-bold">Everyone can control playback</div>
                      <div className="text-[13px] text-t2 mt-0.5">Off: only you can play, pause and skip. Others can still add songs.</div>
                    </div>
                    <Switch checked={jamState.djMode !== 'host_only'} onChange={(v) => jamManager.setDjMode(v ? 'open_party' : 'host_only')} label="Everyone can control playback" />
                  </label>
                ) : (
                  <p className="text-[13px] text-t2">
                    {jamState.djMode === 'host_only' ? `Only ${jamState.hostName || 'the host'} controls playback. Songs you pick are added to the shared queue.` : 'Everyone in the room can play, pause, skip and add songs.'}
                  </p>
                )}

                {/* Listeners */}
                <div>
                  <h3 className="text-sm font-bold text-t2 mb-1.5">In the room</h3>
                  {(participants.length ? participants : [{ id: 'me', name: profile?.name || 'You', isHost }]).map((p) => (
                    <div key={p.peerId || p.id} className="flex items-center gap-3 h-12">
                      <Avatar name={p.name} size={34} />
                      <span className="flex-1 text-[15px] font-semibold truncate">{p.name}</span>
                      {p.isHost && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-t2">
                          <Crown className="w-3.5 h-3.5" /> Host
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Invite online friends */}
                {online.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-t2 mb-1.5">Invite friends</h3>
                    {online.map((f) => (
                      <div key={f.friendCode} className="flex items-center gap-3 h-14">
                        <Avatar name={f.name} picture={f.picture} size={36} live />
                        <span className="flex-1 text-[15px] font-semibold truncate">{f.name}</span>
                        <Chip variant={invited[f.friendCode] ? 'ghost' : 'solid'} onClick={() => invite(f.friendCode)} disabled={invited[f.friendCode]}>
                          {invited[f.friendCode] ? 'Invited' : 'Invite'}
                        </Chip>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => jamManager.leaveJam(false)}
                  className="h-12 rounded-full ring-1 ring-inset ring-[#FF8A73]/40 text-[#FF8A73] font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer hover:bg-[#FF8A73]/10"
                >
                  <LogOut className="w-5 h-5" />
                  {isHost ? 'End Jam' : 'Leave Jam'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl bg-s2 p-4">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl bg-live/15 text-live flex items-center justify-center shrink-0" style={{ background: 'rgba(52,211,153,0.15)' }}>
                      <Radio className="w-5 h-5" />
                    </span>
                    <div>
                      <div className="text-base font-bold">Start a Jam</div>
                      <div className="text-[13px] text-t2">Friends hear exactly what you hear, in sync.</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4" role="radiogroup" aria-label="Who controls playback">
                    {[
                      { v: true, t: 'Everyone controls', d: 'Anyone can play, pause or skip' },
                      { v: false, t: 'Only me', d: 'Others can add songs' }
                    ].map((o) => (
                      <button
                        key={o.t}
                        type="button"
                        role="radio"
                        aria-checked={everyoneControls === o.v}
                        onClick={() => setEveryoneControls(o.v)}
                        className={`text-left p-3 rounded-xl cursor-pointer transition-colors ring-1 ring-inset ${everyoneControls === o.v ? 'ring-white/60 bg-white/[0.06]' : 'ring-white/10 hover:bg-white/[0.04]'}`}
                      >
                        <div className="text-sm font-bold">{o.t}</div>
                        <div className="text-xs text-t2 mt-0.5">{o.d}</div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={startJam}
                    disabled={busy === 'start'}
                    className="mt-4 w-full h-12 rounded-full bg-t1 text-[#0A0A0B] font-extrabold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {busy === 'start' ? <Spinner className="w-5 h-5 !border-black/20 !border-t-black" /> : <Play className="w-5 h-5 fill-current" />}
                    Start Jam
                  </button>
                </div>

                <form onSubmit={joinJam} className="rounded-2xl bg-s2 p-4">
                  <label htmlFor="jam-code" className="text-base font-bold">
                    Join with a code
                  </label>
                  <div className="flex gap-2 mt-3">
                    <input
                      id="jam-code"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="JAM-XXXX"
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 min-w-0 h-12 rounded-xl bg-s3 px-4 text-base font-bold tracking-[0.06em] placeholder:text-t3 placeholder:font-semibold focus:outline-none focus:ring-1 focus:ring-white/25"
                    />
                    <button type="submit" disabled={!joinCode.trim() || busy === 'join'} className="h-12 px-5 rounded-xl bg-t1 text-[#0A0A0B] font-bold cursor-pointer disabled:opacity-40">
                      {busy === 'join' ? 'Joining…' : 'Join'}
                    </button>
                  </div>
                  {jamState?.error && <p className="text-[13px] text-[#FFB4A6] mt-2">{String(jamState.error)}</p>}
                </form>

                {online.length > 0 && (
                  <p className="text-[13px] text-t2">
                    {online.length} friend{online.length > 1 ? 's are' : ' is'} online. Start a Jam to invite them.
                  </p>
                )}
              </div>
            ))}

          {tab === 'friends' && (
            <div className="flex flex-col gap-5">
              {/* You */}
              <div className="rounded-2xl bg-s2 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={profile?.name || 'You'} picture={googleUser?.picture} size={44} />
                  <div className="flex-1 min-w-0">
                    <label htmlFor="my-name" className="sr-only">
                      Your name
                    </label>
                    <input
                      id="my-name"
                      value={profile?.name || ''}
                      onChange={(e) => {
                        const name = e.target.value
                        setProfile((p) => ({ ...p, name }))
                        jamManager.updateUserProfile({ name })
                      }}
                      className="w-full bg-transparent text-base font-bold focus:outline-none focus:underline underline-offset-4"
                    />
                    <div className="text-[13px] text-t2 tabular-nums">Your code · {myCode}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3.5">
                  <Chip onClick={() => copyText(myCode, 'code', 'Friend code copied')}>
                    {copied === 'code' ? <Check className="w-4 h-4 text-live" /> : <Copy className="w-4 h-4" />}
                    Copy code
                  </Chip>
                  <Chip
                    onClick={() =>
                      shareOrCopy({ title: 'Add me on UpBeat', text: `Add me on UpBeat: ${myCode}`, url: friendUrl }, () => {
                        flash('friendlink')
                        onNotify?.('Invite link copied', 'success')
                      })
                    }
                  >
                    <Share2 className="w-4 h-4" />
                    Share link
                  </Chip>
                  <Chip active={qrFor === 'friend'} onClick={() => setQrFor(qrFor === 'friend' ? '' : 'friend')}>
                    <QrCode className="w-4 h-4" />
                    QR
                  </Chip>
                </div>
                {qrFor === 'friend' && friendUrl && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <img src={qrUrl(friendUrl)} alt="QR code to add you as a friend" className="w-44 h-44 rounded-xl bg-white p-1" />
                    <span className="text-xs text-t2">Friends scan this to add you</span>
                  </div>
                )}
              </div>

              <form onSubmit={addFriend} className="flex gap-2">
                <label htmlFor="friend-code" className="sr-only">
                  Friend code
                </label>
                <input
                  id="friend-code"
                  value={friendCode}
                  onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                  placeholder="Add a friend: UP-XXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 h-12 rounded-xl bg-s2 px-4 text-[15px] font-semibold placeholder:text-t3 focus:outline-none focus:ring-1 focus:ring-white/25"
                />
                <button type="submit" disabled={!friendCode.trim()} className="h-12 px-4 rounded-xl bg-t1 text-[#0A0A0B] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
                  <UserPlus className="w-4 h-4" />
                  Add
                </button>
              </form>

              {incoming.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-t2 mb-1.5">Friend requests</h3>
                  {incoming.map((r) => (
                    <div key={r.friendCode} className="flex items-center gap-3 h-14">
                      <Avatar name={r.name} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-bold truncate">{r.name || r.friendCode}</div>
                        <div className="text-xs text-t2">{r.friendCode}</div>
                      </div>
                      <Chip variant="ghost" onClick={() => jamManager.declineFriendRequest(r.friendCode)}>
                        Decline
                      </Chip>
                      <Chip active onClick={() => jamManager.acceptFriendRequest(r.friendCode)}>
                        Accept
                      </Chip>
                    </div>
                  ))}
                </section>
              )}

              {outgoing.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-t2 mb-1.5">Waiting for reply</h3>
                  {outgoing.map((r) => (
                    <div key={r.friendCode} className="flex items-center gap-3 h-12">
                      <span className="flex-1 text-[15px] font-semibold tabular-nums">{r.name && r.name !== r.friendCode ? `${r.name} · ` : ''}{r.friendCode}</span>
                      <Chip variant="ghost" onClick={() => jamManager.cancelOutgoingRequest(r.friendCode)}>
                        Cancel
                      </Chip>
                    </div>
                  ))}
                </section>
              )}

              <section>
                <h3 className="text-sm font-bold text-t2 mb-1.5">Friends</h3>
                {sortedFriends.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-2xl bg-s2 flex items-center justify-center text-t2 mx-auto mb-3">
                      <Users className="w-6 h-6" />
                    </div>
                    <p className="text-sm text-t2 max-w-xs mx-auto">Share your code or QR. When friends add you, you’ll see what they’re playing here.</p>
                  </div>
                ) : (
                  sortedFriends.map((f) => (
                    <div key={f.friendCode} className="flex items-center gap-3 min-h-[60px] py-1.5">
                      <Avatar name={f.name} picture={f.picture} size={42} live={f.online} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-bold truncate">{f.name}</div>
                        <div className="text-[13px] text-t2 truncate">
                          {f.online ? (f.activeJamCode ? 'In a Jam' : f.currentTrack ? `${f.currentTrack.title} · ${f.currentTrack.artist || ''}` : 'Online') : lastSeen(f.lastSeen)}
                        </div>
                      </div>
                      {f.online && (f.activeJamCode || f.currentTrack) && (
                        <Chip variant="ghost" onClick={() => listenAlong(f)}>
                          {f.activeJamCode ? 'Join' : 'Listen along'}
                        </Chip>
                      )}
                      <ActionMenu
                        label={`More for ${f.name}`}
                        items={[
                          f.online && { label: invited[f.friendCode] ? 'Invited' : 'Invite to a Jam', icon: Radio, onClick: () => invite(f.friendCode) },
                          { label: 'Remove friend', icon: Trash2, danger: true, onClick: () => jamManager.removeFriend(f.friendCode) }
                        ].filter(Boolean)}
                      />
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-colors cursor-pointer ${checked ? 'bg-accent' : 'bg-s3'}`}
    >
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}
