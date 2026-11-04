import React, { useMemo, useState } from 'react'
import { Check, Search, Plus, ChevronLeft } from 'lucide-react'
import { Spinner } from '../ui/primitives'
import { GoogleIcon } from '../components/GoogleAuthModal'

export const GENRES = [
  { id: 'pop', label: 'Pop', artists: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Ariana Grande', 'Billie Eilish', 'Ed Sheeran'] },
  { id: 'hiphop', label: 'Hip-hop', artists: ['Drake', 'Kendrick Lamar', 'Travis Scott', 'Eminem', 'Tyler, The Creator'] },
  { id: 'bollywood', label: 'Bollywood', artists: ['Arijit Singh', 'Shreya Ghoshal', 'Pritam', 'A.R. Rahman', 'Jubin Nautiyal'] },
  { id: 'punjabi', label: 'Punjabi', artists: ['Karan Aujla', 'Diljit Dosanjh', 'AP Dhillon', 'Sidhu Moose Wala'] },
  { id: 'rnb', label: 'R&B', artists: ['SZA', 'Frank Ocean', 'Daniel Caesar', 'Bruno Mars'] },
  { id: 'rock', label: 'Rock', artists: ['Coldplay', 'Arctic Monkeys', 'Imagine Dragons', 'Linkin Park', 'Queen'] },
  { id: 'indie', label: 'Indie', artists: ['Tame Impala', 'Lana Del Rey', 'The 1975', 'Prateek Kuhad', 'Cigarettes After Sex'] },
  { id: 'electronic', label: 'Electronic', artists: ['Daft Punk', 'Calvin Harris', 'Avicii', 'Fred again..', 'Martin Garrix'] },
  { id: 'lofi', label: 'Lo-fi & chill', artists: ['Joji', 'Nujabes', 'Keshi', 'Rex Orange County'] },
  { id: 'kpop', label: 'K-pop', artists: ['BTS', 'BLACKPINK', 'NewJeans', 'Stray Kids'] },
  { id: 'jpop', label: 'J-pop & anime', artists: ['YOASOBI', 'Kenshi Yonezu', 'Hiroyuki Sawano', 'LiSA', 'RADWIMPS'] },
  { id: 'latin', label: 'Latin', artists: ['Bad Bunny', 'Shakira', 'Karol G', 'J Balvin'] },
  { id: 'jazz', label: 'Jazz & soul', artists: ['Norah Jones', 'Laufey', 'Amy Winehouse', 'Chet Baker'] },
  { id: 'classical', label: 'Classical & film', artists: ['Hans Zimmer', 'Ludovico Einaudi', 'Max Richter'] },
  { id: 'metal', label: 'Metal', artists: ['Metallica', 'Bring Me The Horizon', 'Slipknot'] },
  { id: 'country', label: 'Country', artists: ['Morgan Wallen', 'Zach Bryan', 'Luke Combs'] }
]

/**
 * First-run setup. Calls onFinish({ genres, artists }) and lets the app turn
 * the picks into taste sources; onConnect opens the YouTube import.
 */
export default function Onboarding({ onFinish, onSkip, onConnect, busy = false }) {
  const [step, setStep] = useState(0)
  const [genres, setGenres] = useState([])
  const [artists, setArtists] = useState([])
  const [extra, setExtra] = useState('')

  const suggestions = useMemo(() => {
    const pool = (genres.length ? GENRES.filter((g) => genres.includes(g.id)) : GENRES).flatMap((g) => g.artists)
    return [...new Set([...artists, ...pool])]
  }, [genres, artists])

  const toggle = (_list, setList, v) => setList((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))

  const addExtra = (e) => {
    e.preventDefault()
    const name = extra.trim()
    if (!name) return
    if (!artists.includes(name)) setArtists([...artists, name])
    setExtra('')
  }

  return (
    <div className="fixed inset-0 z-[90] bg-bg text-t1 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="onb-title" style={{ paddingTop: 'var(--sat)' }}>
      <div className="flex items-center justify-between h-14 px-3 shrink-0 max-w-2xl w-full mx-auto">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} aria-label="Back" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/[0.06] cursor-pointer">
            <ChevronLeft className="w-6 h-6" />
          </button>
        ) : (
          <span className="w-10" />
        )}
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-t1' : 'w-1.5 bg-white/25'}`} />
          ))}
        </div>
        <button type="button" onClick={onSkip} className="h-10 px-3 rounded-full text-sm font-semibold text-t2 hover:text-t1 cursor-pointer">
          Skip
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 pb-8">
          {step === 0 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                What do you listen to?
              </h1>
              <p className="text-[15px] text-t2 mt-2">Pick a few. You can change this any time.</p>
              <div className="flex flex-wrap gap-2.5 mt-6">
                {GENRES.map((g) => {
                  const on = genres.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(genres, setGenres, g.id)}
                      className={`h-12 px-5 rounded-full text-[15px] font-bold inline-flex items-center gap-2 cursor-pointer transition-colors ${on ? 'bg-t1 text-[#0A0A0B]' : 'bg-s2 hover:bg-s3'}`}
                    >
                      {on && <Check className="w-4 h-4" strokeWidth={3} />}
                      {g.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                Pick some artists you like
              </h1>
              <p className="text-[15px] text-t2 mt-2">Three or more works best.</p>
              <form onSubmit={addExtra} className="mt-5 h-12 rounded-2xl bg-s2 flex items-center gap-3 pl-4 pr-1.5 focus-within:ring-1 focus-within:ring-white/20">
                <Search className="w-5 h-5 text-t2 shrink-0" />
                <label htmlFor="onb-artist" className="sr-only">
                  Add an artist
                </label>
                <input
                  id="onb-artist"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="Add any artist"
                  className="flex-1 min-w-0 bg-transparent text-base font-semibold placeholder:text-t3 placeholder:font-medium focus:outline-none"
                />
                {extra.trim() && (
                  <button type="submit" className="h-9 px-3 rounded-xl bg-t1 text-[#0A0A0B] text-sm font-bold inline-flex items-center gap-1 cursor-pointer">
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                )}
              </form>
              <div className="flex flex-wrap gap-2.5 mt-5">
                {suggestions.map((a) => {
                  const on = artists.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(artists, setArtists, a)}
                      className={`h-11 px-4 rounded-full text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${on ? 'bg-accent text-on-accent font-bold' : 'bg-s2 hover:bg-s3'}`}
                    >
                      {on && <Check className="w-4 h-4" strokeWidth={3} />}
                      {a}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                Bring your YouTube likes?
              </h1>
              <p className="text-[15px] text-t2 mt-2 leading-relaxed">Importing a playlist you’ve liked on YouTube makes Home and AI mixes much more “you”. It’s optional.</p>
              <button
                type="button"
                onClick={() => onConnect({ genres, artists })}
                disabled={busy}
                className="mt-6 w-full h-14 rounded-2xl bg-s2 hover:bg-s3 flex items-center gap-3 px-4 text-left cursor-pointer disabled:opacity-50"
              >
                <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                  <GoogleIcon className="w-5 h-5" />
                </span>
                <span className="text-base font-bold">Import from YouTube</span>
              </button>
              <ul className="mt-6 flex flex-col gap-2 text-sm text-t2">
                <li>• {genres.length ? `${genres.length} genre${genres.length > 1 ? 's' : ''}` : 'No genres'} and {artists.length} artist{artists.length === 1 ? '' : 's'} picked</li>
                <li>• We’ll grab a few top songs from each artist to start your Home</li>
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.08] pb-safe">
        <div className="max-w-2xl mx-auto px-5 py-4">
          {step < 2 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 0 ? genres.length === 0 : artists.length === 0}
              className="w-full h-14 rounded-full bg-t1 text-[#0A0A0B] text-base font-extrabold cursor-pointer disabled:opacity-40"
            >
              {step === 0 ? (genres.length ? 'Next' : 'Pick at least one') : artists.length ? `Next · ${artists.length} picked` : 'Pick at least one'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onFinish({ genres, artists })}
              disabled={busy}
              className="w-full h-14 rounded-full bg-accent text-on-accent text-base font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {busy && <Spinner className="w-5 h-5 !border-black/20 !border-t-black" />}
              {busy ? 'Setting up your Home…' : 'Start listening'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
