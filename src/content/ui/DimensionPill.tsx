import type { ReactNode } from 'react'
import type { Rect } from '../core/geometry'

/** Same rule as the bar's number fields: blue is the value, grey is the label. */
const Value = ({ children }: { children: ReactNode }) => (
  <span className="text-[color:var(--color-select)]">{children}</span>
)

/**
 * The size readout under a selected box.
 *
 * Centred on the bottom edge and pushed clear of the handle that sits there —
 * the handle is 9px square straddling the edge, so anything closer than about
 * 20px collides with the one control most likely to be reached for while the
 * number is being read.
 *
 * The unit is spelled out on both axes rather than implied by a bare `223 × 105`.
 * Everything this tool writes is in pixels and there is no mode where that
 * changes, so the pair of `px` is not there to disambiguate — it is there
 * because a number with a unit reads as a measurement and a number without one
 * reads as a count.
 *
 * Positioned inline rather than with Tailwind's `left-1/2 -translate-x-1/2`,
 * which centred nothing at all: the translate utilities depend on `@property`
 * initial values that never register inside our shadow root (see index.tsx).
 * That is fixed at the source now, but a readout whose whole job is to be under
 * the middle of something should not need a variable to resolve to sit there.
 */
export function DimensionPill({ rect }: { rect: Rect }) {
  return (
    <span
      className="dm-panel absolute px-1.5 py-[2px] text-[10px] font-medium whitespace-nowrap text-ink-soft tabular-nums"
      style={{ top: '100%', left: '50%', marginTop: 20, transform: 'translateX(-50%)' }}
    >
      W <Value>{Math.round(rect.width)}</Value>px × H <Value>{Math.round(rect.height)}</Value>px
    </span>
  )
}
