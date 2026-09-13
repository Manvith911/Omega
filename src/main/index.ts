/**
 * Omega — browser process entry point.
 *
 * Wiring order matters here:
 *
 *   1. Command-line flags and the custom scheme must be registered before
 *      `app.whenReady()` — both are frozen once the browser process starts.
 *   2. Sessions must exist before any WebContentsView is constructed, because
 *      the ad blocker attaches to the tab session's webRequest.
 *   3. The overlay view is created before the tab manager so that the first
 *      `addChildView` has something to stack against.
 */

import { BrowserWindow, app, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DOWNLOADS_PAGE_URL, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/constants'
import { AdBlocker } from './ad-blocker'
import { AiService } from './ai'
import { applyCommandLineFlags } from './app-flags'
import {
  closeAllDetachedWindows,
  detachedWebContents,
  type DetachedWindowOptions,
} from './detached-window'
import { DownloadsManager } from './downloads'
import { ExtensionsManager } from './extensions'
import { HistoryStore } from './history-store'
import { registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { APP_ORIGIN, registerOmegaScheme, serveOmegaProtocol } from './omega-protocol'
import { OverlayView } from './overlay-view'
import { PerfMonitor } from './perf'
import { createTabSession, hardenUiSession } from './sessions'
import { SettingsStore } from './settings-store'
import { SuggestionController } from './suggestions'
import { TabManager } from './tab-manager'

// ── One-shot setup. Both of these must happen before app.ready. ──
applyCommandLineFlags(app)
registerOmegaScheme()

// Windows groups taskbar buttons and Start-menu pins by AppUserModelID, and
// falls back to the host exe path when none is set — which in dev means every
// Omega window groups under electron.exe. Matching the installer's appId
// keeps the running window, pinned shortcut and installer under one identity.
if (process.platform === 'win32') app.setAppUserModelId('com.omega.browser')

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/** Resolved from the app root so it works identically in dev and in an asar. */
const APP_ROOT = app.getAppPath()
const PRELOAD_PATH = join(APP_ROOT, 'out', 'preload', 'index.cjs')

/**
 * In production the chrome is served from `omega://app` rather than `file://`,
 * so it has a real origin and receives the CSP as a response header.
 */
const RENDERER_ROOT = join(APP_ROOT, 'out', 'renderer')

/**
 * Window/taskbar icon for Windows and Linux. macOS ignores window icons — its
 * dock icon comes from the app bundle instead. Packaged builds ship the file
 * inside the asar (see electron-builder.yml); dev reads it from the repo.
 */
const WINDOW_ICON_PATH = join(APP_ROOT, 'build', 'icon.png')

function rendererEntry(page: 'index' | 'overlay'): string {
  if (isDev) return `${process.env['ELECTRON_RENDERER_URL']}/${page}.html`
  return `${APP_ORIGIN}/${page}.html`
}

let mainWindow: BrowserWindow | null = null

/**
 * A URL on the command line opens as a tab instead of restoring a session,
 * which is what `omega https://example.com` should do.
 */
function urlFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (/^https?:\/\//i.test(arg)) return arg
  }
  return null
}

async function createWindow(): Promise<void> {
  const dataDir = app.getPath('userData')

  // ── State ──
  const settings = new SettingsStore(dataDir)
  const history = new HistoryStore(dataDir)

  // ── Sessions: web content gets its own partition, never defaultSession ──
  const tabSession = createTabSession()
  hardenUiSession()
  serveOmegaProtocol(settings, history, RENDERER_ROOT, [tabSession])

  // ── Blocking is installed on the *tab* session only ──
  const adBlock = new AdBlocker(tabSession, dataDir, settings.get().adBlockEnabled)
  adBlock.initialize()

  // ── Downloads land in the user's Downloads folder, tracked for the page ──
  // The target list is built lazily: the tab manager does not exist yet here,
  // and the downloads page lives in a tab view, not the chrome window.
  const downloads = new DownloadsManager(
    tabSession,
    () => {
      const targets: Electron.WebContents[] = []
      if (mainWindow && !mainWindow.isDestroyed()) targets.push(mainWindow.webContents)
      for (const tab of tabs?.getAllTabs() ?? []) {
        if (tab.url === DOWNLOADS_PAGE_URL) {
          const wc = tabs.getWebContents(tab.id)
          if (wc) targets.push(wc)
        }
      }
      // Downloads started from a detached window update its page too (the
      // context menu offers Save Image As etc. there).
      targets.push(...detachedWebContents())
      return targets
    },
    app.getPath('downloads'),
  )
  downloads.attach()

  // "Open in new window": shared state for every detached window.
  const detachedWindowOptions = (): DetachedWindowOptions => ({
    preloadPath: null,
    history,
    iconPath: existsSync(WINDOW_ICON_PATH) ? WINDOW_ICON_PATH : null,
    baselineBounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
  })

  // ── Extensions load into the tab session; folders persist in settings ──
  const extensions = new ExtensionsManager(tabSession)
  const savedExtensions = settings.get().extensions ?? []
  if (savedExtensions.length > 0) {
    extensions
      .restore(savedExtensions)
      .then((restored) => {
        if (restored.length !== savedExtensions.length) {
          console.warn(
            `[omega] extensions: restored ${restored.length} of ${savedExtensions.length} (missing folders skipped)`,
          )
        }
      })
      .catch((err) => console.warn('[omega] extension restore failed:', err))
  }

  const isMac = process.platform === 'darwin'

  // Restore the window as the user left it: normal bounds, maximized, or
  // fullscreen. Fullscreen is the case people notice when it is missing —
  // F11 and reopen should behave like every mainstream browser.
  const saved = settings.get().windowState
  const savedBounds = saved?.bounds
  const restoredWidth = savedBounds?.width ?? 1360
  const restoredHeight = savedBounds?.height ?? 860

  const win = new BrowserWindow({
    width: restoredWidth,
    height: restoredHeight,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    // macOS keeps its traffic lights via titleBarStyle; the other platforms
    // get a truly frameless window and we draw our own controls.
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 14, y: 13 } }
      : { frame: false }),
    // Taskbar/alt-tab icon on win+linux. Guarded so a missing file (e.g. a
    // source checkout without generated icons) degrades to the platform
    // default instead of warning on every window creation.
    ...(process.platform !== 'darwin' && existsSync(WINDOW_ICON_PATH)
      ? { icon: WINDOW_ICON_PATH }
      : {}),
    backgroundColor: '#0f0f17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  mainWindow = win

  // ── Overlay surface (omnibox suggestions) — must exist before any tab view ──
  const overlay = new OverlayView(win, PRELOAD_PATH, rendererEntry('overlay'))

  const tabs = new TabManager({
    win,
    preloadPath: PRELOAD_PATH,
    history,
    settings,
    devOrigin: isDev ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null,
    bringOverlayToFront: () => overlay.front(),
    toast: (kind, message) => {
      if (!win.webContents.isDestroyed()) win.webContents.send('toast', { kind, message })
    },
  })

  const perf = new PerfMonitor({
    adBlock: () => adBlock.stats,
    uiWebContents: () => win.webContents,
  })

  const ai = new AiService(tabs, settings, (chunk) => {
    if (!win.webContents.isDestroyed()) win.webContents.send('ai:chunk', chunk)
  })

  const suggest = new SuggestionController(history, settings, overlay)

  const emitWindowState = (): void => {
    if (win.webContents.isDestroyed()) return
    win.webContents.send('win:state', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    })
  }

  registerIpcHandlers({
    win,
    tabs,
    history,
    settings,
    adBlock,
    perf,
    ai,
    suggest,
    downloads,
    extensions,
    emitWindowState,
    detachedWindowOptions,
  })

  // ── Menus carry every keyboard shortcut (focus lives in the tab views) ──
  const activeId = (): number | null => tabs.getActiveTabId()

  installAppMenu({
    newTab: () => void tabs.createTab({}),
    closeTab: () => {
      const id = activeId()
      if (id !== null) void tabs.closeTab(id)
    },
    reopenTab: () => void tabs.reopen(),
    duplicateTab: () => {
      const id = activeId()
      if (id !== null) void tabs.duplicate(id)
    },
    stepTab: (delta) => {
      const list = tabs.getAllTabs()
      if (list.length < 2) return
      const current = list.findIndex((t) => t.id === activeId())
      const next = (current + delta + list.length) % list.length
      const target = list[next]
      if (target) void tabs.activate(target.id)
    },
    selectTabIndex: (index) => {
      const list = tabs.getAllTabs()
      if (!list.length) return
      // -1 means "last tab", matching every other browser.
      const target = index === -1 ? list[list.length - 1] : list[index]
      if (target) void tabs.activate(target.id)
    },
    reload: (ignoreCache) => {
      const id = activeId()
      if (id !== null) tabs.reload(id, ignoreCache)
    },
    back: () => {
      const id = activeId()
      if (id !== null) tabs.goBack(id)
    },
    forward: () => {
      const id = activeId()
      if (id !== null) tabs.goForward(id)
    },
    zoom: (direction) => {
      const id = activeId()
      if (id !== null) tabs.zoom(id, direction)
    },
    toggleDevTools: () => tabs.getWebContents(activeId() ?? -1)?.openDevTools({ mode: 'detach' }),
    toggleUiDevTools: () => win.webContents.toggleDevTools(),
    command: (command) => {
      if (command === 'open-settings') {
        void tabs.openOrFocusPage('settings')
        return
      }
      if (command === 'toggle-history') {
        void tabs.openOrFocusPage('history')
        return
      }
      if (!win.webContents.isDestroyed()) win.webContents.send('ui:command', command)
    },
    openPage: (page) => void tabs.openOrFocusPage(page),
  })

  // ── Frame lifecycle ──
  win.on('resize', () => tabs.syncViewport())
  win.on('maximize', emitWindowState)
  win.on('unmaximize', emitWindowState)
  win.on('enter-full-screen', emitWindowState)
  win.on('leave-full-screen', emitWindowState)
  win.once('ready-to-show', () => {
    // Apply the persisted mode after the normal bounds are set but before the
    // window paints, so the user never sees a wrong-sized flash.
    if (saved?.maximized && !saved.fullscreen) win.maximize()
    if (saved?.fullscreen) win.setFullScreen(true)
    win.show()
  })
  win.on('closed', () => {
    mainWindow = null
  })

  // Persist window state as it changes AND on close. The close-time save is
  // the one that matters for fullscreen: if the OS already left fullscreen
  // during teardown, the change events would have recorded a stale value.
  const persistWindowState = (): void => {
    if (win.isDestroyed()) return
    const fullscreen = win.isFullScreen()
    const maximized = win.isMaximized()
    // Only normal-mode bounds are worth remembering; restoring maximized
    // bounds re-triggers a maximize animation on some platforms.
    const bounds = !fullscreen && !maximized ? win.getBounds() : undefined
    settings.set({ windowState: { fullscreen, maximized, bounds } })
  }
  win.on('enter-full-screen', persistWindowState)
  win.on('leave-full-screen', persistWindowState)
  win.on('maximize', persistWindowState)
  win.on('unmaximize', persistWindowState)
  win.on('close', persistWindowState)

  // ── Load the chrome ──
  // Surface renderer load failures instead of leaving a blank window with no
  // explanation: a packaged build loads over `file://`, where a stray CORS or
  // CSP problem otherwise fails silently.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[omega] chrome failed to load (${code} ${description}) ${url}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[omega] chrome renderer exited: ${details.reason}`)
  })

  await win.loadURL(rendererEntry('index'))

  if (!app.isPackaged) await reportChromeBoot(win)

  // ── A command-line URL wins; otherwise restore the session, otherwise ──
  // ── open a fresh tab. A browser with no tabs is unusable.           ──
  const cliUrl = urlFromArgv(process.argv)
  const restored = cliUrl === null && settings.get().restoreSession ? history.loadSession() : null

  if (cliUrl !== null) {
    await tabs.createTab({ url: cliUrl })
  } else if (restored && restored.length > 0) {
    for (const [i, url] of restored.entries()) {
      await tabs.createTab({ url, background: i > 0 })
    }
  } else {
    await tabs.createTab({})
  }

  if (!app.isPackaged) {
    perf.startDevLogging(30_000)
    // One line per tab shortly after launch. Catches the failure mode where a
    // tab silently shows an error page, which is otherwise invisible from the
    // terminal because the tab's DOM is in a different process.
    setTimeout(() => {
      for (const tab of tabs.getAllTabs()) {
        console.log(`[omega] tab ${tab.id} ${tab.error ? `ERROR(${tab.error})` : 'ok'} "${tab.title}" ${tab.url}`)
      }
    }, 3000)
  }

  app.on('before-quit', () => {
    try {
      if (settings.get().restoreSession) history.saveSession(tabs.sessionSnapshot())
    } catch {
      /* never block shutdown on a persistence error */
    }
  })

  app.on('will-quit', () => {
    tabs.dispose()
    overlay.destroy()
    closeAllDetachedWindows()
    history.close()
  })

  // ── Crash resilience ──
  // "The app closes itself" is almost always a browser-process exception or a
  // GPU process exit escalating to full teardown. None of these are fatal:
  // log, keep the window alive, degrade gracefully.
  process.on('uncaughtException', (err) => {
    console.error('[omega] uncaught exception (browser process kept alive):', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[omega] unhandled rejection (browser process kept alive):', reason)
  })

  app.on('child-process-gone', (_event, details) => {
    // GPU death normally blanks every tab; a restart recovers it without
    // touching the window. Renderer deaths are handled per-tab in TabManager.
    if (details.type === 'GPU') {
      console.warn('[omega] GPU process gone:', details.reason, '— requesting restart')
      try {
        app.commandLine.appendSwitch('ignore-gpu-blocklist')
        win.webContents.invalidate()
      } catch {
        /* window may already be closing */
      }
      return
    }
    console.warn('[omega] child process gone:', details.type, details.reason)
  })

  // If the chrome UI renderer itself dies, the window would sit blank
  // forever — indistinguishable from "the app closed". Reload it; the React
  // tree rehydrates from the main process state within a frame or two.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[omega] chrome renderer gone:', details.reason, '— reloading UI')
    if (!win.isDestroyed()) {
      setTimeout(() => {
        if (!win.isDestroyed()) void win.webContents.reload()
      }, 250)
    }
  })
}

