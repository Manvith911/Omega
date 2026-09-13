import { useEffect, useRef } from 'react'
import { PerfOverlay } from './components/PerfOverlay'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { useChrome } from './store'

export default function App(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)

  const sidebarOpen = useChrome((s) => s.sidebarOpen)

  /**
   * History and settings are real tabs now (omega://app/history.html,
   * omega://app/settings.html), so the page view is never hidden by a DOM
   * panel. Only the AI sidebar — which lives beside the page, not over it —
   * remains as chrome-managed UI.
   */
  const pageHidden = false

  // ── Push events from the main process ──
  useEffect(() => {
    const store = useChrome.getState()
    // Actions are stable references in zustand, so calling getState() once is
    // safe and avoids re-subscribing on every state change.
    const unsubscribe = [
      window.omega.on('tab:list', store.setTabs),
      window.omega.on('tab:updated', store.applyTab),
      window.omega.on('tab:closed', store.removeTab),
      window.omega.on('tab:activated', store.setActiveTab),
      window.omega.on('win:state', store.setWindowState),
      window.omega.on('ui:command', store.applyCommand),
      window.omega.on('toast', store.setToast),
      window.omega.on('downloads:updated', store.setDownloads),
    ]
    return () => unsubscribe.forEach((off) => off())
  }, [])

  // ── Initial state ──
  useEffect(() => {
    const store = useChrome.getState()
    void window.omega.invoke('tab:list').then(store.setTabs).catch(() => undefined)
    void window.omega.invoke('settings:get').then(store.setSettings).catch(() => undefined)
    void window.omega.invoke('win:get-state').then(store.setWindowState).catch(() => undefined)
  }, [])

  /**
   * Report the rect the page should occupy.
   *
   * This is measured from the live DOM rather than computed from a constant,
   * because any disagreement between the two shows up as a visible overlap or
   * gap. A ResizeObserver on the viewport element covers every cause of a
   * layout change: window resize, sidebar toggle, find bar appearing.
   */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const report = (): void => {
      const rect = el.getBoundingClientRect()
      void window.omega
        .invoke('view:bounds', {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: !pageHidden,
        })
        .catch(() => undefined)
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [pageHidden])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-chrome-bg">
      <TabStrip />
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {/* The native WebContentsView is positioned over this element. */}
        <div ref={viewportRef} className="relative min-w-0 flex-1">
          {sidebarOpen ? null : null}
        </div>

        {sidebarOpen ? <Sidebar /> : null}
      </div>

      <PerfOverlay />
      <Toast />
    </div>
  )
}
