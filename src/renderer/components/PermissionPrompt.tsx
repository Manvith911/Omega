import { useEffect, useState } from 'react'

const PERMISSION_LABELS: Record<string, string> = {
  media: 'camera and microphone',
  geolocation: 'your location',
  notifications: 'show notifications',
  midi: 'MIDI devices',
  midiSysex: 'MIDI devices (advanced)',
}

/**
 * Site permission prompt.
 *
 * The main process pauses the permission callback until the user answers
 * here. One prompt at a time (main-process enforced); "Remember" persists
 * the decision per origin so the site is never asked again.
 */
export function PermissionPrompt(): React.JSX.Element | null {
  const [prompt, setPrompt] = useState<{ origin: string; permission: string } | null>(null)
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    return window.omega.on('permission:request', (p) => setPrompt(p))
  }, [])

  const answer = (granted: boolean): void => {
    if (!prompt) return
    // The main process records the decision (origin+permission) and resolves
    // the paused permission callback; the checkbox is advisory UI.
    void window.omega.invoke('permission:answer', granted).catch(() => undefined)
    setPrompt(null)
  }

  if (!prompt) return null

  let host = prompt.origin
  try {
    host = new URL(prompt.origin).host
  } catch {
    /* keep raw */
  }

  return (
    <div className="fixed right-4 top-12 z-[70] w-80 rounded-xl border border-chrome-border bg-chrome-elevated p-3 shadow-2xl">
      <p className="text-[12.5px] leading-snug text-chrome-fg">
        <span className="font-medium">{host}</span> wants to use{' '}
        {PERMISSION_LABELS[prompt.permission] ?? prompt.permission}.
      </p>
      <label className="mt-2 flex items-center gap-2 text-[11px] text-chrome-dim">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this choice for {host}
      </label>
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-chrome-border px-3 py-1 text-[11.5px] text-chrome-muted hover:bg-white/10 hover:text-chrome-fg"
          onClick={() => answer(false)}
        >
          Block
        </button>
        <button
          type="button"
          className="rounded-lg bg-chrome-accent px-3 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
          onClick={() => answer(true)}
        >
          Allow
        </button>
      </div>
    </div>
  )
}
