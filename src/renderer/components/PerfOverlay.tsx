import { useEffect, useState } from 'react'
import type { PerfSnapshot } from '@shared/ipc'

/**
 * Development-only readout.
 *
 * Guarded by `import.meta.env.DEV` on every render path so the whole component
 * is eliminated from the production bundle rather than merely hidden.
 */
export function PerfOverlay(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let alive = true
    const poll = (): void => {
      void window.omega
        .invoke('perf:snapshot')
        .then((next) => {
          if (alive) setSnapshot(next)
        })
        .catch(() => undefined)
    }
    poll()
    const timer = setInterval(poll, 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (!import.meta.env.DEV || !snapshot) return null

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-50 rounded-lg border border-chrome-border bg-black/75 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-emerald-400 backdrop-blur">
      <div>
        total <span className="text-emerald-200">{snapshot.totalMemMB}</span> MB · ui {snapshot.uiMemMB} MB
      </div>
      <div>
        {snapshot.tabProcesses} tab processes · blocked {snapshot.blockedRequests} (
        {snapshot.blockedHosts} hosts)
      </div>
    </div>
  )
}
