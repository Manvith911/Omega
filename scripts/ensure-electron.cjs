#!/usr/bin/env node
/**
 * Guarantees the Electron binary is present after install.
 *
 * npm 12 disables dependency install scripts by default, so `electron` installs
 * as a package but its `postinstall` never runs and the ~100 MB binary is never
 * downloaded. Every later command then fails with a confusing error, and a CI
 * runner has no way to recover on its own.
 *
 * The `allowScripts` allowlist in package.json is the sanctioned fix, but it is
 * not honoured uniformly across npm versions and config combinations (verified:
 * it did not take effect here). The project's own lifecycle scripts are not
 * gated by that policy, so doing the download from here works regardless of
 * which npm is running.
 *
 * Idempotent and fast when the binary already exists.
 */

const { existsSync, readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const electronDir = join(__dirname, '..', 'node_modules', 'electron')

// Nothing installed yet (e.g. a partial install) — there is nothing to fix.
if (!existsSync(electronDir)) process.exit(0)

/**
 * `path.txt` holds the binary's location *relative to dist/*, e.g. `electron.exe`
 * on Windows or `Electron.app/Contents/MacOS/Electron` on macOS.
 */
function binaryPresent() {
  const pathTxt = join(electronDir, 'path.txt')
  if (!existsSync(pathTxt)) return false
  const relative = readFileSync(pathTxt, 'utf-8').trim()
  return relative.length > 0 && existsSync(join(electronDir, 'dist', relative))
}

if (binaryPresent()) process.exit(0)

console.log('[omega] Electron binary missing — downloading it (one time).')

try {
  execFileSync(process.execPath, [join(electronDir, 'install.js')], {
    stdio: 'inherit',
    cwd: electronDir,
  })
} catch {
  console.error(
    '\n[omega] Could not download the Electron binary.\n' +
      '  Check your network or proxy, then retry: node node_modules/electron/install.js\n',
  )
  process.exit(1)
}

if (!binaryPresent()) {
  console.error('[omega] Electron installed but its binary is still missing.')
  process.exit(1)
}

console.log('[omega] Electron ready.')
