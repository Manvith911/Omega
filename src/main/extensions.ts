/**
 * Extension support.
 *
 * Electron ships Chromium's extension runtime, so Manifest V3 content
 * scripts, service workers and popup pages genuinely work — with one honest
 * limitation: there is no Chrome Web Store integration in Electron, so the
 * "Add to Chrome" button on the store cannot work. The supported flow is the
 * developer flow Chrome also offers: load an unpacked extension folder (or a
 * .crx unpacked by the user), which covers uBlock Origin Lite, Dark Reader,
 * Stylus, Bitwarden and most other popular MV3 extensions built from source.
 *
 * Enabled state is persisted by folder path in settings.json. Toggling off
 * unloads the extension from the session; toggling on loads it again. Disabled
 * extensions are loaded once at startup *only* to discover their stable id,
 * then immediately unloaded — this is what makes the id persistable.
 */

import { type Session } from 'electron'

export interface ExtensionRecord {
  id: string
  name: string
  version: string
  /** Description, may be empty. */
  description: string
  enabled: boolean
  /** Absolute folder the extension was loaded from. */
  path: string
  /** Small icon as data URL, when the extension ships one. */
  icon?: string
}

/** What settings.json persists per extension. */
export interface ExtensionEntry {
  path: string
  enabled: boolean
}

interface Tracked {
  id: string
  path: string
  enabled: boolean
  /** Snapshot taken while loaded, so disabled entries can still render. */
  info: Pick<ExtensionRecord, 'name' | 'version' | 'description' | 'icon'>
}

export class ExtensionsManager {
  /** id → live Chromium extension (present only while enabled). */
  private readonly loaded = new Map<string, Electron.Extension>()
  /** id → tracked record, for enabled and disabled extensions alike. */
  private readonly tracked = new Map<string, Tracked>()

  constructor(private readonly session: Session) {}

  /**
   * Re-loads every extension folder recorded in settings. A folder that has
   * been deleted since the last run is skipped with a warning, not fatal.
   */
  async restore(entries: ExtensionEntry[]): Promise<ExtensionRecord[]> {
    // Dedupe by path — a corrupted settings file could list one twice.
    const seen = new Set<string>()
    for (const entry of entries) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      try {
        const ext = await this.session.loadExtension(entry.path, { allowFileAccess: true })
        if (entry.enabled) {
          this.loaded.set(ext.id, ext)
        } else {
          // Loaded only to resolve the id; unload right away.
          try {
            this.session.removeExtension(ext.id)
          } catch {
            /* ignore */
          }
        }
        this.tracked.set(ext.id, {
          id: ext.id,
          path: ext.path,
          enabled: entry.enabled,
          info: snapshot(ext),
        })
      } catch (err) {
        console.warn('[omega] failed to restore extension from', entry.path, err)
      }
    }
    return this.all()
  }

  async load(path: string): Promise<ExtensionRecord> {
    if (this.trackedHasPath(path)) throw new Error('That extension is already loaded')

    const ext = await this.session.loadExtension(path, { allowFileAccess: true })
    this.loaded.set(ext.id, ext)
    this.tracked.set(ext.id, { id: ext.id, path: ext.path, enabled: true, info: snapshot(ext) })
    return this.toRecord(this.tracked.get(ext.id) as Tracked)
  }

  all(): ExtensionRecord[] {
    return [...this.tracked.values()].map((t) => this.toRecord(t))
  }

  async setEnabled(id: string, enabled: boolean): Promise<ExtensionRecord | null> {
    const t = this.tracked.get(id)
    if (!t || t.enabled === enabled) return t ? this.toRecord(t) : null

    if (enabled) {
      try {
        const ext = await this.session.loadExtension(t.path, { allowFileAccess: true })
        this.loaded.set(ext.id, ext)
        t.info = snapshot(ext)
      } catch (err) {
        console.warn('[omega] failed to enable extension', t.path, err)
        return null
      }
    } else {
      try {
        await this.session.removeExtension(id)
      } catch {
        /* already unloaded — treat as success */
      }
      this.loaded.delete(id)
    }
    t.enabled = enabled
    return this.toRecord(t)
  }

  async remove(id: string): Promise<boolean> {
    const t = this.tracked.get(id)
    if (!t) return false
    if (this.loaded.has(id)) {
      try {
        await this.session.removeExtension(id)
      } catch {
        /* fall through — the record is dropped regardless */
      }
      this.loaded.delete(id)
    }
    this.tracked.delete(id)
    return true
  }

  /** Settings entries matching the current tracked state, for persistence. */
  entries(): ExtensionEntry[] {
    return [...this.tracked.values()].map((t) => ({ path: t.path, enabled: t.enabled }))
  }

  private trackedHasPath(path: string): boolean {
    return [...this.tracked.values()].some((t) => t.path === path)
  }

  private toRecord(t: Tracked): ExtensionRecord {
    return { id: t.id, enabled: t.enabled, path: t.path, ...t.info }
  }
}

function snapshot(ext: Electron.Extension): Tracked['info'] {
  const icon = pickIcon(ext.manifest)
  return {
    name: ext.name ?? 'Unnamed extension',
    version: ext.version ?? '0.0.0',
    description: ext.manifest?.['description'] ?? '',
    ...(icon ? { icon } : {}),
  }
}

function pickIcon(manifest: Record<string, unknown> | undefined): string | undefined {
  if (!manifest) return undefined
  const icons = manifest['icons'] as Record<string, string> | undefined
  if (!icons) return undefined
  // Largest key wins; keys are sizes as strings.
  const best = Object.keys(icons).sort((a, b) => Number(b) - Number(a))[0]
  return best ? icons[best] : undefined
}
