import { useCallback } from 'react'
import { TOOLBAR_HEIGHT } from '@shared/constants'
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

/** Only one full-content panel can be open, because each hides the page view. */
function openPanel(panel: 'sidebar' | 'history' | 'settings' | null): void {
  const state = useChrome.getState()
  useChrome.setState({
    sidebarOpen: panel === 'sidebar' ? !state.sidebarOpen : false,
    historyOpen: panel === 'history' ? !state.historyOpen : false,
    settingsOpen: panel === 'settings' ? !state.settingsOpen : false,
  })
}

export function Toolbar(): React.JSX.Element {
  const tab = useActiveTab()
  const tabId = tab?.id ?? null
  const isLoading = tab?.isLoading ?? false

  const findOpen = useChrome((s) => s.findOpen)
  const sidebarOpen = useChrome((s) => s.sidebarOpen)
  const historyOpen = useChrome((s) => s.historyOpen)
  const settingsOpen = useChrome((s) => s.settingsOpen)
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

        <IconButton label="History" active={historyOpen} onClick={() => openPanel('history')}>
          <Clock className="h-4 w-4" />
        </IconButton>

        <IconButton label="Page assistant" active={sidebarOpen} onClick={() => openPanel('sidebar')}>
          <Sparkles className="h-4 w-4" />
        </IconButton>

        <IconButton label="Settings" active={settingsOpen} onClick={() => openPanel('settings')}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}
