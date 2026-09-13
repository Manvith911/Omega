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
  theme: 'dark',
  downloadsDir: '',
  askDownloadLocation: false,
  forceDark: false,
  proxyMode: 'system',
  proxyServer: '',
  customSearchEngines: [],
  zoomLevels: {},
  permissionRules: [],
} as Settings

/** Freeze timers below this can freeze tabs mid-interaction. */
const MIN_FREEZE_MS = 15_000
const MIN_DISCARD_MS = 60_000

const ENGINE_IDS = new Set(['google', 'duckduckgo', 'bing', 'brave'])

/**
 * A hand-edited or corrupt settings file must not produce NaN timers, a
 * crashed new-tab page, or a broken proxy. Everything user-reachable is
 * validated here; anything invalid falls back to its default.
 */
function sanitize(raw: Partial<Settings>): Settings {
  const s: Settings = { ...DEFAULTS, ...raw }

  if (typeof s.searchEngine !== 'string' || !s.searchEngine) s.searchEngine = DEFAULTS.searchEngine

  if (!Number.isFinite(s.freezeAfterMs) || s.freezeAfterMs < MIN_FREEZE_MS) s.freezeAfterMs = DEFAULTS.freezeAfterMs
  if (!Number.isFinite(s.discardAfterMs) || s.discardAfterMs < MIN_DISCARD_MS) s.discardAfterMs = DEFAULTS.discardAfterMs
  if (s.discardAfterMs < s.freezeAfterMs) s.discardAfterMs = s.freezeAfterMs

  if (s.theme !== 'dark' && s.theme !== 'light') s.theme = DEFAULTS.theme
  if (s.aiProvider !== 'ollama' && s.aiProvider !== 'openai') s.aiProvider = DEFAULTS.aiProvider
  if (typeof s.aiModel !== 'string' || !s.aiModel) s.aiModel = DEFAULTS.aiModel
  if (typeof s.aiEndpoint !== 'string' || !/^https?:\/\//.test(s.aiEndpoint)) s.aiEndpoint = DEFAULTS.aiEndpoint

  if (typeof s.downloadsDir !== 'string') s.downloadsDir = ''
  if (typeof s.proxyServer !== 'string') s.proxyServer = ''
  if (s.proxyMode !== 'system' && s.proxyMode !== 'direct' && s.proxyMode !== 'fixed') s.proxyMode = 'system'
  if (s.proxyMode === 'fixed' && !s.proxyServer.trim()) s.proxyMode = 'system'

  if (!Array.isArray(s.customSearchEngines)) {
    s.customSearchEngines = []
  } else {
    // A custom engine without %s would swallow every query; drop those.
    s.customSearchEngines = s.customSearchEngines.filter(
      (e) => e && typeof e.id === 'string' && typeof e.url === 'string' && e.url.includes('%s'),
    )
    // The active engine must resolve to something; otherwise reset to default.
    if (!ENGINE_IDS.has(s.searchEngine) && !s.customSearchEngines.some((e) => e.id === s.searchEngine)) {
      s.searchEngine = DEFAULTS.searchEngine
    }
  }

  if (typeof s.zoomLevels !== 'object' || s.zoomLevels === null || Array.isArray(s.zoomLevels)) {
    s.zoomLevels = {}
  } else {
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(s.zoomLevels)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 5) clean[k] = v
    }
    s.zoomLevels = clean
  }

  if (!Array.isArray(s.permissionRules)) s.permissionRules = []

  return s
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
      return sanitize({ ...DEFAULTS, ...parsed })
    } catch {
      return { ...DEFAULTS }
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  set(patch: Partial<Settings>): Settings {
    // Writes pass through the same validation as reads.
    this.data = sanitize({ ...this.data, ...patch })
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
