/**
 * About — standalone tab page (omega://app/about.html).
 *
 * Versions from the running runtime (never hardcoded), update status from the
 * updater service, and the open-source licenses note.
 */

import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppInfo, UpdateStatus } from '@shared/ipc'
import { Close, Info } from './components/Icons'
import './index.css'

export function AboutPage(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [checking, setChecking] = useState(false)

  const tabId = window.omega.tabId

  useEffect(() => {
    void window.omega.invoke('app:info').then(setInfo).catch(() => undefined)
    void window.omega.invoke('updates:status').then(setStatus).catch(() => undefined)
    return window.omega.on('updates:status', setStatus)
  }, [])

  const check = useCallback(() => {
    setChecking(true)
    void window.omega
      .invoke('updates:check')
      .then(setStatus)
      .finally(() => setChecking(false))
  }, [])

  const closeTab = useCallback(() => {
    if (tabId !== null) void window.omega.invoke('tab:close', tabId)
  }, [tabId])

  const rows: [string, string][] = info
    ? [
        ['Omega', info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node', info.node],
      ]
    : []

  return (
    <section className="flex h-screen flex-col bg-chrome-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <Info className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">About Omega</h1>
        <button
          type="button"
          aria-label="Close about page"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={closeTab}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center overflow-y-auto px-6 py-10">
        <div className="mark mb-2 flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
            <circle cx="16" cy="16" r="13" fill="none" stroke="#7c6af7" strokeWidth="3.2" />
            <circle cx="16" cy="16" r="5" fill="#7c6af7" />
          </svg>
          <span className="text-[20px] font-semibold tracking-tight">Omega</span>
        </div>
        <p className="text-[11.5px] text-chrome-dim">A fast, private web browser</p>

        <div className="mt-8 w-full rounded-xl border border-chrome-border bg-white/3 px-4 py-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-chrome-border/50 py-2.5 last:border-0">
              <span className="text-[12px] text-chrome-muted">{label}</span>
              <span className="text-[12px] tabular-nums text-chrome-fg/90">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 w-full rounded-xl border border-chrome-border bg-white/3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-chrome-muted">Updates</span>
            <UpdateStatusLine status={status} checking={checking} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={check}
              disabled={checking}
              className="rounded-lg border border-chrome-border px-3 py-1 text-[11.5px] text-chrome-muted hover:bg-white/10 hover:text-chrome-fg disabled:opacity-40"
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            {status.state === 'ready' ? (
              <button
                type="button"
                onClick={() => void window.omega.invoke('updates:install')}
                className="rounded-lg bg-chrome-accent px-3 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
              >
                Restart to update
              </button>
            ) : null}
          </div>
          {status.state === 'downloading' ? (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-chrome-accent transition-all" style={{ width: `${status.percent}%` }} />
            </div>
          ) : null}
          <p className="mt-2 text-[10.5px] leading-relaxed text-chrome-dim">
            Omega checks for updates automatically in the background and installs them the next
            time it starts. You can also restart manually once an update is ready.
          </p>
        </div>

        <p className="mt-8 text-center text-[10.5px] leading-relaxed text-chrome-dim">
          Omega is built on Chromium via Electron and is free, open-source software.
          <br />
          Made by Manvith.
        </p>
      </div>
    </section>
  )
}

function UpdateStatusLine({ status, checking }: { status: UpdateStatus; checking: boolean }): React.JSX.Element {
  if (checking) return <span className="text-[12px] text-chrome-dim">Checking…</span>
  switch (status.state) {
    case 'available':
      return <span className="text-[12px] text-amber-300">Version {status.version} available — downloading…</span>
    case 'downloading':
      return <span className="text-[12px] text-chrome-fg/80">Downloading… {status.percent}%</span>
    case 'ready':
      return <span className="text-[12px] text-emerald-300">Update ready — restart to apply</span>
    case 'error':
      return <span className="text-[12px] text-red-300">Update check failed</span>
    case 'not-available':
      return <span className="text-[12px] text-chrome-dim">Up to date</span>
    default:
      return <span className="text-[12px] text-chrome-dim">Automatic</span>
  }
}

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from about.html')

createRoot(container).render(<AboutPage />)
