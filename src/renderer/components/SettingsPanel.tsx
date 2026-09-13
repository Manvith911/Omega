import { useCallback, useEffect, useState } from 'react'
import { SEARCH_ENGINES } from '@shared/constants'
import type { SearchEngineId, Settings } from '@shared/ipc'
import { useChrome } from '../store'
import { Close, Settings as SettingsIcon, Sun, Moon as MoonIcon } from './Icons'

type Row = { label: string; hint?: string; control: React.ReactNode }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-6 border-b border-chrome-border/60 py-3 last:border-0">
      <span className="min-w-0">
        <span className="block text-[12.5px] text-chrome-fg/90">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug text-chrome-dim">{hint}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
  )
}

const inputClass =
  'h-7 rounded-lg border border-chrome-border bg-white/5 px-2 text-[12px] outline-none focus:border-chrome-accent/60'

function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-chrome-accent' : 'bg-white/12'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}

const MINUTE = 60_000

export function SettingsPanel(): React.JSX.Element {
  const settings = useChrome((s) => s.settings)
  const setSettings = useChrome((s) => s.setSettings)
  const setState = useChrome.setState

  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    if (settings) setTheme(settings.theme)
  }, [settings])

  const update = useCallback(
    (patch: Partial<Settings>) => {
      void window.omega.invoke('settings:set', patch).then(setSettings)
    },
    [setSettings],
  )

  const toggleTheme = useCallback(() => {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    void window.omega.invoke('settings:set', { theme: next })
  }, [theme])

  if (!settings) {
    return <p className="p-6 text-[12px] text-chrome-dim">Loading settings…</p>
  }

  const rows: Row[] = [
    {
      label: 'Appearance',
      hint: 'Choose between a dark and a light color scheme for the browser chrome.',
      control: (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { if (theme === 'dark') toggleTheme() }}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${theme === 'dark' ? 'bg-chrome-accent text-white shadow-[0_0_12px_rgba(124,106,247,0.35)]' : 'bg-white/8 text-chrome-dim hover:bg-white/15 hover:shadow-sm'}`}
            title="Dark theme"
            aria-label="Select dark theme"
          >
            <MoonIcon className="h-4 w-4" />
          </button>
          <span className="text-[10px] text-chrome-dim font-medium">/</span>
          <button
            type="button"
            onClick={() => { if (theme === 'light') toggleTheme() }}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${theme === 'light' ? 'bg-chrome-accent text-white shadow-[0_0_12px_rgba(124,106,247,0.35)]' : 'bg-white/8 text-chrome-dim hover:bg-white/15 hover:shadow-sm'}`}
            title="Light theme"
            aria-label="Select light theme"
          >
            <Sun className="h-4 w-4" />
          </button>
        </div>
      ),
    },
    {
      label: 'Search engine',
      hint: 'Used when the address bar contains anything that is not an address.',
      control: (
        <select
          value={settings.searchEngine}
          onChange={(event) => update({ searchEngine: event.target.value as SearchEngineId })}
          className={inputClass}
        >
          {Object.entries(SEARCH_ENGINES).map(([id, engine]) => (
            <option key={id} value={id} className="bg-chrome-elevated">
              {engine.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      label: 'Ad & tracker blocker',
      hint: 'Host rules applied at the network layer on the browsing session only.',
      control: <Toggle on={settings.adBlockEnabled} onChange={(next) => update({ adBlockEnabled: next })} />,
    },
    {
      label: 'Freeze background tabs after',
      hint: 'Stops timers, animation frames and network activity. The page stays loaded, so switching back is instant.',
      control: (
        <select
          value={settings.freezeAfterMs}
          onChange={(event) => update({ freezeAfterMs: Number(event.target.value) })}
          className={inputClass}
        >
          <option value={0}>Never</option>
          <option value={30_000}>30 seconds</option>
          <option value={MINUTE}>1 minute</option>
          <option value={2 * MINUTE}>2 minutes</option>
          <option value={5 * MINUTE}>5 minutes</option>
        </select>
      ),
    },
    {
      label: 'Discard frozen tabs after',
      hint: 'Drops the renderer process entirely and reloads the page when you return. This is what keeps a large session cheap.',
      control: (
        <select
          value={settings.discardAfterMs}
          onChange={(event) => update({ discardAfterMs: Number(event.target.value) })}
          className={inputClass}
        >
          <option value={0}>Never</option>
          <option value={10 * MINUTE}>10 minutes</option>
          <option value={30 * MINUTE}>30 minutes</option>
          <option value={60 * MINUTE}>1 hour</option>
        </select>
      ),
    },
    {
      label: 'Restore tabs on launch',
      hint: 'Reopens the tabs that were open when Omega last quit.',
      control: <Toggle on={settings.restoreSession} onChange={(next) => update({ restoreSession: next })} />,
    },
    {
      label: 'Assistant provider',
      hint: 'Ollama runs locally and needs no key. OpenAI reads OPENAI_API_KEY from the environment.',
      control: (
        <select
          value={settings.aiProvider}
          onChange={(event) => update({ aiProvider: event.target.value as Settings['aiProvider'] })}
          className={inputClass}
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI</option>
        </select>
      ),
    },
    {
      label: 'Model',
      control: (
        <input
          value={settings.aiModel}
          onChange={(event) => update({ aiModel: event.target.value })}
          spellCheck={false}
          className={`${inputClass} w-48`}
        />
      ),
    },
    {
      label: 'Endpoint',
      control: (
        <input
          value={settings.aiEndpoint}
          onChange={(event) => update({ aiEndpoint: event.target.value })}
          spellCheck={false}
          className={`${inputClass} w-72`}
        />
      ),
    },
  ]

  return (
    <section className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <SettingsIcon className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">Settings</h1>
        <button
          type="button"
          aria-label="Close settings"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={() => setState({ settingsOpen: false })}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
        <div className="mx-auto max-w-2xl">
          {rows.map((row) => (
            <Field key={row.label} label={row.label} hint={row.hint}>
              {row.control}
            </Field>
          ))}

          <p className="py-4 text-[11px] leading-relaxed text-chrome-dim">
            Omega runs the chrome UI and every web page in separate Chromium processes with context isolation and the
            sandbox on. Blocked requests are decided before they leave the machine, and the assistant is given page text
            only when you ask a question.
          </p>
        </div>
      </div>
    </section>
  )
}
