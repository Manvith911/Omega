/**
 * The suggestions overlay.
 *
 * Why this exists at all: `win.contentView.addChildView()` paints *above* the
 * window's own webContents. So the React chrome can never draw a dropdown that
 * hangs down over the page — the page is a native layer sitting on top of it.
 * Every Electron browser hits this wall, and there are only three ways out:
 *
 *   1. shrink the page viewport whenever the omnibox focuses (reflows the page
 *      under the user's cursor — unacceptable),
 *   2. spawn a frameless always-on-top BrowserWindow (works, but needs
 *      display-scale coordinate math and is flaky on some Linux WMs),
 *   3. give the dropdown its own WebContentsView stacked above the page view.
 *
 * This is option 3. It is display-only: keyboard focus deliberately stays in
 * the omnibox input, so arrow keys and Enter are handled by the chrome UI and
 * forwarded here only as a highlight index. That avoids the whole class of
 * focus-stealing bugs that make dropdowns feel broken.
 */

import { BrowserWindow, WebContentsView } from 'electron'
import { SUGGESTION_GAP, SUGGESTION_MAX_ROWS, SUGGESTION_PADDING, SUGGESTION_ROW_HEIGHT } from '@shared/constants'
import type { Rect, SuggestState } from '@shared/ipc'

export class OverlayView {
  private readonly view: WebContentsView
  private shown = false

  constructor(
    private readonly win: BrowserWindow,
    preloadPath: string,
    entryUrl: string,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Lets the rounded panel composite over the page instead of sitting
        // on an opaque rectangle.
        transparent: true,
        additionalArguments: ['--omega-overlay'],
      },
    })

    // `View.setBackgroundColor` takes AARRGGBB, not RRGGBBAA.
    this.view.setBackgroundColor('#00000000')
    this.view.setBorderRadius(12)
    this.view.setBounds({ x: -10_000, y: -10_000, width: 1, height: 1 })
    this.view.setVisible(false)

    this.win.contentView.addChildView(this.view)
    void this.load(entryUrl)
  }

  private async load(entryUrl: string): Promise<void> {
    try {
      await this.view.webContents.loadURL(entryUrl)
    } catch (err) {
      console.warn('[omega] overlay failed to load:', err)
    }
  }

  /**
   * Re-add as the last child so it sits above every page view. Every
   * `addChildView` for a tab view pushes that view above this one, so this
   * must be called after any view is added.
   */
  front(): void {
    try {
      this.win.contentView.removeChildView(this.view)
    } catch {
      /* not currently parented */
    }
    this.win.contentView.addChildView(this.view)
    this.view.setVisible(this.shown)
  }

  show(state: SuggestState, anchor: Rect): void {
    const items = state.items.slice(0, SUGGESTION_MAX_ROWS)
    if (!state.visible || items.length === 0) {
      this.hide()
      return
    }

    const win = this.win.getContentBounds()
    const ideal = items.length * SUGGESTION_ROW_HEIGHT + SUGGESTION_PADDING * 2
    const available = Math.max(120, win.height - anchor.y - SUGGESTION_GAP - 12)
    const height = Math.min(ideal, available)

    const width = Math.max(360, Math.min(anchor.width, win.width - 16))
    const x = Math.max(8, Math.min(anchor.x, win.width - width - 8))
    const y = anchor.y + SUGGESTION_GAP

    this.view.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    })

    this.send({ ...state, items })
    this.shown = true
    this.front()
  }

  send(state: SuggestState): void {
    const wc = this.view.webContents
    if (wc.isDestroyed()) return
    wc.send('suggest:state', state)
  }

  hide(): void {
    this.shown = false
    this.view.setVisible(false)
  }

  get isShown(): boolean {
    return this.shown
  }

  destroy(): void {
    try {
      this.win.contentView.removeChildView(this.view)
    } catch {
      /* already detached */
    }
    const wc = this.view.webContents
    if (!wc.isDestroyed()) {
      try {
        wc.close()
      } catch {
        /* renderer already gone */
      }
    }
  }
}
