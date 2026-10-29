import React, { useState } from 'react'
import { Moon, X, Clock, Check, Plus, Volume2 } from 'lucide-react'

function formatCountdown(sec) {
  if (sec == null || isNaN(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTargetTime(timestamp) {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function SleepTimerModal({
  isOpen,
  onClose,
  sleepTimer,
  onSetTimer,
  onCancelTimer,
  onAddMinutes,
  crossfadeSec = 0,
  onChangeCrossfade,
  albumColor = { primary: '#6366f1', accent: '#818cf8' }
}) {
  const [customMinutes, setCustomMinutes] = useState(20)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [useFadeOut, setUseFadeOut] = useState(() => {
    return sleepTimer?.fadeOut !== undefined ? sleepTimer.fadeOut : true
  })

  if (!isOpen) return null

  const isTimerActive = Boolean(sleepTimer?.active && sleepTimer?.mode !== 'off')
  const remainingSec = sleepTimer?.remainingSec || 0
  const isEndOfTrack = sleepTimer?.mode === 'end_of_track'

  const presets = [
    { label: '15 Minutes', minutes: 15 },
    { label: '30 Minutes', minutes: 30 },
    { label: '45 Minutes', minutes: 45 },
    { label: '1 Hour', minutes: 60 },
  ]

  const handleSelectPreset = (min) => {
    onSetTimer(min, useFadeOut)
    onClose()
  }

  const handleSelectEndOfTrack = () => {
    onSetTimer('end_of_track', useFadeOut)
    onClose()
  }

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    const val = parseInt(customMinutes, 10)
    if (val > 0 && val <= 360) {
      onSetTimer(val, useFadeOut)
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-[#101018]/95 border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 text-white select-none max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${albumColor.primary}25`, color: albumColor.primary }}
            >
              <Moon className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Sleep Timer</h2>
              <p className="text-xs text-zinc-400">Automatically pause playback</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active Timer Status Card */}
        {isTimerActive && (
          <div
            className="p-4 rounded-2xl border flex flex-col gap-3 relative overflow-hidden"
            style={{
              backgroundColor: `${albumColor.primary}12`,
              borderColor: `${albumColor.primary}35`
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {isEndOfTrack ? 'Timer Active' : 'Time Remaining'}
                </span>
                <div className="text-2xl font-black tracking-tight text-white mt-0.5">
                  {isEndOfTrack ? 'End of this track' : formatCountdown(remainingSec)}
                </div>
              </div>
              {!isEndOfTrack && sleepTimer?.targetTimestamp && (
                <div className="text-right">
                  <span className="text-[11px] font-medium text-zinc-400 block">Stops at</span>
                  <span className="text-sm font-bold text-zinc-200">
                    {formatTargetTime(sleepTimer.targetTimestamp)}
                  </span>
                </div>
              )}
            </div>

            {/* Quick Adjustment Controls */}
            <div className="flex items-center gap-2 pt-1 border-t border-white/10">
              {!isEndOfTrack && (
                <>
                  <button
                    onClick={() => onAddMinutes(5)}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1 transition-colors cursor-pointer active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" /> 5 min
                  </button>
                  <button
                    onClick={() => onAddMinutes(15)}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1 transition-colors cursor-pointer active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" /> 15 min
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  onCancelTimer()
                  onClose()
                }}
                className="flex-1 py-1.5 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer active:scale-95"
              >
                Turn Off Timer
              </button>
            </div>
          </div>
        )}

        {/* Presets List */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 px-1">
            {isTimerActive ? 'Change Duration' : 'Select Duration'}
          </span>

          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.minutes}
                onClick={() => handleSelectPreset(preset.minutes)}
                className="py-2.5 px-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-left transition-colors cursor-pointer flex items-center justify-between active:scale-98"
              >
                <span className="text-sm font-semibold text-zinc-200">{preset.label}</span>
                <Clock className="w-3.5 h-3.5 text-zinc-400 opacity-60" />
              </button>
            ))}
          </div>

          {/* End of Current Track Option */}
          <button
            onClick={handleSelectEndOfTrack}
            className="w-full mt-1 py-2.5 px-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-left transition-colors cursor-pointer flex items-center justify-between active:scale-98"
          >
            <div>
              <span className="text-sm font-semibold text-zinc-200 block">End of this song</span>
              <span className="text-[11px] text-zinc-400">Pauses when current track finishes</span>
            </div>
            {isEndOfTrack && <Check className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>

        {/* Custom Minutes Accordion / Input */}
        <div>
          {!showCustomInput ? (
            <button
              onClick={() => setShowCustomInput(true)}
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer px-1 py-0.5 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Custom duration</span>
            </button>
          ) : (
            <form onSubmit={handleCustomSubmit} className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min="1"
                max="360"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-sm font-semibold text-white focus:outline-none focus:border-indigo-400"
                placeholder="Minutes"
                autoFocus
              />
              <span className="text-xs font-medium text-zinc-400">min</span>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-opacity cursor-pointer shadow-sm active:scale-95"
                style={{ backgroundColor: albumColor.primary }}
              >
                Set
              </button>
              <button
                type="button"
                onClick={() => setShowCustomInput(false)}
                className="p-2 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>

        {/* Gentle 30s Fade Out Toggle */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-zinc-400" />
            <div>
              <span className="text-xs font-semibold text-zinc-200 block">Smooth Fade-Out</span>
              <span className="text-[11px] text-zinc-400">Gently lowers volume over last 30 seconds</span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useFadeOut}
            onClick={() => setUseFadeOut(!useFadeOut)}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              useFadeOut ? 'bg-indigo-600' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                useFadeOut ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* Crossfade Section */}
        {typeof onChangeCrossfade === 'function' && (
          <div className="pt-3 border-t border-white/10 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-zinc-200 block">Crossfade</span>
                <span className="text-[11px] text-zinc-400">Overlap transitions between songs</span>
              </div>
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full border"
                style={
                  crossfadeSec > 0
                    ? {
                        backgroundColor: `${albumColor.primary}20`,
                        borderColor: `${albumColor.primary}45`,
                        color: albumColor.primary
                      }
                    : {
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        color: '#a1a1aa'
                      }
                }
              >
                {crossfadeSec > 0 ? `${crossfadeSec}s` : 'Off'}
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={crossfadeSec}
              onChange={(e) => onChangeCrossfade(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, ${albumColor.primary} 0%, ${albumColor.accent || albumColor.primary} ${(crossfadeSec / 12) * 100}%, #202028 ${(crossfadeSec / 12) * 100}%, #202028 100%)`
              }}
              className="w-full argon-slider cursor-pointer h-1.5"
            />

            <div className="flex items-center justify-between gap-1.5">
              {[0, 2, 5, 8, 12].map((sec) => {
                const active = crossfadeSec === sec
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => onChangeCrossfade(sec)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                      active
                        ? 'text-white border-white/30 bg-white/15'
                        : 'text-zinc-400 border-white/10 bg-white/[0.03] hover:text-white hover:bg-white/[0.08]'
                    }`}
                    style={
                      active
                        ? {
                            backgroundColor: `${albumColor.primary}25`,
                            borderColor: `${albumColor.primary}55`,
                            color: '#ffffff'
                          }
                        : undefined
                    }
                  >
                    {sec === 0 ? 'Off' : `${sec}s`}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
