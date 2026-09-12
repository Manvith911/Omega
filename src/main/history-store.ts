/**
 * History, sessions, and the autocomplete index.
 *
 * Uses `node:sqlite`, which ships inside Electron's Node 24 runtime. That
 * choice removes the single biggest build headache in an Electron project:
 * there is no native module, so no `node-gyp`, no MSVC/Xcode toolchain, no
 * `electron-rebuild`, and no ABI mismatch crash on a fresh clone.
 *
 * The API is synchronous by design — as was better-sqlite3's. It runs on the
 * browser process's own loop and every query here is a local file read of a
 * few hundred microseconds, so wrapping it in promises would add microtask
 * pressure without buying responsiveness.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { HistoryEntry, Suggestion } from '@shared/ipc'
import { hostOf, prettyUrl, registrableHint } from '@shared/url'

interface HistoryRow {
  url: string
  title: string
  visitCount: number
  visitedAt: number
}

interface ScoredRow extends HistoryRow {
  score: number
}

interface SessionRow {
  tabs_json: string
}

interface IdRow {
  id: number
}

const MS_PER_DAY = 86_400_000
const MAX_SESSION_SNAPSHOTS = 5

export class HistoryStore {
  private readonly db: DatabaseSync
  private readonly s: {
    upsert: StatementSync
    touchTitle: StatementSync
    recent: StatementSync
    top: StatementSync
    remove: StatementSync
    clear: StatementSync
    fts: StatementSync
    substring: StatementSync
    saveSession: StatementSync
    pruneSessions: StatementSync
    loadSession: StatementSync
    countVisits: StatementSync
  }

  constructor(dir: string) {
    if (!dir) throw new Error('HistoryStore requires a data directory')
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'history.db'))

    // WAL keeps autocomplete reads from ever blocking a navigation write.
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -16000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        url         TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL DEFAULT '',
        host        TEXT NOT NULL DEFAULT '',
        visited_at  INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_history_visited ON history (visited_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_count   ON history (visit_count DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5 (
        url,
        title,
        content = 'history',
        content_rowid = 'id',
        tokenize = 'unicode61 remove_diacritics 1'
      );

      CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
        INSERT INTO history_fts (rowid, url, title) VALUES (new.id, new.url, new.title);
      END;

      CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
        INSERT INTO history_fts (history_fts, rowid, url, title)
          VALUES ('delete', old.id, old.url, old.title);
        INSERT INTO history_fts (rowid, url, title) VALUES (new.id, new.url, new.title);
      END;

      CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
        INSERT INTO history_fts (history_fts, rowid, url, title)
          VALUES ('delete', old.id, old.url, old.title);
      END;

      CREATE TABLE IF NOT EXISTS sessions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        tabs_json TEXT NOT NULL,
        saved_at  INTEGER NOT NULL
      );
    `)

    this.s = {
      upsert: this.db.prepare(`
        INSERT INTO history (url, title, host, visited_at, visit_count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(url) DO UPDATE SET
          title       = CASE WHEN excluded.title <> '' THEN excluded.title ELSE history.title END,
          visited_at  = excluded.visited_at,
          visit_count = history.visit_count + 1
      `),

      // Title updates must NOT inflate the visit count: a page that fires
      // page-title-updated twice would otherwise look twice as popular.
      touchTitle: this.db.prepare(
        `UPDATE history SET title = ? WHERE url = ? AND ? <> ''`,
      ),

      recent: this.db.prepare(`
        SELECT url, title, visited_at AS visitedAt, visit_count AS visitCount
        FROM history ORDER BY visited_at DESC LIMIT ?
      `),

      top: this.db.prepare(`
        SELECT url, title, visited_at AS visitedAt, visit_count AS visitCount
        FROM history ORDER BY visit_count DESC, visited_at DESC LIMIT ?
      `),

      remove: this.db.prepare('DELETE FROM history WHERE id = ?'),
      clear: this.db.prepare('DELETE FROM history'),

      // Frecency: popularity decayed by age. A site visited daily outranks a
      // site visited 50 times in 2019 without any manual weighting.
      fts: this.db.prepare(`
        SELECT h.url, h.title, h.visited_at AS visitedAt, h.visit_count AS visitCount
        FROM history_fts f
        JOIN history h ON h.id = f.rowid
        WHERE history_fts MATCH ?
        ORDER BY (h.visit_count * 1.0) / (1.0 + (? - h.visited_at) / ${MS_PER_DAY}.0) DESC
        LIMIT ?
      `),

      // FTS5 tokenises on word boundaries, so "hub" will never match "github.com".
      // Substring matching covers the way people actually type URLs.
      substring: this.db.prepare(`
        SELECT url, title, visited_at AS visitedAt, visit_count AS visitCount
        FROM history
        WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
        ORDER BY (visit_count * 1.0) / (1.0 + (? - visited_at) / ${MS_PER_DAY}.0) DESC
        LIMIT ?
      `),

      saveSession: this.db.prepare('INSERT INTO sessions (tabs_json, saved_at) VALUES (?, ?)'),
      pruneSessions: this.db.prepare(`
        DELETE FROM sessions WHERE id NOT IN (
          SELECT id FROM sessions ORDER BY saved_at DESC LIMIT ${MAX_SESSION_SNAPSHOTS}
        )
      `),
      loadSession: this.db.prepare('SELECT tabs_json FROM sessions ORDER BY saved_at DESC LIMIT 1'),
      countVisits: this.db.prepare('SELECT COUNT(*) AS id FROM history'),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Writes
  // ───────────────────────────────────────────────────────────────────────────

  record(url: string, title: string): void {
    if (!/^https?:/.test(url)) return
    try {
      this.s.upsert.run(url, title || '', hostOf(url), Date.now())
    } catch (err) {
      console.warn('[omega] history write failed:', err)
    }
  }

  touchTitle(url: string, title: string): void {
    if (!title || !/^https?:/.test(url)) return
    try {
      this.s.touchTitle.run(title, url, title)
    } catch {
      /* the URL may not be in history yet; the next navigation will insert it */
    }
  }

  remove(id: number): void {
    this.s.remove.run(id)
  }

  clear(): void {
    // Inside a transaction so the FTS delete triggers fire atomically; a
    // half-cleared FTS index would return phantom autocomplete entries.
    this.db.exec('BEGIN')
    try {
      this.s.clear.run()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  recent(limit = 200): HistoryEntry[] {
    return this.s.recent.all(limit) as unknown as HistoryEntry[]
  }

  visitCount(): number {
    const row = this.s.countVisits.get() as unknown as IdRow | undefined
    return Number(row?.id ?? 0)
  }

  topSites(limit: number): Suggestion[] {
    return (this.s.top.all(limit) as unknown as HistoryRow[]).map((r) => this.toSuggestion(r, 'top'))
  }

  /**
   * The autocomplete hot path. Two indexed queries merged and re-ranked:
   * FTS5 for word-prefix matches, LIKE for literal substrings.
   */
  suggest(query: string, limit = 8): Suggestion[] {
    const trimmed = query.trim()
    if (!trimmed) return this.topSites(limit)

    const now = Date.now()
    const seen = new Map<string, ScoredRow>()

    const collect = (rows: HistoryRow[]): void => {
      for (const row of rows) {
        const score = row.visitCount / (1 + (now - row.visitedAt) / MS_PER_DAY)
        const existing = seen.get(row.url)
        // Prefer whichever hit carries the better title, and keep the best score.
        if (!existing || score > existing.score) {
          seen.set(row.url, { ...row, score: existing ? Math.max(score, existing.score) : score })
        }
      }
    }

    const ftsQuery = this.buildFtsQuery(trimmed)
    if (ftsQuery) {
      try {
        collect(this.s.fts.all(ftsQuery, now, limit) as unknown as HistoryRow[])
      } catch {
        // Malformed FTS expression from unusual input — the LIKE pass still runs.
      }
    }

    const like = `%${this.escapeLike(trimmed)}%`
    try {
      collect(this.s.substring.all(like, like, now, limit) as unknown as HistoryRow[])
    } catch {
      /* nothing else to fall back to */
    }

    return [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => this.toSuggestion(r, 'history'))
  }

  private toSuggestion(row: HistoryRow, kind: Suggestion['kind']): Suggestion {
    const host = hostOf(row.url)
    return {
      url: row.url,
      title: row.title || prettyUrl(row.url) || row.url,
      subtitle: `${registrableHint(host)}${row.visitCount > 1 ? ` · ${row.visitCount} visits` : ''}`,
      visitCount: row.visitCount,
      kind,
    }
  }

  /** Builds an FTS5 prefix expression, stripped of anything FTS treats as syntax. */
  private buildFtsQuery(input: string): string {
    const tokens = input
      .split(/\s+/)
      .map((t) => t.replace(/["*():^]/g, '').trim())
      .filter((t) => t.length > 0)
    if (!tokens.length) return ''
    // Quoting each token makes FTS5 treat it as a literal; the trailing `*`
    // makes it a prefix match. Space between terms is an implicit AND.
    return tokens.map((t) => `"${t}"*`).join(' ')
  }

  /** `_` and `%` are LIKE wildcards; a query containing them must not widen the match. */
  private escapeLike(input: string): string {
    return input.replace(/[\\%_]/g, (c) => `\\${c}`)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Session persistence
  // ───────────────────────────────────────────────────────────────────────────

  saveSession(urls: string[]): void {
    try {
      this.s.saveSession.run(JSON.stringify(urls), Date.now())
      this.s.pruneSessions.run()
    } catch (err) {
      console.warn('[omega] session save failed:', err)
    }
  }

  loadSession(): string[] | null {
    try {
      const row = this.s.loadSession.get() as unknown as SessionRow | undefined
      if (!row) return null
      const parsed: unknown = JSON.parse(row.tabs_json)
      if (!Array.isArray(parsed)) return null
      return parsed.filter((u): u is string => typeof u === 'string')
    } catch {
      return null
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}
