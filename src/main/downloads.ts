/**
 * Download management.
 *
 * Electron's `will-download` pipeline owns the actual transfer; this module
 * only tracks state and answers renderer queries.
 *
 * Design notes:
 *  - By default every download on the tab session is intercepted and saved
 *    without a dialog (Chrome's behaviour with "ask where to save" off).
 *  - Filenames come from the server's Content-Disposition and are therefore
 *    HOSTILE: they can carry path separators or reserved device names. They
 *    are flattened to a bare basename and sanitized before use.
 *  - Collisions are resolved by appending " (n)" before the extension. The
 *    reservation is made synchronously in the handler, so two downloads with
 *    the same name starting in the same tick cannot pick the same path.
 *  - Finished downloads stay listed (Chrome behaviour) until the user clears
 *    them. Records are not persisted across launches; the downloads shelf in
 *    Chrome behaves the same way.
 */

import { dialog, shell, type DownloadItem, type Session, type WebContents } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SettingsStore } from './settings-store'

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

/** Windows reserved device names, case-insensitive. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/**
 * Flattens a server-supplied filename to a single safe path segment.
 * Strips directory components, control characters, Windows-illegal
 * characters and trailing dots/spaces, and dodges reserved device names.
 */
export function sanitizeFilename(input: string): string {
  let name = basename(input.replace(/\\/g, '/')).trim()
  // Control chars and Windows-forbidden: \ / : * ? " < > |
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
  name = name.replace(/^\.+/, '_') // no relative tricks like "..foo" either
  if (!name || name === '.' || name === '..') name = 'download'
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  if (RESERVED_NAMES.has(stem.toLowerCase())) name = `_${stem}${ext}`
  return name.slice(0, 200) || 'download'
}

export class DownloadsManager {
  private readonly items = new Map<string, DownloadRecord>()
  private readonly live = new Map<string, DownloadItem>()
  private seq = 0
  /** In-flight path reservations; also guards the same-tick race. */
  private readonly reserved = new Set<string>()

  constructor(
    private readonly session: Session,
    /**
     * Every WebContents that should receive live download updates: the chrome
     * window (toolbar badge), tabs showing the downloads page, and detached
     * windows. Lazy because the tab manager does not exist yet when this is
     * wired up.
     */
    private readonly getTargets: () => WebContents[],
    /** Fallback when the configured dir is empty/invalid. */
    private readonly defaultDir: string,
    private readonly settings: SettingsStore,
  ) {}

  private get dir(): string {
    const configured = this.settings.get().downloadsDir.trim()
    return configured || this.defaultDir
  }

  attach(): void {
    this.session.on('will-download', (_event, item) => {
      const id = `dl-${++this.seq}`
      const settings = this.settings.get()

      // ── Destination ──
      // askDownloadLocation shows the native dialog (the URL is prefilled so
      // the suggested filename still goes through sanitize on our side via
      // Chromium's own prompt). Otherwise save silently into the dir.
      if (settings.askDownloadLocation) {
        const result = dialog.showSaveDialogSync({
          defaultPath: join(this.dir, sanitizeFilename(item.getFilename())),
          buttonLabel: 'Save',
        })
        // Cancel = abort the download entirely (Chrome behaviour).
        if (!result) {
          item.cancel()
          return
        }
        item.setSavePath(result)
      } else {
        const dir = this.dir
        try {
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        } catch {
          /* an unwritable dir surfaces as an interrupted download */
        }
        const filename = sanitizeFilename(item.getFilename())
        const savePath = this.uniquePath(join(dir, filename))
        item.setSavePath(savePath)
      }

      const savePath = item.getSavePath()
      const record: DownloadRecord = {
        id,
        url: item.getURL(),
        filename: savePath ? basename(savePath) : sanitizeFilename(item.getFilename()),
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
        // Release the path reservation when the transfer ends.
        if (rec && rec.path) this.reserved.delete(rec.path.toLowerCase())
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
    // openPath RESOLVES with an error string ('' on success) — it does not
    // reject. Treating the resolution itself as success reported every
    // failure as a success.
    const err = await shell.openPath(rec.path)
    return err === ''
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
      if (rec.state !== 'progressing') {
        if (rec.path) this.reserved.delete(rec.path.toLowerCase())
        this.items.delete(id)
      }
    }
    this.push()
  }

  /**
   * Reserves a non-colliding path. `existsSync` alone races: two downloads
   * with the same filename in the same tick would both see "free" and
   * overwrite each other. Reservations are tracked in-memory per app run.
   */
  private uniquePath(path: string): string {
    const key = path.toLowerCase()
    if (!existsSync(path) && !this.reserved.has(key)) {
      this.reserved.add(key)
      return path
    }
    const dot = path.lastIndexOf('.')
    const base = dot > 0 ? path.slice(0, dot) : path
    const ext = dot > 0 ? path.slice(dot) : ''
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`
      const ckey = candidate.toLowerCase()
      if (!existsSync(candidate) && !this.reserved.has(ckey)) {
        this.reserved.add(ckey)
        return candidate
      }
    }
  }

  /** Pushes the list to the chrome UI and to any open downloads page. */
  private push(): void {
    for (const wc of this.getTargets()) {
      if (!wc.isDestroyed()) wc.send('downloads:updated', this.list())
    }
  }
}
