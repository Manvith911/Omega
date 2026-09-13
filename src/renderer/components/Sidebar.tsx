import { useCallback, useEffect, useRef, useState } from 'react'
import { SIDEBAR_WIDTH } from '@shared/constants'
import type { PageContent } from '@shared/ipc'
import { useActiveTab, useChrome } from '../store'
import { Close, Sparkles, Stop } from './Icons'

const QUICK_PROMPTS = ['Summarise this page', 'What are the key claims?', 'List action items', 'Explain it simply']

/**
 * Page assistant.
 *
 * Only one request is ever in flight, which is what lets the streaming handler
 * accept any incoming chunk without first having to learn the request id —
 * the id is only known once `ai:ask` resolves, and the first token can beat
 * that promise.
 */
export function Sidebar(): React.JSX.Element {
  const tab = useActiveTab()
  const settings = useChrome((s) => s.settings)
  const setState = useChrome.setState

  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [page, setPage] = useState<PageContent | null>(null)

  const streamingRef = useRef(false)
  const answerRef = useRef('')
  /** In-flight request id from ai:ask; Stop aborts the real request. */
  const requestRef = useRef<string | null>(null)

  const tabId = tab?.id ?? null

  useEffect(() => {
    return window.omega.on('ai:chunk', (chunk) => {
      if (!streamingRef.current) return
      if (chunk.type === 'token') {
        answerRef.current += chunk.value
        setAnswer(answerRef.current)
        return
      }
      streamingRef.current = false
      requestRef.current = null
      setStreaming(false)
      if (chunk.type === 'error') setError(chunk.value)
    })
  }, [])

  // Re-read the page whenever the active tab changes, so the header reflects
  // what the assistant can actually see.
  useEffect(() => {
    if (tabId === null) {
      setPage(null)
      return
    }
    let cancelled = false
    void window.omega
      .invoke('ai:extract', tabId)
      .then((content) => {
        if (!cancelled) setPage(content)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tabId])

  const ask = useCallback(
    (text: string) => {
      if (tabId === null || streamingRef.current) return
      setError(null)
      setAnswer('')
      answerRef.current = ''
      streamingRef.current = true
      setStreaming(true)
      void window.omega
        .invoke('ai:ask', tabId, text)
        .then((id) => {
          // The first token can beat this promise; only remember the id while
          // we are still streaming so Stop can abort the real request.
          if (streamingRef.current) requestRef.current = id
        })
        .catch((err: unknown) => {
          streamingRef.current = false
          setStreaming(false)
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [tabId],
  )

  const abort = useCallback(() => {
    if (requestRef.current) void window.omega.invoke('ai:abort', requestRef.current).catch(() => undefined)
    requestRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }, [])

  const provider = settings ? `${settings.aiProvider === 'ollama' ? 'Ollama' : 'OpenAI'} · ${settings.aiModel}` : 'not configured'

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-chrome-border bg-chrome-surface"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-chrome-border px-3">
        <Sparkles className="h-4 w-4 text-chrome-accent" />
        <span className="text-[12.5px] font-medium">Page assistant</span>
        <span className="truncate text-[11px] text-chrome-dim" title={provider}>
          {provider}
        </span>
        <button
          type="button"
          aria-label="Close assistant"
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={() => setState({ sidebarOpen: false })}
        >
          <Close className="h-3 w-3" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 rounded-lg border border-chrome-border bg-white/4 px-3 py-2">
          <div className="truncate text-[11.5px] text-chrome-fg/80">{page?.title || 'No page content available'}</div>
          <div className="mt-0.5 text-[10.5px] text-chrome-dim">
            {page ? `${page.text.length.toLocaleString()} characters read from this page` : 'Internal pages have no readable content'}
          </div>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-[11.5px] text-red-300">
            {error}
          </div>
        ) : null}

        {answer ? (
          <div className="mb-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chrome-fg/90">{answer}</div>
        ) : null}

        {streaming ? (
          <div className="mb-3 flex items-center gap-2 text-[11.5px] text-chrome-dim">
            <span className="spin h-3 w-3 rounded-full border-[1.5px] border-chrome-accent border-t-transparent" />
            Thinking…
          </div>
        ) : null}

        {!answer && !streaming && !error ? (
          <div className="space-y-1.5">
            {QUICK_PROMPTS.map((text) => (
              <button
                key={text}
                type="button"
                disabled={!page}
                className="block w-full rounded-lg border border-chrome-border bg-white/3 px-3 py-2 text-left text-[12px] text-chrome-fg/80 transition-colors hover:bg-white/8 disabled:opacity-40"
                onClick={() => ask(text)}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-chrome-border px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          const text = prompt.trim()
          if (!text) return
          setPrompt('')
          ask(text)
        }}
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask about this page…"
          disabled={!page}
          className="min-w-0 flex-1 rounded-lg border border-chrome-border bg-white/5 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-chrome-dim focus:border-chrome-accent/60 disabled:opacity-40"
        />
        {streaming ? (
          <button
            type="button"
            aria-label="Stop"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
            onClick={abort}
          >
            <Stop className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!page || !prompt.trim()}
            className="shrink-0 rounded-lg bg-chrome-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            Ask
          </button>
        )}
      </form>
    </aside>
  )
}
