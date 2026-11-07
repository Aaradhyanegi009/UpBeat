import React, { useEffect, useState } from 'react'
import { KeyRound, Eye, EyeOff, ExternalLink, RefreshCw, Check, ChevronDown } from 'lucide-react'
import { PageHeader, Chip, Spinner, Avatar } from '../ui/primitives'
import { getStoredApiKey, setStoredApiKey, getStoredServerUrl, setStoredServerUrl } from '../standaloneApi'
import { checkOtaUpdate, getCurrentOtaVersion, applyOtaBundle } from '../otaUpdater'

export default function SettingsView({
  isDesktop,
  onBack,
  crossfade,
  setCrossfade,
  models = [],
  selectedModel,
  onSelectModel,
  googleUser,
  onOpenGoogle,
  onLogout,
  onOpenProfileEdit,
  offlineStats,
  onClearDownloads,
  playbackMode,
  setPlaybackMode,
  notify,
  onRedoSetup
}) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())
  const [showKey, setShowKey] = useState(false)
  const [serverUrl, setServerUrl] = useState(() => getStoredServerUrl())
  const [savedField, setSavedField] = useState('')
  const [version, setVersion] = useState('')
  const [otaBusy, setOtaBusy] = useState(false)
  const [otaMsg, setOtaMsg] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    getCurrentOtaVersion().then((v) => setVersion(v || '')).catch(() => {})
    if (window.location.hash.includes('section=ai')) {
      setTimeout(() => document.getElementById('settings-ai')?.scrollIntoView({ block: 'start' }), 50)
    }
  }, [])

  const flashSaved = (field) => {
    setSavedField(field)
    setTimeout(() => setSavedField(''), 1600)
  }

  const checkUpdates = async () => {
    setOtaBusy(true)
    setOtaMsg('')
    try {
      const res = await checkOtaUpdate({ silent: false, forceCheck: true })
      if (res.updateAvailable && res.downloadUrl) {
        setOtaMsg(`Installing ${res.latestTag}…`)
        await applyOtaBundle(res.downloadUrl, res.latestTag, res.checksum, res.fallbackDownloadUrl)
        setOtaMsg('Update installed. Reloading…')
      } else if (res.error) {
        setOtaMsg(`Couldn't check: ${res.error}`)
      } else {
        setOtaMsg(`You're up to date (${res.currentVer || version}).`)
      }
    } catch (e) {
      setOtaMsg(`Couldn't check: ${e?.message || 'connection problem'}`)
    } finally {
      setOtaBusy(false)
    }
  }

  return (
    <div className="pb-12 w-full max-w-full overflow-x-hidden box-border">
      {!isDesktop && <PageHeader title="Settings" onBack={onBack} />}
      <div className="px-4 sm:px-5 lg:px-8 max-w-2xl w-full box-border overflow-x-hidden">
        {isDesktop && <h1 className="text-[34px] font-extrabold tracking-[-0.025em] mt-2">Settings</h1>}
        <Section title="Account">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 py-3.5 w-full min-w-0 box-border">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={onOpenProfileEdit}
                title="Click to edit profile picture or name"
                className="relative group cursor-pointer rounded-full shrink-0"
              >
                <Avatar name={googleUser?.name || 'You'} picture={googleUser?.picture} size={48} />
                <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold text-white transition-opacity">
                  Edit
                </span>
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold truncate">{googleUser?.name || 'UpBeat Listener'}</div>
                <div className="text-[13px] text-t2 truncate">{googleUser?.email || 'Local Studio Profile'}</div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto box-border">
              <Chip
                variant="ghost"
                onClick={onOpenProfileEdit}
                className="w-full sm:w-auto justify-center h-10 sm:h-9 px-4 box-border"
              >
                Edit profile
              </Chip>
              {googleUser?.accessToken ? (
                <Chip
                  variant="ghost"
                  onClick={onLogout}
                  className="w-full sm:w-auto justify-center h-10 sm:h-9 px-4 box-border"
                >
                  Disconnect
                </Chip>
              ) : (
                <Chip
                  onClick={onOpenGoogle}
                  className="w-full sm:w-auto justify-center h-10 sm:h-9 px-4 box-border"
                >
                  Connect Google
                </Chip>
              )}
            </div>
          </div>
          {onRedoSetup && (
            <Row className="border-t border-white/[0.08]">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold">Your music picks</div>
                <div className="text-[13px] text-t2">Choose genres and artists again to retune Home.</div>
              </div>
              <Chip variant="ghost" onClick={onRedoSetup}>
                Pick again
              </Chip>
            </Row>
          )}
        </Section>

        <Section title="Playback">
          <div className="py-3.5">
            <div className="flex justify-between">
              <label htmlFor="crossfade" className="text-[15px] font-bold">
                Crossfade
              </label>
              <span className="text-sm font-semibold text-t2">{crossfade > 0 ? `${crossfade} s` : 'Off'}</span>
            </div>
            <input
              id="crossfade"
              type="range"
              min="0"
              max="12"
              step="1"
              value={crossfade}
              onChange={(e) => setCrossfade(parseInt(e.target.value, 10))}
              className="ub-range w-full mt-2"
              style={{ '--pct': `${(crossfade / 12) * 100}%` }}
            />
            <p className="text-[13px] text-t2 mt-1">Blend the end of one song into the next.</p>
          </div>
        </Section>

        <Section title="AI mixes" id="settings-ai">
          <div className="py-3.5 w-full min-w-0 box-border">
            <label htmlFor="gemini-key" className="text-[15px] font-bold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-t1 shrink-0" />
              Gemini API key
            </label>
            <p className="text-[13px] text-t2 mt-1 leading-relaxed">
              Create mixes from a description. Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-t1 underline underline-offset-2">
                Google AI Studio
              </a>
              . It stays on this device.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5 mt-3 w-full min-w-0 box-border">
              <div className="flex-1 min-w-0 w-full h-11 rounded-xl bg-s2 flex items-center pl-3.5 pr-1 box-border focus-within:ring-1 focus-within:ring-white/20">
                <input
                  id="gemini-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 w-full bg-transparent text-[15px] font-medium focus:outline-none placeholder:text-t3"
                />
                <button
                  type="button"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  onClick={() => setShowKey((s) => !s)}
                  className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-t2 hover:text-t1 cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <SaveButton
                saved={savedField === 'key'}
                onClick={() => {
                  setStoredApiKey(apiKey)
                  flashSaved('key')
                  notify?.(apiKey.trim() ? 'Gemini key saved' : 'Gemini key removed')
                }}
              />
            </div>
          </div>
          <div className="py-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              aria-expanded={showAdvanced}
              className="w-full flex items-center justify-between text-[15px] font-bold cursor-pointer"
            >
              Advanced
              <ChevronDown className={`w-5 h-5 text-t2 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <div className="mt-3">
                <label htmlFor="model" className="text-[13px] font-semibold text-t2">
                  Model
                </label>
                <select
                  id="model"
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  className="mt-1.5 w-full h-11 rounded-xl bg-s2 px-3.5 text-[15px] font-medium focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {(m.name || m.id).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+\)/, ')').trim()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </Section>

        <Section title="Downloads">
          <Row>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-bold">Stored on this device</div>
              <div className="text-[13px] text-t2">
                {offlineStats?.count || 0} songs · {offlineStats?.formattedSize || '0 B'}
              </div>
            </div>
            {confirmClear ? (
              <div className="flex flex-wrap gap-2 shrink-0">
                <Chip variant="ghost" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Chip>
                <Chip
                  className="!bg-[#FF8A73] !text-[#1B0A05]"
                  onClick={() => {
                    setConfirmClear(false)
                    onClearDownloads()
                  }}
                >
                  Delete all
                </Chip>
              </div>
            ) : (
              <Chip variant="ghost" onClick={() => setConfirmClear(true)} disabled={!offlineStats?.count}>
                Clear
              </Chip>
            )}
          </Row>
        </Section>

        <Section title="Mac companion">
          <div className="py-3.5 w-full min-w-0 box-border">
            <label htmlFor="server-url" className="text-[15px] font-bold">
              Companion address
            </label>
            <p className="text-[13px] text-t2 mt-1">Optional. Lets this device use UpBeat running on your Mac (same Wi-Fi).</p>
            <div className="flex flex-col sm:flex-row gap-2.5 mt-3 w-full min-w-0 box-border">
              <input
                id="server-url"
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://192.168.1.4:8000"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-0 w-full h-11 rounded-xl bg-s2 px-3.5 text-[15px] font-medium box-border focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-t3"
              />
              <SaveButton
                saved={savedField === 'server'}
                onClick={() => {
                  setStoredServerUrl(serverUrl)
                  flashSaved('server')
                }}
              />
            </div>
          </div>
          {setPlaybackMode && (
            <Row className="border-t border-white/[0.08]">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold">Play through Safari on the Mac</div>
                <div className="text-[13px] text-t2">Sends songs to YouTube Music in Safari instead of playing here.</div>
              </div>
              <Toggle checked={playbackMode === 'safari'} onChange={(v) => setPlaybackMode(v ? 'safari' : 'app')} label="Play through Safari" />
            </Row>
          )}
        </Section>

        <Section title="About">
          <Row>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-bold">UpBeat {version}</div>
              {otaMsg && <div className="text-[13px] text-t2 mt-0.5">{otaMsg}</div>}
            </div>
            <Chip variant="ghost" onClick={checkUpdates} disabled={otaBusy}>
              {otaBusy ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              Check for updates
            </Chip>
          </Row>
          <a
            href="https://github.com/AaradhyaNegi009/UpBeat/releases"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between py-3.5 border-t border-white/[0.08] text-[15px] font-bold"
          >
            Release notes
            <ExternalLink className="w-4 h-4 text-t2" />
          </a>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children, id }) {
  return (
    <section id={id} className="mt-7 scroll-mt-16 w-full min-w-0 box-border">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-t2 mb-2 px-1">{title}</h2>
      <div className="rounded-[20px] bg-s1 px-4 w-full min-w-0 box-border overflow-hidden">{children}</div>
    </section>
  )
}

function Row({ children, className = '' }) {
  return <div className={`flex flex-wrap items-center justify-between gap-3 py-3.5 w-full min-w-0 box-border ${className}`}>{children}</div>
}

function SaveButton({ onClick, saved }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full sm:w-auto h-11 px-4 rounded-xl bg-t1 text-[#0A0A0B] text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer hover:bg-white/90 shrink-0 whitespace-nowrap box-border"
    >
      {saved && <Check className="w-4 h-4" strokeWidth={3} />}
      {saved ? 'Saved' : 'Save'}
    </button>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-colors cursor-pointer ${checked ? 'bg-accent' : 'bg-s3'}`}
    >
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}
