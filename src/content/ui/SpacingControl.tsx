import { useLayoutEffect, useRef, useState } from 'react'
import { COLORS } from '@/shared/constants'
import { summarise, type Side, type SpacingInfo, type SpacingKind } from '../core/box'
import { NumberField } from './NumberField'
import { cx, POPOVER_ATTR, useDismiss } from './util'
import { LinkIcon } from './icons'

const PANEL_WIDTH = 232

/**
 * Padding and margin, which are four numbers wearing one name.
 *
 * The bar shows a summary — `20` when the sides agree, `24·0` for the common
 * vertical/horizontal pair, `–` when all four genuinely differ — and clicking it
 * opens the box model, where each edge is its own field. That split is the way
 * out of the confusion: a single stepper can only ever describe one side while
 * writing all of them, so it looks stuck the moment you drag one edge, and no
 * amount of relabelling fixes that. Four fields cannot lie.
 *
 * A box with no spacing at all reads in muted grey rather than disappearing —
 * hiding it would leave nowhere to *add* padding from the bar.
 */
export function SpacingControl({
  kind,
  info,
  dropUp,
  onSide,
  onAll,
  onNudge,
}: {
  kind: SpacingKind
  info: SpacingInfo
  dropUp: boolean
  onSide: (side: Side, value: number) => void
  onAll: (value: number) => void
  onNudge: (delta: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [linked, setLinked] = useState(info.uniform)
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismiss(panelRef, open, () => setOpen(false))

  // These controls sit at the right-hand end of the bar, which is often near the
  // window edge; left-aligning the panel there runs it off screen.
  useLayoutEffect(() => {
    if (!open) return
    const box = rootRef.current?.getBoundingClientRect()
    if (box) setAlignRight(box.left + PANEL_WIDTH + 8 > window.innerWidth)
  }, [open])

  const summary = summarise(info)
  const empty = Object.values(info.sides).every((n) => Math.abs(n) < 0.5)
  const label = kind === 'padding' ? 'pad' : 'mar'
  const tone = kind === 'padding' ? COLORS.paddingLine : COLORS.marginLine

  const write = (side: Side, value: number) => {
    if (linked) onAll(value)
    else onSide(side, value)
  }

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <span className="mr-0.5 text-[10px] font-medium text-ink-soft">{label}</span>
      <button
        type="button"
        aria-label={`${kind} — ${summary.mixed ? 'differs per side' : summary.text}`}
        title={`${kind}: top ${Math.round(info.sides.top)} · right ${Math.round(
          info.sides.right,
        )} · bottom ${Math.round(info.sides.bottom)} · left ${Math.round(
          info.sides.left,
        )} — click to edit each side`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className={cx(
          'flex h-[22px] items-center gap-1 rounded-[6px] border px-1.5 text-[11px] tabular-nums',
          open ? 'border-[color:var(--color-select)] bg-ink/5' : 'border-line bg-paper',
          empty ? 'text-ink-soft' : 'text-ink',
        )}
      >
        <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: tone, opacity: empty ? 0.35 : 1 }} />
        {summary.text}
      </button>

      {open && (
        <div
          ref={panelRef}
          {...{ [POPOVER_ATTR]: '' }}
          className="dm-panel absolute px-2.5 py-2"
          style={{
            width: PANEL_WIDTH,
            ...(alignRight ? { right: 0 } : { left: 0 }),
            ...(dropUp ? { bottom: 28 } : { top: 28 }),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-semibold tracking-wide text-ink-soft uppercase">
              {kind}
            </span>
            <button
              type="button"
              aria-label="Link all sides"
              aria-pressed={linked}
              title={linked ? 'Editing one side changes all four' : 'Each side edits on its own'}
              onClick={() => setLinked((prev) => !prev)}
              className={cx(
                'flex items-center gap-1 rounded-[var(--radius-pill)] border-0 px-1.5 py-[2px] text-[9px] font-medium',
                linked ? 'bg-[color:var(--color-select)] text-paper' : 'bg-ink/5 text-ink-soft',
              )}
            >
              <LinkIcon />
              all
            </button>
          </div>

          {/* The box model, laid out as it is drawn everywhere else. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-y-1">
            <span />
            <NumberField
              label="top"
              value={info.sides.top}
              min={kind === 'padding' ? 0 : -Infinity}
              onChange={(next) => write('top', next)}
            />
            <span />

            <NumberField
              label="left"
              value={info.sides.left}
              min={kind === 'padding' ? 0 : -Infinity}
              onChange={(next) => write('left', next)}
            />
            <span
              className="h-[24px] w-[30px] rounded-[3px] border border-dashed"
              style={{ borderColor: tone }}
            />
            <NumberField
              label="right"
              value={info.sides.right}
              min={kind === 'padding' ? 0 : -Infinity}
              onChange={(next) => write('right', next)}
            />

            <span />
            <NumberField
              label="bottom"
              value={info.sides.bottom}
              min={kind === 'padding' ? 0 : -Infinity}
              onChange={(next) => write('bottom', next)}
            />
            <span />
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5">
            <span className="text-[9px] text-ink-soft">all sides</span>
            <NumberField
              label="all"
              value={info.value}
              mixed={summary.mixed}
              min={kind === 'padding' ? 0 : -Infinity}
              onNudge={onNudge}
              onChange={onAll}
            />
          </div>
        </div>
      )}
    </div>
  )
}

