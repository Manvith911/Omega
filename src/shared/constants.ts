/**
 * Layout constants shared by the main process (which positions native views)
 * and the renderer (which draws the chrome and measures itself).
 *
 * The renderer is the source of truth for the viewport rect: it measures its
 * own DOM and reports the result, rather than the main process guessing.
 */

export const TAB_STRIP_HEIGHT = 36
export const TOOLBAR_HEIGHT = 40

/** Total height of the React chrome. The page viewport starts below this. */
export const CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT

export const SIDEBAR_WIDTH = 384
export const MIN_WINDOW_WIDTH = 760
export const MIN_WINDOW_HEIGHT = 480

/** Suggestions overlay geometry — the main process sizes the overlay view from these. */
export const SUGGESTION_ROW_HEIGHT = 44
export const SUGGESTION_MAX_ROWS = 8
export const SUGGESTION_PADDING = 8
export const SUGGESTION_GAP = 6

export const NEW_TAB_URL = 'omega://newtab'

/**
 * Internal chrome pages that open as real tabs (Chrome-style), not as DOM
 * overlays hiding the page view. Served by the omega:// protocol from the
 * renderer output; each entry has its own HTML + JS bundle.
 */
export const SETTINGS_PAGE_URL = 'omega://app/settings.html'
export const HISTORY_PAGE_URL = 'omega://app/history.html'

export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=' },
} as const

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

/**
 * The CSP that ships. Defined here because two very different places need the
 * identical string: the session layer (which injects it as a response header
 * for dev-server loads) and the build (which bakes it into a meta tag, the
 * only mechanism that applies to `file://` loads, which have no headers).
 *
 * `connect-src 'self'` is the important line: a compromised chrome window has
 * no reachable remote origin to exfiltrate to.
 */
export const PROD_UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')
