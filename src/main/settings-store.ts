import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/ipc'

const DEFAULTS: Settings = {
  searchEngine: 'duckduckgo',
  adBlockEnabled: true,
  // Hidden tab: JS timers still run, but deprioritised.
  // 2 minutes later we stop them entirely, 30 minutes later we drop the renderer.
  freezeAfterMs: 2 * 60 * 1000,
  discardAfterMs: 30 * 60 * 1000,
  restoreSession: true,
  aiProvider: 'ollama',
  aiModel: 'llama3.2',
  aiEndpoint: 'http://127.0.0.1:11434/v1/chat/completions',
}

/**
 * Small, synchronous, and read once at boot. A settings file is a handful of
 * keys — an async API here would add ceremony without buying anything.
 */
export class SettingsStore {
  private readonly file: string
  private data: Settings

  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'settings.json')
    this.data = this.read()
  }

  private read(): Settings {
    try {
      const raw = readFileSync(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<Settings>
      // Merge rather than replace: a settings file written by an older build
      // must not leave newer keys undefined.
      return { ...DEFAULTS, ...parsed }
    } catch {
      return { ...DEFAULTS }
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    this.persist()
    return this.get()
  }

  private persist(): void {
    // Write-then-rename: a crash mid-write leaves the old file intact rather
    // than a truncated one that fails to parse on next boot.
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.warn('[omega] failed to persist settings:', err)
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* nothing else to do */
      }
    }
  }

  /** Where blocklists / cached rule files live. */
  get dataDir(): string {
    return this.dir
  }
}
