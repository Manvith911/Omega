import { create } from 'zustand'
import type { Settings, TabMeta, Toast, UiCommand, WindowState } from '@shared/ipc'

export interface ChromeState {
  tabs: TabMeta[]
  activeTabId: number | null
  settings: Settings | null
  windowState: WindowState

  // Panels. Only one full-content panel can be open at a time, because each
  // one hides the native page view.
  sidebarOpen: boolean
  historyOpen: boolean
  settingsOpen: boolean
  findOpen: boolean

  toast: Toast | null

  setTabs: (tabs: TabMeta[]) => void
  applyTab: (tab: TabMeta) => void
  removeTab: (tabId: number) => void
  setActiveTab: (tabId: number) => void
  setSettings: (settings: Settings) => void
  setWindowState: (state: WindowState) => void
  setToast: (toast: Toast | null) => void
  setFindOpen: (open: boolean) => void
  applyCommand: (command: UiCommand) => void
}

export const useChrome = create<ChromeState>((set) => ({
  tabs: [],
  activeTabId: null,
  settings: null,
  windowState: { maximized: false, fullscreen: false, platform: 'win32' },
  sidebarOpen: false,
  historyOpen: false,
  settingsOpen: false,
  findOpen: false,
  toast: null,

  setTabs: (tabs) =>
    set({
      tabs,
      // The main process is authoritative about which tab is active; never
      // infer it from array position.
      activeTabId: tabs.find((t) => t.isActive)?.id ?? tabs[0]?.id ?? null,
    }),

  applyTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tab.id ? tab : t)),
    })),

  removeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      return {
        tabs,
        activeTabId: state.activeTabId === tabId ? (tabs.find((t) => t.isActive)?.id ?? tabs[0]?.id ?? null) : state.activeTabId,
      }
    }),

  setActiveTab: (tabId) =>
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isActive: true } : t)),
    })),

  setSettings: (settings) => {
    document.body.classList.toggle('light', settings.theme === 'light')
    return set({ settings })
  },
  setWindowState: (windowState) => set({ windowState }),
  setToast: (toast) => set({ toast }),
  setFindOpen: (findOpen) => set({ findOpen }),

  applyCommand: (command) =>
    set((state) => {
      switch (command) {
        case 'toggle-sidebar':
          return { sidebarOpen: !state.sidebarOpen, historyOpen: false, settingsOpen: false }
        case 'toggle-history':
          return { historyOpen: !state.historyOpen, sidebarOpen: false, settingsOpen: false }
        case 'open-settings':
          return { settingsOpen: true, historyOpen: false, sidebarOpen: false }
        case 'open-find':
          return { findOpen: true }
        case 'close-overlays':
          return { historyOpen: false, settingsOpen: false, sidebarOpen: false, findOpen: false }
        case 'focus-omnibox':
        default:
          return {}
      }
    }),
}))

/** Convenience selector: the currently active tab's metadata. */
export function useActiveTab(): TabMeta | null {
  return useChrome((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
}