/**
 * Dev-only boot assertion.
 *
 * The chrome UI is the one piece of this app that can fail completely without
 * raising anything in the main process — a bad bundle, a CSP violation, or a
 * preload that did not attach all produce the same blank window. Probing for
 * the bridge and a mounted React root turns that into a clear log line.
 */
async function reportChromeBoot(win: BrowserWindow): Promise<void> {
  const probe = `({
    bridge: typeof window.omega,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    nodeFrames: document.querySelectorAll('script').length,
  })`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = (await win.webContents.executeJavaScript(probe, true)) as {
        bridge: string
        rootChildren: number
      }
      if (result.bridge === 'object' && result.rootChildren > 0) {
        console.log('[omega] chrome renderer booted, preload bridge attached')
        return
      }
      if (attempt === 2) {
        console.error('[omega] chrome renderer did NOT boot:', JSON.stringify(result))
      }
    } catch (err) {
      console.error('[omega] boot probe failed:', err)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global hardening + lifecycle
// ─────────────────────────────────────────────────────────────────────────────

app.on('web-contents-created', (_event, contents) => {
  // A <webview> is an unmanaged webContents that can be given Node access by a
  // malicious page. Nothing in Omega needs one.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // The chrome window and the overlay must never spawn windows. Tab views
  // install their own handler that turns popups into tabs.
  if (contents.session === session.defaultSession) {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
})

// A second launch should focus the existing browser, not start a new one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(createWindow).catch((err) => {
    console.error('[omega] failed to start:', err)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
