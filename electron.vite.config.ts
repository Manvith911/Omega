import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PROD_UI_CSP } from './src/shared/constants'

/**
 * `file://` responses carry no headers, so the CSP the session layer injects
 * cannot reach a packaged build. Baking the same policy into the HTML as a
 * meta tag is what actually protects production.
 *
 * Build only: the dev server needs eval and inline scripts for HMR, so the
 * dev policy is applied as a real header at runtime instead.
 */
function prodCspPlugin(): Plugin {
  // `frame-ancestors` is only honoured in an HTTP header; Chromium logs a
  // warning and ignores it in a meta tag. Dropping it here keeps the packaged
  // console clean, and the header form still carries it for dev.
  const metaCsp = PROD_UI_CSP.split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ')
  const tag = `    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />\n`
  return {
    name: 'omega-prod-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return html.replace('</head>', `${tag}  </head>`)
      },
    },
  }
}

// Must match the Chromium shipped inside Electron 44 (Chromium 152).
// Pinning it exactly lets esbuild emit the tightest possible output.
const CHROME_TARGET = 'chrome152'
const NODE_TARGET = 'node24'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    // Externalizes `dependencies` from package.json. Omega has none, so this
    // only affects `electron` and node builtins — everything else is inlined.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      target: NODE_TARGET,
      minify: 'esbuild',
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron'],
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      target: NODE_TARGET,
      minify: 'esbuild',
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // A sandboxed preload is evaluated as a plain script: it must be CJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), prodCspPlugin()],
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    // Explicit path: the renderer root is src/renderer, so Vite would not
    // find a postcss config sitting at the project root on its own.
    css: { postcss: resolve(__dirname, 'postcss.config.cjs') },
    build: {
      target: CHROME_TARGET,
      minify: 'esbuild',
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          // Eight entries: the chrome UI, the suggestions overlay surface, and
          // the six internal tab pages (settings, history, downloads,
          // extensions, bookmarks, about).
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          history: resolve(__dirname, 'src/renderer/history.html'),
          downloads: resolve(__dirname, 'src/renderer/downloads.html'),
          extensions: resolve(__dirname, 'src/renderer/extensions.html'),
          bookmarks: resolve(__dirname, 'src/renderer/bookmarks.html'),
          about: resolve(__dirname, 'src/renderer/about.html'),
        },
        output: {
          // A function, not an object map: the object form silently produced an
          // empty `react` chunk because the bare specifiers resolved to the
          // same module graph Rollup had already placed elsewhere.
          manualChunks(id: string) {
            if (id.includes('node_modules/@dnd-kit') || id.includes('node_modules/@dnd-kit-sortable')) return 'dnd'
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
            return undefined
          },
        },
      },
    },
  },
})
