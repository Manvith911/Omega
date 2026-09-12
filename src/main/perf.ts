/**
 * Performance telemetry.
 *
 * "Low memory" is not a design goal you can verify by reading code, so the app
 * exposes a real snapshot per process. The renderer mounts a small overlay in
 * development and the values come straight from Chromium's own accounting —
 * nothing here is estimated.
 */

import { app, type WebContents } from 'electron'
import type { PerfSnapshot, ProcessMetric } from '@shared/ipc'
import type { AdBlockerStats } from './ad-blocker'

export interface PerfSources {
  adBlock: () => AdBlockerStats
  uiWebContents: () => WebContents | null
}

/** Chromium reports bytes; every number we surface is MB. */
const toMB = (bytes: number): number => Math.round(bytes / 1024)

export class PerfMonitor {
  constructor(private readonly sources: PerfSources) {}

  async snapshot(): Promise<PerfSnapshot> {
    const metrics = app.getAppMetrics()

    const processes: ProcessMetric[] = metrics.map((metric) => {
      // `name`/`serviceName` are only present on some process types, so both
      // are treated as optional rather than trusted.
      const named = metric as { name?: string; serviceName?: string }
      return {
        pid: metric.pid,
        type: metric.type,
        label: named.name ?? named.serviceName ?? metric.type,
        cpuPercent: Math.round((metric.cpu?.percentCPUUsage ?? 0) * 10) / 10,
        memMB: toMB(metric.memory?.workingSetSize ?? 0),
      }
    })

    // `getProcessMemoryInfo` exists on node's `process`, not on WebContents.
    // `getOSProcessId` gives us the OS pid, which we then look up in the same
    // Chromium accounting used for every other process.
    let uiMemMB = 0
    const ui = this.sources.uiWebContents()
    if (ui && !ui.isDestroyed()) {
      try {
        const pid = ui.getOSProcessId()
        uiMemMB = toMB(metrics.find((m) => m.pid === pid)?.memory?.workingSetSize ?? 0)
      } catch {
        /* the UI renderer may be mid-teardown */
      }
    }

    const adBlock = this.sources.adBlock()

    return {
      processes: processes.sort((a, b) => b.memMB - a.memMB),
      totalMemMB: processes.reduce((sum, p) => sum + p.memMB, 0),
      tabProcesses: processes.filter((p) => p.type === 'Tab').length,
      uiMemMB,
      blockedRequests: adBlock.blockedRequests,
      blockedHosts: adBlock.blockedHosts,
    }
  }

  /**
   * Dev-only periodic log. Regressions in this line are the fastest signal
   * that a change leaked a renderer or a GPU surface.
   */
  startDevLogging(intervalMs = 20_000): NodeJS.Timeout {
    return setInterval(() => {
      void this.snapshot().then((s) => {
        console.log(
          `[omega:perf] total=${s.totalMemMB}MB ui=${s.uiMemMB}MB tabProcesses=${s.tabProcesses} blocked=${s.blockedRequests}`,
        )
      })
    }, intervalMs)
  }
}
