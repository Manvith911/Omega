/**
 * Application menu.
 *
 * Keyboard shortcuts have to live here rather than in DOM listeners, because
 * focus is almost always inside a tab's WebContentsView — the chrome UI never
 * sees the keystroke. Menu accelerators fire regardless of which view has
 * focus, which is exactly the property a browser needs.
 *
 * The window is frameless, so on Windows and Linux the bar itself is never
 * drawn. The accelerators still work.
 */

import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { UiCommand } from '@shared/ipc'

export interface MenuActions {
  newTab: () => void
  closeTab: () => void
  reopenTab: () => void
  duplicateTab: () => void
  stepTab: (delta: number) => void
  selectTabIndex: (index: number) => void
  reload: (ignoreCache: boolean) => void
  back: () => void
  forward: () => void
  zoom: (direction: 'in' | 'out' | 'reset') => void
  toggleDevTools: () => void
  toggleUiDevTools: () => void
  command: (command: UiCommand) => void
  openPage: (page: 'settings' | 'history' | 'downloads' | 'extensions') => void
}

export function installAppMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'appMenu' }] : []

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => actions.newTab() },
      { label: 'New Window', enabled: false },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => actions.closeTab() },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => actions.reopenTab() },
      { label: 'Duplicate Tab', accelerator: 'CmdOrCtrl+Shift+K', click: () => actions.duplicateTab() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Find in Page',
        accelerator: 'CmdOrCtrl+F',
        click: () => actions.command('open-find'),
      },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => actions.reload(false) },
      { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => actions.reload(true) },
      { label: 'Stop', accelerator: 'Esc', enabled: false },
      { type: 'separator' },
      { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => actions.back() },
      { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => actions.forward() },
      { type: 'separator' },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => actions.zoom('reset') },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => actions.zoom('in') },
      // A second binding: on most layouts Ctrl+= is physically the same key
      // but produces a different accelerator string.
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => actions.zoom('in') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => actions.zoom('out') },
      { type: 'separator' },
      { label: 'Toggle Page Assistant', accelerator: 'CmdOrCtrl+Shift+E', click: () => actions.command('toggle-sidebar') },
      { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => actions.command('focus-omnibox') },
      { type: 'separator' },
      {
        label: 'Developer Tools (page)',
        accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
        click: () => actions.toggleDevTools(),
      },
      {
        label: 'Developer Tools (browser UI)',
        accelerator: 'F12',
        click: () => actions.toggleUiDevTools(),
      },
    ],
  }

  const historyMenu: MenuItemConstructorOptions = {
    label: 'History',
    submenu: [
      { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => actions.command('toggle-history') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => actions.openPage('downloads') },
      { type: 'separator' },
      { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => actions.stepTab(1) },
      { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => actions.stepTab(-1) },
      { type: 'separator' },
      // CmdOrCtrl+9 means "last tab" in every browser, so 1..8 only.
      ...Array.from({ length: 8 }, (_, i) => ({
        label: `Tab ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}`,
        visible: false,
        click: () => actions.selectTabIndex(i),
      })),
      { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', visible: false, click: () => actions.selectTabIndex(-1) },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => actions.openPage('settings') },
      { label: 'Extensions', accelerator: 'CmdOrCtrl+Shift+X', click: () => actions.openPage('extensions') },
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    fileMenu,
    editMenu,
    viewMenu,
    historyMenu,
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
