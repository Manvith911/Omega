/**
 * Shared helpers for main-process modules that need small utilities.
 * Kept dependency-free like the rest of the project.
 */

/** Parses a hex RGB/AARRGGBB string into [r, g, b]. */
export function parseHexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const rgb = h.length === 8 ? h.slice(2) : h
  return [parseInt(rgb.slice(0, 2), 16), parseInt(rgb.slice(2, 4), 16), parseInt(rgb.slice(4, 6), 16)]
}

/**
 * Validates window bounds against the currently connected displays and
 * returns corrected bounds. A window saved on a monitor that has since been
 * disconnected must not restore off-screen.
 */
export function clampBoundsToDisplays(
  bounds: { x: number; y: number; width: number; height: number },
  displays: { workArea: { x: number; y: number; width: number; height: number } }[],
): { x: number; y: number; width: number; height: number } | null {
  if (displays.length === 0) return null
  const intersects = displays.some((d) => {
    const a = d.workArea
    return (
      bounds.x + bounds.width > a.x &&
      bounds.x < a.x + a.width &&
      bounds.y + bounds.height > a.y &&
      bounds.y < a.y + a.height
    )
  })
  if (intersects) return bounds
  // Fall back to the primary display (assumed first), centered.
  const primary = displays[0]
  const a = primary.workArea
  return {
    x: a.x + Math.max(0, Math.floor((a.width - bounds.width) / 2)),
    y: a.y + Math.max(0, Math.floor((a.height - bounds.height) / 2)),
    width: Math.min(bounds.width, a.width),
    height: Math.min(bounds.height, a.height),
  }
}
