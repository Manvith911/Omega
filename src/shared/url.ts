import { SEARCH_ENGINES } from './constants'
import type { CustomSearchEngine } from './ipc'

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

/**
 * Custom engines carry `%s`; built-ins append the query. Both shapes are
 * normalized to a template here so every call site has one branch.
 */
export function engineTemplate(engine: string, custom: CustomSearchEngine[]): string | null {
  const builtIn = SEARCH_ENGINES[engine as keyof typeof SEARCH_ENGINES]
  if (builtIn) return builtIn.url + '%s'
  const found = custom.find((e) => e.id === engine)
  if (found && found.url.includes('%s')) return found.url
  return null
}

/** Schemes we are willing to navigate to inside a tab. */
const IN_TAB_SCHEMES = new Set(['http', 'https', 'file', 'omega', 'about', 'view-source', 'data'])

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/
const IPV6_RE = /^\[[0-9a-f:]+\](?::\d{1,5})?(?:[/?#].*)?$/i
const LOCALHOST_RE = /^localhost(?::\d{1,5})?(?:[/?#].*)?$/i
const INTRA_HOST_RE = /^[a-z0-9-]+(?:[/?#].*)?$/i

export function schemeOf(url: string): string {
  const m = SCHEME_RE.exec(url.trim())
  return m?.[1]?.toLowerCase() ?? ''
}

/**
 * True when the input should be treated as a destination rather than a query.
 * Deliberately conservative: a false positive navigates the user to a
 * nonexistent host, which is far more annoying than a false negative.
 */
export function isProbablyUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return false
  if (SCHEME_RE.test(s)) return IN_TAB_SCHEMES.has(schemeOf(s)) || schemeOf(s).length > 0
  if (LOCALHOST_RE.test(s)) return true
  if (IPV4_RE.test(s)) return true
  if (IPV6_RE.test(s)) return true
  if (HOST_RE.test(s)) return true
  // Single-label host with a path, e.g. "intranet/wiki"
  if (s.includes('/') && INTRA_HOST_RE.test(s)) return true
  return false
}

/** Resolves the active engine's template, falling back to DuckDuckGo. */
export function activeEngineTemplate(engine: string, custom: CustomSearchEngine[]): string {
  return engineTemplate(engine, custom) ?? (SEARCH_ENGINES.duckduckgo.url + '%s')
}

export function searchUrlFor(query: string, template: string): string {
  return template.replace('%s', encodeURIComponent(query))
}

/**
 * Turns whatever the user typed into something loadable. There are exactly
 * three outcomes: an internal page, a real URL, or a search.
 */
export function toNavigationUrl(raw: string, template: string): string {
  const s = raw.trim()
  if (!s) return 'omega://newtab'
  if (isProbablyUrl(s)) {
    if (SCHEME_RE.test(s)) return s
    if (LOCALHOST_RE.test(s) || IPV4_RE.test(s) || IPV6_RE.test(s)) return `http://${s}`
    return `https://${s}`
  }
  return searchUrlFor(s, template)
}

/** What the omnibox shows when it is not focused. */
export function prettyUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('omega://newtab')) return ''
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      const path = u.pathname === '/' ? '' : u.pathname
      return `${u.host}${path}${u.search}${u.hash}`
    }
    return url
  } catch {
    return url
  }
}

export type ProtocolKind = 'https' | 'http' | 'local' | 'unknown'

export function protocolKind(url: string): ProtocolKind {
  if (url.startsWith('https://')) return 'https'
  if (url.startsWith('http://')) return 'http'
  if (/^(omega|about|file|data|view-source|devtools):/.test(url)) return 'local'
  return 'unknown'
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function isInternalUrl(url: string): boolean {
  return /^(omega|about|chrome|devtools|view-source):/.test(url)
}

/** Domains the omnibox can shorten, e.g. "www.google.com" -> "google.com". */
export function registrableHint(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}
