import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '@shared/ipc'
import { prettyUrl } from '@shared/url'
import { useChrome } from '../store'
import { Close, Clock, Search, Trash } from './Icons'

/** A malformed URL must not take the whole panel down. */
function faviconFor(url: string): string | null {
  try {
    return `https://${new URL(url).hostname}/favicon.ico`
  } catch {
    return null
  }
}

function groupLabel(timestamp: number): string {
  const now = new Date()
  const then = new Date(timestamp)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 86_400_000
  if (timestamp >= startOfToday) return 'Today'
  if (timestamp >= startOfToday - dayMs) return 'Yesterday'
  if (timestamp >= startOfToday - dayMs * 7) return 'Earlier this week'
  return then.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function HistoryPanel(): React.JSX.Element {
  const activeTabId = useChrome((s) => s.activeTabId)
  const setState = useChrome.setState

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    void window.omega
      .invoke('history:list', 500)
      .then((rows) => {
        setEntries(rows)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered = needle
      ? entries.filter((e) => e.url.toLowerCase().includes(needle) || e.title.toLowerCase().includes(needle))
      : entries

    const buckets: { label: string; items: HistoryEntry[] }[] = []
    for (const entry of filtered) {
      const label = groupLabel(entry.visitedAt)
      const last = buckets[buckets.length - 1]
      if (last && last.label === label) last.items.push(entry)
      else buckets.push({ label, items: [entry] })
    }
    return buckets
  }, [entries, filter])

  const open = useCallback(
    (url: string) => {
      if (activeTabId !== null) void window.omega.invoke('nav:go', { tabId: activeTabId, url })
      setState({ historyOpen: false })
    },
    [activeTabId, setState],
  )

  const remove = useCallback(
    (id: number) => {
      void window.omega.invoke('history:delete', id).then(reload)
    },
    [reload],
  )

  const clearAll = useCallback(() => {
    void window.omega.invoke('history:clear').then(reload)
  }, [reload])

  return (
    <section className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border px-4">
        <Clock className="h-4 w-4 text-chrome-accent" />
        <h1 className="text-[13px] font-medium">History</h1>
        <span className="text-[11px] text-chrome-dim">{entries.length} entries</span>

        <div className="relative ml-auto flex h-7 w-64 items-center gap-1.5 rounded-lg border border-chrome-border bg-white/5 px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-chrome-dim" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter history"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-chrome-dim"
          />
        </div>

        <button
          type="button"
          onClick={clearAll}
          disabled={entries.length === 0}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-chrome-border px-2.5 text-[11.5px] text-chrome-muted transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
        >
          <Trash className="h-3.5 w-3.5" />
          Clear all
        </button>

        <button
          type="button"
          aria-label="Close history"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={() => setState({ historyOpen: false })}
        >
          <Close className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="p-6 text-center text-[12px] text-chrome-dim">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-chrome-dim">
            {filter ? 'Nothing matches that filter.' : 'No history yet. Pages you visit will show up here.'}
          </p>
        ) : (
          grouped.map((bucket) => (
            <div key={bucket.label} className="mb-4">
              <h2 className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-chrome-dim">{bucket.label}</h2>
              {bucket.items.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/6"
                  onClick={() => open(entry.url)}
                >
                  {faviconFor(entry.url) ? (
                    <img
                      src={faviconFor(entry.url) ?? ''}
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
                    <span className="h-[15px] w-[15px] shrink-0 rounded-[3px] bg-white/8" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-chrome-fg/90">{entry.title || prettyUrl(entry.url)}</div>
                    <div className="truncate text-[11px] text-chrome-dim">{prettyUrl(entry.url)}</div>
                  </div>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-chrome-dim">
                    {entry.visitCount > 1 ? `${entry.visitCount}×` : ''}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove from history"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-transparent hover:bg-white/10 hover:text-chrome-fg group-hover:text-chrome-muted"
                    onClick={(event) => {
                      event.stopPropagation()
                      remove(entry.id)
                    }}
                  >
                    <Close className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
