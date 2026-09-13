/**
 * Download management.
 *
 * Electron's `will-download` pipeline owns the actual transfer; this module
 * only tracks state and answers renderer queries.
 *
 * Design notes:
 *  - Every download on the tab session is intercepted. `savePath` is set so
 *    Chromium does not open a native Save dialog per file — the downloads
 *    page is the UI.
 *  - Filename collisions are resolved by appending " (n)" before the
 *    extension, on disk and in the record.
 *  - Finished downloads stay listed (Chrome behaviour) until the user clears
 *    them. Records are not persisted across launches; the downloads shelf in
 *    Chrome behaves the same way.
 */

import { shell, type BrowserWindow, type DownloadItem, type Session } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface DownloadRecord {
  id: string
  url: string
  filename: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  /** Bytes received so far. */
  received: number
  total: number
  startedAt: number
  /** Present once state is completed/cancelled/interrupted. */
  endedAt?: number
}

export class DownloadsManager {
  private readonly items = new Map<string, DownloadRecord>()
  private readonly live = new Map<string, DownloadItem>()
  private seq = 0

  constructor(
    private readonly session: Session,
    private readonly getWindow: () => BrowserWindow | null,
    /** Defaults to the user's Downloads folder. */
    private readonly dir: string,
  ) {}

  attach(): void {
    // Directory created lazily but eagerly enough for the first download.
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    } catch {
      /* will-download sets an absolute savePath anyway; a missing dir only
         surfaces as an interrupted download, surfaced in the page. */
    }

    this.session.on('will-download', (_event, item) => {
      const id = `dl-${++this.seq}`
      const savePath = this.uniquePath(join(this.dir, item.getFilename()))

      item.setSavePath(savePath)

      const record: DownloadRecord = {
        id,
        url: item.getURL(),
        filename: basename(savePath),
        path: savePath,
        state: 'progressing',
        received: 0,
        total: item.getTotalBytes(),
        startedAt: Date.now(),
      }
      this.items.set(id, record)
      this.live.set(id, item)

      item.on('updated', (_e, state) => {
        const rec = this.items.get(id)
        if (!rec) return
        rec.received = item.getReceivedBytes()
        rec.total = item.getTotalBytes()
        rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'
        this.push()
      })

      item.once('done', (_e, state) => {
        const rec = this.items.get(id)
        this.live.delete(id)
        if (rec) {
          rec.received = item.getReceivedBytes()
          rec.state =
            state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
          rec.endedAt = Date.now()
        }
        this.push()
      })

      this.push()
    })
  }

  list(): DownloadRecord[] {
    return [...this.items.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  /** Opens the file with the OS handler. Returns false when unavailable. */
  async open(id: string): Promise<boolean> {
    const rec = this.items.get(id)
    if (!rec || rec.state !== 'completed' || !existsSync(rec.path)) return false
    return shell.openPath(rec.path).then(() => true, () => false)
  }

  /** Reveals the file in the platform file manager. */
  showInFolder(id: string): void {
    const rec = this.items.get(id)
    if (rec && existsSync(rec.path)) shell.showItemInFolder(rec.path)
  }

  cancel(id: string): void {
    const item = this.live.get(id)
    if (item) {
      try {
        item.cancel()
      } catch {
        /* already done */
      }
    }
  }

  clearFinished(): void {
    for (const [id, rec] of this.items) {
      if (rec.state !== 'progressing') this.items.delete(id)
    }
    this.push()
  }

  private uniquePath(path: string): string {
    if (!existsSync(path)) return path
    const dot = path.lastIndexOf('.')
    const base = dot > 0 ? path.slice(0, dot) : path
    const ext = dot > 0 ? path.slice(dot) : ''
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`
      if (!existsSync(candidate)) return candidate
    }
  }

  /** Pushes the list to the chrome UI; the page also re-fetches on open. */
  private push(): void {
    const win = this.getWindow()
    if (!win || win.webContents.isDestroyed()) return
    win.webContents.send('downloads:updated', this.list())
  }
}
