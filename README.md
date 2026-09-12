# Omega

A desktop web browser built on Electron 44, with per-tab process suspension,
network-level ad blocking, and a local-first page assistant.

```bash
npm install          # downloads Electron's ~100 MB binary
npm run dev                 # HMR for the chrome UI, auto-reload for main
npm run build               # typecheck + bundle to out/
npm run build:win           # installer  (also :mac and :linux)
npm run verify              # storage/completions + tab-suspension suites
```

`npm install` downloads Electron's ~50 MB binary in the postinstall step. On
first clone, Electron's install may be skipped by your npm or CI — the app's
postinstall script detects this and downloads the binary itself.
`npm run verify` runs two suites. `verify:storage` exercises the SQLite engine
and URL normalisation on Electron's own Node runtime; `verify:freeze` measures
the suspension tiers against a live interval in a real `WebContentsView` — it
is the only way to confirm the freezing mechanism actually works, because a
failure there is silent.

Zero runtime dependencies. No native modules, no `node-gyp`, no
`electron-rebuild` — storage uses `node:sqlite`, which ships inside Electron's
own Node 24 runtime.

---

## Architecture

Three layers, and the boundary between them is the whole design.

```
┌─ Chrome UI ──────────────── BrowserWindow webContents ─────────────┐
│  React + Tailwind. Tab strip, toolbar, omnibox, side panels.       │
│  Draws only where the page is NOT. Measures its own layout and     │
│  reports the page viewport rect over IPC.                          │
└────────────────────────────────────────────────────────────────────┘
                              │ IPC (contextBridge, allowlisted)
┌─ Browser process ──────────────────────────────────────────────────┐
│  TabManager       WebContentsView lifecycle, z-order, bounds       │
│  AdBlocker        session.webRequest onBeforeRequest               │
│  HistoryStore     node:sqlite + FTS5 (frecency-ranked autocomplete) │
│  SuggestionCtrl   owns omnibox suggestion state                    │
│  AiService        in-page extraction + streaming completion        │
│  OverlayView      a second WebContentsView for the omnibox dropdown│
└────────────────────────────────────────────────────────────────────┘
                              │ native child views
┌─ Web content ──────────────────────────────────────────────────────┐
│  One WebContentsView per tab, own sandboxed renderer, own session  │
└────────────────────────────────────────────────────────────────────┘
```

### Why a second renderer for the dropdown

`contentView.addChildView()` paints **above** the window's own webContents. The
page is therefore always on top of the React chrome. Anything that must float
over a page — the autocomplete dropdown — has to be its own native view, which
is what `OverlayView` is.

The dropdown is *display-only*: keyboard focus stays in the omnibox input, so
arrow keys and Enter are handled by the chrome UI and forwarded to the overlay
as a highlight index. This removes an entire class of focus-stealing bugs.

Side panels take the other route: the renderer reports a narrower viewport and
the page view is resized, so the panel sits in real space rather than on top.
Full-content panels (history, settings) hide the page view entirely.

### The chrome is served from `omega://app`, not `file://`

In production the built chrome UI is served over the internal `omega://`
protocol rather than loaded from disk. This matters for two reasons:

- **`file://` is an opaque origin.** Under a custom scheme the renderer has a
  real origin to scope things to, and relative asset URLs resolve normally.
- **A `file://` load produces no response headers**, so the only CSP available
  there is a `<meta>` tag. Serving it ourselves means the CSP arrives as a real
  header — which is also what Chromium's own security check looks at, so the
  "no Content Security Policy set" warning goes away instead of being papered
  over.

One consequence worth knowing: `protocol.handle` registers on the **default
session only**. The new tab page loads inside a tab view on the
`persist:omega-web` partition, so the same handler is attached to that session
too — an unregistered scheme there fails the navigation outright.

### Process layout

| Concern | Where it runs |
| --- | --- |
| Tab chrome, omnibox, panels | chrome renderer (`defaultSession`) |
| Suggestion list | overlay renderer (same session, second entry) |
| Page content | one sandboxed renderer per tab (`persist:omega-web`) |
| New tab page, chrome assets | `omega://` (handler attached to both sessions) |
| History, blocking, AI calls | browser process |

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a
strict CSP on the chrome. The preload exposes two generic methods —
`invoke`/`on` — gated by an allowlist derived from the channel arrays in
`src/shared/ipc.ts`. A channel that isn't declared there is unreachable from
every renderer, including the overlay, which gets a smaller allowlist still.
There is no `sendSync` anywhere.

---

## Tab suspension

Hidden tabs move through tiers, and each one was measured on a 50 ms interval
inside a real `WebContentsView` (Electron 44 / Chromium 152):

| Tier | Trigger | Timers | Renderer | GPU surface |
| --- | --- | --- | --- | --- |
| **live** | active | 19 / sec | alive | allocated |
| **throttled** | hidden | 1 / sec | alive | allocated |
| **frozen** | hidden 2 min | **0** | alive, DOM intact | released |
| **discarded** | hidden 30 min | — | destroyed | released |

