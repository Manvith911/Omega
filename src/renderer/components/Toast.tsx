import { useEffect } from 'react'
import { useChrome } from '../store'
import { Close, Warning } from './Icons'

const DISMISS_MS = 5000

/**
 * Toasts are pointer-interactive: the close button dismisses immediately
 * instead of waiting out the timer. Two quick toasts still replace each
 * other, but the timer resets, so the second one gets its full 5 seconds.
 */
export function Toast(): React.JSX.Element | null {
  const toast = useChrome((s) => s.toast)
  const setToast = useChrome((s) => s.setToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, setToast])

  if (!toast) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      <div
        className={[
          'animate-in flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[12px] shadow-2xl backdrop-blur',
          toast.kind === 'error'
            ? 'border-red-500/30 bg-red-950/80 text-red-200'
            : 'border-chrome-border bg-chrome-elevated/90 text-chrome-fg',
        ].join(' ')}
      >
        {toast.kind === 'error' ? <Warning className="h-3.5 w-3.5 shrink-0" /> : null}
        {toast.message}
        <button
          type="button"
          aria-label="Dismiss"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-current opacity-50 transition-opacity hover:opacity-100"
          onClick={() => setToast(null)}
        >
          <Close className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
