/**
 * Clear-browsing-data.
 *
 * Operates on the tab session (and its incognito twin, which usually has
 * nothing to clear). History lives in its own SQLite store and is cleared by
 * the caller through HistoryStore.clear().
 */

import type { Session } from 'electron'
import type { ClearDataOptions } from '@shared/ipc'

export async function clearBrowsingData(tabSessions: Session[], options: ClearDataOptions): Promise<void> {
  await Promise.all(
    tabSessions.map(async (s) => {
      const tasks: Promise<unknown>[] = []
      if (options.cache) {
        tasks.push(s.clearCache())
      }
      const storages: string[] = []
      if (options.cookies) storages.push('cookies')
      if (options.localStorage) storages.push('localstorage')
      if (options.indexedDB) storages.push('indexdb')
      if (options.serviceWorkers) storages.push('serviceworkers', 'cachestorage')
      if (storages.length > 0) {
        tasks.push(s.clearStorageData({ storages: storages as never[] }))
      }
      await Promise.all(tasks)
    }),
  )
}
