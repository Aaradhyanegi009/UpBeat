import React, { useState } from 'react'

export const MOOD_CHIPS = [
  { id: 'all', label: 'All', query: 'Popular music mix' },
  { id: 'workout', label: 'Work out', query: 'High energy workout motivation tracks' },
  { id: 'relax', label: 'Relax', query: 'Chill relaxing ambient lofi music' },
  { id: 'commute', label: 'Commute', query: 'Upbeat road trip commute music' },
  { id: 'energise', label: 'Energise', query: 'High BPM energetic electronic dance tracks' },
  { id: 'feelgood', label: 'Feel good', query: 'Happy feel good upbeat songs playlist' },
  { id: 'romance', label: 'Romance', query: 'Romantic acoustic melodies love songs' },
  { id: 'party', label: 'Party', query: 'Party club bangers dance remix' },
  { id: 'sad', label: 'Sad', query: 'Emotional melancholic slow acoustic songs' },
  { id: 'focus', label: 'Focus', query: 'Deep focus instrumental ambient electronic beats' },
  { id: 'sleep', label: 'Sleep', query: 'Deep sleep soothing ambient delta waves' },
  { id: 'anime', label: 'Anime OST', query: 'High-impact orchestral rock Hiroyuki Sawano anime openings' },
  { id: 'sawano', label: 'Sawano OST', query: 'Hiroyuki Sawano best epic soundtrack mix' },
  { id: 'hindi', label: 'Hindi Trending', query: 'New Hindi songs latest releases' },
  { id: 'lofi', label: 'Lo-Fi', query: 'Nocturnal lofi hip hop chill study beats' }
]

export default function CuratorPrompt({
  setPrompt,
  onGenerate,
  onDirectSearch,
  searchMode = 'direct',
  isGenerating,
  isSearching
}) {
  const [activeChip, setActiveChip] = useState('all')
  const busy = isGenerating || isSearching

  const handleChipClick = (chip) => {
    setActiveChip(chip.id)
    if (setPrompt) setPrompt(chip.query)
    if (searchMode === 'curator' && onGenerate) {
      onGenerate(chip.query)
    } else if (onDirectSearch) {
      onDirectSearch(chip.query)
    }
  }

  return (
    <div className="w-full bg-black/40 backdrop-blur-md border-b border-white/10 py-2.5 select-none flex-shrink-0 sticky top-0 z-20 overflow-hidden">
      {/* Horizontal Mood / Activity Chips Carousel - Full-Bleed Edge-to-Edge like YouTube */}
      <div className="w-full flex items-center gap-2 overflow-x-auto no-scrollbar px-3.5 sm:px-6 py-1 scroll-smooth">
        {MOOD_CHIPS.map((chip) => {
          const isSelected = activeChip === chip.id
          return (
            <button
              key={chip.id}
              onClick={() => handleChipClick(chip)}
              disabled={busy}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 border ${
                isSelected
                  ? 'bg-white text-black font-bold border-white shadow-md shadow-white/10 scale-[1.02]'
                  : 'bg-white/[0.06] hover:bg-white/[0.14] text-zinc-300 hover:text-white border-white/[0.08]'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
        {/* Trailing spacer for end margin when scrolled to the rightmost edge */}
        <div className="w-2 shrink-0 pointer-events-none" />
      </div>
    </div>
  )
}
