/**
 * The tab engine.
 *
 * Every tab is a native `WebContentsView` owned exclusively by this class.
 * The React UI never holds a reference to one — it sends intents over IPC and
 * receives plain metadata back.
 *
 * Two invariants hold throughout:
 *
 *   1. Bounds are *reported* by the renderer, which measures its own DOM. The
 *      main process never guesses the chrome height, because a mismatch is
 *      visible as an overlap or a gap.
 *   2. Only the active view is in the child-view list. Hidden views stay
 *      parented (so switching back is instant and does not reflow the page),
 *      but frozen views are detached entirely to release their GPU surface.
 */

import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { HISTORY_PAGE_URL, NEW_TAB_URL, SETTINGS_PAGE_URL, ZOOM_STEPS } from '@shared/constants'
import type { FindResult, TabCreatePayload, TabMeta, ViewRect } from '@shared/ipc'
import { freeze, thaw } from './tab-freezer'
import type { HistoryStore } from './history-store'
import type { SettingsStore } from './settings-store'
import { TAB_PARTITION } from './sessions'
import { popupContextMenu } from './context-menu'
import { isInternalUrl, prettyUrl, toNavigationUrl } from '@shared/url'

const ZOOM_BASE = 1.2

/** Tab-strip titles for the internal pages, which never fire page-title-updated. */
function internalPageTitle(url: string): string {
  if (url.startsWith(SETTINGS_PAGE_URL)) return 'Settings'
  if (url.startsWith(HISTORY_PAGE_URL)) return 'History'
  if (url.startsWith(NEW_TAB_URL)) return 'New Tab'
  return prettyUrl(url) || 'Untitled'
}

interface TabEntry {
  id: number
  /** null once the tab has been discarded — the renderer is gone on purpose. */
  view: WebContentsView | null
  /**
   * Whether the view is currently in the window's child list.
   *
   * This is tracked explicitly rather than inferred because freezing detaches
   * the view to release its GPU surface, and `setVisible(true)` on a view that
   * is not parented does nothing at all — a frozen tab would thaw into an
   * invisible page with no error anywhere.
   */
  attached: boolean
  meta: TabMeta
  zoomFactor: number
  freezeTimer: NodeJS.Timeout | null
  discardTimer: NodeJS.Timeout | null
  crashed: boolean
}

export interface TabManagerOptions {
  win: BrowserWindow
  preloadPath: string
  history: HistoryStore
  settings: SettingsStore
  /** Re-stack the suggestions overlay above the page views. */
  bringOverlayToFront: () => void
  toast: (kind: 'info' | 'error', message: string) => void
}

export class TabManager {
  private readonly tabs = new Map<number, TabEntry>()
  private order: number[] = []
  private activeId: number | null = null
  private nextId = 1

  /** Most recently closed tabs, for Ctrl+Shift+T. */
  private readonly closed: { url: string; index: number }[] = []

  /** Last rect reported by the renderer, plus how it relates to the window. */
  private viewport: ViewRect = { x: 0, y: 0, width: 800, height: 600, visible: true }
  private gutterRight = 0

