/**
 * The IPC contract.
 *
 * Nothing crosses the process boundary that is not declared here. The preload
 * bridge is generic but *allowlisted* against these two arrays, so a channel
 * missing from this file is unreachable from any renderer.
 *
 * All renderer -> main traffic is `invoke` (promise based). There is no
 * `sendSync` anywhere in this codebase.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle phase of a tab. The transitions are:
 *
 *   live ──(hidden)──> throttled ──(freezeAfter)──> frozen ──(discardAfter)──> discarded
 *     ▲                    │                            │                         │
 *     └────────────────────┴────────────────────────────┴─────────────────────────┘
 *                            (on activation)
 */
export type TabLifecycle = 'live' | 'throttled' | 'frozen' | 'discarded'

export interface TabMeta {
  id: number
  url: string
  title: string
  favicon: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isAudible: boolean
  isMuted: boolean
  isActive: boolean
  lifecycle: TabLifecycle
  /** Epoch ms of the last activation — drives frecency of the tab stack itself. */
  lastActiveAt: number
  /** Set when a navigation failed; cleared on the next successful load. */
  error: string | null
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The renderer measures its own layout and reports the rect the page should
 * occupy. `visible: false` is used when a full-content modal (history,
 * settings) is open — native views are always painted above the DOM, so the
 * only way to show a DOM panel over the page is to hide the page view.
 */
export interface ViewRect extends Rect {
  visible: boolean
}

export interface TabCreatePayload {
  url?: string
  /** Open without switching to it. */
  background?: boolean
  /** Insert at a specific position in the strip. Defaults to after the active tab. */
  index?: number
}

export interface NavPayload {
  tabId: number
  url: string
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  visitedAt: number
  visitCount: number
}

export type SuggestionKind = 'url' | 'history' | 'search' | 'top'

export interface Suggestion {
  url: string
  title: string
  subtitle?: string
  visitCount: number
  kind: SuggestionKind
}

export interface SuggestState {
  visible: boolean
  query: string
  items: Suggestion[]
  activeIndex: number
}

export interface FindResult {
  matches: number
  active: number
}

export interface ProcessMetric {
  pid: number
  /** Electron's process type: Browser, Tab, Utility, GPU, ... */
  type: string
  label: string
  cpuPercent: number
  memMB: number
}

export interface PerfSnapshot {
  processes: ProcessMetric[]
  totalMemMB: number
  tabProcesses: number
  uiMemMB: number
  blockedRequests: number
  blockedHosts: number
}

export interface PageContent {
  title: string
  url: string
  /** Whitespace-collapsed, capped at 12k chars. */
  text: string
}

export interface AiChunk {
  id: string
  type: 'token' | 'done' | 'error'
  value: string
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
  platform: 'darwin' | 'win32' | 'linux'
}

export interface Toast {
  kind: 'info' | 'error'
  message: string
}

/**
 * Commands the main process pushes down to the chrome UI — driven by menu
 * accelerators, which fire inside the tab views and therefore cannot be
 * observed by the chrome's own DOM listeners.
 */
export type UiCommand =
  | 'focus-omnibox'
  | 'toggle-sidebar'
  | 'toggle-history'
  | 'open-find'
  | 'close-overlays'
  | 'open-settings'

export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'brave'

export interface Settings {
  searchEngine: SearchEngineId
  adBlockEnabled: boolean
  /** Idle ms before a hidden tab's JS timers are frozen. */
  freezeAfterMs: number
  /** Idle ms before a frozen tab's renderer is discarded entirely. */
  discardAfterMs: number
  restoreSession: boolean
  aiProvider: 'ollama' | 'openai'
  aiModel: string
  aiEndpoint: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer -> Main  (invoke / promise)
// ─────────────────────────────────────────────────────────────────────────────

export const INVOKE_CHANNELS = [
  // tabs
  'tab:create',
  'tab:close',
  'tab:close-others',
  'tab:switch',
  'tab:reorder',
  'tab:list',
  'tab:duplicate',
  'tab:reopen',
  'tab:mute',
  // navigation
  'nav:go',
  'nav:back',
  'nav:forward',
  'nav:reload',
  'nav:stop',
  'nav:home',
  'nav:zoom',
  // layout sync
  'view:bounds',
  // omnibox suggestions
  'suggest:query',
  'suggest:highlight',
  'suggest:dismiss',
  'suggest:select',
  // history
  'history:list',
  'history:delete',
  'history:clear',
  // find in page
  'find:start',
  'find:next',
  'find:stop',
  // telemetry
  'perf:snapshot',
  // config
  'settings:get',
  'settings:set',
  // window chrome
  'win:get-state',
  'win:minimize',
  'win:maximize',
  'win:close',
  // ai sidebar
  'ai:extract',
  'ai:ask',
  'ai:abort',
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export interface InvokeMap {
  'tab:create': { args: [payload?: TabCreatePayload]; result: TabMeta }
  'tab:close': { args: [tabId: number]; result: void }
  'tab:close-others': { args: [tabId: number]; result: void }
  'tab:switch': { args: [tabId: number]; result: void }
  'tab:reorder': { args: [fromIndex: number, toIndex: number]; result: void }
  'tab:list': { args: []; result: TabMeta[] }
  'tab:duplicate': { args: [tabId: number]; result: TabMeta | null }
  'tab:reopen': { args: []; result: TabMeta | null }
  'tab:mute': { args: [tabId: number, muted: boolean]; result: void }
  'nav:go': { args: [payload: NavPayload]; result: void }
  'nav:back': { args: [tabId: number]; result: void }
  'nav:forward': { args: [tabId: number]; result: void }
  'nav:reload': { args: [tabId: number, ignoreCache?: boolean]; result: void }
  'nav:stop': { args: [tabId: number]; result: void }
  'nav:home': { args: [tabId: number]; result: void }
  'nav:zoom': { args: [tabId: number, direction: 'in' | 'out' | 'reset']; result: number }
  'view:bounds': { args: [rect: ViewRect]; result: void }
  'suggest:query': { args: [query: string, rect: Rect]; result: SuggestState }
  'suggest:highlight': { args: [activeIndex: number]; result: void }
  'suggest:dismiss': { args: []; result: void }
  'suggest:select': { args: [index: number]; result: void }
  'history:list': { args: [limit?: number]; result: HistoryEntry[] }
  'history:delete': { args: [id: number]; result: void }
  'history:clear': { args: []; result: void }
  'find:start': { args: [text: string]; result: FindResult }
  'find:next': { args: [text: string, forward: boolean]; result: FindResult }
  'find:stop': { args: []; result: void }
  'perf:snapshot': { args: []; result: PerfSnapshot }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }
  'win:get-state': { args: []; result: WindowState }
  'win:minimize': { args: []; result: void }
  'win:maximize': { args: []; result: void }
  'win:close': { args: []; result: void }
  'ai:extract': { args: [tabId: number]; result: PageContent | null }
  'ai:ask': { args: [tabId: number, prompt: string]; result: string }
  'ai:abort': { args: [id: string]; result: void }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main -> Renderer  (push events)
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_CHANNELS = [
  'tab:list',
  'tab:updated',
  'tab:closed',
  'tab:activated',
  'nav:navigated',
  'suggest:state',
  'suggest:commit',
  'find:result',
  'perf:tick',
  'win:state',
  'ai:chunk',
  'toast',
  'ui:command',
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface EventMap {
  'tab:list': TabMeta[]
  'tab:updated': TabMeta
  'tab:closed': number
  'tab:activated': number
  'nav:navigated': { tabId: number; url: string }
  /** Pushed to the overlay surface only. */
  'suggest:state': SuggestState
  /** Pushed to the chrome UI: the overlay acted on the current list. */
  'suggest:commit': { index: number }
  'find:result': FindResult
  'perf:tick': PerfSnapshot
  'win:state': WindowState
  'ai:chunk': AiChunk
  'toast': Toast
  'ui:command': UiCommand
}

// ─────────────────────────────────────────────────────────────────────────────
// The surface exposed on `window.omega` by the preload bridge
// ─────────────────────────────────────────────────────────────────────────────

export interface OmegaApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeMap[C]['args']
  ): Promise<InvokeMap[C]['result']>

  /** Subscribe to a push channel. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void

  /** Static facts about the host, available without an IPC round trip. */
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly isOverlay: boolean
}
