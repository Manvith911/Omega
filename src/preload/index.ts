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

const OVERLAY_ALLOWED_INVOKES = new Set<string>(['suggest:select', 'suggest:highlight', 'suggest:dismiss'])
const OVERLAY_ALLOWED_EVENTS = new Set<string>(['suggest:state'])

function allowedInvoke(channel: string): boolean {
  if (!INVOKE_ALLOWLIST.has(channel)) return false
  return IS_OVERLAY ? OVERLAY_ALLOWED_INVOKES.has(channel) : true
}

function allowedEvent(channel: string): boolean {
  if (!EVENT_ALLOWLIST.has(channel)) return false
  return IS_OVERLAY ? OVERLAY_ALLOWED_EVENTS.has(channel) : true
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
}

contextBridge.exposeInMainWorld('omega', omega)
