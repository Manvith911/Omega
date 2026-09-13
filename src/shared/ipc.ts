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
  /** Private tab: ephemeral session, no history writes, no session restore. */
  incognito: boolean
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
  /** Open in the ephemeral incognito session. */
  incognito?: boolean
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

export interface Bookmark {
  id: number
  url: string
  title: string
  addedAt: number
}

/** One persisted origin×permission decision. */
export interface PermissionRule {
  origin: string
  permission: string
  granted: boolean
}

export interface ClearDataOptions {
  history: boolean
  cache: boolean
  cookies: boolean
  /** Also clear localStorage / IndexedDB / service workers (implied by cookies). */
  localStorage?: boolean
  indexedDB?: boolean
  serviceWorkers?: boolean
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready' }
  | { state: 'error'; message: string }

/** Mirrors the main-process download record, minus Electron types. */
export interface DownloadInfo {
  id: string
  url: string
  filename: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  received: number
  total: number
  startedAt: number
  endedAt?: number
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  path: string
  icon?: string
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
  | 'open-bookmarks'
  | 'open-about'
  | 'toggle-fullscreen'
  | 'print'

export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'brave'

/** A user-defined search engine; `url` must contain `%s` for the query. */
export interface CustomSearchEngine {
  id: string
  name: string
  url: string
}

export interface Settings {
  searchEngine: string
  adBlockEnabled: boolean
  /** Idle ms before a hidden tab's JS timers are frozen. */
  freezeAfterMs: number
  /** Idle ms before a frozen tab's renderer is discarded entirely. */
  discardAfterMs: number
  restoreSession: boolean
  aiProvider: 'ollama' | 'openai'
  aiModel: string
  aiEndpoint: string
  /** 'dark' or 'light' — drives the chrome color scheme. */
  theme: 'dark' | 'light'
  /** Where downloads land. Empty = the OS Downloads folder. */
  downloadsDir: string
  /** Ask where to save each file (native Save dialog) instead of auto-saving. */
  askDownloadLocation: boolean
  /** Chromium auto-dark for web content. Takes effect on relaunch. */
  forceDark: boolean
  /** 'system' (OS default), 'direct' (never proxy), or 'fixed' (proxyServer). */
  proxyMode: 'system' | 'direct' | 'fixed'
 /** electron.proxyRules string, e.g. "http=host:8080;https=host:8080". */
  proxyServer: string
  /** User-defined engines, referenced by id from `searchEngine`. */
  customSearchEngines: CustomSearchEngine[]
  /** Per-origin zoom, persisted. Key: origin, value: zoom factor. */
  zoomLevels: Record<string, number>
  /** Persisted per-origin permission decisions. */
  permissionRules: PermissionRule[]
  /** Set after repeated GPU crashes: relaunches with acceleration off. */
  gpuFallback?: boolean
  /** Window geometry + fullscreen/maximized state, restored on launch. */
  windowState?: PersistedWindowState
  /** Absolute folders of extensions to re-load on launch. */
  extensions?: { path: string; enabled: boolean }[]
}

/** Shape saved to settings.json between runs. Optional for older files. */
export interface PersistedWindowState {
  fullscreen: boolean
  maximized: boolean
  /** Normal (non-maximized, non-fullscreen) bounds in DIP. */
  bounds?: { x: number; y: number; width: number; height: number }
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer -> Main  (invoke / promise)
// ─────────────────────────────────────────────────────────────────────────────

export const INVOKE_CHANNELS = [
  // tabs
  'tab:create',
  'page:open',
  'tab:close',
  'tab:close-others',
  'tab:switch',
  'tab:reorder',
  'tab:list',
  'tab:duplicate',
  'tab:reopen',
  'tab:mute',
  'tab:menu',
  'tab:new-private',
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
  'win:toggle-fullscreen',
  // downloads
  'downloads:list',
  'downloads:open',
  'downloads:show',
  'downloads:cancel',
  'downloads:clear-finished',
  'downloads:pick-dir',
  // extensions
  'extensions:list',
  'extensions:load',
  'extensions:remove',
  'extensions:set-enabled',
  // page host (internal pages asking which page they are)
  'page:kind',
  // ai sidebar
  'ai:extract',
  'ai:ask',
  'ai:abort',
  // bookmarks
  'bookmarks:list',
  'bookmarks:add',
  'bookmarks:remove',
  'bookmarks:by-url',
  // browsing data
  'data:clear',
  // app info + updates
  'app:info',
  'updates:check',
  'updates:download',
  'updates:install',
  'updates:status',
  // printing
  'print',
  // permission prompt answer (chrome UI -> main)
  'permission:answer',
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export interface InvokeMap {
  'page:open': { args: [page: 'settings' | 'history' | 'downloads' | 'extensions' | 'bookmarks' | 'about']; result: TabMeta | null }
  'tab:create': { args: [payload?: TabCreatePayload]; result: TabMeta }
  'tab:close': { args: [tabId: number]; result: void }
  'tab:close-others': { args: [tabId: number]; result: void }
  'tab:switch': { args: [tabId: number]; result: void }
  'tab:reorder': { args: [fromIndex: number, toIndex: number]; result: void }
  'tab:list': { args: []; result: TabMeta[] }
  'tab:duplicate': { args: [tabId: number]; result: TabMeta | null }
  'tab:reopen': { args: []; result: TabMeta | null }
  'tab:mute': { args: [tabId: number, muted: boolean]; result: void }
  'tab:menu': { args: [tabId: number, position: { x: number; y: number }]; result: void }
  'tab:new-private': { args: []; result: TabMeta }
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
  'win:toggle-fullscreen': { args: []; result: void }
  'downloads:list': { args: []; result: DownloadInfo[] }
  'downloads:open': { args: [id: string]; result: boolean }
  'downloads:show': { args: [id: string]; result: void }
  'downloads:cancel': { args: [id: string]; result: void }
  'downloads:clear-finished': { args: []; result: void }
  'downloads:pick-dir': { args: []; result: string | null }
  'extensions:list': { args: []; result: ExtensionInfo[] }
  'extensions:load': { args: []; result: ExtensionInfo }
  'extensions:remove': { args: [id: string]; result: boolean }
  'extensions:set-enabled': { args: [id: string, enabled: boolean]; result: ExtensionInfo | null }
  'page:kind': { args: []; result: 'settings' | 'history' | 'downloads' | 'extensions' | 'other' }
  'ai:extract': { args: [tabId: number]; result: PageContent | null }
  'ai:ask': { args: [tabId: number, prompt: string]; result: string }
  'ai:abort': { args: [id: string]; result: void }
  'bookmarks:list': { args: []; result: Bookmark[] }
  'bookmarks:add': { args: [url: string, title: string]; result: Bookmark }
  'bookmarks:remove': { args: [id: number]; result: void }
  'bookmarks:by-url': { args: [url: string]; result: Bookmark | null }
  'data:clear': { args: [options: ClearDataOptions]; result: void }
  'app:info': { args: []; result: AppInfo }
  'updates:check': { args: []; result: UpdateStatus }
  'updates:download': { args: []; result: UpdateStatus }
  'updates:install': { args: []; result: void }
  'updates:status': { args: []; result: UpdateStatus }
  'print': { args: []; result: void }
  'permission:answer': { args: [granted: boolean]; result: void }
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
  'downloads:updated',
  'settings:changed',
  'updates:status',
  'permission:request',
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
  'downloads:updated': DownloadInfo[]
  'settings:changed': Settings
  'updates:status': UpdateStatus
  'permission:request': { origin: string; permission: string }
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
  /**
   * The tab this renderer surface belongs to, or null for chrome surfaces
   * that are not tabs (the main window UI, the suggestions overlay).
   * Delivered via an additional argument on the preload, not discoverable by
   * page scripts through any API.
   */
  readonly tabId: number | null
}
