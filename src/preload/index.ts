/**
 * The security boundary.
 *
 * `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. This
 * file is the only thing the renderer can reach, and it exposes exactly two
 * generic methods plus an allowlist.
 *
 * The allowlist matters: without it, a generic `invoke` passthrough would let
 * any script running in the UI window call *any* ipcMain handler, including
 * ones added later by a careless commit. With it, a channel that is not
 * declared in src/shared/ipc.ts is unreachable from every renderer.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  INVOKE_CHANNELS,
  EVENT_CHANNELS,
  type EventChannel,
  type EventMap,
  type InvokeChannel,
  type InvokeMap,
  type OmegaApi,
  type WindowState,
} from '@shared/ipc'

const INVOKE_ALLOWLIST = new Set<string>(INVOKE_CHANNELS)
const EVENT_ALLOWLIST = new Set<string>(EVENT_CHANNELS)

/**
 * The overlay surface (omnibox suggestions) is loaded from a second HTML entry
 * into its own WebContentsView. It shares this preload but must not be handed
 * the full chrome API surface — it only ever needs `suggest:select`,
 * `suggest:highlight` and the `suggest:state` event.
 */
const IS_OVERLAY = process.argv.includes('--omega-overlay')

/**
 * Which tab this renderer surface belongs to. TabManager tags every tab view
 * with `--omega-tab=<id>`; chrome surfaces (main window, overlay) have no tag
 * and get null.
 */
const TAB_ID: number | null = (() => {
  const arg = process.argv.find((a) => a.startsWith('--omega-tab='))
  if (!arg) return null
  const id = Number(arg.slice('--omega-tab='.length))
  return Number.isInteger(id) && id > 0 ? id : null
})()

/**
 * Surfaces that render web content must not hold the full chrome API: a
 * compromised page would get tab control, history access and settings writes
 * for free. Tab renderers are gated per call — see isOmegaPageSurface().
 */
const IS_TAB = TAB_ID !== null && !IS_OVERLAY

/** Dev server origin for chrome surfaces, when running under electron-vite dev. */
const DEV_ORIGIN: string | null = (() => {
  const arg = process.argv.find((a) => a.startsWith('--omega-dev-origin='))
  return arg ? arg.slice('--omega-dev-origin='.length) : null
})()

const OVERLAY_ALLOWED_INVOKES = new Set<string>(['suggest:select', 'suggest:highlight', 'suggest:dismiss'])
const OVERLAY_ALLOWED_EVENTS = new Set<string>(['suggest:state'])

/** The reduced surface for Omega's own full pages (settings, history, …). */
const PAGE_ALLOWED_INVOKES = new Set<string>([
  'page:open',
  'page:kind',
  'settings:get',
  'settings:set',
  'history:list',
  'history:delete',
  'history:clear',
  'nav:go',
  'tab:close',
  'downloads:list',
  'downloads:open',
  'downloads:show',
  'downloads:cancel',
  'downloads:clear-finished',
  'extensions:list',
  'extensions:load',
  'extensions:remove',
  'extensions:set-enabled',
  'bookmarks:list',
  'bookmarks:add',
  'bookmarks:remove',
  'bookmarks:by-url',
  'data:clear',
  'app:info',
  'updates:check',
  'updates:download',
  'updates:install',
  'updates:status',
])
const PAGE_ALLOWED_EVENTS = new Set<string>([
  'toast',
  'downloads:updated',
  'settings:changed',
  'updates:status',
])

/**
 * Whether this tab renderer is currently showing an Omega page rather than
 * web content. Evaluated at CALL time on purpose: one renderer hosts the
 * settings page now and https://example.com after a navigation, so a
 * load-time decision cannot be correct. Omega origins are `omega://` in
 * packaged builds and the dev server origin under electron-vite dev.
 */
function isOmegaPageSurface(): boolean {
  try {
    // Sandboxed preloads do have `location` at runtime; the node tsconfig
    // simply does not type DOM globals, hence the narrow cast.
    const href = (globalThis as { location?: { href?: string } }).location?.href ?? ''
    if (!href) return false
    const url = new URL(href)
    if (url.protocol === 'omega:') return true
    if (DEV_ORIGIN && url.origin === DEV_ORIGIN) return true
  } catch {
    /* URL unreadable — treat as web content */
  }
  return false
}

function allowedInvoke(channel: string): boolean {
  if (!INVOKE_ALLOWLIST.has(channel)) return false
  if (IS_OVERLAY) return OVERLAY_ALLOWED_INVOKES.has(channel)
  // Tab renderers: Omega pages get the reduced set, web content gets nothing.
  if (IS_TAB) return isOmegaPageSurface() && PAGE_ALLOWED_INVOKES.has(channel)
  return true
}

function allowedEvent(channel: string): boolean {
  if (!EVENT_ALLOWLIST.has(channel)) return false
  if (IS_OVERLAY) return OVERLAY_ALLOWED_EVENTS.has(channel)
  if (IS_TAB) return isOmegaPageSurface() && PAGE_ALLOWED_EVENTS.has(channel)
  return true
}

const omega: OmegaApi = {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeMap[C]['args']): Promise<InvokeMap[C]['result']> {
    if (!allowedInvoke(channel)) {
      return Promise.reject(new Error(`[omega] blocked IPC invoke: ${channel}`))
    }
    // Never sendSync. Every call is a promise.
    return ipcRenderer.invoke(channel, ...args) as Promise<InvokeMap[C]['result']>
  },

  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void {
    if (!allowedEvent(channel)) {
      throw new Error(`[omega] blocked IPC event: ${channel}`)
    }
    const wrapped = (_event: Electron.IpcRendererEvent, payload: EventMap[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    // Returning the unbind function is what makes this safe inside useEffect.
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },

  platform: process.platform as WindowState['platform'],
  isOverlay: IS_OVERLAY,
  tabId: TAB_ID,
}

contextBridge.exposeInMainWorld('omega', omega)
