/**
 * Decisive test of the suspension pipeline.
 *
 * Run with a real Electron runtime: `electron .tmp-verify/freeze-probe.cjs`
 *
 * Uses a visible window, because Chromium throttles timers to ~1 Hz in a
 * hidden window and a hidden baseline would prove nothing.
 *
 * Measures four states against a 50ms interval in a WebContentsView:
 *
 *   live      — visible, backgroundThrottling off   (the active tab)
 *   throttled — hidden                              (a background tab)
 *   frozen    — hidden + Page.setWebLifecycleState  (the suspension tier)
 *   resumed   — visible again                       (tab switched back to)
 *
 * Reading the counter requires the renderer to execute JS, which a frozen page
 * will not do, so the frozen delta is bracketed by a sample before freezing and
 * a sample after thawing.
 */

const { app, BrowserWindow, WebContentsView } = require('electron')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0
function check(condition, label, detail = '') {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -> ${detail}` : ''}`)
  if (!condition) failures++
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 900, height: 700 })
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  console.log('\n== view container semantics ==')
  win.contentView.addChildView(view)
  check(win.contentView.children.length === 1, 'addChildView parents the view')
  win.contentView.removeChildView(view)
  check(win.contentView.children.length === 0, 'removeChildView detaches it')
  view.setVisible(true)
  check(win.contentView.children.length === 0, 'setVisible does not re-parent a detached view')
  win.contentView.addChildView(view)
  check(win.contentView.children.length === 1, 're-adding restores it')

  console.log('\n== overlay styling ==')
  let styled = true
  try {
    view.setBackgroundColor('#00000000')
    view.setBorderRadius(12)
  } catch (err) {
    styled = false
    console.log('    error:', err.message)
  }
  check(styled, 'transparent background + native border radius are supported')

  const wc = view.webContents
  await wc.loadURL('about:blank')
  wc.setBackgroundThrottling(false)
  await wc.executeJavaScript('window.__n = 0; window.__t = setInterval(() => { window.__n++ }, 50); "started"', true)
  const sample = async () => Number(await wc.executeJavaScript('window.__n', true))

  // ── live (active tab) ──
  await sleep(500)
  const a1 = await sample()
  await sleep(1000)
  const a2 = await sample()
  const liveTicks = a2 - a1

  // ── throttled (hidden, not frozen) ──
  view.setVisible(false)
  wc.setBackgroundThrottling(true)
  await sleep(400)
  const b1 = await sample()
  await sleep(2000)
  const b2 = await sample()
  const throttledTicks = b2 - b1

  // ── frozen (hidden + CDP lifecycle) ──
  let attached = false
  let froze = false
  try {
    wc.debugger.attach('1.3')
    attached = true
  } catch (err) {
    console.log('    attach error:', err.message)
  }
  const c1 = await sample()
  try {
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
    froze = true
  } catch (err) {
    console.log('    freeze error:', err.message)
  }
  await sleep(2000)
  let thawed = false
  try {
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
    wc.debugger.detach()
    thawed = true
  } catch (err) {
    console.log('    thaw error:', err.message)
  }
  const c2 = await sample()
  const frozenTicks = c2 - c1

  // ── resumed (tab switched back to) ──
  view.setVisible(true)
  wc.setBackgroundThrottling(false)
  await sleep(400)
  const d1 = await sample()
  await sleep(1000)
  const d2 = await sample()
  const resumedTicks = d2 - d1

  console.log('\n== measurements (50ms interval, so ~20 ticks/sec when unthrottled) ==')
  console.log(`  live       1000ms -> ${liveTicks} ticks`)
  console.log(`  throttled  2000ms -> ${throttledTicks} ticks`)
  console.log(`  frozen     2000ms -> ${frozenTicks} ticks`)
  console.log(`  resumed    1000ms -> ${resumedTicks} ticks`)

  console.log('\n== assertions ==')
  check(attached, 'debugger attaches to a sandboxed WebContentsView')
  check(froze, 'Page.setWebLifecycleState({ state: "frozen" }) is accepted on a hidden page')
  check(thawed, 'thaw + detach succeeds')
  check(liveTicks >= 12, 'an active tab runs timers at full speed', `${liveTicks} ticks/s`)
  check(throttledTicks <= 8, 'a hidden tab is throttled by Chromium', `${throttledTicks} ticks in 2s`)
  check(frozenTicks === 0, 'a hidden tab that is frozen runs NO timers at all', `${frozenTicks} ticks in 2s`)
  check(resumedTicks >= 12, 'timers resume when the tab is activated again', `${resumedTicks} ticks/s`)

  await wc.executeJavaScript('clearInterval(window.__t)', true)
  wc.close()
  win.destroy()

  console.log(failures === 0 ? '\nFREEZE PROBE PASSED' : `\n${failures} PROBE CHECK(S) FAILED`)
  app.exit(failures === 0 ? 0 : 1)
})
