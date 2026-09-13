/**
 * Bookmarks — standalone tab page (omega://app/bookmarks.html).
 *
 * Reads/writes through the reduced page API; entries open by navigating the
 * page's own tab, matching History's behaviour.
 */

import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Bookmark } from '@shared/ipc'
import { prettyUrl } from '@shared/url'
import { Close, Globe, StarFilled, Trash } from './components/Icons'
import './index.css'

function faviconFor(url: string): string | null {
  try {
    return `https://${new URL(url).hostname}/favicon.ico`
  } catch {
    return null
  }
}

export function BookmarksPage(): React.JSX.Element {
  const [items, setItems] = useState<Bookmark[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const tabId = window.omega.tabId

  const reload = useCallback(() => {
    void window.omega
      .invoke('bookmarks:list')
      .then((rows) => {
        setItems(rows)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const remove = useCallback(
    (id: number) => {
      void window.omega.invoke('bookmarks:remove', id).then(reload)
    },
    [reload],
  )

  const open = useCallback(
    (url: string) => {
      if (tabId !== null) void window.omega.invoke('nav:go', { tabId, url })
    },
    [tabId],
  )

  const closeTab = useCallback(() => {
    if (tabId !== null) void window.omega.invoke('tab:close', tabId)
  }, [tabId])

  const f = filter.trim().toLowerCase()
  const shown = f
    ? items.filter((b) => b.title.toLowerCase().includes(f) || b.url.toLowerCase().includes(f))
    : items

  return (
    <section className="flex h-screen flex-col bg-chrome-bg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <StarFilled className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">Bookmarks</h1>
        <span className="text-[11px] text-chrome-dim">{items.length} saved</span>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter bookmarks"
          spellCheck={false}
          className="ml-auto h-7 w-64 rounded-lg border border-chrome-border bg-white/5 px-2.5 text-[12px] outline-none placeholder:text-chrome-dim focus:border-chrome-accent/60"
        />

        <button
          type="button"
          aria-label="Close bookmarks"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={closeTab}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="p-6 text-center text-[12px] text-chrome-dim">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-chrome-dim">
            {filter ? 'Nothing matches that filter.' : 'No bookmarks yet. Use the star in the toolbar or press Ctrl+D.'}
          </p>
        ) : (
          shown.map((b) => (
            <div
              key={b.id}
              className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/6"
              onClick={() => open(b.url)}
            >
              {faviconFor(b.url) ? (
                <img
                  src={faviconFor(b.url) ?? ''}
                  alt=""
                  width={15}
                  height={15}
                  loading="lazy"
                  className="h-[15px] w-[15px] shrink-0 rounded-[3px] object-contain"
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden'
                  }}
                />
              ) : (
                <Globe className="h-[15px] w-[15px] shrink-0 text-chrome-dim" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-chrome-fg/90">{b.title || b.url}</span>
              <span className="hidden shrink-0 text-[11px] text-chrome-dim group-hover:inline">
                {prettyUrl(b.url)}
              </span>
              <button
                type="button"
                aria-label={`Remove bookmark: ${b.title || b.url}`}
                className="hidden shrink-0 rounded-lg px-2 py-1 text-[11.5px] text-chrome-muted hover:bg-white/10 hover:text-red-300 group-hover:block"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(b.id)
                }}
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from bookmarks.html')

createRoot(container).render(<BookmarksPage />)
