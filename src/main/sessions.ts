/**
 * Session isolation.
 *
 * The chrome UI and the web content must never share a session. If they do:
 *
 *   - the ad blocker runs against the UI's own requests,
 *   - the UI's CSP has to be loosened to whatever the most permissive site needs,
 *   - and a compromised UI window and a compromised web page share cookies.
 *
 * So: `defaultSession` for the chrome (only ever loads our own files), a
 * dedicated *persistent* partition for web content so logins survive restarts,
 * and an in-memory partition for incognito tabs where nothing touches disk.
 */

import { session, type Session } from 'electron'
import { PROD_UI_CSP } from '@shared/constants'
import type { PermissionRule, Settings } from '@shared/ipc'

export const TAB_PARTITION = 'persist:omega-web'
/** In-memory partition: cookies/storage die with the process, nothing on disk. */
export const INCOGNITO_PARTITION = 'omega-incognito'

/**
 * Origins granted media without prompting. Users can override per-origin via
 * the permission prompt / settings (see permissionRules below).
 */
const TRUSTED_MEDIA_ORIGINS = new Set(['https://meet.google.com', 'https://discord.com', 'https://web.whatsapp.com'])

/** Permissions granted without a prompt because they are harmless and noisy. */
const SILENT_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'background-sync'])

/** Permissions that will raise an interactive prompt when not yet decided. */
const PROMPTABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex'])

export interface PermissionPromptHost {
  /**
   * Shows the Allow/Deny prompt for a permission request. Resolves true to
   * grant. Must be called on the main thread; the chrome UI renders it.
   */
  ask: (origin: string, permission: string) => Promise<boolean>
  /** Persisted rules from settings (origin+permission -> granted). */
  rules: () => PermissionRule[]
  /** Record a user decision. */
  onDecide: (rule: PermissionRule) => void
}

/**
 * Installs the permission pipeline on a tab-capable session. Both the normal
 * and the incognito session get identical policy; prompts route through the
 * chrome UI so the user always decides.
 */
export function installPermissionHandlers(s: Session, host: PermissionPromptHost): void {
  s.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (SILENT_ALLOW.has(permission)) {
      callback(true)
      return
    }
    const origin = safeOrigin(details.requestingUrl)

    // A persisted rule always wins — no re-prompting for a decided origin.
    const rule = host.rules().find((r) => r.origin === origin && r.permission === permission)
    if (rule) {
      callback(rule.granted)
      return
    }

    if (permission === 'media') {
      // No stored decision: trusted origins pass, everything else prompts.
      if (origin && TRUSTED_MEDIA_ORIGINS.has(origin)) {
        callback(true)
        return
      }
      if (!origin || !PROMPTABLE.has(permission)) {
        callback(false)
        return
      }
    } else if (!PROMPTABLE.has(permission)) {
      callback(false)
      return
    }

    // Interactive decision. Chromium requires the callback to be invoked
    // exactly once; bridge the async UI answer back synchronously.
    void host
      .ask(origin, permission)
      .then((granted) => {
        host.onDecide({ origin, permission, granted })
        callback(granted)
      })
      .catch(() => callback(false))
  })

  // Second gate: some code paths query permission *state* without ever
  // raising a request. Persisted rules and trusted origins read as granted;
  // everything else reads as denied (prompt happens on request).
  s.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (SILENT_ALLOW.has(permission)) return true
    const origin = safeOrigin(requestingOrigin)
    const rule = host.rules().find((r) => r.origin === origin && r.permission === permission)
    if (rule) return rule.granted
    if (permission === 'media') return !!origin && TRUSTED_MEDIA_ORIGINS.has(origin)
    return false
  })

  // Screen capture always requires an explicit source picked by us. Until
  // there is UI for that, denying is the only safe answer.
  s.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  })
}

/** Proxy configuration from settings, applied at session creation time. */
function applyProxy(s: Session, settings: Settings): void {
  try {
    if (settings.proxyMode === 'direct') {
      s.setProxy({ mode: 'direct' })
    } else if (settings.proxyMode === 'fixed' && settings.proxyServer.trim()) {
      s.setProxy({ mode: 'fixed_servers', proxyRules: settings.proxyServer.trim() })
    } else {
      s.setProxy({ mode: 'system' })
    }
  } catch (err) {
    console.warn('[omega] proxy configuration failed:', err)
  }
}

export function createTabSession(settings: Settings): Session {
  const tabSession = session.fromPartition(TAB_PARTITION)
  applyProxy(tabSession, settings)
  return tabSession
}

/** Incognito twin of the tab session: same policy, zero persistence. */
export function createIncognitoSession(settings: Settings): Session {
  const incognito = session.fromPartition(INCOGNITO_PARTITION)
  applyProxy(incognito, settings)
  return incognito
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
