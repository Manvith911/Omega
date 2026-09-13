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
 *
 * Everything inside `createWindow` is built ONCE and stored at module scope.
 * On macOS, `activate` can call `createWindow` again after the last window
 * closes; without singletons the second call would double-register IPC
 * handlers (which throws) and double-attach the download interceptor. The
 * window-specific parts are rebuilt per call; services are not.
 */

import { BrowserWindow, app, screen, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DOWNLOADS_PAGE_URL, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/constants'
import { AdBlocker } from './ad-blocker'
import { AiService } from './ai'
import { applyCommandLineFlags } from './app-flags'
import { BookmarksStore } from './bookmarks'
import { clearBrowsingData } from './clear-data'
import {
  closeAllDetachedWindows,
  detachedWebContents,
  type DetachedWindowOptions,
} from './detached-window'
import { clampBoundsToDisplays } from './display-bounds'
import { DownloadsManager } from './downloads'
import { ExtensionsManager } from './extensions'
import { HistoryStore } from './history-store'
import { registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { APP_ORIGIN, registerOmegaScheme, serveOmegaProtocol } from './omega-protocol'
import { OverlayView } from './overlay-view'
import { PerfMonitor } from './perf'
import {
  createIncognitoSession,
  createTabSession,
  hardenUiSession,
  installPermissionHandlers,
} from './sessions'
import { SettingsStore } from './settings-store'
import { SuggestionController } from './suggestions'
import { TabManager } from './tab-manager'
import { UpdateService } from './updates'

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

// ── Process-wide services. Built once; survive window recreation. ──
let settings: SettingsStore
let history: HistoryStore
let bookmarks: BookmarksStore
let adBlock: AdBlocker
let downloads: DownloadsManager
let extensions: ExtensionsManager
let tabSession: Electron.Session
let incognitoSession: Electron.Session
let updates: UpdateService
let tabs: TabManager
let overlay: OverlayView
let ai: AiService
let suggest: SuggestionController
let perf: PerfMonitor
let servicesReady = false
let bootState = { savedFullscreen: false, savedMaximized: false }

/** A URL on the command line opens as a tab instead of restoring a session. */
function urlFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (/^(https?|omega):\/\//i.test(arg)) return arg
  }
  return null
}

/** Pending permission prompts, one at a time; resolved via the chrome UI. */
let pendingPermission: { origin: string; permission: string; resolve: (granted: boolean) => void } | null = null

function buildServices(): void {
  const dataDir = app.getPath('userData')

  settings = new SettingsStore(dataDir)
  history = new HistoryStore(dataDir)
  bookmarks = new BookmarksStore(dataDir)

  // ── Sessions: web content gets its own partition, never defaultSession ──
  tabSession = createTabSession(settings.get())
  incognitoSession = createIncognitoSession(settings.get())
  hardenUiSession()
  serveOmegaProtocol(settings, history, RENDERER_ROOT, [tabSession, incognitoSession])

  // ── Blocking is installed on the *tab* session only ──
  adBlock = new AdBlocker(tabSession, dataDir, settings.get().adBlockEnabled)
  adBlock.initialize()

  // ── Interactive permission pipeline (both sessions) ──
  const permissionHost = {
    ask: (origin: string, permission: string): Promise<boolean> =>
      new Promise((resolve) => {
        // One prompt at a time; the rest auto-deny rather than queueing a
        // confusing stack of dialogs.
        if (pendingPermission) {
          resolve(false)
          return
        }
        pendingPermission = { origin, permission, resolve }
        pushPermissionPrompt()
      }),
    rules: () => settings.get().permissionRules ?? [],
    onDecide: (rule: { origin: string; permission: string; granted: boolean }): void => {
      const rules = [...(settings.get().permissionRules ?? [])]
      const i = rules.findIndex((r) => r.origin === rule.origin && r.permission === rule.permission)
      if (i >= 0) rules[i] = rule
      else rules.push(rule)
      settings.set({ permissionRules: rules })
    },
  }
  installPermissionHandlers(tabSession, permissionHost)
  installPermissionHandlers(incognitoSession, permissionHost)

  // ── Downloads: settings-driven dir, ask-location, sanitized filenames ──
  downloads = new DownloadsManager(
    tabSession,
    () => {
      const targets: Electron.WebContents[] = []
      if (mainWindow && !mainWindow.isDestroyed()) targets.push(mainWindow.webContents)
      if (tabs) {
        for (const t of tabs.getAllTabs()) {
          if (t.url === DOWNLOADS_PAGE_URL) {
            const wc = tabs.getWebContents(t.id)
            if (wc) targets.push(wc)
          }
        }
      }
      targets.push(...detachedWebContents())
      return targets
    },
    app.getPath('downloads'),
    settings,
  )
  downloads.attach()

  // ── Extensions load into the tab session; folders persist in settings ──
  extensions = new ExtensionsManager(tabSession)

  updates = new UpdateService(() => mainWindow)
  // Background update cycle: check shortly after launch, then every 6h.
  // Downloads are silent; the update applies on next quit.
  if (app.isPackaged) updates.startAutoChecks()
  servicesReady = true
}

function pushPermissionPrompt(): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || !pendingPermission) return
  win.webContents.send('permission:request', {
    origin: pendingPermission.origin,
    permission: pendingPermission.permission,
  })
}