  /**
   * Tab updates are coalesced to one flush per frame. A single page load can
   * fire a dozen `did-*` events; sending each one individually is how IPC
   * becomes the bottleneck in an Electron browser.
   */
  private readonly dirty = new Set<number>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly o: TabManagerOptions) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  async createTab(payload: TabCreatePayload = {}): Promise<TabMeta> {
    const id = this.nextId++
    const url = payload.url ?? NEW_TAB_URL

    const meta: TabMeta = {
      id,
      url,
      title: url === NEW_TAB_URL ? 'New Tab' : '',
      favicon: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isAudible: false,
      isMuted: false,
      isActive: false,
      lifecycle: 'throttled',
      lastActiveAt: Date.now(),
      error: null,
    }

    const entry: TabEntry = {
      id,
      view: null,
      attached: false,
      meta,
      zoomFactor: 1,
      freezeTimer: null,
      discardTimer: null,
      crashed: false,
    }

    this.tabs.set(id, entry)

    const anchor = this.activeId !== null ? this.order.indexOf(this.activeId) + 1 : this.order.length
    const at = Math.max(0, Math.min(payload.index ?? anchor, this.order.length))
    this.order.splice(at, 0, id)

    this.materialize(entry, url)

    if (payload.background) {
      this.emitList()
    } else {
      await this.activate(id)
    }
    return this.metaOf(entry)
  }

  /**
   * Open an internal page (settings, history) as a tab — or focus the tab
   * that already shows it. Chrome behaves the same way: one Settings tab per
   * window, however many times you trigger the command.
   */
  async openOrFocusPage(page: 'settings' | 'history'): Promise<TabMeta | null> {
    const target = page === 'settings' ? SETTINGS_PAGE_URL : HISTORY_PAGE_URL
    const existing = [...this.tabs.values()].find((e) => e.meta.url === target)
    if (existing) {
      await this.activate(existing.id)
      return this.metaOf(existing)
    }
    // Internal pages never enter the reopen-closed stack and are excluded
    // from session snapshots by sessionSnapshot(), so restore-on-launch will
    // not resurrect a stale settings tab.
    return this.createTab({ url: target })
  }

  async closeTab(id: number): Promise<void> {
    const entry = this.tabs.get(id)
    if (!entry) return

    this.clearTimers(entry)
    if (!isInternalUrl(entry.meta.url)) {
      this.closed.push({ url: entry.meta.url, index: this.order.indexOf(id) })
      if (this.closed.length > 25) this.closed.shift()
    }

    this.destroyView(entry)
    this.tabs.delete(id)
    const index = this.order.indexOf(id)
    this.order = this.order.filter((x) => x !== id)
    this.dirty.delete(id)

    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[Math.min(index, this.order.length - 1)]
      if (next !== undefined) {
        await this.activate(next)
      } else {
        // A browser with zero tabs is unusable; open a fresh one.
        await this.createTab({})
      }
    }

    this.send('tab:closed', id)
    this.emitList()
  }

  async closeOthers(keepId: number): Promise<void> {
    for (const id of [...this.order]) {
      if (id !== keepId) await this.closeTab(id)
    }
  }

  async activate(id: number): Promise<void> {
    const entry = this.tabs.get(id)
    if (!entry) return

    const previous = this.activeId
    if (previous !== null && previous !== id) {
      const outgoing = this.tabs.get(previous)
      if (outgoing) this.deactivate(outgoing)
    }

    this.clearTimers(entry)

    // Rebuild the renderer if it was discarded or crashed.
    if (!entry.view || entry.crashed) {
      this.materialize(entry, entry.meta.url)
    }

    if (entry.meta.lifecycle === 'frozen' && entry.view) {
      await thaw(entry.view.webContents)
    }

    // Re-attach if a previous freeze detached this view.
    if (entry.view && !entry.attached) {
      this.o.win.contentView.addChildView(entry.view)
      entry.attached = true
      this.o.bringOverlayToFront()
    }

    this.activeId = id
    entry.meta.isActive = true
    entry.meta.lifecycle = 'live'
    entry.meta.lastActiveAt = Date.now()

    const view = entry.view
    if (view) {
      const wc = view.webContents
      // Full priority for the visible tab. This is the only place throttling
      // is ever turned off.
      if (!wc.isDestroyed()) wc.setBackgroundThrottling(false)
      view.setBounds(this.pixelRect(this.viewport))
      view.setVisible(this.viewport.visible)
      if (!wc.isDestroyed()) wc.focus()
    }

    this.o.bringOverlayToFront()
    this.send('tab:activated', id)
    this.emitList()
  }

  reorder(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= this.order.length) return
    const clamped = Math.max(0, Math.min(toIndex, this.order.length - 1))
    const [moved] = this.order.splice(fromIndex, 1)
    if (moved === undefined) return
    this.order.splice(clamped, 0, moved)
    this.emitList()
  }

  navigate(tabId: number, input: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return

    const url = toNavigationUrl(input, this.o.settings.get().searchEngine)
    entry.meta.error = null

    if (!entry.view || entry.crashed) {
      entry.meta.url = url
      this.materialize(entry, url)
      return
    }

    const wc = entry.view.webContents
    if (wc.isDestroyed()) return
    void wc.loadURL(url).catch(() => {
      // did-fail-load reports this; swallowing here avoids an unhandled rejection.
    })
  }

  goBack(tabId: number): void {
    this.withWebContents(tabId, (wc) => {
      if (!wc.canGoBack()) return
      wc.navigationHistory.goBack()
    })
  }

  goForward(tabId: number): void {
    this.withWebContents(tabId, (wc) => {
      if (!wc.canGoForward()) return
      wc.navigationHistory.goForward()
    })
  }

  reload(tabId: number, ignoreCache = false): void {
    this.withWebContents(tabId, (wc) => {
      if (ignoreCache) wc.reloadIgnoringCache()
      else wc.reload()
    })
  }

  stop(tabId: number): void {
    this.withWebContents(tabId, (wc) => wc.stop())
  }

  home(tabId: number): void {
    this.navigate(tabId, NEW_TAB_URL)
  }

  zoom(tabId: number, direction: 'in' | 'out' | 'reset'): number {
    const entry = this.tabs.get(tabId)
    if (!entry) return 100

    if (direction === 'reset') {
      entry.zoomFactor = 1
    } else {
      const idx = ZOOM_STEPS.findIndex((z) => z >= entry.zoomFactor - 0.001)
      const current = idx === -1 ? ZOOM_STEPS.length - 1 : idx
      const next = direction === 'in' ? current + 1 : current - 1
      const clamped = Math.max(0, Math.min(next, ZOOM_STEPS.length - 1))
      entry.zoomFactor = ZOOM_STEPS[clamped] ?? 1
    }

    this.withWebContents(tabId, (wc) => wc.setZoomLevel(Math.log(entry.zoomFactor) / Math.log(ZOOM_BASE)))
    return Math.round(entry.zoomFactor * 100)
  }

  setMuted(tabId: number, muted: boolean): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    entry.meta.isMuted = muted
    this.withWebContents(tabId, (wc) => wc.setAudioMuted(muted))
    this.markDirty(entry)
  }

  async duplicate(tabId: number): Promise<TabMeta | null> {
    const entry = this.tabs.get(tabId)
    if (!entry) return null
    const index = this.order.indexOf(tabId) + 1
    return this.createTab({ url: entry.meta.url, index })
  }

  async reopen(): Promise<TabMeta | null> {
    const last = this.closed.pop()
    if (!last) return null
    return this.createTab({ url: last.url, index: last.index })
  }

  findStart(tabId: number, text: string): FindResult {
    const entry = this.tabs.get(tabId)
    if (!entry?.view || entry.view.webContents.isDestroyed() || !text) return { matches: 0, active: 0 }
    entry.view.webContents.findInPage(text, { findNext: false })
    return this.lastFind
  }

  findNext(tabId: number, text: string, forward: boolean): FindResult {
    const entry = this.tabs.get(tabId)
    if (!entry?.view || entry.view.webContents.isDestroyed() || !text) return { matches: 0, active: 0 }
    entry.view.webContents.findInPage(text, { findNext: true, forward })
    return this.lastFind
  }

  findStop(tabId: number): void {
    this.withWebContents(tabId, (wc) => wc.stopFindInPage('clearSelection'))
    this.lastFind = { matches: 0, active: 0 }
  }

  private lastFind: FindResult = { matches: 0, active: 0 }

  getAllTabs(): TabMeta[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((e): e is TabEntry => e !== undefined)
      .map((e) => this.metaOf(e))
  }

  getWebContents(tabId: number): WebContents | null {
    const view = this.tabs.get(tabId)?.view
    if (!view || view.webContents.isDestroyed()) return null
    return view.webContents
  }

  getActiveTabId(): number | null {
    return this.activeId
  }

  /** URLs to restore on next launch, in strip order. */
  sessionSnapshot(): string[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((e): e is TabEntry => e !== undefined)
      .map((e) => e.meta.url)
      .filter((url) => !!url && !isInternalUrl(url))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Layout
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The renderer measures its own DOM and reports the rect the page should
   * occupy. `visible: false` is how a full-content modal (history, settings)
   * gets to cover the page: native views always paint above the DOM, so the
   * page view is hidden rather than drawn over.
   */
  setViewport(rect: ViewRect): void {
    const win = this.o.win.getContentBounds()
    // Remember the right-hand gutter (e.g. an open sidebar) so a window resize
    // can be applied immediately without waiting for the next DOM report.
    this.gutterRight = Math.max(0, win.width - (rect.x + rect.width))
    this.viewport = rect
    this.applyViewport()
  }

  /** Called on window resize: applies the last known layout to the new size. */
  syncViewport(): void {
    this.applyViewport()
  }

  private applyViewport(): void {
    const entry = this.activeId !== null ? this.tabs.get(this.activeId) : undefined
    // `attached` matters: sizing a detached view is pointless, and calling
    // setVisible on it would be a silent no-op that looks like a layout bug.
    if (!entry?.view || !entry.attached || entry.view.webContents.isDestroyed()) return

    const win = this.o.win.getContentBounds()
    const live: ViewRect = {
      x: this.viewport.x,
      y: this.viewport.y,
      width: Math.max(0, win.width - this.viewport.x - this.gutterRight),
      height: Math.max(0, win.height - this.viewport.y),
      visible: this.viewport.visible,
    }

    entry.view.setBounds(this.pixelRect(live))
    entry.view.setVisible(live.visible && entry.meta.isActive)
  }

  /**
   * Fractional bounds cause the compositor to resample and produce seams on
   * HiDPI displays. Always hand it integers in DIP space — Electron applies
   * the display scale itself, so no manual DPR multiplication is needed.
   */
  private pixelRect(rect: ViewRect): Electron.Rectangle {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // View lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  private materialize(entry: TabEntry, url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.o.preloadPath,
        partition: TAB_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // A browser renderer without hunspell: the spellcheck service costs
        // roughly 15-40 MB per renderer for a feature most pages do not need.
        spellcheck: false,
        // Background tabs must be throttlable. The active tab opts out of
        // throttling in activate(); this default must stay `true`.
        backgroundThrottling: true,
        // Reuse V8's generated code across visits to the same origin.
        v8CacheOptions: 'code',
        // Never let a page start audio before the user interacts with it.
        autoplayPolicy: 'document-user-activation-required',
        additionalArguments: [`--omega-tab=${entry.id}`],
      },
    })

    view.setBackgroundColor('#11111b')
    entry.view = view
    entry.crashed = false

    this.o.win.contentView.addChildView(view)
    entry.attached = true
    // Any addChildView pushes the new view above the overlay.
    this.o.bringOverlayToFront()

    view.setBounds(this.pixelRect(this.viewport))
    view.setVisible(false)

    this.bindEvents(entry)

    if (url) {
      void view.webContents.loadURL(url).catch(() => {
        /* surfaced through did-fail-load */
      })
    }
  }

  private destroyView(entry: TabEntry): void {
    const view = entry.view
    if (!view) return
    if (entry.attached) {
      try {
        this.o.win.contentView.removeChildView(view)
      } catch {
        /* already detached */
      }
      entry.attached = false
    }
    const wc = view.webContents
    if (!wc.isDestroyed()) {
      try {
        // `webContents.close()` is the supported teardown; WebContentsView has
        // no destroy(). Callbacks are guarded by identity checks, so there is
        // no need to strip listeners first.
        wc.close()
      } catch {
        /* renderer already gone */
      }
    }
    entry.view = null
  }

  private bindEvents(entry: TabEntry): void {
    const view = entry.view
    if (!view) return
    const wc = view.webContents
    const meta = entry.meta

    /**
     * Guards against a stale renderer: after a discard the entry gets a new
     * webContents, and late events from the old one must not mutate metadata.
     */
    const live = (): boolean => entry.view?.webContents === wc && !wc.isDestroyed()

    wc.on('did-start-loading', () => {
      if (!live()) return
      meta.isLoading = true
      meta.error = null
      this.markDirty(entry)
    })

    wc.on('did-stop-loading', () => {
      if (!live()) return
      meta.isLoading = false
      meta.canGoBack = wc.navigationHistory.canGoBack()
      meta.canGoForward = wc.navigationHistory.canGoForward()
      this.markDirty(entry)
    })

    wc.on('did-navigate', (_event, url, httpResponseCode) => {
      if (!live()) return
      meta.url = url
      meta.canGoBack = wc.navigationHistory.canGoBack()
      meta.canGoForward = wc.navigationHistory.canGoForward()
      meta.error = null
      if (httpResponseCode >= 400) meta.error = `HTTP ${httpResponseCode}`
      if (url !== NEW_TAB_URL) this.o.history.record(url, meta.title)
      // Internal pages have no document title event, so derive one from the
      // URL. Without this the strip shows the raw URL for the settings and
      // history tabs.
      if (isInternalUrl(url)) meta.title = internalPageTitle(url)
      this.markDirty(entry)
      this.send('nav:navigated', { tabId: entry.id, url })
    })

    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!live() || !isMainFrame) return
      meta.url = url
      meta.canGoBack = wc.navigationHistory.canGoBack()
      meta.canGoForward = wc.navigationHistory.canGoForward()
      this.markDirty(entry)
      this.send('nav:navigated', { tabId: entry.id, url })
    })

    wc.on('page-title-updated', (_event, title) => {
      if (!live()) return
      meta.title = title || prettyUrl(meta.url) || 'Untitled'
      // Metadata only — bumping the visit count here would double-count every
      // page, since this fires alongside did-navigate.
      this.o.history.touchTitle(meta.url, title)
      this.markDirty(entry)
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      if (!live()) return
      const best = favicons.find((f) => f.startsWith('http')) ?? favicons[0] ?? ''
      meta.favicon = best.length > 8192 ? '' : best
      this.markDirty(entry)
    })

    // `audio-state-changed` carries the authoritative flag; the media events
    // are a belt-and-braces re-sync for pages that stop audio without pausing.
    wc.on('audio-state-changed', (event) => {
      if (!live()) return
      meta.isAudible = event.audible
      this.markDirty(entry)
    })
    const syncAudible = (): void => {
      if (!live()) return
      meta.isAudible = wc.isCurrentlyAudible()
      this.markDirty(entry)
    }
    wc.on('media-started-playing', syncAudible)
    wc.on('media-paused', syncAudible)
    wc.on('did-finish-load', syncAudible)

    wc.on('found-in-page', (_event, result) => {
      if (!live()) return
      this.lastFind = { matches: result.matches, active: result.activeMatchOrdinal }
      this.send('find:result', this.lastFind)
    })

    wc.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!live() || !isMainFrame) return
      // -3  ERR_ABORTED         : the user navigated away or hit stop
      // -27 ERR_BLOCKED_BY_RESPONSE / -20 ERR_BLOCKED_BY_CLIENT
      if (errorCode === -3) return
      meta.isLoading = false
      meta.error = errorCode === -20 ? 'Blocked by Omega' : errorDescription
      this.markDirty(entry)
    })

    wc.on('render-process-gone', (_event, details) => {
      if (!live()) return
      entry.crashed = true
      meta.isLoading = false
      meta.error = `Renderer crashed (${details.reason})`
      meta.isAudible = false
      this.markDirty(entry)
      this.o.toast('error', 'A tab crashed. Switch to it to reload.')
    })

    // Popups become tabs. Never let a page spawn its own window: those are
    // unmanaged webContents with no chrome, no blocker, and no user affordance.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void this.createTab({ url, background: false })
      return { action: 'deny' }
    })

    wc.on('will-navigate', (event, url) => {
      if (/^(https?|file|omega|about|view-source|data):/.test(url)) return
      event.preventDefault()
      void import('electron').then(({ shell }) => shell.openExternal(url))
    })

    wc.on('certificate-error', (event, _url, _error, _cert, callback) => {
      // A production browser does not silently click through a bad cert.
      // The page will render its own interstitial.
      event.preventDefault()
      callback(false)
    })

    wc.on('context-menu', (_event, params) => {
      popupContextMenu(this.o.win, wc, params, {
        onNewTab: (url) => void this.createTab({ url }),
        onReload: () => wc.reload(),
        onBack: () => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(),
        onInspect: () => wc.openDevTools({ mode: 'detach' }),
      })
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suspension pipeline
  // ───────────────────────────────────────────────────────────────────────────

  private deactivate(entry: TabEntry): void {
    entry.meta.isActive = false
    entry.meta.lifecycle = 'throttled'

    const view = entry.view
    if (view && !view.webContents.isDestroyed()) {
      view.setVisible(false)
      // Deprioritise the renderer. Deliberately NOT collapsing its bounds to
      // 1x1: that forces a responsive layout reflow on every tab switch, so
      // the page visibly jumps when you come back to it.
      view.webContents.setBackgroundThrottling(true)
    }

    this.scheduleFreeze(entry)
  }

  private scheduleFreeze(entry: TabEntry): void {
    this.clearFreezeTimer(entry)
    const delay = this.o.settings.get().freezeAfterMs
    if (delay <= 0) return
    entry.freezeTimer = setTimeout(() => {
      entry.freezeTimer = null
      void this.freezeEntry(entry)
    }, delay)
  }

  private async freezeEntry(entry: TabEntry): Promise<void> {
    if (entry.id === this.activeId) return
    // A tab making noise is doing something the user cares about.
    if (entry.meta.isAudible) {
      this.scheduleFreeze(entry)
      return
    }
    const view = entry.view
    if (!view || view.webContents.isDestroyed()) return

    const ok = await freeze(view.webContents)

    // Close the race: `freeze` is awaited, and the user may have switched back
    // to this tab while the CDP command was in flight. Leaving it frozen would
    // present a page that silently runs no script at all.
    if (entry.id === this.activeId) {
      await thaw(view.webContents)
      entry.meta.lifecycle = 'live'
      this.markDirty(entry)
      this.emitList()
      return
    }

    entry.meta.lifecycle = 'frozen'
    entry.meta.isLoading = false

    // Detaching releases the GPU surface, which is what actually costs VRAM at
    // 20+ tabs. The frozen renderer keeps its DOM, so restoring is instant.
    if (entry.attached) {
      try {
        this.o.win.contentView.removeChildView(view)
      } catch {
        /* already detached */
      }
      entry.attached = false
    }
    // The frozen page will never see this, so 1x1 costs nothing now.
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    if (!ok) {
      // Freezing failed (page was mid-navigation). Retry rather than leaking a
      // tab that thinks it is frozen but is still running timers.
      entry.meta.lifecycle = 'throttled'
      this.scheduleFreeze(entry)
    }

    this.markDirty(entry)
    this.emitList()
    this.scheduleDiscard(entry)
  }

  private scheduleDiscard(entry: TabEntry): void {
    this.clearDiscardTimer(entry)
    const delay = this.o.settings.get().discardAfterMs
    if (delay <= 0) return
    entry.discardTimer = setTimeout(() => {
      entry.discardTimer = null
      this.discardEntry(entry)
    }, delay)
  }

  /**
   * Tier 3: drop the renderer entirely. The tab keeps its title and favicon so
   * it still reads as a tab, and reloads its URL when activated. This is the
   * only tier that gets RAM back to roughly zero, and it is what makes a
   * 50-tab session survivable.
   */
  private discardEntry(entry: TabEntry): void {
    if (entry.id === this.activeId) return
    if (entry.meta.isAudible) {
      this.scheduleDiscard(entry)
      return
    }
    this.destroyView(entry)
    entry.meta.lifecycle = 'discarded'
    entry.meta.isLoading = false
    this.markDirty(entry)
    this.emitList()
  }

  private clearFreezeTimer(entry: TabEntry): void {
    if (entry.freezeTimer) {
      clearTimeout(entry.freezeTimer)
      entry.freezeTimer = null
    }
  }

  private clearDiscardTimer(entry: TabEntry): void {
    if (entry.discardTimer) {
      clearTimeout(entry.discardTimer)
      entry.discardTimer = null
    }
  }

  private clearTimers(entry: TabEntry): void {
    this.clearFreezeTimer(entry)
    this.clearDiscardTimer(entry)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private withWebContents(tabId: number, fn: (wc: WebContents) => void): void {
    const wc = this.getWebContents(tabId)
    if (wc) fn(wc)
  }

  private metaOf(entry: TabEntry): TabMeta {
    return { ...entry.meta, isActive: entry.id === this.activeId }
  }

  private markDirty(entry: TabEntry): void {
    this.dirty.add(entry.id)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      const ids = [...this.dirty]
      this.dirty.clear()
      for (const id of ids) {
        const e = this.tabs.get(id)
        if (e) this.send('tab:updated', this.metaOf(e))
      }
    }, 33)
  }

  private send(channel: Parameters<BrowserWindow['webContents']['send']>[0], payload: unknown): void {
    const wc = this.o.win.webContents
    if (wc.isDestroyed()) return
    wc.send(channel, payload)
  }

  private emitList(): void {
    const wc = this.o.win.webContents
    if (wc.isDestroyed()) return
    wc.send('tab:list', this.getAllTabs())
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    for (const entry of this.tabs.values()) {
      this.clearTimers(entry)
      this.destroyView(entry)
    }
    this.tabs.clear()
    this.order = []
  }
}
