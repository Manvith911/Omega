/**
 * The internal `omega://` protocol.
 *
 * Two origins are served from it:
 *
 *   omega://newtab      the new tab page (static, no script at all)
 *   omega://app/*       the built chrome UI
 *
 * Serving the UI from a custom protocol rather than `file://` buys two real
 * things:
 *
 *   1. A *real* origin. `file://` is an opaque origin, which means the renderer
 *      has no origin to scope anything to.
 *   2. Response headers the browser process controls, so the CSP can be sent as
 *      a header. A `file://` load has no headers at all, which is why the only
 *      CSP available there is a `<meta>` tag — and why Chromium reports the UI
 *      as having no CSP set.
 *
 * Module scripts, relative asset paths and `standard: true` URL resolution all
 * behave normally under a privileged scheme.
 */

import { protocol, net, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { extname, normalize, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROD_UI_CSP, SEARCH_ENGINES } from '@shared/constants'
import type { HistoryStore } from './history-store'
import type { SettingsStore } from './settings-store'

export const APP_ORIGIN = 'omega://app'

/**
 * Must be called before `app.whenReady()`: scheme privileges are frozen once
 * the browser process starts.
 */
export function registerOmegaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'omega',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        bypassCSP: false,
      },
    },
  ])
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function serveOmegaProtocol(
  settings: SettingsStore,
  history: HistoryStore,
  rendererRoot: string,
  extraSessions: Session[] = [],
): void {
  const handler = createHandler(settings, history, rendererRoot)

  // `protocol.handle` only ever registers on the default session. The new tab
  // page loads inside a tab view, which lives on a *different* partition, and
  // an unregistered scheme there fails the navigation outright — so the same
  // handler has to be attached to every session that might request it.
  protocol.handle('omega', handler)
  for (const session of extraSessions) session.protocol.handle('omega', handler)
}

