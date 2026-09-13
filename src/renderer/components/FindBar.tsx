import { useCallback, useEffect, useRef, useState } from 'react'
import type { FindResult } from '@shared/ipc'
import { useChrome } from '../store'
import { ArrowDown, ArrowUp, Close, Search } from './Icons'

/**
 * Deliberately inline in the toolbar rather than floating over the page.
 * A floating bar would be DOM painted under the native page view, so it would
 * either need the overlay surface or a viewport resize — neither is worth it
 * for a 220px control.
 */
export function FindBar(): React.JSX.Element {
  const setFindOpen = useChrome((s) => s.setFindOpen)
  /** Survives close/reopen within the session, like the omnibox draft. */
  const [text, setText] = useState(() => sessionStorage.getItem('omega:find-text') ?? '')
  const [result, setResult] = useState<FindResult>({ matches: 0, active: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // The main process reports counts asynchronously; a page with thousands of
  // matches would otherwise block the keystroke that triggered the search.
  useEffect(() => {
    return window.omega.on('find:result', setResult)
  }, [])

  const stop = useCallback(() => {
    void window.omega.invoke('find:stop')
  }, [])

  /** One findInPage per keystroke hammers large pages; 120ms is invisible. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const close = useCallback(() => {
    stop()
    setFindOpen(false)
  }, [setFindOpen, stop])

  const search = useCallback(
    (value: string) => {
      setText(value)
      sessionStorage.setItem('omega:find-text', value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (value) {
        debounceRef.current = setTimeout(() => {
          void window.omega.invoke('find:start', value).then(setResult).catch(() => undefined)
        }, 120)
      } else {
        stop()
        setResult({ matches: 0, active: 0 })
      }
    },
    [stop],
  )

  const step = useCallback(
    (forward: boolean) => {
      if (!text) return
      void window.omega.invoke('find:next', text, forward).then(setResult)
    },
    [text],
  )

  return (
    <div className="no-drag animate-in flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-chrome-border bg-white/6 pl-2.5 pr-1">
      <Search className="h-3.5 w-3.5 shrink-0 text-chrome-dim" />

      <input
        ref={inputRef}
        type="text"
        value={text}
        spellCheck={false}
        placeholder="Find in page"
        aria-label="Find in page"
        className="w-40 bg-transparent text-[12.5px] text-chrome-fg outline-none placeholder:text-chrome-dim"
        onChange={(event) => search(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(!event.shiftKey)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      />

      <span className="w-14 shrink-0 text-center text-[11px] tabular-nums text-chrome-dim">
        {text ? (result.matches > 0 ? `${result.active}/${result.matches}` : '0/0') : ''}
      </span>

      <button
        type="button"
        aria-label="Previous match"
        className="flex h-6 w-6 items-center justify-center rounded text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
        onClick={() => step(false)}
      >
        <ArrowUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        className="flex h-6 w-6 items-center justify-center rounded text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
        onClick={() => step(true)}
      >
        <ArrowDown className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Close find bar"
        className="flex h-6 w-6 items-center justify-center rounded text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
        onClick={close}
      >
        <Close className="h-3 w-3" />
      </button>
    </div>
  )
}
