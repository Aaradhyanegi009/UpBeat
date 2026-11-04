import React from 'react'
import { Users, Sparkles, ChevronUp, Radio, X } from 'lucide-react'
import { jamManager, JAM_REACTIONS, renderEmoji } from '../jamEngine'

export default function JamFloatingBar({
  jamState,
  reactions = [],
  googleUser = null,
  onOpenJamModal
}) {
  const incomingInvite = jamState?.incomingJamInvite
  const hasActiveJam = Boolean(jamState?.active)
  const hasReactions = Array.isArray(reactions) && reactions.length > 0

  if (!hasActiveJam && !hasReactions && !incomingInvite) {
    return null
  }

  const participants = jamState?.participants || []
  const syncTier = jamState?.syncTier || 'LOCKED'
  const quickReactions = JAM_REACTIONS.slice(0, 4)

  const handleAcceptJamInvite = async () => {
    if (!incomingInvite?.roomCode) return
    const code = incomingInvite.roomCode
    jamManager.dismissJamInvite()
    await jamManager.joinJam(code, googleUser)
  }

  return (
    <>
      {/* Floating Emoji Particle Overlay */}
      {hasReactions && (
        <div className="fixed inset-0 pointer-events-none z-[130] overflow-hidden">
          {reactions.map((item) => {
            const emojiChar = renderEmoji(item?.emoji, '🔥')
            const senderAvatarChar = renderEmoji(item?.senderAvatar, '🎧')
            const senderNameText = String(item?.senderName || 'Listener')
            return (
              <div
                key={item.id}
                style={{
                  left: `${item.xOffset || 50}%`,
                  bottom: '110px',
                  animation: 'jamFloatUp 2.6s cubic-bezier(0.22, 1, 0.36, 1) forwards'
                }}
                className="absolute flex flex-col items-center pointer-events-none select-none"
              >
                <div className="text-3xl sm:text-4xl drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]">
                  {emojiChar}
                </div>
                <span className="mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-glass-heavy)] text-[var(--text-primary)] border border-[var(--border-subtle)] backdrop-blur-md whitespace-nowrap shadow-md">
                  {senderAvatarChar} {senderNameText}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Keyframe injection for floating reactions */}
      <style>{`
        @keyframes jamFloatUp {
          0% {
            opacity: 0;
            transform: translateY(16px) scale(0.65);
          }
          15% {
            opacity: 1;
            transform: translateY(0px) scale(1.1);
          }
          80% {
            opacity: 0.95;
            transform: translateY(-170px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-230px) scale(0.88);
          }
        }
      `}</style>

      {/* Incoming 1-Click Live Jam Invite Floating Glass Toast */}
      {incomingInvite && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-24px)] max-w-md pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="jam-glass-surface rounded-[20px] p-3.5 sm:px-4 shadow-2xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-lg shrink-0 relative">
                <span>{renderEmoji(incomingInvite.hostAvatar, '🎧')}</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[var(--bg-primary)] absolute -bottom-0.5 -right-0.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                  🎧 {incomingInvite.hostName} invited you to a Live Jam!
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                  {incomingInvite.currentTrack?.title
                    ? `Playing "${incomingInvite.currentTrack.title}" • ${incomingInvite.roomCode}`
                    : `Room ${incomingInvite.roomCode} • Real-time audio sync`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleAcceptJamInvite}
                className="px-3.5 py-1.5 rounded-full bg-[#F43F5E] hover:bg-rose-600 text-white text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 whitespace-nowrap"
              >
                Join Jam
              </button>
              <button
                type="button"
                onClick={() => jamManager.dismissJamInvite()}
                className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                title="Dismiss invite"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact Live Jam Pill Bar above PlayerBar */}
      {hasActiveJam && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[88px] sm:bottom-[98px] z-[95] w-[calc(100%-24px)] max-w-[540px] pointer-events-auto">
          <div className="jam-glass-pill flex items-center justify-between gap-2 px-3.5 py-2 rounded-full shadow-2xl">
            {/* Left: Room Code + Status */}
            <button
              type="button"
              onClick={onOpenJamModal}
              className="flex items-center gap-2.5 text-left group min-w-0 flex-1 cursor-pointer"
              title="Open Friends & Live Jam Hub"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10B981]"></span>
              </span>

              <div className="min-w-0 flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-primary)] font-mono truncate">
                  {jamState.roomCode}
                </span>
                <span className="hidden xs:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  <Users size={11} className="text-[#10B981]" />
                  {participants.length}
                </span>
                <span
                  className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    syncTier === 'LOCKED' || syncTier === 'IN_SYNC'
                      ? 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30'
                      : syncTier === 'RAMPING'
                      ? 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30'
                      : 'bg-[#F43F5E]/15 text-[#F43F5E] border-[#F43F5E]/30'
                  }`}
                >
                  <Sparkles size={9} />
                  {syncTier === 'LOCKED' || syncTier === 'IN_SYNC'
                    ? 'In Sync'
                    : syncTier === 'RAMPING'
                    ? 'Aligning'
                    : 'Syncing'}
                </span>
              </div>

              {/* Avatar Stack */}
              <div className="flex -space-x-1.5 overflow-hidden ml-1 shrink-0">
                {participants.slice(0, 4).map((p, idx) => {
                  const avatarEmoji = renderEmoji(p?.avatar, '🎧')
                  return (
                    <span
                      key={p?.peerId || p?.id || idx}
                      title={`${p?.name || 'Listener'}${p?.isHost ? ' (Host)' : ''}`}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs shadow-sm"
                    >
                      {avatarEmoji}
                    </span>
                  )
                })}
                {participants.length > 4 && (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#10B981]/15 border border-[#10B981]/35 text-[10px] font-bold text-[#10B981]">
                    +{participants.length - 4}
                  </span>
                )}
              </div>
            </button>

            {/* Right: Quick Emoji Reactions + Expand */}
            <div className="flex items-center gap-1 shrink-0">
              {quickReactions.map((item) => {
                const emojiChar = renderEmoji(item, '🔥')
                const labelText = typeof item === 'object' && item?.label ? item.label : emojiChar
                return (
                  <button
                    key={emojiChar}
                    type="button"
                    onClick={() => jamManager.sendReaction(emojiChar)}
                    className="w-7 h-7 rounded-full bg-[var(--surface-hover)] hover:bg-[var(--bg-elevated)] active:scale-90 border border-[var(--border-subtle)] flex items-center justify-center text-sm transition-all cursor-pointer"
                    title={`React with ${labelText}`}
                  >
                    {emojiChar}
                  </button>
                )
              })}

              <button
                type="button"
                onClick={onOpenJamModal}
                className="ml-1 w-7 h-7 rounded-full bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 text-[#F43F5E] border border-[#F43F5E]/30 flex items-center justify-center transition-all cursor-pointer"
                title="Open Friends & Live Jam Hub"
              >
                <ChevronUp size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
