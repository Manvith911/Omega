/**
 * Real tab freezing.
 *
 * Dispatching a synthetic `visibilitychange` event does NOT stop timers — it
 * only fools libraries that listen for it. The lifecycle state that actually
 * halts `setTimeout`, `setInterval`, `requestAnimationFrame` and in-flight
 * network activity is `Page.setWebLifecycleState`, and it is only reachable
 * over the DevTools protocol.
 *
 * That is fine for a browser: we own the debugger.
 *
 * Cost, stated plainly: attaching the debugger disables the V8 code cache for
 * that renderer and is detectable by page script (`Debugger.enable`). For a
 * background tab that is a good trade — the alternative is a renderer burning
 * CPU on a timer nobody is watching.
 *
 * PRECONDITION: the page must already be *hidden*. Chromium refuses the frozen
 * lifecycle state for a visible page, and `sendCommand` still resolves
 * successfully — so calling this on a foreground tab is a silent no-op, not an
 * error. Verified against Electron 44 (Chromium 152): with a visible page a
 * 50ms interval kept running at 19 ticks/sec after the command.
 *
 * TabManager enforces the ordering by hiding the view on deactivate and only
 * scheduling the freeze afterwards.
 *
 * Measured effect of each tier on that same interval:
 *   active tab            19 ticks/sec
 *   hidden, throttled      1 tick/sec   (Chromium's own background throttling)
 *   hidden, frozen         0 ticks      (this module)
 */

import type { WebContents } from 'electron'

const CDP_VERSION = '1.3'

const isGone = (wc: WebContents): boolean => {
  try {
    return wc.isDestroyed()
  } catch {
    return true
  }
}

/**
 * Stop the renderer's timers and network activity, keeping its DOM intact.
 *
 * Returns false only when the debugger could not be attached or the renderer
 * is gone. A `true` result means the command was accepted — it does NOT prove
 * the page actually froze, because a visible page is silently rejected. See the
 * precondition above.
 */
export async function freeze(wc: WebContents): Promise<boolean> {
  if (isGone(wc)) return false
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach(CDP_VERSION)
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
    return true
  } catch {
    // Mid-navigation, or the renderer went away between the check and the
    // command. Not fatal: the tab simply stays merely-throttled.
    return false
  }
}

/** Resume the lifecycle, then release the debugger. */
export async function thaw(wc: WebContents): Promise<boolean> {
  if (isGone(wc)) return false
  try {
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
      wc.debugger.detach()
      return true
    }
    return false
  } catch {
    // Make sure we never leave a debugger attached to a tab we gave up on.
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      /* renderer is gone */
    }
    return false
  }
}
