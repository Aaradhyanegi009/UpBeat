import React, { useRef, useEffect } from 'react'
import { Sparkles, Heart, Play, X, Clock, KeyRound } from 'lucide-react'
import { Chip, ChipRow, IconButton, Collage, SectionHeader } from '../ui/primitives'

export const VIBES = [
  'Rainy evening, mellow and warm',
  'Deep focus, no vocals',
  'Gym hour, heavy and fast',
  'Road trip singalongs',
  'Heartbreak at 2am',
  'Sunday morning coffee',
  'Late-night drive, moody synths'
]

export const LENGTHS = [
  { id: 10, label: '10 songs' },
  { id: 20, label: '20 songs' },
  { id: 30, label: '30 songs' }
]

function energyWord(v) {
  if (v < 30) return 'Calm'
  if (v < 55) return 'Easy'
  if (v < 80) return 'Lively'
  return 'Intense'
}

function discoveryWord(v) {
  if (v < 30) return 'Mostly familiar'
  if (v < 70) return 'A mix'
  return 'Mostly new'
}

export default function CreateView({
  isDesktop,
  prompt,
  setPrompt,
  energy,
  setEnergy,
  discovery,
  setDiscovery,
  length,
  setLength,
  seed,
  setSeed,
  currentTrack,
  likesCount = 0,
  needsKey = false,
  busy = false,
  recentMixes = [],
  onMake,
  onOpenMix,
  onOpenSettings
}) {
  const inputRef = useRef(null)
  const canMake = Boolean(prompt.trim() || seed) && !busy

  useEffect(() => {
    if (isDesktop) inputRef.current?.focus()
  }, [isDesktop])

  return (
    <div className={`px-5 lg:px-8 pb-10 w-full ${isDesktop ? 'max-w-3xl' : ''}`}>
      <div className="flex items-center justify-between h-14 mt-1">
        <h1 className="text-[30px] font-extrabold tracking-[-0.025em]">Create</h1>
      </div>

      <form
        className="mt-3 rounded-[22px] bg-s1 ring-1 ring-white/[0.06] focus-within:ring-white/20 p-[18px] pb-3.5 transition-shadow"
        onSubmit={(e) => {
          e.preventDefault()
          if (canMake) onMake()
        }}
      >
        <label htmlFor="create-prompt" className="sr-only">
          Describe the music you want
        </label>
        <textarea
          id="create-prompt"
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canMake) onMake()
            }
          }}
          rows={3}
          placeholder="Describe a moment, a mood, a memory…"
          className="w-full bg-transparent resize-none text-xl leading-snug font-semibold tracking-[-0.01em] placeholder:text-t3 placeholder:font-medium focus:outline-none min-h-[84px]"
        />
        <div className="flex items-center justify-end gap-2 mt-2.5">
          <button
            type="submit"
            disabled={!canMake}
            className="h-11 pl-4 pr-5 rounded-full bg-accent text-on-accent text-[15px] font-extrabold inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-default hover:brightness-110 transition shrink-0"
          >
            <Sparkles className="w-[18px] h-[18px]" />
            {busy ? 'Making…' : 'Make my mix'}
          </button>
        </div>
      </form>

      {!prompt.trim() && (
        <ChipRow className="mt-3">
          {VIBES.map((v) => (
            <Chip key={v} variant="ghost" onClick={() => setPrompt(v)}>
              {v}
            </Chip>
          ))}
        </ChipRow>
      )}

      {needsKey && (
        <div className="mt-4 flex items-center gap-3 p-3.5 rounded-2xl bg-s1">
          <div className="w-10 h-10 rounded-xl bg-s2 flex items-center justify-center text-accent shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <p className="flex-1 text-[13px] text-t2 leading-snug">
            Mixes use Google Gemini. Add your free API key (or connect the Mac companion) to make them.
          </p>
          <Chip onClick={onOpenSettings}>Add key</Chip>
        </div>
      )}

      <div className="text-sm font-bold mt-6 mb-2.5">Start from</div>
      <ChipRow>
        {seed && seed.type === 'track' && (
          <Chip active onClick={() => setSeed(null)} aria-label={`Remove ${seed.track.title} as starting point`}>
            <Play className="w-3.5 h-3.5 fill-current" />
            <span className="max-w-[140px] truncate">{seed.track.title}</span>
            <X className="w-4 h-4" />
          </Chip>
        )}
        <Chip active={seed?.type === 'likes'} onClick={() => setSeed(seed?.type === 'likes' ? null : { type: 'likes' })} disabled={!likesCount}>
          <Heart className={`w-4 h-4 ${seed?.type === 'likes' ? 'fill-current' : 'text-accent fill-current'}`} />
          My likes
        </Chip>
        {currentTrack && !(seed?.type === 'track' && seed.track.video_id === currentTrack.video_id) && (
          <Chip variant="ghost" onClick={() => setSeed({ type: 'track', track: currentTrack })}>
            <Play className="w-3.5 h-3.5" />
            <span className="max-w-[160px] truncate">Now playing: {currentTrack.title}</span>
          </Chip>
        )}
      </ChipRow>

      <div className="mt-5 rounded-[22px] bg-s1 px-[18px] py-1.5">
        <Slider label="Energy" value={energy} onChange={setEnergy} word={energyWord(energy)} left="Calm" right="Intense" />
        <Slider divider label="Familiar ↔ New" value={discovery} onChange={setDiscovery} word={discoveryWord(discovery)} left="Songs I know" right="Surprise me" />
        <div className="py-3.5 border-t border-white/[0.08]">
          <div className="text-[15px] font-bold">Length</div>
          <div className="grid grid-cols-3 gap-1 p-1 mt-2.5 rounded-xl bg-s2" role="radiogroup" aria-label="Length">
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={length === l.id}
                onClick={() => setLength(l.id)}
                className={`h-9 rounded-[9px] text-sm font-semibold cursor-pointer transition-colors ${length === l.id ? 'bg-t1 text-[#0A0A0B]' : 'text-t2 hover:text-t1'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {recentMixes.length > 0 && (
        <>
          <SectionHeader title="Your recent mixes" />
          <div>
            {recentMixes.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenMix(m)}
                className="w-full flex items-center gap-3.5 min-h-[64px] py-1.5 px-2 -mx-2 rounded-xl hover:bg-white/[0.04] text-left cursor-pointer"
              >
                <Collage tracks={m.tracks} className="w-[52px] h-[52px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold truncate">{m.title}</div>
                  <div className="text-[13px] text-t2 truncate flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{m.prompt || `${m.tracks?.length || 0} songs`}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Slider({ label, value, onChange, word, left, right, divider = false }) {
  const id = `slider-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className={`py-3.5 ${divider ? 'border-t border-white/[0.08]' : ''}`}>
      <div className="flex justify-between">
        <label htmlFor={id} className="text-[15px] font-bold">
          {label}
        </label>
        <span className="text-sm font-semibold text-t2">{word}</span>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="ub-range w-full mt-2"
        style={{ '--pct': `${value}%` }}
      />
      <div className="flex justify-between text-xs font-semibold text-t3 mt-0.5">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}
