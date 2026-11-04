import React, { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Chip, IconButton } from '../ui/primitives'

function formatCountdown(sec) {
  if (sec == null || isNaN(sec) || sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function clock(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

const PRESETS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '90 min', minutes: 90 }
]

/** Sleep timer sheet. Crossfade moved to Settings → Playback. */
export default function SleepTimerModal({ isOpen, onClose, sleepTimer, onSetTimer, onCancelTimer, onAddMinutes }) {
  const [fade, setFade] = useState(() => (sleepTimer?.fadeOut !== undefined ? sleepTimer.fadeOut : true))
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const active = Boolean(sleepTimer?.active && sleepTimer?.mode !== 'off')
  const endOfSong = sleepTimer?.mode === 'end_of_track'
  const set = (v) => {
    onSetTimer(v, fade)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center select-none" role="dialog" aria-modal="true" aria-labelledby="sleep-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 cursor-default" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 pb-safe">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5" />
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5">
          <h2 id="sleep-title" className="text-xl font-extrabold tracking-[-0.015em]">
            Sleep timer
          </h2>
          <IconButton label="Close" size={40} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <div className="px-5 pb-6 pt-2">
          {active && (
            <div className="rounded-2xl bg-s2 p-4 mb-4">
              <div className="text-xs font-semibold text-t2">{endOfSong ? 'Stops' : 'Stops in'}</div>
              <div className="flex items-end justify-between gap-3">
                <div className="text-[30px] font-extrabold tracking-tight tabular-nums leading-tight">{endOfSong ? 'After this song' : formatCountdown(sleepTimer.remainingSec)}</div>
                {!endOfSong && sleepTimer?.targetTimestamp && <div className="text-sm text-t2 pb-1">at {clock(sleepTimer.targetTimestamp)}</div>}
              </div>
              <div className="flex gap-2 mt-3">
                {!endOfSong && onAddMinutes && (
                  <Chip onClick={() => onAddMinutes(10)}>
                    <Plus className="w-4 h-4" />
                    10 min
                  </Chip>
                )}
                <Chip variant="ghost" onClick={() => onCancelTimer()}>
                  Turn off
                </Chip>
              </div>
            </div>
          )}

          <div className="text-sm font-bold text-t2 mb-2">{active ? 'Change to' : 'Stop playing after'}</div>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.minutes}
                type="button"
                onClick={() => set(p.minutes)}
                className="h-12 rounded-xl bg-s2 hover:bg-s3 text-[15px] font-bold cursor-pointer transition-colors"
              >
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => set('end_of_track')} className="h-12 rounded-xl bg-s2 hover:bg-s3 text-[15px] font-bold cursor-pointer transition-colors">
              End of song
            </button>
          </div>

          <form
            className="flex gap-2 mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              const v = parseInt(custom, 10)
              if (v > 0 && v <= 360) set(v)
            }}
          >
            <label htmlFor="sleep-custom" className="sr-only">
              Custom minutes
            </label>
            <input
              id="sleep-custom"
              type="number"
              inputMode="numeric"
              min="1"
              max="360"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Other: minutes"
              className="flex-1 min-w-0 h-12 rounded-xl bg-s2 px-4 text-[15px] font-semibold placeholder:text-t3 focus:outline-none focus:ring-1 focus:ring-white/25"
            />
            <button type="submit" disabled={!(parseInt(custom, 10) > 0)} className="h-12 px-5 rounded-xl bg-t1 text-[#0A0A0B] font-bold cursor-pointer disabled:opacity-40">
              Set
            </button>
          </form>

          <label className="flex items-center justify-between gap-3 mt-5 cursor-pointer">
            <span>
              <span className="block text-[15px] font-bold">Fade out</span>
              <span className="block text-[13px] text-t2">Lower the volume gently before stopping</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={fade}
              aria-label="Fade out"
              onClick={() => setFade((f) => !f)}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors cursor-pointer ${fade ? 'bg-accent' : 'bg-s3'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${fade ? 'left-6' : 'left-1'}`} />
            </button>
          </label>
        </div>
      </div>
    </div>
  )
}
