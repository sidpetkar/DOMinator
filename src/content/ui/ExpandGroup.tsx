import type { ReactNode } from 'react'

/**
 * A row of controls that folds away behind the one that stands for them.
 *
 * The reveal animates `grid-template-columns` from `0fr` to `1fr`. That lands on
 * the group's *natural* width without anyone measuring it, which `max-width`
 * can't do without a hardcoded guess that goes stale the moment another control
 * is added — and it stays a single CSS transition, so no JS runs per frame.
 *
 * A `0fr` track still floors at its content's min-content width, which padding
 * contributes to, so a folded group takes its spacing from the parent's flex gap
 * instead and is genuinely zero-wide. The negative margin then cancels that
 * trailing gap, or a folded group would leave a hole in the bar.
 *
 * `inert` as well as `aria-hidden`: the controls stay in the DOM so they can
 * animate, and a focusable control inside an `aria-hidden` subtree is exactly
 * the bug this tool's own accessibility checks look for. `inert` takes them out
 * of the tab order and out of hit testing, which `aria-hidden` alone does not.
 */
export function ExpandGroup({
  open,
  gap = 6,
  children,
}: {
  open: boolean
  /** Must match the parent row's gap, or folding leaves a hole. */
  gap?: number
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      style={{
        display: 'grid',
        gridTemplateColumns: open ? '1fr' : '0fr',
        overflow: 'hidden',
        marginRight: open ? 0 : -gap,
        transition:
          'grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease, margin-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        opacity: open ? 1 : 0,
      }}
    >
      <div className="flex min-w-0 items-center gap-1" style={{ gap: gap - 2 }}>
        {children}
      </div>
    </div>
  )
}

/**
 * The same fold, turned ninety degrees: a row of controls that drops out from
 * under the row that stands for it.
 *
 * The docked panel is a column 264px wide, and four number chips laid side by
 * side do not fit across it — the horizontal fold above would either overflow
 * or shrink every chip until its number had two characters of room. Downwards
 * there is as much space as the group needs, so the four sides land as a 2×2
 * block under their own heading, which is also where anyone arriving from a
 * design tool expects to find them.
 *
 * `grid-template-rows` for the same reason the other one uses columns: it
 * animates to the content's natural height with nothing measured, so a row that
 * grows a second line of chips still opens to exactly its own size.
 */
export function ExpandRows({
  open,
  gap = 4,
  children,
}: {
  open: boolean
  /** Must match the parent column's gap, or folding leaves a hole. */
  gap?: number
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        overflow: 'hidden',
        marginBottom: open ? 0 : -gap,
        transition:
          'grid-template-rows 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease, margin-bottom 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        opacity: open ? 1 : 0,
      }}
    >
      <div className="min-h-0">{children}</div>
    </div>
  )
}
