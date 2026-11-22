import React, { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { IconButton } from '../ui/primitives'

export const KEYBOARD_SHORTCUT_GROUPS = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space'], label: 'Play / Pause' },
      { keys: ['←', '→'], srHint: 'ArrowLeft / ArrowRight', label: 'Seek backward / forward 10s (±10s)' },
      { keys: ['M'], label: 'Mute / Unmute' },
      { keys: ['N'], label: 'Next song' },
      { keys: ['P'], label: 'Previous song' },
      { keys: ['L'], label: 'Loop current song' },
      { keys: ['S'], label: 'Toggle shuffle' }
    ]
  },
  {
    title: 'Navigation & Panels',
    items: [
      { keys: ['⌘ / Ctrl', 'K'], label: 'Search' },
      { keys: ['⌘ / Ctrl', 'N'], label: 'New AI mix' },
      { keys: ['⌘ / Ctrl', 'B'], label: 'Toggle left sidebar' },
      { keys: ['⌘ / Ctrl', '\\'], label: 'Toggle right panel' },
      { keys: ['?'], label: 'Keyboard shortcuts' }
    ]
  }
]

export default function ShortcutModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/65 cursor-default" onClick={onClose} />
      <div className="relative w-full sm:w-[480px] max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-s1 ring-1 ring-white/10 shadow-2xl text-t1 overflow-hidden pb-safe">
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-white/25 mx-auto mt-2.5 shrink-0" />
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-s2 flex items-center justify-center text-accent">
              <Keyboard className="w-5 h-5" />
            </span>
            <h2 id="shortcuts-title" className="text-lg font-extrabold tracking-[-0.015em]">
              Keyboard shortcuts
            </h2>
          </div>
          <IconButton label="Close" size={36} onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-t2 mb-2 px-1">
                {group.title}
              </h3>
              <div className="rounded-2xl bg-s2 divide-y divide-white/[0.06]">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-semibold text-t1">{item.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.srHint && <span className="sr-only">{item.srHint}</span>}
                      {item.keys.map((k, idx) => (
                        <React.Fragment key={`${item.label}-${k}`}>
                          {idx > 0 && <span className="text-xs text-t3 font-bold">+</span>}
                          <kbd className="min-w-[28px] h-7 px-2 rounded-lg bg-s3 ring-1 ring-white/10 text-xs font-bold text-t1 inline-flex items-center justify-center font-sans">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
