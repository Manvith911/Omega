/**
 * Inline SVG icons.
 *
 * Hand-written rather than pulled from an icon package: the whole set is under
 * 4 KB of source, ships in the main bundle with zero runtime cost, and avoids
 * a dependency whose tree-shaking would need verifying on every upgrade.
 *
 * Stroke-based, 16px grid, `currentColor` so Tailwind's text color drives them.
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const Base = ({ children, ...props }: IconProps & { children: React.ReactNode }): React.JSX.Element => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props}>
    {children}
  </svg>
)

export const ChevronLeft = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M10 3.5 5.5 8l4.5 4.5" {...stroke} />
  </Base>
)

export const ChevronRight = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" {...stroke} />
  </Base>
)

export const Reload = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" {...stroke} />
    <path d="M13 2v3.2H9.8" {...stroke} />
  </Base>
)

export const Stop = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.8" fill="currentColor" />
  </Base>
)

export const Plus = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 3v10M3 8h10" {...stroke} strokeWidth={2} />
  </Base>
)

export const Close = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M4 4l8 8M12 4l-8 8" {...stroke} strokeWidth={2} />
  </Base>
)

export const Lock = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" {...stroke} />
    <path d="M5.8 7V5.2a2.2 2.2 0 0 1 4.4 0V7" {...stroke} />
  </Base>
)

export const Warning = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 2.6 14.2 13H1.8L8 2.6Z" {...stroke} />
    <path d="M8 7v2.6M8 11.4v.2" {...stroke} />
  </Base>
)

export const Globe = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="8" cy="8" r="5.6" {...stroke} />
    <path d="M2.6 8h10.8M8 2.4c1.7 1.7 1.7 9.5 0 11.2M8 2.4c-1.7 1.7-1.7 9.5 0 11.2" {...stroke} />
  </Base>
)

export const Search = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="7.2" cy="7.2" r="4.4" {...stroke} />
    <path d="M10.6 10.6 14 14" {...stroke} />
  </Base>
)

export const Clock = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="8" cy="8" r="5.6" {...stroke} />
    <path d="M8 4.6V8l2.4 1.6" {...stroke} />
  </Base>
)

export const Sparkles = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M6.2 2.4 7.3 5.3 10.2 6.4 7.3 7.5 6.2 10.4 5.1 7.5 2.2 6.4 5.1 5.3z" {...stroke} />
    <path d="M11.6 9.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" {...stroke} />
  </Base>
)

export const PanelRight = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.8" {...stroke} />
    <path d="M9.6 3.2v9.6" {...stroke} />
  </Base>
)

export const Minus = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M3.5 8h9" {...stroke} strokeWidth={1.6} />
  </Base>
)

export const Square = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1.2" {...stroke} strokeWidth={1.5} />
  </Base>
)

export const Restore = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <rect x="3" y="5.4" width="7.6" height="7.6" rx="1.2" {...stroke} strokeWidth={1.5} />
    <path d="M5.6 5.4V4.2A1.2 1.2 0 0 1 6.8 3h5a1.2 1.2 0 0 1 1.2 1.2v5a1.2 1.2 0 0 1-1.2 1.2h-1.2" {...stroke} strokeWidth={1.5} />
  </Base>
)

export const Volume = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3z" {...stroke} />
    <path d="M10.4 5.8a3 3 0 0 1 0 4.4M12.4 4.2a5.4 5.4 0 0 1 0 7.6" {...stroke} />
  </Base>
)

export const VolumeMuted = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3z" {...stroke} />
    <path d="M10.6 6.4l3 3.2M13.6 6.4l-3 3.2" {...stroke} />
  </Base>
)

/** Frozen: renderer alive, timers stopped. */
export const Snowflake = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 2v12M3 5l10 6M13 5 3 11" {...stroke} strokeWidth={1.3} />
  </Base>
)

/** Discarded: renderer gone entirely. Paired with a dimmed tab. */
export const Moon = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M12.8 9.6A5.4 5.4 0 0 1 6.4 3.2a5.6 5.6 0 1 0 6.4 6.4Z" {...stroke} />
  </Base>
)

export const Trash = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M3 4.4h10M6.4 4.4V3.2h3.2v1.2M4.4 4.4l.6 8.2h6l.6-8.2" {...stroke} />
  </Base>
)

export const Sun = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="8" cy="8" r="3" {...stroke} />
    <path d="M8 1.8v.8M8 13.4v.8M1.8 8h.8M13.4 8h.8M3 3l.8.8M12.2 12.2l.8.8M3 13l.8-.8M12.2 3.8l.8-.8" {...stroke} strokeWidth={1.4} />
  </Base>
)

export const Settings = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="8" cy="8" r="2.2" {...stroke} />
    <path
      d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"
      {...stroke}
    />
  </Base>
)

export const ShieldOff = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 2.2 3.4 4v4c0 2.8 1.9 4.9 4.6 5.8 2.7-.9 4.6-3 4.6-5.8V4L8 2.2Z" {...stroke} />
    <path d="M6 8h4" {...stroke} />
  </Base>
)

export const ArrowUp = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 13V3.6M4.2 7.4 8 3.6l3.8 3.8" {...stroke} />
  </Base>
)

export const ArrowDown = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 3v9.4M4.2 8.6 8 12.4l3.8-3.8" {...stroke} />
  </Base>
)

export const Folder = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M2.2 4.6A1.4 1.4 0 0 1 3.6 3.2h2.9l1.4 1.6h4.5a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4V4.6Z" {...stroke} />
  </Base>
)

export const Puzzle = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path
      d="M6.6 2.8a1.5 1.5 0 0 1 3 0v.9h2.1a.9.9 0 0 1 .9.9v2.1h.9a1.5 1.5 0 0 1 0 3h-.9v2.1a.9.9 0 0 1-.9.9H9.6v-.9a1.5 1.5 0 0 0-3 0v.9H4.5a.9.9 0 0 1-.9-.9V9.7h-.9a1.5 1.5 0 0 1 0-3h.9V4.6a.9.9 0 0 1 .9-.9h2.1v-.9Z"
      {...stroke}
    />
  </Base>
)

export const Star = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path
      d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 1.9.7-4.2-3.1-3 4.3-.6L8 1.8Z"
      {...stroke}
    />
  </Base>
)

export const StarFilled = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.6l-3.8 1.9.7-4.2-3.1-3 4.3-.6L8 1.8Z" fill="currentColor" stroke="none" />
  </Base>
)

export const EyeOff = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M3 3l10 10M6.2 6.3A5.6 5.6 0 0 0 2.4 8s2.2 3.8 5.6 3.8c.8 0 1.6-.2 2.3-.5M9.4 4.4a5.7 5.7 0 0 1 4.2 3.6s-.5.9-1.4 1.8M6.9 6.9a1.6 1.6 0 0 0 2.2 2.2" {...stroke} />
  </Base>
)

export const Info = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <circle cx="8" cy="8" r="6.2" {...stroke} />
    <path d="M8 7.2v4M8 4.9v.2" {...stroke} />
  </Base>
)

export const Print = (p: IconProps): React.JSX.Element => (
  <Base {...p}>
    <path d="M4.5 5.5V2.5h7v3M4.5 11.5h-2v-4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4h-2M4.5 9.5h7v4h-7v-4Z" {...stroke} />
  </Base>
)
