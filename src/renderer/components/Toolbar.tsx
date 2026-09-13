import { useCallback } from 'react'
import { HISTORY_PAGE_URL, SETTINGS_PAGE_URL, TOOLBAR_HEIGHT } from '@shared/constants'
import { useActiveTab, useChrome } from '../store'
import { FindBar } from './FindBar'
import { ChevronLeft, ChevronRight, Clock, Reload, Settings, ShieldOff, Sparkles, Stop } from './Icons'
import { Omnibox } from './Omnibox'

function IconButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-100',
        disabled
          ? 'cursor-default text-white/12'
          : active
            ? 'bg-white/8 text-chrome-accent'
            : 'text-chrome-muted hover:bg-white/10 hover:text-chrome-fg',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** Sidebar toggles chrome-local; settings and history open as real tabs. */
function openPanel(panel: 'sidebar'): void {
  if (panel === 'sidebar') {
    const open = useChrome.getState().sidebarOpen
    useChrome.setState({ sidebarOpen: !open })
  }
}

function openPage(page: 'settings' | 'history'): void {
  void window.omega.invoke('page:open', page)
}

export function Toolbar(): React.JSX.Element {
  const tab = useActiveTab()
  const tabId = tab?.id ?? null
  const isLoading = tab?.isLoading ?? false

  const findOpen = useChrome((s) => s.findOpen)
  const sidebarOpen = useChrome((s) => s.sidebarOpen)
  const activeUrl = useActiveTab()?.url ?? ''
  const adBlockEnabled = useChrome((s) => s.settings?.adBlockEnabled ?? true)

  const reloadOrStop = useCallback(() => {
    if (tabId === null) return
    if (isLoading) void window.omega.invoke('nav:stop', tabId)
    else void window.omega.invoke('nav:reload', tabId, false)
  }, [isLoading, tabId])

  const toggleAdBlock = useCallback(() => {
    void window.omega
      .invoke('settings:set', { adBlockEnabled: !adBlockEnabled })
      .then((next) => useChrome.getState().setSettings(next))
  }, [adBlockEnabled])

  return (
    <div
      className="drag flex shrink-0 items-center gap-1.5 border-b border-chrome-border bg-chrome-surface px-2"
      style={{ height: TOOLBAR_HEIGHT }}
    >
      <div className="no-drag flex shrink-0 items-center gap-0.5">
        <IconButton
          label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => tabId !== null && void window.omega.invoke('nav:back', tabId)}
        >
          {tab?.canGoBack ? <ChevronLeft className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4 opacity-30" />}
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => tabId !== null && void window.omega.invoke('nav:forward', tabId)}
        >
          {tab?.canGoForward ? <ChevronRight className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 opacity-30" />}
        </IconButton>
        <IconButton label={isLoading ? 'Stop' : 'Reload'} disabled={tabId === null} onClick={reloadOrStop}>
          {isLoading ? <Stop className="h-3.5 w-3.5" /> : <Reload className="h-4 w-4" />}
        </IconButton>
      </div>

      <Omnibox />

      {findOpen ? <FindBar /> : null}

      <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton
          label={adBlockEnabled ? 'Ad & tracker blocker: on' : 'Ad & tracker blocker: off'}
          active={adBlockEnabled}
          onClick={toggleAdBlock}
        >
          <ShieldOff className="h-4 w-4" />
        </IconButton>

        <IconButton label="History" active={activeUrl.startsWith(HISTORY_PAGE_URL)} onClick={() => openPage('history')}>
          <Clock className="h-4 w-4" />
        </IconButton>

        <IconButton label="Page assistant" active={sidebarOpen} onClick={() => openPanel('sidebar')}>
          <Sparkles className="h-4 w-4" />
        </IconButton>

        <IconButton label="Settings" active={activeUrl.startsWith(SETTINGS_PAGE_URL)} onClick={() => openPage('settings')}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}
