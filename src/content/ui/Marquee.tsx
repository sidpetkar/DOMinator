import type { Rect } from '../core/geometry'
import { rectStyle } from './util'

/**
 * The rubber band. A wash of the selection blue inside a solid hairline of it —
 * the fill is what makes a band you are dragging over busy page content legible,
 * and the hairline is what keeps its exact edges readable, which matters because
 * those edges are what decides the selection.
 */
export function Marquee({ band }: { band: Rect }) {
  return (
    <div
      className="pointer-events-none border border-[color:var(--color-select)]"
      style={{
        ...rectStyle(band),
        background: 'color-mix(in srgb, var(--color-select) 12%, transparent)',
      }}
    />
  )
}
