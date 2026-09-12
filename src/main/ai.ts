/**
 * AI page context.
 *
 * Two rules shape this module:
 *
 *   1. Extraction runs in the *page's* renderer via `executeJavaScript`, so it
 *      sees the live DOM (including anything rendered client-side) without us
 *      shipping a content script.
 *   2. Summarisation runs here, in the browser process. An API key never enters
 *      a renderer, and the request never passes through page script.
 *
 * Local Ollama is the default provider: it needs no key and no egress.
 */

import { randomUUID } from 'node:crypto'
import { net } from 'electron'
import type { AiChunk, PageContent, Settings } from '@shared/ipc'
import type { SettingsStore } from './settings-store'
import type { TabManager } from './tab-manager'

/** Hard cap on what we will send to a model: ~3k tokens. */
const MAX_CHARS = 12_000

/**
 * Self-contained: this string is evaluated inside the page, so it cannot close
 * over anything from the main process.
 */
const EXTRACT_SCRIPT = `(() => {
  const firstNonEmpty = (selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      const text = el && el.innerText ? el.innerText.trim() : ''
      if (text.length > 200) return text
    }
    return ''
  }
  const body = firstNonEmpty(['article', 'main', '[role="main"]', '#content', '.post-content']) ||
    (document.body ? document.body.innerText : '')
  return {
    title: document.title || '',
    url: location.href,
    text: body.replace(/\\s+/g, ' ').trim().slice(0, ${MAX_CHARS}),
  }
})()`

const SYSTEM_PROMPT =
  'You are the assistant built into the Omega web browser. Answer using only the page content provided. ' +
  'Be concise and concrete. If the page does not contain the answer, say so plainly.'

export class AiService {
  private readonly inFlight = new Map<string, Electron.ClientRequest>()

  constructor(
    private readonly tabs: TabManager,
    private readonly settings: SettingsStore,
    private readonly emit: (chunk: AiChunk) => void,
  ) {}

  async extract(tabId: number): Promise<PageContent | null> {
    const wc = this.tabs.getWebContents(tabId)
    if (!wc) return null
    const url = wc.getURL()
    if (!/^https?:/.test(url)) return null
    try {
      const result = (await wc.executeJavaScript(EXTRACT_SCRIPT, false)) as PageContent | null
      if (!result || typeof result.text !== 'string') return null
      return result
    } catch {
      // The page may have navigated away mid-extraction.
      return null
    }
  }

  /** Returns a request id immediately; tokens arrive on the `ai:chunk` event. */
  async ask(tabId: number, prompt: string): Promise<string> {
    const id = randomUUID()
    const config = this.settings.get()
    const page = await this.extract(tabId)

    if (!page || page.text.length < 40) {
      this.emit({ id, type: 'error', value: 'This page has no readable text content.' })
      return id
    }

    const body = JSON.stringify({
      model: config.aiModel,
      stream: true,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Page title: ${page.title}\nPage URL: ${page.url}\n\n` +
            `--- BEGIN PAGE CONTENT ---\n${page.text}\n--- END PAGE CONTENT ---\n\n` +
            `Question: ${prompt || 'Summarise this page in five short bullet points.'}`,
        },
      ],
    })

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.aiProvider === 'openai') {
      const key = process.env['OPENAI_API_KEY']
      if (!key) {
        this.emit({ id, type: 'error', value: 'OPENAI_API_KEY is not set in the app environment.' })
        return id
      }
      headers['authorization'] = `Bearer ${key}`
    }

    try {
      const request = net.request({ method: 'POST', url: config.aiEndpoint, redirect: 'follow' })
      for (const [k, v] of Object.entries(headers)) request.setHeader(k, v)
      this.inFlight.set(id, request)

      request.on('response', (response) => {
        const status = response.statusCode
        if (status >= 400) {
          let detail = ''
          response.on('data', (c: Buffer) => (detail += c.toString('utf-8')))
          response.on('end', () => {
            this.inFlight.delete(id)
            this.emit({ id, type: 'error', value: `${config.aiProvider} returned ${status}. ${detail.slice(0, 400)}` })
          })
          return
        }

        let buffer = ''
        response.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          // SSE frames are newline delimited; a chunk boundary can split one,
          // so keep the trailing partial line for the next pass.
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
              const token = parsed.choices?.[0]?.delta?.content
              if (token) this.emit({ id, type: 'token', value: token })
            } catch {
              /* keep-alive comment or a non-JSON frame */
            }
          }
        })
        response.on('end', () => {
          this.inFlight.delete(id)
          this.emit({ id, type: 'done', value: '' })
        })
      })

      request.on('error', (err) => {
        this.inFlight.delete(id)
        const hint =
          config.aiProvider === 'ollama'
            ? `Could not reach Ollama at ${config.aiEndpoint}. Is it running?`
            : err.message
        this.emit({ id, type: 'error', value: hint })
      })

      request.write(body)
      request.end()
    } catch (err) {
      this.inFlight.delete(id)
      this.emit({ id, type: 'error', value: err instanceof Error ? err.message : String(err) })
    }

    return id
  }

  abort(id: string): void {
    const request = this.inFlight.get(id)
    if (!request) return
    try {
      request.abort()
    } catch {
      /* already finished */
    }
    this.inFlight.delete(id)
  }

  get providerLabel(): string {
    const s: Settings = this.settings.get()
    return `${s.aiProvider === 'ollama' ? 'Ollama' : 'OpenAI'} · ${s.aiModel}`
  }
}
