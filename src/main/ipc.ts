/**
 * All `ipcMain` registrations live here.
 *
 * This file is the complete capability map of the renderer. If a channel is
 * not handled here, it cannot be called — the preload allowlist has already
 * rejected it, and this side would have no handler anyway.
 *
 * Every handler is async (`handle`, never `handleSync`). There is no
 * synchronous IPC anywhere in this codebase: a blocking call from a renderer
 * onto the browser process's loop is how an Electron app acquires "random"
 * one-frame stalls.
 */

import { ipcMain, dialog, Menu, type BrowserWindow } from 'electron'
import type { Rect, Settings, TabCreatePayload, ViewRect } from '@shared/ipc'
import { SETTINGS_PAGE_URL } from '@shared/constants'
import { openInNewWindow } from './detached-window'
import type { AdBlocker } from './ad-blocker'
import type { AiService } from './ai'
import type { DownloadsManager } from './downloads'
import type { ExtensionsManager } from './extensions'
import type { HistoryStore } from './history-store'
import type { DetachedWindowOptions } from './detached-window'
import type { PerfMonitor } from './perf'
import type { SettingsStore } from './settings-store'
import type { SuggestionController } from './suggestions'
import type { TabManager } from './tab-manager'

export interface IpcDeps {
  win: BrowserWindow
  tabs: TabManager
  history: HistoryStore
  settings: SettingsStore
  adBlock: AdBlocker
  perf: PerfMonitor
  ai: AiService
  suggest: SuggestionController
  downloads: DownloadsManager
  extensions: ExtensionsManager
  emitWindowState: () => void
  /** Builds options for detached windows (needs history + paths). */
  detachedWindowOptions: () => DetachedWindowOptions
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { win, tabs, history, settings, adBlock, perf, ai, suggest, downloads, extensions } = deps

  /** Detached windows share the history store and get the app icon. */
  const detachedOptions = (): DetachedWindowOptions => deps.detachedWindowOptions()

  // ── Tabs ──────────────────────────────────────────────────────────────────

