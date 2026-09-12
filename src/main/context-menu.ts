/**
 * The tab context menu.
 *
 * Rendered as a real native menu rather than a DOM popover, which sidesteps
 * the whole z-order problem: the page view is a native layer above the React
 * chrome, so a DOM menu would be painted underneath it.
 *
 * Role-based items (`copy`, `paste`, ...) act on whichever webContents has
 * focus, which is the tab view — exactly what we want.
 */

import { Menu, clipboard, shell, type BrowserWindow, type ContextMenuParams, type WebContents } from 'electron'

export interface ContextMenuActions {
  onNewTab: (url: string) => void
  onReload: () => void
  onBack: () => void
  onInspect: () => void
}

export function popupContextMenu(
  win: BrowserWindow,
  wc: WebContents,
  params: ContextMenuParams,
  actions: ContextMenuActions,
): void {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (params.linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => actions.onNewTab(params.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    )
  }

  if (params.isEditable) {
    template.push(
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
    )
  } else if (params.selectionText.trim()) {
    template.push({ role: 'copy' }, { type: 'separator' })
  }

  if (params.mediaType === 'image' && params.srcURL) {
    template.push(
      { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
      { label: 'Save Image As…', click: () => wc.downloadURL(params.srcURL) },
      { type: 'separator' },
    )
  }

  const canGoBack = wc.navigationHistory.canGoBack()
  if (canGoBack && !params.linkURL) {
    template.push({ label: 'Back', click: actions.onBack }, { type: 'separator' })
  }

  template.push(
    { label: 'Reload', click: actions.onReload },
    { type: 'separator' },
    { label: 'Copy Page Address', enabled: !wc.getURL().startsWith('devtools://'), click: () => clipboard.writeText(wc.getURL()) },
    { label: 'Open in Default Browser', click: () => void shell.openExternal(wc.getURL()) },
    { type: 'separator' },
    { label: 'Inspect Element', click: actions.onInspect },
  )

  Menu.buildFromTemplate(template).popup({ window: win })
}
