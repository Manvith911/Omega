import { create } from 'zustand'
import type { DownloadInfo, Settings, TabMeta, Toast, UiCommand, WindowState } from '@shared/ipc'

export interface ChromeState {
  tabs: TabMeta[]
  activeTabId: number | null
  settings: Settings | null
  windowState: WindowState

  sidebarOpen: boolean
  findOpen: boolean
  /** Count of in-flight downloads — drives the toolbar badge. */
  activeDownloads: number

  toast: Toast | null

  setTabs: (tabs: TabMeta[]) => void
  applyTab: (tab: TabMeta) => void
  removeTab: (tabId: number) => void
  setActiveTab: (tabId: number) => void
  setSettings: (settings: Settings) => void
  setWindowState: (state: WindowState) => void
  setToast: (toast: Toast | null) => void
  setFindOpen: (open: boolean) => void
  setDownloads: (downloads: DownloadInfo[]) => void
  applyCommand: (command: UiCommand) => void
}

export const useChrome = create<ChromeState>((set) => ({
  tabs: [],
  activeTabId: null,
  settings: null,
  windowState: { maximized: false, fullscreen: false, platform: 'win32' },
  sidebarOpen: false,
  findOpen: false,
  activeDownloads: 0,
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
    // Theme follows the persisted setting whenever the chrome re-reads it.
    document.body.classList.toggle('light', settings.theme === 'light')
    return set({ settings })
  },
  setWindowState: (windowState) => set({ windowState }),
  setToast: (toast) => set({ toast }),
  setFindOpen: (findOpen) => set({ findOpen }),
  setDownloads: (downloads) =>
    set({ activeDownloads: downloads.filter((d) => d.state === 'progressing').length }),

  applyCommand: (command) =>
    set((state) => {
      switch (command) {
        case 'toggle-sidebar':
          return { sidebarOpen: !state.sidebarOpen }
        case 'open-find':
          return { findOpen: true }
        case 'focus-omnibox':
        default:
          // open-settings / toggle-history / close-overlays are handled in the
          // main process now — they open real tabs, not chrome overlays.
          return {}
      }
    }),
}))

/** Convenience selector: the currently active tab's metadata. */
export function useActiveTab(): TabMeta | null {
  return useChrome((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
}
