import { useEffect, useState } from 'react'
import type { SuggestState, Suggestion } from '@shared/ipc'
import { Clock, Globe, Search, Sparkles } from './Icons'

const EMPTY: SuggestState = { visible: false, query: '', items: [], activeIndex: -1 }

function KindIcon({ kind }: { kind: Suggestion['kind'] }): React.JSX.Element {
  const cls = 'h-3.5 w-3.5 shrink-0 text-chrome-dim'
  switch (kind) {
    case 'search':
      return <Search className={cls} />
    case 'history':
      return <Clock className={cls} />
    case 'top':
      return <Sparkles className={cls} />
    case 'url':
    default:
      return <Globe className={cls} />
  }
}

/** Highlights the typed substring so the match reason is obvious. */
function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim()
  if (!needle) return <>{text}</>
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="font-medium text-chrome-accent">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  )
}

/**
 * Display-only surface.
 *
 * Keyboard focus never moves here — the omnibox keeps it — so arrow keys and
 * Enter are handled by the chrome UI and forwarded as a highlight index. That
 * is why rows use `onMouseDown` (fires before the omnibox's blur) rather than
 * `onClick`.
 */
export function Suggestions(): React.JSX.Element | null {
  const [state, setState] = useState<SuggestState>(EMPTY)

  useEffect(() => {
    return window.omega.on('suggest:state', setState)
  }, [])

  if (!state.visible || state.items.length === 0) return null

  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-chrome-border bg-[#1b1b26] py-2 shadow-2xl shadow-black/60">
      {state.items.map((item, index) => {
        const active = index === state.activeIndex
        return (
          <div
            key={`${item.kind}-${item.url}-${index}`}
            // 44px row, matching SUGGESTION_ROW_HEIGHT so the native view's
            // computed height lines up exactly with the rendered content.
            className={[
              'flex h-11 cursor-default items-center gap-3 px-3.5',
              active ? 'bg-white/9' : 'hover:bg-white/5',
            ].join(' ')}
            onMouseDown={(event) => {
              event.preventDefault()
              void window.omega.invoke('suggest:select', index)
            }}
            onMouseEnter={() => void window.omega.invoke('suggest:highlight', index)}
          >
            <KindIcon kind={item.kind} />

            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] leading-tight text-chrome-fg/95">
                <Highlight text={item.title} query={state.query} />
              </div>
              {item.subtitle ? (
                <div className="mt-0.5 truncate text-[10.5px] leading-tight text-chrome-dim">
                  <Highlight text={item.subtitle} query={state.query} />
                </div>
              ) : null}
            </div>

            {item.kind === 'history' && item.visitCount > 1 ? (
              <span className="shrink-0 text-[10px] tabular-nums text-chrome-dim">{item.visitCount}×</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
