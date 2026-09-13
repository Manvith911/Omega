/**
 * Ad & tracker blocking at the network layer.
 *
 * `session.webRequest.onBeforeRequest` runs in the browser process *before*
 * the request is dispatched, so a blocked request costs zero bytes, zero
 * decoder time, and produces no layout work in the page's renderer. This is
 * categorically different from a content-script blocker, which has to let the
 * request complete and then remove the element.
 *
 * Scope note: this implements host-based rules (`||domain^`) plus an
 * exception list (`@@||domain^`). Cosmetic rules (`##.ad-banner`) and
 * regex/path patterns are deliberately out of scope — the first needs CSS
 * injection, the second needs a different matcher. Host rules catch the bulk
 * of tracking traffic, which is what this is for.
 */

import { app, type Session, type OnBeforeRequestListenerDetails } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostOf } from '@shared/url'

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt'
const RULES_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RULES_FILE = 'easylist-hosts.txt'
/** Guard against a malformed download filling memory. */
const MAX_RULES = 120_000

/**
 * Always-on baseline. This is what runs on a cold, offline first launch
 * before any list has been downloaded.
 */
const BUILTIN_RULES = [
  // Google analytics / tag manager / ads
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'doubleclick.net',
  'googleadservices.com',
  '2mdn.net',
  // Meta
  'connect.facebook.net',
  'pixel.facebook.com',
  // Ad exchanges / SSPs
  'adnxs.com',
  'adsrvr.org',
  'advertising.com',
  'adform.net',
  'adsymptotic.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'pubmatic.com',
  'rubiconproject.com',
  'smartadserver.com',
  'teads.tv',
  'casalemedia.com',
  'sharethrough.com',
  '33across.com',
  'bidswitch.net',
  'openx.net',
  'sovrn.com',
  'yieldmo.com',
  'serving-sys.com',
  'adsafeprotected.com',
  'moatads.com',
  // Analytics / session replay
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'hotjar.io',
  'mouseflow.com',
  'fullstory.com',
  'smartlook.com',
  'clarity.ms',
  'bat.bing.com',
  'omtrdc.net',
  'demdex.net',
  'everesttech.net',
  'adobedtm.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'segment.com',
  'heapanalytics.com',
  'plausible.io',
  'matomo.cloud',
  'statcounter.com',
  'newrelic.com',
  'sentry.io',
  // Support widgets
  'intercom.io',
  'intercomcdn.com',
  'zendesk.com',
  'drift.com',
  'livechatinc.com',
  'tawk.to',
]

/** Structural match for Electron's BlockingResponse, which is not exported as a named type. */
type RequestDecision = { cancel: boolean }

export interface AdBlockerStats {
  blockedRequests: number
  blockedHosts: number
  rules: number
  enabled: boolean
}

export class AdBlocker {
  private block = new Set<string>(BUILTIN_RULES)
  private allow = new Set<string>()
  /** webContentsId -> hostname of that tab's current top-level document. */
  private readonly topHost = new Map<number, string>()
  private readonly blockedHosts = new Set<string>()

  private blockedRequests = 0
  private enabled: boolean
  private installed = false

  constructor(
    private readonly session: Session,
    private readonly dataDir: string,
    enabled: boolean,
  ) {
    this.enabled = enabled
  }

