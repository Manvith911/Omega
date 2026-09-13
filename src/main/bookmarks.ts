/**
 * Bookmarks.
 *
 * Same node:sqlite stance as history: synchronous, no native module, WAL.
 * A handful of rows, read on every navigation to light the toolbar star —
 * local file reads of microseconds.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Bookmark } from '@shared/ipc'

interface BookmarkRow {
  id: number
  url: string
  title: string
  addedAt: number
}

export class BookmarksStore {
  private readonly db: DatabaseSync
  private readonly s: {
    insert: StatementSync
    remove: StatementSync
    all: StatementSync
    byUrl: StatementSync
  }

  constructor(dir: string) {
    if (!dir) throw new Error('BookmarksStore requires a data directory')
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'bookmarks.db'))
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS bookmarks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        url      TEXT NOT NULL UNIQUE,
        title    TEXT NOT NULL DEFAULT '',
        added_at INTEGER NOT NULL
      );
    `)
    this.s = {
      insert: this.db.prepare(
        'INSERT INTO bookmarks (url, title, added_at) VALUES (?, ?, ?) ON CONFLICT(url) DO NOTHING',
      ),
      remove: this.db.prepare('DELETE FROM bookmarks WHERE id = ?'),
      all: this.db.prepare('SELECT id, url, title, added_at AS addedAt FROM bookmarks ORDER BY added_at DESC'),
      byUrl: this.db.prepare('SELECT id, url, title, added_at AS addedAt FROM bookmarks WHERE url = ?'),
    }
  }

  add(url: string, title: string): Bookmark {
    // Only real web pages are bookmarkable.
    if (!/^https?:/.test(url)) throw new Error('Only http(s) pages can be bookmarked')
    this.s.insert.run(url, title || '', Date.now())
    const row = this.s.byUrl.get(url) as unknown as BookmarkRow | undefined
    if (!row) throw new Error('Bookmark not found after insert')
    return row
  }

  remove(id: number): void {
    this.s.remove.run(id)
  }

  /** Lookup by exact URL — drives the toolbar star state. */
  byUrl(url: string): Bookmark | null {
    if (!/^https?:/.test(url)) return null
    const row = this.s.byUrl.get(url) as unknown as BookmarkRow | undefined
    return row ?? null
  }

  all(): Bookmark[] {
    return this.s.all.all() as unknown as Bookmark[]
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}
