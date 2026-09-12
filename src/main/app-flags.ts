/**
 * Chromium command-line switches.
 *
 * These are one-shot: they are read while the browser process is still
 * booting, so this must run at module load, before `app.whenReady()`.
 *
 * NOTE: `appendSwitch` with a key that was already appended does not merge —
 * the last value wins, and earlier values are silently dropped. That is why
 * every feature list is joined into a single string here rather than being
 * appended from several call sites.
 */

import type { App } from 'electron'

const ENABLED_FEATURES = [
  // Raster tiles on worker threads instead of the browser main thread.
  'CanvasOopRasterization',
  // Zero-copy video paths.
  'VaapiVideoDecodeLinuxGL',
].join(',')

/**
 * Every entry here is a subsystem a browser shell does not need, and each one
 * costs either a background process, a periodic timer, or a network poll.
 */
const DISABLED_FEATURES = [
  'Translate', // full-pages translation service + ICU data
  'OptimizationHints', // periodic "hints" downloads
  'OptimizationGuideModelDownloading', // silently fetches multi-MB ML models
  'MediaRouter', // Cast discovery, LAN multicast
  'GlobalMediaControls',
  'InterestFeedContentSuggestions',
  'CalculateNativeWinOcclusion', // polls window occlusion, burns CPU on Windows
  'AutofillServerCommunication',
  'SegmentationPlatform',
  'UseChromeOSDirectVideoDecoder', // wrong decoder outside ChromeOS
].join(',')

export function applyCommandLineFlags(app: App): void {
  const sw = (key: string, value = ''): void => app.commandLine.appendSwitch(key, value)

  sw('enable-features', ENABLED_FEATURES)
  sw('disable-features', DISABLED_FEATURES)

  // ── GPU ──
  sw('enable-gpu-rasterization')
  sw('enable-zero-copy')
  sw('ignore-gpu-blocklist')
  sw('enable-begin-frame-scheduling')

  // ── RAM: cap concurrent renderer processes. Above this, tabs share
  //    processes instead of each spinning up a ~40 MB sandboxed child.
  sw('renderer-process-limit', '8')

  // ── RAM: stop V8 from lazily growing each renderer's heap toward a
  //    multi-GB ceiling that a single page will never need.
  sw('js-flags', '--max-old-space-size=384 --max-semi-space-size=8')

  // ── Network/CPU: the component updater periodically pulls Widevine,
  //    CRL sets and other payloads we do not use.
  sw('disable-component-update')

  // Dev-only: adds "Purge memory" to the chrome://gpu tooling.
  if (!app.isPackaged) sw('purge-memory-button')
}
