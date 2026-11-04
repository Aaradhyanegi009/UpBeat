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
  { id: 'soundtrack', label: 'Soundtrack', query: 'Epic cinematic orchestral soundtracks and film scores' },
  { id: 'indie', label: 'Indie & Alt', query: 'Indie pop alternative melodic hits playlist' },
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
    <div className="w-full bg-[var(--bg-glass)] backdrop-blur-xl border-b border-[var(--border-subtle)] py-2.5 select-none flex-shrink-0 sticky top-0 z-20 overflow-hidden transition-colors">
      {/* Horizontal Mood / Activity Chips Carousel - Full-Bleed Edge-to-Edge like YouTube */}
      <div className="w-full flex items-center gap-2.5 overflow-x-auto no-scrollbar px-5 sm:px-6 py-1 scroll-smooth">
        {MOOD_CHIPS.map((chip) => {
          const isSelected = activeChip === chip.id
          return (
            <button
              key={chip.id}
              onClick={() => handleChipClick(chip)}
              disabled={busy}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 border ${
                isSelected
                  ? 'bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold border-[var(--text-primary)] shadow-md shadow-black/10 scale-[1.02]'
                  : 'bg-[var(--surface-hover)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
        {/* Trailing spacer for end margin when scrolled to the rightmost edge */}
        <div className="w-3 shrink-0 pointer-events-none" />
      </div>
    </div>
  )
}
