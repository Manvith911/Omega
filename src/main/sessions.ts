/**
 * Session isolation.
 *
 * The chrome UI and the web content must never share a session. If they do:
 *
 *   - the ad blocker runs against the UI's own requests,
 *   - the UI's CSP has to be loosened to whatever the most permissive site needs,
 *   - and a compromised UI window and a compromised web page share cookies.
 *
 * So: `defaultSession` for the chrome (only ever loads our own files), and a
 * dedicated *persistent* partition for web content so logins survive restarts.
 */

import { app, session, type Session } from 'electron'
import { PROD_UI_CSP } from '@shared/constants'

export const TAB_PARTITION = 'persist:omega-web'

/** Origins allowed to use mic/camera without a visible prompt. */
const TRUSTED_MEDIA_ORIGINS = new Set(['https://meet.google.com', 'https://discord.com', 'https://web.whatsapp.com'])

/** Permissions granted without a prompt because they are harmless and noisy. */
const SILENT_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'background-sync'])

export function createTabSession(): Session {
  const tabSession = session.fromPartition(TAB_PARTITION)

  // ── Deny by default ──
  // Electron's default for several of these is to *grant*. Without an explicit
  // handler, any page can ask for geolocation, the microphone, or notifications
  // and get it. This is the single biggest silent hole in a hand-rolled browser.
  tabSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (SILENT_ALLOW.has(permission)) {
      callback(true)
      return
    }
    if (permission === 'media') {
      const origin = safeOrigin(details.requestingUrl)
      callback(!!origin && TRUSTED_MEDIA_ORIGINS.has(origin))
      return
    }
    callback(false)
  })

  // Second gate: some code paths query permission *state* without ever
  // raising a request, and would otherwise read as granted.
  tabSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (SILENT_ALLOW.has(permission)) return true
    if (permission === 'media') return TRUSTED_MEDIA_ORIGINS.has(safeOrigin(requestingOrigin))
    return false
  })

  // Screen capture always requires an explicit source picked by us. Until
  // there is UI for that, denying is the only safe answer.
  tabSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  })

  return tabSession
}

/**
 * CSP for the chrome window. In production this is also baked into
 * index.html as a meta tag so it applies to `file://` loads, which do not
 * produce response headers at all.
 */
export function hardenUiSession(): void {
  const uiSession = session.defaultSession
  const isDev = !!process.env['ELECTRON_RENDERER_URL']

  // Vite's dev server needs eval (HMR) and inline module scripts (the React
  // Fast Refresh preamble), so the dev policy is deliberately looser. It is
  // never the policy that ships.
  const devCsp = [
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
    'script-src  \'self\' \'unsafe-inline\' \'unsafe-eval\'',
    "style-src   'self' 'unsafe-inline'",
    "img-src     'self' data: blob:",
    "font-src    'self' data:",
    "connect-src 'self' ws: wss: http://localhost:* https://localhost:*",
  ].join('; ')

  const csp = isDev ? devCsp : PROD_UI_CSP

  uiSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })

  // The chrome needs no browser permissions at all.
  uiSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** True while the browser process is still the only thing that exists. */
export const beforeReady = (): boolean => !app.isReady()
