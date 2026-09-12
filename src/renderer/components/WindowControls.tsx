import { useChrome } from '../store'
import { Close, Minus, Restore, Square } from './Icons'

/**
 * Windows and Linux get `frame: false`, so the OS draws no controls at all.
 * macOS keeps its traffic lights via `titleBarStyle: 'hidden'`, which is why
 * this renders nothing there.
 *
 * These live at the right end of the *tab strip* row, not the toolbar row,
 * matching every other Windows browser: tabs, then new-tab, then window
 * controls, all on one line with the controls flush to the top-right corner.
 *
 * `h-full` rather than a fixed height so the hover highlight fills the whole
 * row and reads as part of the title bar, and `no-drag` so the clicks are not
 * swallowed by the window-drag region behind them.
 */
export function WindowControls(): React.JSX.Element | null {
  const { platform, maximized } = useChrome((s) => s.windowState)

  if (platform === 'darwin') return null

  const button = 'no-drag flex h-full w-[46px] shrink-0 items-center justify-center text-chrome-muted transition-colors'

  return (
    <div className="flex shrink-0 items-stretch self-stretch">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        className={`${button} hover:bg-white/10 hover:text-chrome-fg`}
        onClick={() => void window.omega.invoke('win:minimize')}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        className={`${button} hover:bg-white/10 hover:text-chrome-fg`}
        onClick={() => void window.omega.invoke('win:maximize')}
      >
        {maximized ? <Restore className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>

      <button
        type="button"
        aria-label="Close"
        title="Close"
        className={`${button} hover:bg-red-500 hover:text-white`}
        onClick={() => void window.omega.invoke('win:close')}
      >
        <Close className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
