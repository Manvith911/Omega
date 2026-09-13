import { useCallback, useEffect, useState } from 'react'
import { SEARCH_ENGINES } from '@shared/constants'
import type { ClearDataOptions, CustomSearchEngine, SearchEngineId, Settings } from '@shared/ipc'
import { prettyUrl } from '@shared/url'
import { Close, Settings as SettingsIcon, Sun, Moon as MoonIcon, Plus, Trash } from './Icons'

const MINUTE = 60_000

const inputClass =
  'h-7 rounded-lg border border-chrome-border bg-white/5 px-2 text-[12px] outline-none focus:border-chrome-accent/60'

const btnClass =
  'flex h-7 items-center gap-1.5 rounded-lg border border-chrome-border px-2.5 text-[11.5px] text-chrome-fg/85 transition-colors hover:border-chrome-accent/50 hover:text-chrome-fg disabled:opacity-50'

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

/** Per-origin permission rules with per-entry remove. */
function PermissionRulesList({ settings, onChange }: { settings: Settings; onChange: (rules: Settings['permissionRules']) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rules = settings.permissionRules
  if (rules.length === 0 && !open) {
    return (
      <button type="button" className={btnClass} onClick={() => setOpen(true)}>
        Show
      </button>
    )
  }
  return (
    <span className="flex flex-col items-end gap-1">
      {rules.length === 0 ? <span className="text-[11px] text-chrome-dim">No decisions saved</span> : null}
      {rules.map((rule) => (
        <span key={`${rule.origin}:${rule.permission}`} className="flex items-center gap-2 text-[11px] text-chrome-dim">
          <span className="max-w-52 truncate">{prettyUrl(rule.origin)}</span>
          <span className={rule.granted ? 'text-emerald-400/90' : 'text-rose-400/90'}>
            {rule.granted ? 'allowed' : 'blocked'} · {rule.permission}
          </span>
          <button
            type="button"
            aria-label="Remove rule"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
            onClick={() => onChange(rules.filter((r) => !(r.origin === rule.origin && r.permission === rule.permission)))}
          >
            <Trash className="h-3 w-3" />
          </button>
        </span>
      ))}
      {rules.length > 0 ? (
        <button type="button" className={btnClass} onClick={() => onChange([])}>
          Reset all
        </button>
      ) : (
        <button type="button" className={btnClass} onClick={() => setOpen(false)}>
          Hide
        </button>
      )}
    </span>
  )
}

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

/**
 * The Settings page — a real tab (omega://app/settings.html), not a chrome
 * overlay. Self-contained: loads its own settings over the reduced page API
 * and closes its own tab when the user is done.
 */
export function SettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [busy, setBusy] = useState(false)
  const [newEngine, setNewEngine] = useState<{ name: string; url: string } | null>(null)

  const reloadSettings = useCallback(() => {
    void window.omega.invoke('settings:get').then((s) => {
      setSettings(s)
      setTheme(s.theme)
      document.body.classList.toggle('light', s.theme === 'light')
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    reloadSettings()
    // Keep this page in sync when another surface changes settings (e.g. the
    // toolbar's ad-block toggle) instead of showing a stale view.
    return window.omega.on('settings:changed', (next) => {
      setSettings(next)
      setTheme(next.theme)
      document.body.classList.toggle('light', next.theme === 'light')
    })
  }, [reloadSettings])

  const update = useCallback((patch: Partial<Settings>) => {
    void window.omega
      .invoke('settings:set', patch)
      .then((next) => {
        setSettings(next)
        document.body.classList.toggle('light', next.theme === 'light')
      })
      .catch(() => undefined)
  }, [])

  const toggleTheme = useCallback(() => {
    update({ theme: theme === 'dark' ? 'light' : 'dark' })
  }, [theme, update])

  const closeTab = useCallback(() => {
    if (window.omega.tabId !== null) void window.omega.invoke('tab:close', window.omega.tabId)
  }, [])

  const pickDownloadDir = useCallback(() => {
    setBusy(true)
    void window.omega
      .invoke('downloads:pick-dir')
      .then((dir) => {
        if (dir) update({ downloadsDir: dir })
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [update])

  const clearData = useCallback(
    (options: ClearDataOptions) => {
      setBusy(true)
      void window.omega
        .invoke('data:clear', options)
        .then(() => reloadSettings())
        .catch(() => undefined)
        .finally(() => setBusy(false))
    },
    [reloadSettings],
  )

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
          {settings.customSearchEngines.map((engine) => (
            <option key={engine.id} value={engine.id} className="bg-chrome-elevated">
              {engine.name} (custom)
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
    {
      label: 'Download location',
      hint: 'Where files are saved. Leave empty for the OS Downloads folder.',
      control: (
        <span className="flex items-center gap-2">
          <input
            value={settings.downloadsDir}
            onChange={(event) => update({ downloadsDir: event.target.value })}
            placeholder="Downloads"
            spellCheck={false}
            className={`${inputClass} w-64`}
          />
          <button type="button" className={btnClass} onClick={pickDownloadDir} disabled={busy}>
            Browse…
          </button>
        </span>
      ),
    },
    {
      label: 'Ask where to save each file',
      hint: 'Shows the native Save dialog for every download instead of saving automatically.',
      control: <Toggle on={settings.askDownloadLocation} onChange={(next) => update({ askDownloadLocation: next })} />,
    },
    {
      label: 'Dark mode for websites',
      hint: 'Makes light websites dark automatically (Chromium auto-dark). Takes effect after a relaunch.',
      control: <Toggle on={settings.forceDark} onChange={(next) => update({ forceDark: next })} />,
    },
    {
      label: 'Proxy',
      hint: '“System” follows the OS proxy. “Fixed” uses the rules below, e.g. http=127.0.0.1:8080. Applied on relaunch.',
      control: (
        <span className="flex items-center gap-2">
          <select
            value={settings.proxyMode}
            onChange={(event) => update({ proxyMode: event.target.value as Settings['proxyMode'] })}
            className={inputClass}
          >
            <option value="system">System</option>
            <option value="direct">No proxy</option>
            <option value="fixed">Fixed servers</option>
          </select>
          <input
            value={settings.proxyServer}
            onChange={(event) => update({ proxyServer: event.target.value })}
            placeholder="http=host:port;https=host:port"
            spellCheck={false}
            disabled={settings.proxyMode !== 'fixed'}
            className={`${inputClass} w-56 disabled:opacity-40`}
          />
        </span>
      ),
    },
    {
      label: 'Custom search engines',
      hint: 'Use %s in the URL where the query goes.',
      control: (
        <span className="flex flex-col items-end gap-1.5">
          {settings.customSearchEngines.length === 0 && !newEngine ? (
            <span className="text-[11px] text-chrome-dim">None yet</span>
          ) : (
            settings.customSearchEngines.map((engine) => (
              <span key={engine.id} className="flex items-center gap-2 text-[11px] text-chrome-dim">
                <span className="max-w-52 truncate">{engine.name} — {prettyUrl(engine.url)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${engine.name}`}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
                  onClick={() => {
                    const rest = settings.customSearchEngines.filter((e) => e.id !== engine.id)
                    update({
                      customSearchEngines: rest,
                      searchEngine: settings.searchEngine === engine.id ? 'duckduckgo' : settings.searchEngine,
                    })
                  }}
                >
                  <Trash className="h-3 w-3" />
                </button>
              </span>
            ))
          )}
          {newEngine ? (
            <span className="flex items-end gap-1.5">
              <span className="flex flex-col gap-1">
                <input value={newEngine.name} onChange={(e) => setNewEngine({ ...newEngine, name: e.target.value })} placeholder="Name" className={`${inputClass} w-32`} />
                <input value={newEngine.url} onChange={(e) => setNewEngine({ ...newEngine, url: e.target.value })} placeholder="https://…?q=%s" spellCheck={false} className={`${inputClass} w-64`} />
              </span>
              <button
                type="button"
                className={btnClass}
                onClick={() => {
                  const url = newEngine.url.trim()
                  const name = newEngine.name.trim()
                  if (!url || !url.includes('%s')) return
                  const id = `custom-${Date.now().toString(36)}`
                  const engine: CustomSearchEngine = { id, name: name || id, url }
                  update({ customSearchEngines: [...settings.customSearchEngines, engine], searchEngine: id })
                  setNewEngine(null)
                }}
              >
                Save
              </button>
              <button type="button" className={btnClass} onClick={() => setNewEngine(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={btnClass} onClick={() => setNewEngine({ name: '', url: '' })}>
              <Plus className="h-3 w-3" /> Add engine
            </button>
          )}
        </span>
      ),
    },
    {
      label: 'Site permissions',
      hint: 'Sites you have allowed or blocked for camera, microphone, notifications and location.',
      control: <PermissionRulesList settings={settings} onChange={(rules) => update({ permissionRules: rules })} />,
    },
    {
      label: 'Clear browsing data',
      hint: 'Removes cookies, cache and site data from the browsing session. History is cleared on the History page.',
      control: (
        <span className="flex items-center gap-2">
          <button type="button" className={btnClass} onClick={() => clearData({ history: false, cookies: true, cache: false })} disabled={busy}>
            Cookies
          </button>
          <button type="button" className={btnClass} onClick={() => clearData({ history: false, cookies: false, cache: true })} disabled={busy}>
            Cached files
          </button>
          <button type="button" className={btnClass} onClick={() => clearData({ history: false, cookies: true, cache: true, localStorage: true, indexedDB: true, serviceWorkers: true })} disabled={busy}>
            Everything
          </button>
        </span>
      ),
    },
  ]

  return (
    <section className="flex h-screen flex-col bg-chrome-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <SettingsIcon className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">Settings</h1>
        <button
          type="button"
          aria-label="Close settings"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={closeTab}
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