  ipcMain.handle('tab:create', (_e, payload: TabCreatePayload = {}) => tabs.createTab(payload))
  ipcMain.handle('page:open', (_e, page: 'settings' | 'history' | 'downloads' | 'extensions') =>
    tabs.openOrFocusPage(page),
  )
  ipcMain.handle('page:kind', (_e) => {
    const senderUrl = new URL(_e.senderFrame?.url ?? 'about:blank')
    const path = senderUrl.pathname
    if (path.includes('settings')) return 'settings' as const
    if (path.includes('history')) return 'history' as const
    if (path.includes('downloads')) return 'downloads' as const
    if (path.includes('extensions')) return 'extensions' as const
    return 'other' as const
  })
  ipcMain.handle('tab:close', (_e, id: number) => tabs.closeTab(id))
  ipcMain.handle('tab:close-others', (_e, id: number) => tabs.closeOthers(id))
  ipcMain.handle('tab:switch', (_e, id: number) => tabs.activate(id))
  ipcMain.handle('tab:reorder', (_e, from: number, to: number) => tabs.reorder(from, to))
  ipcMain.handle('tab:list', () => tabs.getAllTabs())
  ipcMain.handle('tab:duplicate', (_e, id: number) => tabs.duplicate(id))
  ipcMain.handle('tab:reopen', () => tabs.reopen())
  ipcMain.handle('tab:mute', (_e, id: number, muted: boolean) => tabs.setMuted(id, muted))
  ipcMain.handle('tab:menu', (_e, id: number, position: { x: number; y: number }) => {
    const meta = tabs.getMeta(id)
    if (!meta) return
    // A detached window is a *page* window: internal pages (settings,
    // history) have no meaning outside the browser shell, so the item only
    // makes sense for real web content.
    const canDetach = /^(https?|file):/.test(meta.url)
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Duplicate Tab', click: () => void tabs.duplicate(id) },
      ...(canDetach
        ? [{
            label: 'Open in New Window',
            click: () => {
              openInNewWindow(meta.url, detachedOptions())
              // The tab stays in the strip, exactly like Edge's "Open in new
              // window" keeps the original in the tab list.
            },
          }]
        : []),
      { type: 'separator' },
      { label: meta.isMuted ? 'Unmute Tab' : 'Mute Tab', click: () => tabs.setMuted(id, !meta.isMuted) },
      { type: 'separator' },
      { label: 'Close Tab', click: () => void tabs.closeTab(id) },
      { label: 'Close Other Tabs', click: () => void tabs.closeOthers(id) },
    ]
    Menu.buildFromTemplate(template).popup({
      window: win,
      // The renderer's CSS pixels match the window's DIP coordinates.
      x: Math.round(position.x),
      y: Math.round(position.y),
    })
  })

  // ── Navigation ────────────────────────────────────────────────────────────

  ipcMain.handle('nav:go', (_e, payload: { tabId: number; url: string }) => {
    tabs.navigate(payload.tabId, payload.url)
  })
  ipcMain.handle('nav:back', (_e, id: number) => tabs.goBack(id))
  ipcMain.handle('nav:forward', (_e, id: number) => tabs.goForward(id))
  ipcMain.handle('nav:reload', (_e, id: number, ignoreCache = false) => tabs.reload(id, ignoreCache))
  ipcMain.handle('nav:stop', (_e, id: number) => tabs.stop(id))
  ipcMain.handle('nav:home', (_e, id: number) => tabs.home(id))
  ipcMain.handle('nav:zoom', (_e, id: number, direction: 'in' | 'out' | 'reset') => tabs.zoom(id, direction))

  // ── Layout sync ───────────────────────────────────────────────────────────

  ipcMain.handle('view:bounds', (_e, rect: ViewRect) => {
    tabs.setViewport(rect)
  })

  // ── Omnibox suggestions ───────────────────────────────────────────────────

  ipcMain.handle('suggest:query', (_e, query: string, anchor: Rect) => suggest.update(query, anchor))
  ipcMain.handle('suggest:highlight', (_e, index: number) => suggest.highlight(index))
  ipcMain.handle('suggest:dismiss', () => suggest.dismiss())

  ipcMain.handle('suggest:select', (_e, index: number) => {
    const url = suggest.take(index)
    const activeId = tabs.getActiveTabId()
    if (url && activeId !== null) {
      tabs.navigate(activeId, url)
      // Keyboard focus was in the omnibox; hand it back to the page so the
      // next keystroke goes to the site, not the address bar.
      tabs.getWebContents(activeId)?.focus()
    }
    if (!win.webContents.isDestroyed()) win.webContents.send('suggest:commit', { index })
  })

  // ── History ───────────────────────────────────────────────────────────────

  ipcMain.handle('history:list', (_e, limit = 200) => history.recent(limit))
  ipcMain.handle('history:delete', (_e, id: number) => history.remove(id))
  ipcMain.handle('history:clear', () => history.clear())

  // ── Find in page ──────────────────────────────────────────────────────────

  ipcMain.handle('find:start', (_e, text: string) => {
    const id = tabs.getActiveTabId()
    return id === null ? { matches: 0, active: 0 } : tabs.findStart(id, text)
  })
  ipcMain.handle('find:next', (_e, text: string, forward: boolean) => {
    const id = tabs.getActiveTabId()
    return id === null ? { matches: 0, active: 0 } : tabs.findNext(id, text, forward)
  })
  ipcMain.handle('find:stop', () => {
    const id = tabs.getActiveTabId()
    if (id !== null) tabs.findStop(id)
  })

  // ── Telemetry ─────────────────────────────────────────────────────────────

  ipcMain.handle('perf:snapshot', () => perf.snapshot())

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', (): Settings => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>): Settings => {
    const next = settings.set(patch)
    if (typeof patch.adBlockEnabled === 'boolean') adBlock.setEnabled(patch.adBlockEnabled)
    // Every surface showing settings must learn about the change: the chrome
    // window (toolbar ad-block state) and any tab on the settings page.
    const targets: Electron.WebContents[] = [win.webContents]
    for (const tab of tabs.getAllTabs()) {
      if (tab.url === SETTINGS_PAGE_URL) {
        const wc = tabs.getWebContents(tab.id)
        if (wc) targets.push(wc)
      }
    }
    for (const wc of targets) {
      if (!wc.isDestroyed()) wc.send('settings:changed', next)
    }
    return next
  })

  // ── Window chrome ─────────────────────────────────────────────────────────

  ipcMain.handle('win:get-state', () => ({
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
  }))
  ipcMain.handle('win:minimize', () => win.minimize())
  ipcMain.handle('win:maximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    deps.emitWindowState()
  })
  ipcMain.handle('win:close', () => win.close())

  // ── AI page assistant ─────────────────────────────────────────────────────

  ipcMain.handle('ai:extract', (_e, tabId: number) => ai.extract(tabId))
  ipcMain.handle('ai:ask', (_e, tabId: number, prompt: string) => ai.ask(tabId, prompt))
  ipcMain.handle('ai:abort', (_e, id: string) => ai.abort(id))

  // ── Downloads ──────────────────────────────────────────────────────

  ipcMain.handle('downloads:list', () => downloads.list())
  ipcMain.handle('downloads:open', (_e, id: string) => downloads.open(id))
  ipcMain.handle('downloads:show', (_e, id: string) => downloads.showInFolder(id))
  ipcMain.handle('downloads:cancel', (_e, id: string) => downloads.cancel(id))
  ipcMain.handle('downloads:clear-finished', () => downloads.clearFinished())

  // ── Extensions ─────────────────────────────────────────────────────

  ipcMain.handle('extensions:list', () => extensions.all())
  ipcMain.handle('extensions:load', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Load unpacked extension',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const record = await extensions.load(result.filePaths[0] as string)
    syncExtensionSettings()
    return record
  })
  ipcMain.handle('extensions:remove', async (_e, id: string) => {
    const ok = await extensions.remove(id)
    if (ok) syncExtensionSettings()
    return ok
  })
  ipcMain.handle('extensions:set-enabled', async (_e, id: string, enabled: boolean) => {
    const record = await extensions.setEnabled(id, enabled)
    if (record) syncExtensionSettings()
    return record
  })

  /** Persist the manager's state; it is the source of truth. */
  function syncExtensionSettings(): void {
    settings.set({ extensions: extensions.entries() })
  }
}