```bash
npm run verify:freeze   # prints the tick counts for each tier
```

Freezing uses `Page.setWebLifecycleState` over the DevTools protocol. Two
things worth knowing, both found by testing rather than reading:

- **Dispatching a synthetic `visibilitychange` event does not stop timers.** It
  only fools libraries that listen for it. The lifecycle state is the real
  mechanism, and it is only reachable over CDP.
- **A visible page cannot be frozen.** Chromium rejects the state transition
  and `sendCommand` resolves anyway, so it fails *silently*. `TabManager` hides
  the view on deactivate and only schedules the freeze after that.

Chromium's own background throttling already does most of the CPU reduction
(19/sec → 1/sec). Freezing is what takes it to exactly zero and releases the
GPU surface; discarding is what returns the RAM.

---

## Performance notes

- **`renderer-process-limit=8`** — beyond ~8 renderers, tabs share processes
  instead of each costing a sandboxed child.
- **`spellcheck: false`** per tab — the hunspell service costs 15–40 MB per
  renderer and most pages don't need it.
- **`electronLanguages: [en-US]`** — drops ~45 MB of Chromium locale packs.
- **IPC is coalesced.** One page load fires a dozen `did-*` events; `TabManager`
  batches tab updates into one flush per frame.
- **All switches are consolidated** in `src/main/app-flags.ts`. Calling
  `appendSwitch` twice with the same key silently discards the first value, so
  there is exactly one append per key.

A dev-only overlay (bottom right) shows live process counts and memory.

---

## Layout contract

The renderer measures its own DOM and reports the rect the page should occupy.
The main process never computes the chrome height, because any disagreement
between the two shows up as a visible overlap or gap. A `ResizeObserver` on the
viewport element covers window resize, sidebar toggle, and the find bar
appearing, with no special cases.

---

## Security posture

- Tab session and UI session are separate partitions, so blocking and CSP apply
  to web content and never to the chrome.
- Permissions are **deny by default** with a small allowlist. Electron's
  defaults grant several of these silently.
- First-party requests are never blocked, even if a domain appears in a rule
  list. This single rule prevents most "the blocker broke my site" reports.
- `<webview>` is rejected globally; popups become tabs.
- The AI assistant receives page text only when asked, and an OpenAI key stays
  in the browser process — it never enters a renderer.

---

## Layout

```
src/
  shared/     ipc.ts (the contract), url.ts, constants.ts   — no Node, no DOM
  preload/    index.ts — the allowlisted contextBridge
  main/       index.ts, tab-manager.ts, tab-freezer.ts, overlay-view.ts,
              sessions.ts, ad-blocker.ts, history-store.ts, suggestions.ts,
              ai.ts, perf.ts, menu.ts, context-menu.ts, newtab-page.ts
  renderer/   index.html + overlay.html (two entries), App.tsx, store.ts,
              components/
```

---

## Packaging & release

The release pre-release-signing story is beyond scope for this README, but
the intent was that `npm run build:win`, `:mac` or `:linux` produces a
platform installer via `electron-builder`, configured in `electron-builder.yml`.

1. **Windows**: produces `omega-<version>-setup.exe` (NSIS). The MSI target is
   available too.
2. **macOS**: produces a DMG plus a signed zip target, and assumes a code
   signing identity with hardened runtime. The `--pub` flag enables GitHub
   release upload once upload tokens are configured.
3. **Linux**: produces an AppImage and a `.deb`.

```bash
npm run build && electron-builder --win --publish never
```

The `electron-builder.yml` already references an Apple entitlements plist in
`build/entitlements.mac.plist`. For a real signed release, code signing material
(`CSC_LINK`, `CSC_KEY_PASSWORD` on Windows; signing identity on macOS) is
configured outside the repo.

---

`test/` contains two verification suites:

- `test/storage.ts` — exercises URL normalisation, SQLite backend, FTS-based
  autocomplete, and session round trips on Electron's own Node runtime.
- `test/freeze-probe.cjs` — measures each suspension tier against a 50 ms
  interval in a real `WebContentsView` and prints the tick counts. The only
  evidence that freezing works, because a failure there is silent.

---

## Known gaps

Honest list of what this does not do yet:

- **Downloads** have no UI. Cancelled and oversized downloads are unhandled.
- **Bookmarks** don't exist. History is the only persistence.
- **Ad-block rules** cover host rules (`||domain^`) and exceptions only.
  Cosmetic rules (`##.banner`) and path/regex patterns need a different matcher.
- **Only the first tab's session is restored**, by URL. Scroll position and form
  state are not preserved, and discarded tabs come back at their current URL.
- **No auto-update.** `electron-builder.yml` produces a zip target for it on
  macOS but no update feed is configured.
- **macOS `open-url`** (opening a link from another app) isn't wired up; only
  command-line URLs are.
