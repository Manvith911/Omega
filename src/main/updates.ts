/**
 * Auto-update pipeline (electron-updater).
 *
 * Model, matching Chrome: check in the background a few seconds after launch
 * and every 6 hours, download silently, and stage the update. The new version
 * is applied on the next app quit — no restart is ever forced mid-session.
 *
 * Every call is defensive: updater misbehaviour must never take the browser
 * down. Without a publish target (dev builds) the check reports
 * `not-available` and silently stops.
 */

import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/ipc'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Loaded lazily so dev builds without the package never touch it. */
type Updater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string } }>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  on: (event: string, listener: (...args: never[]) => void) => void
}

export class UpdateService {
  private updater: Updater | null = null
  private loadAttempted = false
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** Probes for electron-updater once; absent in dev is normal, not an error. */
  private ensureUpdater(): Updater | null {
    if (this.loadAttempted) return this.updater
    this.loadAttempted = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('electron-updater') as { autoUpdater: Updater }
      this.updater = mod.autoUpdater
      // Silent download + install on quit: the user never has to do anything.
      this.updater.autoDownload = true
      this.updater.autoInstallOnAppQuit = true
      this.updater.on('update-available', (...args: never[]) => {
        const info = args[0] as { version?: string } | undefined
        this.set({ state: 'available', version: info?.version ?? 'unknown' })
      })
      this.updater.on('update-not-available', () => this.set({ state: 'not-available' }))
      this.updater.on('download-progress', (...args: never[]) => {
        const p = args[0] as { percent?: number } | undefined
        this.set({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
      })
      this.updater.on('update-downloaded', () => this.set({ state: 'ready' }))
      this.updater.on('error', (...args: never[]) => {
        const err = args[0] as Error
        // A transient network error after a successful download must not
        // clear the staged update.
        if (this.status.state === 'ready') return
        this.set({ state: 'error', message: err?.message ?? 'Unknown updater error' })
      })
    } catch {
      // No electron-updater (dev checkout) or no publish target: fine.
      this.updater = null
    }
    return this.updater
  }

  private set(status: UpdateStatus): void {
    this.status = status
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('updates:status', status)
  }

  /**
   * Starts the automatic cycle: first check shortly after launch, then
   * periodically. Called once from the app entry point.
   */
  startAutoChecks(): void {
    const u = this.ensureUpdater()
    if (!u) return
    const check = (): void => {
      void this.check()
    }
    setTimeout(check, 15_000)
    this.timer = setInterval(check, CHECK_INTERVAL_MS)
  }

  stopAutoChecks(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateStatus> {
    const u = this.ensureUpdater()
    if (!u) {
      if (this.status.state === 'idle') this.set({ state: 'not-available' })
      return this.status
    }
    try {
      if (this.status.state === 'idle' || this.status.state === 'error' || this.status.state === 'not-available') {
        this.set({ state: 'checking' })
      }
      await u.checkForUpdates()
      // The update-available / update-not-available events set the real state.
    } catch (err) {
      if (this.status.state !== 'ready') {
        this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    return this.status
  }

  /** Manual trigger from the About page; downloads when not already staged. */
  async download(): Promise<UpdateStatus> {
    const u = this.ensureUpdater()
    if (!u) return this.status
    const before = this.status.state
    if (before === 'ready') return this.status
    try {
      if (before !== 'downloading') this.set({ state: 'downloading', percent: 0 })
      await u.downloadUpdate()
    } catch (err) {
      // A concurrent 'update-downloaded' event may have won the race; only
      // surface the error when nothing staged the update meanwhile.
      if (this.readState() !== 'ready') {
        this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    return this.status
  }

  /** Property access through a function defeats TS narrowing of `this.status`. */
  private readState(): UpdateStatus['state'] {
    return this.status.state
  }

  install(): void {
    const u = this.ensureUpdater()
    if (!u || this.status.state !== 'ready') return
    try {
      u.quitAndInstall()
    } catch (err) {
      console.warn('[omega] update install failed:', err)
    }
  }

  current(): UpdateStatus {
    return this.status
  }
}