function createHandler(
  settings: SettingsStore,
  history: HistoryStore,
  rendererRoot: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound()
    }

    if (url.hostname === 'newtab' || url.hostname === '') {
      return new Response(renderNewTab(settings, history), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': CSP_NEWTAB,
          'cache-control': 'no-store',
        },
      })
    }

    if (url.hostname !== 'app') return notFound()

    const relativePath = url.pathname === '/' || url.pathname === '' ? 'index.html' : url.pathname.slice(1)
    const target = resolve(rendererRoot, normalize(relativePath))

    // Path traversal guard: a crafted URL must not be able to reach outside the
    // bundled renderer directory.
    if (relative(rendererRoot, target).startsWith('..') || !existsSync(target)) {
      return notFound()
    }

    try {
      const upstream = await net.fetch(pathToFileURL(target).toString())
      const headers = new Headers()
      // Never trust the platform's guess for a JS module: served as anything
      // other than a JS MIME type, Chromium refuses to execute it.
      headers.set('content-type', MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream')
      // Hashed asset filenames are immutable; the HTML entry point is not.
      headers.set('cache-control', relativePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      headers.set('content-security-policy', PROD_UI_CSP)
      headers.set('x-content-type-options', 'nosniff')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (err) {
      console.error('[omega] failed to serve', target, err)
      return notFound()
    }
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

const CSP_NEWTAB = [
  "default-src 'none'",
  // The draft-persistence snippet below is a small inline script maintained
  // in this file; no external script is ever loaded on this page.
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src https: data:",
  "form-action https:",
  "base-uri 'none'",
].join('; ')

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderNewTab(settings: SettingsStore, history: HistoryStore): string {
  const engine = SEARCH_ENGINES[settings.get().searchEngine]
  const tiles = (() => {
    try {
      return history.topSites(8)
    } catch {
      return []
    }
  })()

  const tilesHtml = tiles
    .map((site) => {
      let host = site.url
      try {
        host = new URL(site.url).hostname.replace(/^www\./, '')
      } catch {
        /* keep the raw URL as the label */
      }
      return `
        <a class="tile" href="${escapeHtml(site.url)}">
          <span class="tile-icon">
            <img src="https://${escapeHtml(host)}/favicon.ico" alt="" loading="lazy" width="24" height="24" />
          </span>
          <span class="tile-label">${escapeHtml(host)}</span>
        </a>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>New Tab</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0f0f17;
    --surface: rgba(255,255,255,0.05);
    --surface-hover: rgba(255,255,255,0.10);
    --border: rgba(255,255,255,0.09);
    --fg: rgba(255,255,255,0.92);
    --muted: rgba(255,255,255,0.38);
    --accent: #7c6af7;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background:
      radial-gradient(1100px 520px at 50% -12%, rgba(124,106,247,0.22), transparent 62%),
      var(--bg);
    color: var(--fg);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center;
    padding: 16vh 24px 48px;
    user-select: none;
  }
  .mark { display:flex; align-items:center; gap:10px; margin-bottom: 26px; }
  .mark svg { width: 28px; height: 28px; }
  .mark span { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  form { width: 100%; max-width: 620px; }
  input[type="search"] {
    width: 100%; height: 52px; padding: 0 20px;
    background: var(--surface); color: var(--fg);
    border: 1px solid var(--border); border-radius: 14px;
    font-size: 15px; outline: none;
    transition: border-color .15s, background .15s, box-shadow .15s;
  }
  input[type="search"]::placeholder { color: var(--muted); }
  input[type="search"]:focus {
    border-color: rgba(124,106,247,0.65);
    background: rgba(255,255,255,0.08);
    box-shadow: 0 0 0 4px rgba(124,106,247,0.12);
  }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 40px; width: 100%; max-width: 620px; }
  .tile {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 16px 8px; text-decoration: none; color: inherit;
    background: var(--surface); border: 1px solid transparent; border-radius: 14px;
    transition: background .12s, border-color .12s, transform .12s;
  }
  .tile:hover { background: var(--surface-hover); border-color: var(--border); transform: translateY(-1px); }
  .tile-icon {
    width: 34px; height: 34px; border-radius: 9px;
    background: rgba(255,255,255,0.07);
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .tile-icon img { width: 20px; height: 20px; object-fit: contain; }
  .tile-label { font-size: 11px; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { margin-top: 46px; font-size: 11.5px; color: var(--muted); }
  kbd {
    font: inherit; font-size: 10.5px; padding: 2px 6px; border-radius: 5px;
    background: rgba(255,255,255,0.07); border: 1px solid var(--border);
  }
</style>
</head>
<body>
  <div class="mark">
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="#7c6af7" stroke-width="3.2" />
      <circle cx="16" cy="16" r="5" fill="#7c6af7" />
    </svg>
    <span>Omega</span>
  </div>

  <form action="${escapeHtml(engine.url)}" method="GET" role="search">
    <input id="omega-q" type="search" name="q" placeholder="Search ${escapeHtml(engine.name)} or enter an address" autofocus autocomplete="off" spellcheck="false" aria-label="Search" />
  </form>

  <script>
    // Draft persistence: clicking anywhere else must not lose a half-typed
    // query. Restored only while the query has not been submitted (a real
    // navigation wipes sessionStorage on this origin-locked page).
    (function () {
      var input = document.getElementById('omega-q')
      if (!input) return
      var KEY = 'omega:newtab-draft'
      var saved = null
      try { saved = sessionStorage.getItem(KEY) } catch (e) { /* storage denied */ }
      if (saved) input.value = saved
      input.addEventListener('input', function () {
        try { sessionStorage.setItem(KEY, input.value) } catch (e) { /* ignore */ }
      })
      // If the page came back via back/forward after a submit, the draft is
      // stale — the URL bar shows the submitted query.
      window.addEventListener('pageshow', function (event) {
        if (event.persisted) {
          try { sessionStorage.removeItem(KEY) } catch (e) { /* ignore */ }
          input.value = ''
        }
      })
      document.addEventListener('submit', function () {
        try { sessionStorage.removeItem(KEY) } catch (e) { /* ignore */ }
      })
    })()
  </script>

  ${tilesHtml ? `<div class="tiles">${tilesHtml}</div>` : ''}

  <p class="hint"><kbd>Ctrl</kbd> <kbd>T</kbd> new tab &nbsp;·&nbsp; <kbd>Ctrl</kbd> <kbd>L</kbd> address bar &nbsp;·&nbsp; <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>E</kbd> page assistant</p>
</body>
</html>`
}
