import React, { useState, useRef, useEffect } from 'react'
import { Radio, Users, Check, Copy, Share2, ExternalLink, X, LogOut, ChevronRight, Sparkles } from 'lucide-react'
import { jamManager, buildJamInviteUrl } from '../jamEngine'

export default function JamFloatingBar({
  jamState,
  googleUser = null,
  onOpenJamModal,
  hideWidget = false
}) {
  const incomingInvite = jamState?.incomingJamInvite
  const hasActiveJam = Boolean(jamState?.active)

  // Floating icon position (movable / draggable)
  // Default to safe bottom-right corner, well above the PlayerBar
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      const x = Math.max(16, window.innerWidth - 76)
      const y = Math.max(100, window.innerHeight - 170)
      return { x, y }
    }
    return { x: 300, y: 500 }
  })

  const [isExpanded, setIsExpanded] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const elementStartRef = useRef({ x: 0, y: 0 })
  const didMoveRef = useRef(false)

  // Keep within viewport bounds on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const maxX = window.innerWidth - 68
        const maxY = window.innerHeight - 100
        return {
          x: Math.min(Math.max(12, prev.x), Math.max(12, maxX)),
          y: Math.min(Math.max(64, prev.y), Math.max(64, maxY))
        }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Drag handlers using pointer events (desktop mouse + mobile touch)
  const handlePointerDown = (e) => {
    // Only drag with left mouse button or touch
    if (e.button !== undefined && e.button !== 0) return
    isDraggingRef.current = true
    didMoveRef.current = false
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    elementStartRef.current = { ...position }

    // Capture pointer to track smoothly outside element
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      didMoveRef.current = true
    }

    const maxX = window.innerWidth - (isExpanded ? 320 : 60)
    const maxY = window.innerHeight - (isExpanded ? 140 : 60)
    const newX = Math.min(Math.max(12, elementStartRef.current.x + dx), Math.max(12, maxX))
    const newY = Math.min(Math.max(64, elementStartRef.current.y + dy), Math.max(64, maxY))

    setPosition({ x: newX, y: newY })
  }

  const handlePointerUp = (e) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    // If user clicked without dragging, toggle expanded menu
    if (!didMoveRef.current) {
      setIsExpanded((prev) => !prev)
    }
  }

  const handleAcceptJamInvite = async () => {
    if (!incomingInvite?.roomCode) return
    const code = incomingInvite.roomCode
    jamManager.dismissJamInvite()
    await jamManager.joinJam(code, googleUser)
  }

  const handleCopyCode = (e) => {
    e.stopPropagation()
    if (!jamState?.roomCode) return
    navigator.clipboard?.writeText(jamState.roomCode).catch(() => {})
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleShareLink = async (e) => {
    e?.stopPropagation?.()
    if (!jamState?.roomCode) return
    const url = buildJamInviteUrl(jamState.roomCode)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my UpBeat Live Jam',
          text: `Join my live listening session on UpBeat! Room: ${jamState.roomCode}`,
          url
        })
        return
      } catch (err) {
        if (err.name === 'AbortError') return
      }
    }
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const participants = jamState?.participants || []
  const syncTier = jamState?.syncTier || 'LOCKED'
  const isInSync = syncTier === 'LOCKED' || syncTier === 'IN_SYNC'

  return (
    <>
      {/* Incoming 1-Click Live Jam Invite Floating Glass Banner */}
      {incomingInvite && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-24px)] max-w-md pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="bg-white/95 dark:bg-[#121218]/95 border border-slate-200 dark:border-white/10 rounded-2xl p-3.5 sm:px-4 shadow-2xl flex items-center justify-between gap-3 text-slate-900 dark:text-white backdrop-blur-2xl">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-500 shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">
                  {incomingInvite.hostName} invited you to Jam
                </div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate font-mono">
                  Room: {incomingInvite.roomCode}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleAcceptJamInvite}
                className="px-3.5 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-all cursor-pointer shadow-md active:scale-95"
              >
                Join
              </button>
              <button
                type="button"
                onClick={() => jamManager.dismissJamInvite()}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Movable Jam Floating Widget (Icon by default, expands to bar menu when pressed) */}
      {hasActiveJam && !hideWidget && (
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            zIndex: 95,
            touchAction: 'none'
          }}
          className="select-none pointer-events-auto"
        >
          {!isExpanded ? (
            /* Movable Floating Jam Icon Button */
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative w-12 h-12 rounded-full bg-slate-900/90 dark:bg-[#14141c]/95 border border-emerald-500/40 text-white shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-transform backdrop-blur-xl group"
              title="Drag to move • Tap to open Jam menu"
            >
              <Radio className="w-5 h-5 text-emerald-400" />

              {/* Pulsing Emerald Live Indicator */}
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>

              {/* Participant Count Badge */}
              {participants.length > 1 && (
                <span className="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded-full bg-emerald-600 text-white text-[10px] font-bold font-mono border border-black shadow-xs">
                  {participants.length}
                </span>
              )}
            </div>
          ) : (
            /* Expanded Movable Jam Bar Menu */
            <div
              className="w-72 sm:w-80 rounded-2xl bg-white/95 dark:bg-[#121218]/95 border border-slate-200 dark:border-white/10 shadow-2xl p-3.5 backdrop-blur-2xl text-slate-900 dark:text-white space-y-3"
            >
              {/* Drag Handle & Header */}
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10 cursor-grab active:cursor-grabbing"
                title="Drag to reposition menu"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="text-xs font-bold font-mono tracking-wider text-emerald-600 dark:text-emerald-400 truncate">
                    {jamState.roomCode}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {participants.length}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-1 rounded-md text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    title="Copy room code"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleShareLink}
                    className="p-1 rounded-md text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    title="Share invite link"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExpanded(false)}
                    className="p-1 rounded-md text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    title="Minimize to icon"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Status and Participants Stack */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                  Status: <strong className={isInSync ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>{isInSync ? 'In Sync' : 'Aligning'}</strong>
                </span>

                <div className="flex -space-x-1.5 overflow-hidden">
                  {participants.slice(0, 4).map((p, idx) => (
                    <div
                      key={p.peerId || p.id || idx}
                      title={p.name || 'Listener'}
                      className="w-6 h-6 rounded-full bg-gradient-to-tr from-rose-500 to-indigo-600 border border-white dark:border-[#121218] flex items-center justify-center text-[10px] font-bold text-white shadow-xs"
                    >
                      {(p.name || 'U')[0].toUpperCase()}
                    </div>
                  ))}
                  {participants.length > 4 && (
                    <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 text-[9px] font-bold flex items-center justify-center text-slate-700 dark:text-zinc-300">
                      +{participants.length - 4}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions: Open Jam Hub / Leave */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsExpanded(false)
                    onOpenJamModal?.()
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/10 text-slate-900 dark:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Jam Hub</span>
                  <ExternalLink className="w-3 h-3 text-slate-400 dark:text-zinc-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsExpanded(false)
                    jamManager.leaveJam(false)
                  }}
                  className="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  title="Leave Jam"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Leave</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
