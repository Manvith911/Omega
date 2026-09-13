/**
 * Extensions — standalone tab page (omega://app/extensions.html).
 *
 * Electron has no Chrome Web Store integration, so this page manages
 * extensions the way Chrome's developer mode does: load an unpacked folder,
 * remove, and see what is active. The manager persists loaded folders in
 * settings so they survive relaunch.
 */

import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExtensionInfo } from '@shared/ipc'
import { Close, Puzzle } from './components/Icons'

export function ExtensionsPage(): React.JSX.Element {
  const [items, setItems] = useState<ExtensionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    void window.omega
      .invoke('extensions:list')
      .then((list) => {
        setItems(list)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const loadUnpacked = useCallback(() => {
    setError(null)
    void window.omega
      .invoke('extensions:load')
      .then((record) => {
        if (record) reload()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
      })
  }, [reload])

  const remove = useCallback(
    (id: string) => {
      void window.omega.invoke('extensions:remove', id).then(reload)
    },
    [reload],
  )

  const closeTab = useCallback(() => {
    if (window.omega.tabId !== null) void window.omega.invoke('tab:close', window.omega.tabId)
  }, [])

  return (
    <section className="flex h-screen flex-col bg-chrome-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <Puzzle className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">Extensions</h1>
        <span className="text-[11px] text-chrome-dim">{items.length} installed</span>
        <button
          type="button"
          onClick={loadUnpacked}
          className="ml-auto rounded-lg bg-chrome-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Load unpacked
        </button>
        <button
          type="button"
          aria-label="Close extensions"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={closeTab}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div className="mx-auto mb-3 max-w-2xl rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-[11.5px] text-red-300">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="p-6 text-center text-[12px] text-chrome-dim">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <p className="p-4 text-center text-[12.5px] text-chrome-dim">No extensions installed.</p>
            <div className="rounded-lg border border-chrome-border bg-white/4 px-4 py-3 text-[11.5px] leading-relaxed text-chrome-dim">
              <p className="mb-2 font-medium text-chrome-fg/80">How extensions work in Omega</p>
              <p className="mb-2">
                Omega supports Chromium (Manifest V3) extensions loaded from a folder — the same "unpacked" flow Chrome's
                developer mode uses. Download an extension's source (many popular ones publish it), unzip it, then click
                <span className="text-chrome-fg/90"> Load unpacked</span>.
              </p>
              <p>
                The Chrome Web Store's one-click install button is not available here — that integration is exclusive to
                Chrome itself.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-1.5">
            {items.map((ext) => (
              <div key={ext.id} className="flex items-center gap-3 rounded-lg border border-chrome-border bg-white/4 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/8 text-chrome-dim">
                  <Puzzle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-chrome-fg/90">
                    {ext.name} <span className="text-[10.5px] text-chrome-dim">{ext.version}</span>
                  </div>
                  {ext.description ? (
                    <div className="truncate text-[11px] text-chrome-dim">{ext.description}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg px-2.5 py-1 text-[11.5px] text-chrome-muted hover:bg-white/10 hover:text-red-300"
                  onClick={() => remove(ext.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from extensions.html')

createRoot(container).render(<ExtensionsPage />)
