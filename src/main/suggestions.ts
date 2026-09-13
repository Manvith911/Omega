/**
 * Omnibox suggestion engine.
 *
 * Ordering is deliberate and mirrors what makes a browser's address bar feel
 * fast: an address you can go to right now first, then your own history ranked
 * by frecency, then the escape hatch of a web search.
 *
 * The controller owns the suggestion state, not the renderer. The chrome UI
 * sends keystrokes; this decides what the list is and pushes it straight to
 * the overlay surface. That keeps one source of truth for what is displayed.
 */

import { SUGGESTION_MAX_ROWS, SEARCH_ENGINES } from '@shared/constants'
import type { Rect, SuggestState, Suggestion } from '@shared/ipc'
import type { HistoryStore } from './history-store'
import type { SettingsStore } from './settings-store'
import type { OverlayView } from './overlay-view'
import { activeEngineTemplate, isProbablyUrl, searchUrlFor, toNavigationUrl } from '@shared/url'

const EMPTY: SuggestState = { visible: false, query: '', items: [], activeIndex: -1 }

export class SuggestionController {
  private state: SuggestState = { ...EMPTY }

  constructor(
    private readonly history: HistoryStore,
    private readonly settings: SettingsStore,
    private readonly overlay: OverlayView,
  ) {}

  get current(): SuggestState {
    return this.state
  }

  update(query: string, anchor: Rect): SuggestState {
    const items = this.build(query)
    const visible = items.length > 0 && query.trim().length > 0

    this.state = { visible, query, items, activeIndex: visible ? 0 : -1 }

    if (visible) this.overlay.show(this.state, anchor)
    else this.overlay.hide()

    return this.state
  }

  highlight(index: number): void {
    if (!this.state.visible) return
    const clamped = Math.max(-1, Math.min(index, this.state.items.length - 1))
    if (clamped === this.state.activeIndex) return
    this.state = { ...this.state, activeIndex: clamped }
    this.overlay.send(this.state)
  }

  dismiss(): void {
    this.state = { ...this.state, visible: false, activeIndex: -1 }
    this.overlay.hide()
  }

  /** Resolves an index to a URL, hiding the overlay. Returns null if gone. */
  take(index: number): string | null {
    const item = this.state.items[index]
    this.dismiss()
    return item?.url ?? null
  }

  private build(query: string): Suggestion[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    const s = this.settings.get()
    const template = activeEngineTemplate(s.searchEngine, s.customSearchEngines)
    const out: Suggestion[] = []
    const seen = new Set<string>()

    // 1. A literal address, if what they typed could be one.
    if (isProbablyUrl(trimmed)) {
      const url = toNavigationUrl(trimmed, template)
      out.push({ url, title: trimmed, subtitle: 'Open address', visitCount: 0, kind: 'url' })
      seen.add(url)
    }

    // 2. Their own history, frecency ranked.
    for (const hit of this.history.suggest(trimmed, SUGGESTION_MAX_ROWS)) {
      if (seen.has(hit.url)) continue
      seen.add(hit.url)
      out.push(hit)
    }

    // 3. Always leave a way to search.
    const searchUrl = searchUrlFor(trimmed, template)
    if (!seen.has(searchUrl)) {
      const engineName =
        SEARCH_ENGINES[s.searchEngine as keyof typeof SEARCH_ENGINES]?.name ??
        s.customSearchEngines.find((e) => e.id === s.searchEngine)?.name ??
        'Search'
      out.push({
        url: searchUrl,
        title: `Search for "${trimmed}"`,
        subtitle: engineName,
        visitCount: 0,
        kind: 'search',
      })
    }

    return out.slice(0, SUGGESTION_MAX_ROWS)
  }
}
