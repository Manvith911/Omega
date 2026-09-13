/**
 * Downloads — standalone tab page (omega://app/downloads.html).
 *
 * Live list: the manager pushes `downloads:updated` on every state change,
 * and the page re-fetches on mount. Only one request kind exists, so the
 * reduced page API covers everything shown here.
 */

import { useCallback, useEffect, useState } from 'react'
import type { DownloadInfo } from '@shared/ipc'
import { Close, ArrowDown, Folder } from './components/Icons'

function fmtBytes(n: number): string {
  if (n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function DownloadsPage(): React.JSX.Element {
  const [items, setItems] = useState<DownloadInfo[]>([])

  useEffect(() => {
    void window.omega.invoke('downloads:list').then(setItems).catch(() => undefined)
    return window.omega.on('downloads:updated', setItems)
  }, [])

  const clearFinished = useCallback(() => {
    void window.omega.invoke('downloads:clear-finished')
  }, [])

  const closeTab = useCallback(() => {
    if (window.omega.tabId !== null) void window.omega.invoke('tab:close', window.omega.tabId)
  }, [])

  const active = items.filter((d) => d.state === 'progressing').length

  return (
    <section className="flex h-screen flex-col bg-chrome-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <ArrowDown className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">Downloads</h1>
        <span className="text-[11px] text-chrome-dim">{active > 0 ? `${active} active` : `${items.length} items`}</span>
        <button
          type="button"
          onClick={clearFinished}
          disabled={!items.some((d) => d.state !== 'progressing')}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-lg border border-chrome-border px-2.5 text-[11.5px] text-chrome-muted transition-colors hover:border-chrome-accent/40 hover:text-chrome-fg disabled:opacity-40"
        >
          Clear finished
        </button>
        <button
          type="button"
          aria-label="Close downloads"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={closeTab}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="p-8 text-center text-[12.5px] text-chrome-dim">
            No downloads yet. Files you download from the web appear here.
          </p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-1.5">
            {items.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-chrome-border bg-white/4 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/8 text-chrome-dim">
                  <ArrowDown className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-chrome-fg/90">{d.filename}</div>
                  {d.state === 'progressing' ? (
                    <div className="mt-1">
                      <div className="h-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full bg-chrome-accent transition-all"
                          style={{ width: d.total > 0 ? `${Math.min(100, (d.received / d.total) * 100)}%` : '30%' }}
                        />
                      </div>
                      <div className="mt-1 text-[10.5px] text-chrome-dim">
                        {fmtBytes(d.received)} of {d.total > 0 ? fmtBytes(d.total) : 'unknown'}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[10.5px] text-chrome-dim">
                      {d.state === 'completed' && `${fmtBytes(d.total)} · `}
                      {d.state === 'completed' && `Done ${fmtTime(d.endedAt ?? d.startedAt)}`}
                      {d.state === 'cancelled' && 'Cancelled'}
                      {d.state === 'interrupted' && 'Failed — network or disk error'}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {d.state === 'progressing' ? (
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1 text-[11.5px] text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
                      onClick={() => void window.omega.invoke('downloads:cancel', d.id)}
                    >
                      Cancel
                    </button>
                  ) : d.state === 'completed' ? (
                    <>
                      <button
                        type="button"
                        className="rounded-lg bg-chrome-accent/90 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-chrome-accent"
                        onClick={() => void window.omega.invoke('downloads:open', d.id)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        aria-label="Show in folder"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
                        onClick={() => void window.omega.invoke('downloads:show', d.id)}
                      >
                        <Folder className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
