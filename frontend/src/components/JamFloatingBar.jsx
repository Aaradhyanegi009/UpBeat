import React from 'react';
import { Radio, Users, Sparkles, ChevronUp } from 'lucide-react';
import { jamManager, JAM_REACTIONS } from '../jamEngine';

export default function JamFloatingBar({ jamState, reactions = [], onOpenJamModal }) {
    if (!jamState?.active && (!reactions || reactions.length === 0)) {
        return null;
    }

    const participants = jamState?.participants || [];
    const syncTier = jamState?.syncTier || 'LOCKED';
    const quickReactions = JAM_REACTIONS.slice(0, 4);

    return (
        <>
            {/* Floating Emoji Particle Overlay */}
            {reactions.length > 0 && (
                <div className="fixed inset-0 pointer-events-none z-[130] overflow-hidden">
                    {reactions.map((item) => (
                        <div
                            key={item.id}
                            style={{
                                left: `${item.xOffset || 50}%`,
                                bottom: '110px',
                                animation: 'jamFloatUp 2.6s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                            }}
                            className="absolute flex flex-col items-center pointer-events-none select-none"
                        >
                            <div className="text-3xl sm:text-4xl drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]">
                                {item.emoji}
                            </div>
                            <span className="mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/75 text-white border border-white/15 backdrop-blur-md whitespace-nowrap shadow-md">
                                {item.senderAvatar} {item.senderName}
                            </span>
                        </div>
                    ))}
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

            {/* Compact Live Jam Pill Bar above PlayerBar */}
            {jamState?.active && (
                <div className="fixed left-1/2 -translate-x-1/2 bottom-[88px] sm:bottom-[98px] z-[95] w-[calc(100%-24px)] max-w-[540px] pointer-events-auto">
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-[#101016]/90 backdrop-blur-2xl border border-emerald-500/35 shadow-[0_12px_36px_rgba(0,0,0,0.6),0_0_24px_rgba(16,185,129,0.14)]">
                        {/* Left: Room Code + Status */}
                        <button
                            type="button"
                            onClick={onOpenJamModal}
                            className="flex items-center gap-2.5 text-left group min-w-0 flex-1"
                            title="Open Jam Session Controls"
                        >
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>

                            <div className="min-w-0 flex items-center gap-2">
                                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400 font-mono truncate">
                                    {jamState.roomCode}
                                </span>
                                <span className="hidden xs:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.06] text-[#d4d4d8] border border-white/10">
                                    <Users size={11} className="text-emerald-400" />
                                    {participants.length}
                                </span>
                                <span
                                    className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                        syncTier === 'LOCKED'
                                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                            : syncTier === 'RAMPING'
                                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                    }`}
                                >
                                    <Sparkles size={9} />
                                    {syncTier === 'LOCKED'
                                        ? 'In Sync'
                                        : syncTier === 'RAMPING'
                                        ? 'Aligning'
                                        : 'Syncing'}
                                </span>
                            </div>

                            {/* Avatar Stack */}
                            <div className="flex -space-x-1.5 overflow-hidden ml-1 shrink-0">
                                {participants.slice(0, 4).map((p) => (
                                    <span
                                        key={p.peerId}
                                        title={`${p.name}${p.isHost ? ' (Host)' : ''}`}
                                        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#1c1c24] border border-white/15 text-xs shadow-sm"
                                    >
                                        {p.avatar || '🎧'}
                                    </span>
                                ))}
                                {participants.length > 4 && (
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300">
                                        +{participants.length - 4}
                                    </span>
                                )}
                            </div>
                        </button>

                        {/* Right: Quick Emoji Reactions + Expand */}
                        <div className="flex items-center gap-1 shrink-0">
                            {quickReactions.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => jamManager.sendReaction(emoji)}
                                    className="w-7 h-7 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] active:scale-90 border border-white/5 flex items-center justify-center text-sm transition-all"
                                    title={`React with ${emoji}`}
                                >
                                    {emoji}
                                </button>
                            ))}

                            <button
                                type="button"
                                onClick={onOpenJamModal}
                                className="ml-1 w-7 h-7 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 flex items-center justify-center transition-all"
                                title="Open Jam Dashboard"
                            >
                                <ChevronUp size={15} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
