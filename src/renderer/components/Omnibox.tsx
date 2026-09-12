import { useCallback, useEffect, useRef, useState } from 'react'
import { prettyUrl, protocolKind } from '@shared/url'
import type { Rect } from '@shared/ipc'
import { useActiveTab } from '../store'
import { Close, Globe, Lock, Search, Warning } from './Icons'

/**
 * Debounce for autocomplete. Short enough to feel instant, long enough that a
 * fast typist generates one query per pause rather than one per keystroke —
 * every query is an IPC round trip and a SQLite read.
 */
const DEBOUNCE_MS = 90

/** Grace period on blur so a click landing on the overlay still registers. */
const BLUR_GRACE_MS = 180

function ProtocolBadge({ url }: { url: string }): React.JSX.Element | null {
  const kind = protocolKind(url)
  if (kind === 'unknown') return null

  if (kind === 'https') {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1 rounded bg-emerald-500/12 px-1.5 text-[10px] font-medium text-emerald-400" title="Connection is encrypted">
        <Lock className="h-3 w-3" />
      </span>
    )
  }
  if (kind === 'http') {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1 rounded bg-amber-500/12 px-1.5 text-[10px] font-medium text-amber-400" title="Connection is not secure">
        <Warning className="h-3 w-3" />
      </span>
    )
  }
  return (
    <span className="flex h-5 shrink-0 items-center rounded bg-white/8 px-1.5 text-chrome-dim" title="Local page">
      <Globe className="h-3 w-3" />
    </span>
  )
}

export function Omnibox(): React.JSX.Element {
  const tab = useActiveTab()
  const tabId = tab?.id ?? null
  const tabUrl = tab?.url ?? ''
  const isLoading = tab?.isLoading ?? false

  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [itemCount, setItemCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * The single most important rule in this component: the page may only write
   * into the input when the user is not typing in it. Without this guard a
   * `did-navigate` from a background frame wipes a half-typed query.
   */
  useEffect(() => {
    if (focused) return
    setValue(prettyUrl(tabUrl))
    setItemCount(0)
    setActiveIndex(-1)
  }, [tabUrl, focused, tabId])

  const anchor = useCallback((): Rect => {
    const el = wrapRef.current
    if (!el) return { x: 0, y: 0, width: 0, height: 0 }
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }
  }, [])

  const query = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!text.trim()) {
        setItemCount(0)
        setActiveIndex(-1)
        void window.omega.invoke('suggest:dismiss')
        return
      }
      debounceRef.current = setTimeout(() => {
        void window.omega
          .invoke('suggest:query', text, anchor())
          .then((state) => {
            setItemCount(state.items.length)
            setActiveIndex(state.activeIndex)
          })
          .catch(() => setItemCount(0))
      }, DEBOUNCE_MS)
    },
    [anchor],
  )

  const highlight = useCallback(
    (index: number) => {
      setActiveIndex(index)
      void window.omega.invoke('suggest:highlight', index)
    },
    [],
  )

  const commit = useCallback(() => {
    if (tabId === null) return
    if (itemCount > 0 && activeIndex >= 0) {
      void window.omega.invoke('suggest:select', activeIndex)
    } else {
      void window.omega.invoke('nav:go', { tabId, url: value })
    }
    setItemCount(0)
    setActiveIndex(-1)
    inputRef.current?.blur()
  }, [activeIndex, itemCount, tabId, value])

  const onFocus = useCallback(() => {
    if (blurRef.current) clearTimeout(blurRef.current)
    setFocused(true)
    // Pre-fill with the real URL so Enter re-navigates rather than searching
    // the pretty form, then select it so typing replaces it.
    setValue(tabUrl.startsWith('omega://') ? '' : tabUrl)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [tabUrl])

  const onBlur = useCallback(() => {
    blurRef.current = setTimeout(() => {
      setFocused(false)
      setItemCount(0)
      setActiveIndex(-1)
      void window.omega.invoke('suggest:dismiss').catch(() => undefined)
    }, BLUR_GRACE_MS)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          commit()
          break
        case 'ArrowDown':
          event.preventDefault()
          if (itemCount > 0) highlight(Math.min(activeIndex + 1, itemCount - 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          if (itemCount > 0) highlight(Math.max(activeIndex - 1, 0))
          break
        case 'Escape':
          event.preventDefault()
          if (itemCount > 0) {
            setItemCount(0)
            setActiveIndex(-1)
            void window.omega.invoke('suggest:dismiss')
          } else {
            inputRef.current?.blur()
          }
          break
        case 'Tab':
          // Accept the highlighted completion without navigating.
          if (itemCount > 0) event.preventDefault()
          break
        default:
          break
      }
    },
    [activeIndex, commit, highlight, itemCount],
  )

  // Ctrl+L arrives via the application menu, because focus is usually in the
  // tab's view and this window never sees the keypress.
  useEffect(() => {
    return window.omega.on('ui:command', (command) => {
      if (command !== 'focus-omnibox') return
      inputRef.current?.focus()
      requestAnimationFrame(() => inputRef.current?.select())
    })
  }, [])

  useEffect(() => {
    return window.omega.on('suggest:commit', () => {
      setItemCount(0)
      setActiveIndex(-1)
      setFocused(false)
      inputRef.current?.blur()
    })
  }, [])

  const displayUrl = prettyUrl(tabUrl)

  return (
    <div ref={wrapRef} className="no-drag relative mx-auto w-full max-w-[760px] flex-1">
      <div
        className={[
          'relative flex h-8 items-center gap-2 rounded-[10px] border px-2.5 transition-colors duration-150',
          focused
            ? 'border-chrome-accent/60 bg-white/10'
            : 'border-chrome-border bg-white/6 hover:bg-white/9',
        ].join(' ')}
      >
        {focused ? (
          <Search className="h-3.5 w-3.5 shrink-0 text-chrome-dim" />
        ) : displayUrl ? (
          <ProtocolBadge url={tabUrl} />
        ) : null}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Address and search"
          aria-autocomplete="list"
          aria-expanded={itemCount > 0}
          value={value}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Search or enter an address"
          onChange={(event) => {
            setValue(event.target.value)
            query(event.target.value)
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chrome-fg outline-none placeholder:text-chrome-dim"
        />

        {isLoading && tabId !== null ? (
          <button
            type="button"
            aria-label="Stop loading"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-chrome-muted hover:text-chrome-fg"
            onMouseDown={(event) => {
              event.preventDefault()
              void window.omega.invoke('nav:stop', tabId)
            }}
          >
            <Close className="h-3 w-3" />
          </button>
        ) : focused && value ? (
          <button
            type="button"
            aria-label="Clear"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-chrome-dim hover:text-chrome-fg"
            onMouseDown={(event) => {
              event.preventDefault()
              setValue('')
              query('')
              inputRef.current?.focus()
            }}
          >
            <Close className="h-3 w-3" />
          </button>
        ) : null}

        {/* Indeterminate loading rail, matching the omnibox's bottom edge. */}
        {isLoading ? (
          <span className="pointer-events-none absolute inset-x-2 -bottom-px h-px overflow-hidden rounded-full">
            <span className="block h-full w-1/3 animate-pulse bg-chrome-accent/80" />
          </span>
        ) : null}
      </div>
    </div>
  )
}