function answerPermission(granted: boolean): void {
  const pending = pendingPermission
  pendingPermission = null
  pending?.resolve(granted)
}

/** Restores saved extensions; logged, never fatal. */
function restoreExtensions(): void {
  const savedExtensions = settings.get().extensions ?? []
  if (savedExtensions.length === 0) return
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

async function createWindow(): Promise<void> {
  if (!servicesReady) buildServices()

  const isMac = process.platform === 'darwin'

  // Restore the window as the user left it: normal bounds, maximized, or
  // fullscreen. Bounds are validated against connected displays first — a
  // monitor that has since been disconnected must not swallow the window.
  const saved = settings.get().windowState
  bootState = { savedFullscreen: !!saved?.fullscreen, savedMaximized: !!saved?.maximized }
  const savedBounds = saved?.bounds
  const clamped = savedBounds
    ? clampBoundsToDisplays(savedBounds, screen.getAllDisplays())
    : null
  const restoredWidth = (clamped ?? savedBounds)?.width ?? 1360
  const restoredHeight = (clamped ?? savedBounds)?.height ?? 860

  const win = new BrowserWindow({
    width: restoredWidth,
    height: restoredHeight,
    ...(clamped ? { x: clamped.x, y: clamped.y } : {}),
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
  overlay = new OverlayView(win, PRELOAD_PATH, rendererEntry('overlay'))

  tabs = new TabManager({
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

  perf = new PerfMonitor({
    adBlock: () => adBlock.stats,
    uiWebContents: () => win.webContents,
  })

  ai = new AiService(tabs, settings, (chunk) => {
    if (!win.webContents.isDestroyed()) win.webContents.send('ai:chunk', chunk)
  })

  suggest = new SuggestionController(history, settings, overlay)

  const emitWindowState = (): void => {
    if (win.webContents.isDestroyed()) return
    win.webContents.send('win:state', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    })
  }

  const detachedWindowOptions = (): DetachedWindowOptions => ({
    preloadPath: null,
    history,
    iconPath: existsSync(WINDOW_ICON_PATH) ? WINDOW_ICON_PATH : null,
    baselineBounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
    // Move to Tab Strip: re-host the page as an active tab, then the module
    // closes the window. Focus follows the tab the user just created.
    onReattach: (url) => {
      void tabs.createTab({ url }).then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
        }
      })
    },
  })

  registerIpcHandlers({
    win,
    tabs,
    history,
    bookmarks,
    settings,
    adBlock,
    perf,
    ai,
    suggest,
    downloads,
    extensions,
    updates,
    emitWindowState,
    detachedWindowOptions,
    answerPermission,
    clearData: (options) => clearBrowsingData([tabSession, incognitoSession], options),
  })

  // ── Menus carry every keyboard shortcut (focus lives in the tab views) ──
  const activeId = (): number | null => tabs.getActiveTabId()

  installAppMenu({
    newTab: () => void tabs.createTab({}),
    newPrivateTab: () => void tabs.createTab({ incognito: true }),
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
    fullscreen: () => {
      if (win.isFullScreen()) win.setFullScreen(false)
      else win.setFullScreen(true)
    },
    print: () => {
      const id = activeId()
      const wc = id !== null ? tabs.getWebContents(id) : null
      if (wc && !wc.isDestroyed()) wc.print()
    },
    bookmarkPage: () => {
      const id = activeId()
      if (id === null) return
      const meta = tabs.getMeta(id)
      if (!meta || !/^https?:/.test(meta.url)) return
      try {
        bookmarks.add(meta.url, meta.title)
        win.webContents.send('toast', { kind: 'info', message: 'Bookmark added' })
      } catch {
        /* already bookmarked */
      }
    },
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
    if (bootState.savedMaximized && !bootState.savedFullscreen) win.maximize()
    if (bootState.savedFullscreen) win.setFullScreen(true)
    win.show()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
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

  // ── Session durability: periodic save, not only on clean quit ──
  const sessionSaver = setInterval(() => {
    try {
      if (settings.get().restoreSession && !win.isDestroyed()) {
        history.saveSession(tabs.sessionSnapshot())
      }
    } catch {
      /* never fatal */
    }
  }, 30_000)

  // ── Load the chrome ──
  // Surface renderer load failures instead of leaving a blank window with no
  // explanation: a packaged build loads over `file://`, where a stray CORS or
  // CSP problem otherwise fails silently.
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[omega] chrome failed to load (${code} ${description}) ${url}`)
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

  // ── Clear the CLI argv so a later macOS `activate` doesn't re-open it ──
  process.argv.length = 1

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

  win.once('closed', () => {
    clearInterval(sessionSaver)
    // Save one last time on window close.
    try {
      if (settings.get().restoreSession) history.saveSession(tabs.sessionSnapshot())
    } catch {
      /* never block shutdown on a persistence error */
    }
  })

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
    bookmarks.close()
  })

  // ── Crash resilience ──
  // "The app closes itself" is almost always a browser-process exception or a
  // GPU process exit escalating to full teardown. None of these are fatal:
  // log, keep the window alive, degrade gracefully.
  process.removeAllListeners('uncaughtException')
  process.on('uncaughtException', (err) => {
    console.error('[omega] uncaught exception (browser process kept alive):', err)
  })
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', (reason) => {
    console.error('[omega] unhandled rejection (browser process kept alive):', reason)
  })

  let gpuCrashes = 0
  app.on('child-process-gone', (_event, details) => {
    // GPU death normally blanks every tab. First crash: restart the compositor
    // path. Second: relaunch with hardware acceleration off, which always
    // works, at the cost of software rendering.
    if (details.type === 'GPU') {
      gpuCrashes += 1
      console.warn(`[omega] GPU process gone (${gpuCrashes}):`, details.reason)
      try {
        if (gpuCrashes >= 2 && !process.env['OMEGA_NO_GPU_FALLBACK']) {
          console.warn('[omega] falling back to software rendering on next launch')
          settings.set({ ...settings.get(), gpuFallback: true } as never)
          app.relaunch()
          app.exit(0)
          return
        }
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

// A second launch should focus the existing browser — and, if it carried a
// URL, open it as a tab (deep links like `omega https://x.com`).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = urlFromArgv(argv)
    if (url && tabs) void tabs.createTab({ url })
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    buildServices()
    restoreExtensions()
    await createWindow()
  }).catch((err) => {
    console.error('[omega] failed to start:', err)
    app.quit()
  })

  app.on('activate', () => {
    // macOS only. The services are singletons; only the window is rebuilt.
    if (BrowserWindow.getAllWindows().length === 0 && servicesReady) void createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
