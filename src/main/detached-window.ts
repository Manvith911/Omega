/**
 * Detached windows — "Open in new window".
 *
 * Scope, stated honestly: this is a *page* window, not a second full browser
 * window. It hosts one web page on the tab session (so cookies, the ad
 * blocker, permission policy and downloads all behave identically), with a
 * native frame and no Omega chrome. The original tab stays in the main strip.
 * Full multi-window tab management would mean generalising TabManager across
 * windows — a different feature.
 *
 * The window gets NO preload: contextIsolation and the sandbox default on,
 * nodeIntegration stays off, so a page here has zero bridge access — the same
 * posture as a tab view without the chrome affordances.
 */

import { BrowserWindow, type WebContents } from 'electron'
import type { HistoryStore } from './history-store'
import { popupContextMenu } from './context-menu'
import { TAB_PARTITION } from './sessions'
import { isInternalUrl } from '@shared/url'

/** Live detached windows; closed when the main window goes away. */
const windows = new Set<BrowserWindow>()

export function closeAllDetachedWindows(): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.close()
  }
  windows.clear()
}

export interface DetachedWindowOptions {
  preloadPath: string | null
  history: HistoryStore
  iconPath: string | null
  /** Normal-mode bounds of the main window, used as the size baseline. */
  baselineBounds?: { width: number; height: number }
  /**
   * "Move to Tab Strip": host this URL as an active tab in the main window
   * and close the detached window. Optional; absent until the main window's
   * tab manager exists.
   */
  onReattach?: (url: string) => void
}

export function openInNewWindow(url: string, o: DetachedWindowOptions): BrowserWindow {
  const base = o.baselineBounds ?? { width: 1100, height: 780 }

  const win = new BrowserWindow({
    width: Math.max(760, base.width),
    height: Math.max(560, base.height),
    minWidth: 760,
    minHeight: 480,
    // A page window has no chrome of ours, so it keeps the OS frame —
    // otherwise it would have no close button.
    ...(process.platform === 'darwin' ? {} : { autoHideMenuBar: true }),
    ...(process.platform !== 'darwin' && o.iconPath ? { icon: o.iconPath } : {}),
    backgroundColor: '#0f0f17',
    show: false,
    webPreferences: {
      // No preload on purpose: no bridge, no chrome API, nothing to attack.
      preload: undefined,
      partition: TAB_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: 'code',
      autoplayPolicy: 'document-user-activation-required',
    },
  })

  windows.add(win)
  win.on('closed', () => windows.delete(win))
  win.once('ready-to-show', () => win.show())

  const wc = win.webContents

  // History parity with tabs: real page visits are recorded, internal URLs
  // never are (isInternalUrl filtering matches TabManager behaviour).
  wc.on('did-navigate', (_event, navigatedUrl) => {
    if (!isInternalUrl(navigatedUrl)) o.history.record(navigatedUrl, win.getTitle())
  })
  wc.on('page-title-updated', (_event, title) => {
    if (!isInternalUrl(wc.getURL())) o.history.touchTitle(wc.getURL(), title)
  })

  // Never let a page spawn an unmanaged webContents. Popups become further
  // detached windows, which is the closest a page window gets to "new tab".
  wc.setWindowOpenHandler(({ url: popupUrl }) => {
    if (/^https?:/.test(popupUrl)) openInNewWindow(popupUrl, o)
    return { action: 'deny' }
  })

  wc.on('will-navigate', (event, target) => {
    if (/^(https?|file|about|view-source|data):/.test(target)) return
    event.preventDefault()
    void import('electron').then(({ shell }) => shell.openExternal(target))
  })

  // Same certificate posture as tab views: never click through a bad cert.
  wc.on('certificate-error', (event, _url, _error, _cert, callback) => {
    event.preventDefault()
    callback(false)
  })

  wc.on('context-menu', (_event, params) => {
    popupContextMenu(win, wc, params, {
      onNewTab: (linkUrl) => openInNewWindow(linkUrl, o),
      onReload: () => wc.reload(),
      onBack: () => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(),
      onInspect: () => wc.openDevTools({ mode: 'detach' }),
      onReattach: () => {
        // The tab strip now hosts the page; this window's job is done.
        o.onReattach?.(wc.getURL())
        if (!win.isDestroyed()) win.close()
      },
    })
  })

  wc.on('render-process-gone', (_event, details) => {
    console.warn('[omega] detached window renderer gone:', details.reason)
    // A dead renderer in a one-page window is not recoverable meaningfully;
    // reload it, mirroring the chrome-UI strategy.
    if (!win.isDestroyed()) setTimeout(() => !win.isDestroyed() && void wc.reload(), 250)
  })

  void wc.loadURL(url).catch(() => {
    /* the failure surfaces in the window as Chromium's error page */
  })

  return win
}

/** WebContents of every detached window — included in downloads pushes. */
export function detachedWebContents(): WebContents[] {
  const out: WebContents[] = []
  for (const win of windows) {
    if (!win.isDestroyed()) out.push(win.webContents)
  }
  return out
}