  initialize(): void {
    this.loadCachedRules()
    this.installInterceptor()
    this.installTopHostTracking()
    // Never awaited: startup must not depend on the network.
    void this.refreshRulesIfStale()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  get stats(): AdBlockerStats {
    return {
      blockedRequests: this.blockedRequests,
      blockedHosts: this.blockedHosts.size,
      rules: this.block.size,
      enabled: this.enabled,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule loading
  // ───────────────────────────────────────────────────────────────────────────

  private get rulesPath(): string {
    return join(this.dataDir, RULES_FILE)
  }

  private loadCachedRules(): void {
    try {
      if (!existsSync(this.rulesPath)) return
      const raw = readFileSync(this.rulesPath, 'utf-8')
      const { block, allow } = parseRuleText(raw)
      // Replace, don't merge: a refreshed list that dropped a host must stop
      // blocking it, and merged sets only ever grow (leaked blocks).
      for (const h of block) if (this.block.size < MAX_RULES) this.block.add(h)
      for (const h of allow) this.allow.add(h)
      console.log(`[omega] adblock: ${this.block.size} host rules, ${this.allow.size} exceptions`)
    } catch (err) {
      console.warn('[omega] adblock: could not read cached rules:', err)
    }
  }

  private async refreshRulesIfStale(): Promise<void> {
    try {
      if (existsSync(this.rulesPath)) {
        const age = Date.now() - statSync(this.rulesPath).mtimeMs
        if (age < RULES_TTL_MS) return
      }
      const res = await fetch(EASYLIST_URL, { redirect: 'follow' })
      if (!res.ok) return
      const text = await res.text()
      if (!text.includes('||')) return
      writeFileSync(this.rulesPath, text, 'utf-8')
      const { block, allow } = parseRuleText(text)
      // Rebuild from the fresh list (keep the builtin baseline): otherwise a
      // host removed upstream stays blocked until relaunch.
      this.block = new Set(BUILTIN_RULES)
      this.allow = new Set()
      for (const h of block) if (this.block.size < MAX_RULES) this.block.add(h)
      for (const h of allow) this.allow.add(h)
      console.log(`[omega] adblock: refreshed -> ${this.block.size} host rules`)
    } catch {
      // Offline, blocked, or the CDN is down. The builtin list still applies.
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Interception
  // ───────────────────────────────────────────────────────────────────────────

  private installTopHostTracking(): void {
    app.on('web-contents-created', (_event, wc) => {
      // Only track contents that actually belong to the browsing session.
      if (wc.session !== this.session) return

      // did-start-navigation is the newest-style event: its arguments live on
      // the event object rather than in the positional list.
      wc.on('did-start-navigation', (details) => {
        if (!details.isMainFrame) return
        this.topHost.set(wc.id, hostOf(details.url))
      })

      wc.on('destroyed', () => {
        this.topHost.delete(wc.id)
      })
    })
  }

  private installInterceptor(): void {
    if (this.installed) return
    this.installed = true

    this.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback(this.decide(details))
    })
  }

  private decide(details: OnBeforeRequestListenerDetails): RequestDecision {
    if (!this.enabled) return { cancel: false }

    let host: string
    try {
      host = new URL(details.url).hostname.toLowerCase()
    } catch {
      return { cancel: false }
    }
    if (!host) return { cancel: false }

    // ── First-party passthrough ──
    // A site loading assets from its own domain must never be blocked, even
    // if that domain ends up in a list. This single rule prevents most
    // "the blocker broke my site" reports.
    const contentsId = details.webContentsId
    const top = contentsId === undefined ? undefined : this.topHost.get(contentsId)
    if (top && (host === top || host.endsWith(`.${top}`))) return { cancel: false }

    // ── Exceptions win over rules ──
    if (matchesHost(this.allow, host)) return { cancel: false }

    if (!matchesHost(this.block, host)) return { cancel: false }

    this.blockedRequests++
    this.blockedHosts.add(host)
    return { cancel: true }
  }
}

/**
 * Exact match, then walk parent domains: `a.ads.example.com` is checked as
 * `ads.example.com`, then `example.com`. The final label (the TLD) is never
 * checked on its own, so a rule for `com` cannot nuke the internet.
 */
function matchesHost(set: Set<string>, host: string): boolean {
  if (set.has(host)) return true
  const parts = host.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true
  }
  return false
}

/** Parses EasyList (and EasyList-shaped) text down to host rules. */
function parseRuleText(text: string): { block: Set<string>; allow: Set<string> } {
  const block = new Set<string>()
  const allow = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Comments, the ABP header, cosmetic rules, and everything else we skip.
    if (line.startsWith('!') || line.startsWith('[')) continue
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue
    const m = /^(@@)?\|\|([A-Za-z0-9.*\-_]+)\^/.exec(line)
    if (!m) continue
    const host = m[2].toLowerCase().replace(/^\*\./, '')
    if (!host || !host.includes('.')) continue
    if (m[1]) allow.add(host)
    else block.add(host)
  }
  return { block, allow }
}
