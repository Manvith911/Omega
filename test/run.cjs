/**
 * Test runner for the storage/completions suite.
 *
 * `storage.ts` is TypeScript that imports from `src/`, so it is bundled with
 * esbuild (already present as a Vite dependency) and then executed on
 * *Electron's* Node runtime rather than the system one.
 *
 * That last part matters: `node:sqlite` needs Node 22.5+, and running against
 * Electron's runtime is the only way to be sure the tests exercise the same
 * SQLite build the app will actually use.
 *
 * Cross-platform: setting an env var inline in an npm script does not work in
 * cmd.exe on Windows, so the environment is passed through execFileSync here.
 */

const { execFileSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const esbuild = require('esbuild')

const root = join(__dirname, '..')
const outfile = join(__dirname, '.storage.cjs')

mkdirSync(__dirname, { recursive: true })

esbuild.buildSync({
  entryPoints: [join(__dirname, 'storage.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  // Mirrors the alias in electron.vite.config.ts so test imports resolve the
  // same way the app's do.
  alias: { '@shared': join(root, 'src', 'shared') },
  outfile,
  logLevel: 'warning',
})

// `require('electron')` from plain Node resolves to the path of the binary.
const electronBinary = require('electron')

execFileSync(electronBinary, [outfile], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
