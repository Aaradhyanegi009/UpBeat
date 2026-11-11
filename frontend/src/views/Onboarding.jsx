import React, { useMemo, useState, useEffect } from 'react'
import { Check, Search, Plus, ChevronLeft } from 'lucide-react'
import { Spinner } from '../ui/primitives'
import { GoogleIcon } from '../components/GoogleAuthModal'

export const GENRES = [
  { id: 'bollywood', label: 'Bollywood & Hindi', artists: ['Arijit Singh', 'Shreya Ghoshal', 'Pritam', 'A.R. Rahman', 'Jubin Nautiyal', 'Vishal Mishra'] },
  { id: 'punjabi', label: 'Punjabi & Desi', artists: ['Karan Aujla', 'Diljit Dosanjh', 'AP Dhillon', 'Sidhu Moose Wala', 'Shubh'] },
  { id: 'pop', label: 'Pop & Chart Hits', artists: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Ariana Grande', 'Billie Eilish', 'Ed Sheeran', 'Post Malone'] },
  { id: 'hiphop', label: 'Hip-hop & Rap', artists: ['Kendrick Lamar', 'Drake', 'Travis Scott', 'Eminem', 'Tyler, The Creator', 'J. Cole'] },
  { id: 'indie', label: 'Indie & Acoustic', artists: ['Prateek Kuhad', 'Anuv Jain', 'Lana Del Rey', 'Cigarettes After Sex', 'The 1975', 'Tame Impala'] },
  { id: 'rock', label: 'Rock & Alt', artists: ['Coldplay', 'Arctic Monkeys', 'Imagine Dragons', 'Linkin Park', 'Queen', 'The Neighbourhood'] },
  { id: 'jpop', label: 'J-pop & Anime', artists: ['YOASOBI', 'Fujii Kaze', 'Kenshi Yonezu', 'LiSA', 'RADWIMPS', 'Ai Higuchi'] },
  { id: 'kpop', label: 'K-pop & Asian', artists: ['BTS', 'BLACKPINK', 'NewJeans', 'Stray Kids', 'TWICE', 'Jung Kook'] },
  { id: 'rnb', label: 'R&B & Soul', artists: ['SZA', 'Frank Ocean', 'Daniel Caesar', 'Bruno Mars', 'Giveon'] },
  { id: 'electronic', label: 'Electronic & Dance', artists: ['Daft Punk', 'Calvin Harris', 'Avicii', 'Fred again..', 'Martin Garrix'] },
  { id: 'latin', label: 'Latin & Reggaeton', artists: ['Bad Bunny', 'Shakira', 'Karol G', 'J Balvin', 'Peso Pluma'] },
  { id: 'classical', label: 'Soundtrack & Film', artists: ['Hans Zimmer', 'Ludovico Einaudi', 'Max Richter', 'A.R. Rahman'] },
  { id: 'metal', label: 'Metal & Heavy', artists: ['Metallica', 'Bring Me The Horizon', 'Slipknot', 'Avenged Sevenfold'] },
  { id: 'country', label: 'Country & Folk', artists: ['Morgan Wallen', 'Zach Bryan', 'Luke Combs', 'Chris Stapleton'] }
]

export const CHART_OPTIONS = [
  { id: 'block_india_top_daily', label: 'India Top Daily Chart', desc: 'Top charting hits across India today', flag: '🇮🇳', region: 'india' },
  { id: 'block_india_trendy', label: 'India Trendy & Reels', desc: 'Viral reels, indie & Bollywood heat', flag: '🇮🇳', region: 'india' },
  { id: 'block_global_top_daily', label: 'Global Top 50 Daily', desc: 'Most played tracks worldwide', flag: '🌎', region: 'global' },
  { id: 'block_us_top_daily', label: 'US Billboard Daily', desc: 'Billboard Hot 100 & US Top 50 Daily Hits', flag: '🇺🇸', region: 'us' },
  { id: 'block_uk_top_daily', label: 'UK Official Top 40', desc: 'Official UK Top 40 & British Daily Chart', flag: '🇬🇧', region: 'uk' },
  { id: 'block_japan_top_daily', label: 'Japan Tokyo Hot 100', desc: 'J-Pop, Anime & Tokyo Hot 100 Daily Chart', flag: '🇯🇵', region: 'japan' },
  { id: 'block_viral_top_daily', label: 'Global Viral Daily Hits', desc: 'Trending TikTok & viral daily tracks', flag: '🔥', region: 'viral' },
  { id: 'block_kpop_top_daily', label: 'K-Pop Top Daily Chart', desc: 'Top K-Pop & East Asian Hot 50 Daily', flag: '🇰🇷', region: 'kpop' },
  { id: 'block_latin_top_daily', label: 'Latin Top Daily Chart', desc: 'Reggaeton & Latin pop daily rhythms', flag: '🌴', region: 'latin' }
]

/**
 * First-run setup. Calls onFinish({ genres, artists, chartPrefs }) and lets the app turn
 * the picks into taste sources & prioritized charts; onConnect opens YouTube import.
 */
export default function Onboarding({ onFinish, onSkip, onConnect, busy = false }) {
  const [step, setStep] = useState(0)

  const [genres, setGenres] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_taste_prefs_v1')
      return saved ? JSON.parse(saved)?.genres || [] : []
    } catch {
      return []
    }
  })

  const [artists, setArtists] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_taste_prefs_v1')
      return saved ? JSON.parse(saved)?.artists || [] : []
    } catch {
      return []
    }
  })

  const [chartPrefs, setChartPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem('upbeat_chart_prefs_v1')
      if (saved) return JSON.parse(saved)
      const savedTaste = localStorage.getItem('upbeat_taste_prefs_v1')
      if (savedTaste) return JSON.parse(savedTaste)?.chartPrefs || []
      return ['block_india_top_daily', 'block_india_trendy', 'block_global_top_daily', 'block_us_top_daily', 'block_viral_top_daily']
    } catch {
      return ['block_india_top_daily', 'block_india_trendy', 'block_global_top_daily', 'block_us_top_daily', 'block_viral_top_daily']
    }
  })

  const [extra, setExtra] = useState('')

  // Dynamically auto-tune chart suggestions based on genre choices
  useEffect(() => {
    if (chartPrefs.length > 0 && genres.length === 0) return
    const recommended = new Set(chartPrefs)
    if (genres.includes('bollywood') || genres.includes('punjabi')) {
      recommended.add('block_india_top_daily')
      recommended.add('block_india_trendy')
      recommended.add('block_global_top_daily')
    }
    if (genres.includes('jpop')) {
      recommended.add('block_japan_top_daily')
      recommended.add('block_global_top_daily')
    }
    if (genres.includes('kpop')) {
      recommended.add('block_kpop_top_daily')
      recommended.add('block_global_top_daily')
    }
    if (genres.includes('latin')) {
      recommended.add('block_latin_top_daily')
      recommended.add('block_global_top_daily')
    }
    if (genres.includes('pop') || genres.includes('hiphop') || genres.includes('rock')) {
      recommended.add('block_global_top_daily')
      recommended.add('block_us_top_daily')
      recommended.add('block_uk_top_daily')
      recommended.add('block_viral_top_daily')
    }
    if (recommended.size >= 4) {
      setChartPrefs(Array.from(recommended))
    }
  }, [genres])

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

  const handleFinish = () => {
    onFinish?.({ genres, artists, chartPrefs })
  }

  return (
    <div className="fixed inset-0 z-[90] bg-bg text-t1 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="onb-title" style={{ paddingTop: 'var(--sat)' }}>
      {/* Top Header */}
      <div className="flex items-center justify-between h-14 px-3 shrink-0 max-w-2xl w-full mx-auto">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} aria-label="Back" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/[0.06] cursor-pointer">
            <ChevronLeft className="w-6 h-6" />
          </button>
        ) : (
          <span className="w-10" />
        )}
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 4`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-t1' : 'w-1.5 bg-white/25'}`} />
          ))}
        </div>
        <button type="button" onClick={onSkip} className="h-10 px-3 rounded-full text-sm font-semibold text-t2 hover:text-t1 cursor-pointer">
          Skip
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 pb-8">
          {/* STEP 0: GENRES */}
          {step === 0 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                What do you listen to?
              </h1>
              <p className="text-[15px] text-t2 mt-2">Pick your favorite music genres & regions. We’ll tailor your mixes and charts.</p>
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

          {/* STEP 1: ARTISTS */}
          {step === 1 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                Pick some artists you like
              </h1>
              <p className="text-[15px] text-t2 mt-2">Pick 3 or more. We will build custom 2-artist mashups & collaborative sets for you.</p>
              <form onSubmit={addExtra} className="mt-5 h-12 rounded-2xl bg-s2 flex items-center gap-3 pl-4 pr-1.5 focus-within:ring-1 focus-within:ring-white/20">
                <Search className="w-5 h-5 text-t2 shrink-0" />
                <label htmlFor="onb-artist" className="sr-only">
                  Add an artist
                </label>
                <input
                  id="onb-artist"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="Add any artist (e.g. Arijit Singh, The Weeknd)"
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

          {/* STEP 2: TOP CHARTS PREFERENCE */}
          {step === 2 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                Select your Top Daily Charts
              </h1>
              <p className="text-[15px] text-t2 mt-2">
                Choose the regional and global daily charts you want prioritized on your Home feed.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                {CHART_OPTIONS.map((c) => {
                  const on = chartPrefs.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(chartPrefs, setChartPrefs, c.id)}
                      className={`p-4 rounded-2xl text-left flex items-start gap-3.5 transition-all cursor-pointer border ${
                        on
                          ? 'bg-s3 border-white/25 ring-1 ring-white/20'
                          : 'bg-s2 hover:bg-s3/70 border-white/[0.06]'
                      }`}
                    >
                      <span className="text-2xl shrink-0 mt-0.5">{c.flag}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] font-bold text-t1 truncate">{c.label}</span>
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs transition-colors ${
                              on ? 'bg-accent text-on-accent font-bold' : 'border border-white/20'
                            }`}
                          >
                            {on && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </span>
                        </div>
                        <p className="text-xs text-t2 mt-1 line-clamp-1">{c.desc}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* STEP 3: YOUTUBE IMPORT & FINISH */}
          {step === 3 && (
            <>
              <h1 id="onb-title" className="text-[30px] font-extrabold tracking-[-0.025em] leading-tight mt-4">
                Bring your YouTube likes?
              </h1>
              <p className="text-[15px] text-t2 mt-2 leading-relaxed">
                Importing a playlist you’ve liked on YouTube makes Home mixes even more personal. It’s 100% optional.
              </p>
              <button
                type="button"
                onClick={() => onConnect({ genres, artists, chartPrefs })}
                disabled={busy}
                className="mt-6 w-full h-14 rounded-2xl bg-s2 hover:bg-s3 flex items-center gap-3 px-4 text-left cursor-pointer disabled:opacity-50"
              >
                <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                  <GoogleIcon className="w-5 h-5" />
                </span>
                <span className="text-base font-bold">Import from YouTube</span>
              </button>
              <div className="mt-6 rounded-2xl bg-s2/60 border border-white/[0.08] p-4 flex flex-col gap-2.5 text-sm text-t2">
                <div className="font-bold text-t1">Preferences Summary:</div>
                <div>• {genres.length ? `${genres.length} genre${genres.length > 1 ? 's' : ''}` : 'No genres'} & {artists.length} artist{artists.length === 1 ? '' : 's'} selected</div>
                <div>• {chartPrefs.length} Top Daily Chart{chartPrefs.length === 1 ? '' : 's'} prioritized for your Home</div>
                <div>• Zero gym music & zero generic lo-fi in your Made for You feed</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div className="shrink-0 border-t border-white/[0.08] pb-safe">
        <div className="max-w-2xl mx-auto px-5 py-4">
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={
                step === 0 ? genres.length === 0 : step === 1 ? artists.length === 0 : chartPrefs.length === 0
              }
              className="w-full h-14 rounded-full bg-t1 text-[#0A0A0B] text-base font-extrabold cursor-pointer disabled:opacity-40 transition-opacity"
            >
              {step === 0
                ? genres.length ? 'Next · Artists' : 'Pick at least one genre'
                : step === 1
                  ? artists.length ? `Next · Daily Charts (${artists.length} artists)` : 'Pick at least one artist'
                  : chartPrefs.length ? `Next · Finish (${chartPrefs.length} charts)` : 'Select at least one chart'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
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
