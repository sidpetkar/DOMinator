import type { PointerEvent as ReactPointerEvent } from 'react'
import { COLORS } from '@/shared/constants'
import { startDrag } from '../core/drag'
import { childGaps, type GapBand } from '../core/gaps'
import * as history from '../core/history'
import { readAxisGap, setAxisGap } from '../core/layout'
import { store, type Node } from '../core/store'
import { rectStyle } from './util'

/**
 * The spacing *between* a selected container's children, in pink — a third
 * colour on purpose, because this is neither the element's own padding (green)
 * nor its own margin (orange), and confusing the three is the usual reason a
 * spacing change lands on the wrong box.
 *
 * On flex and grid containers the bands are draggable and write `column-gap` /
 * `row-gap`. Elsewhere the spacing comes from the children's own margins or
 * from flow, so the bands are read-only measurements.
 */
export function GapOverlay({ node, readOnly = false }: { node: Node; readOnly?: boolean }) {
  const { bands, editable: canEdit, axis, mainGap, crossGap } = childGaps(node.el)
  const editable = canEdit && !readOnly
  if (!bands.length) return null

  const onGrab = (band: GapBand) => (event: ReactPointerEvent) => {
    if (!editable) return
    const which = (band.kind === 'main' ? (axis === 'row' ? 'column' : 'row') : axis === 'row' ? 'row' : 'column') as
      | 'column'
      | 'row'
    const el = node.el
    const start = readAxisGap(el, which)
    const alongX = band.rect.width < band.rect.height
    store.set({ interaction: 'spacing' })
    history.begin('gap', el)
    startDrag(event.nativeEvent, {
      cursor: alongX ? 'ew-resize' : 'ns-resize',
      // No redraw is requested from here: the per-frame tracker fingerprints the
      // children's geometry, so the bands and their values follow the drag
      // without this handler re-rendering the very node it is being dragged by.
      onMove: (drag) => setAxisGap(el, which, start + (alongX ? drag.dx : drag.dy)),
      onEnd: () => {
        history.commit()
        store.set({ interaction: 'idle', ...history.depths() })
      },
    })
  }

  return (
    <>
      {bands.map((band, index) => {
        const alongX = band.rect.width < band.rect.height
        /**
         * When a CSS gap is in force it is what the badge shows, because that is
         * the number the bar's stepper edits and dragging this band writes —
         * two controls for one property must not disagree. The measured space
         * can be larger, since the children's own margins add to it, so the
         * tooltip spells the difference out rather than hiding it.
         */
        const css = band.kind === 'main' ? mainGap : crossGap
        const shown = editable ? css : band.value
        const margins = Math.round(band.value - css)
        return (
          <div
            key={index}
            className={editable ? 'dm-interactive' : 'pointer-events-none'}
            style={{
              ...rectStyle(band.rect),
              background: COLORS.gap,
              cursor: editable ? (alongX ? 'ew-resize' : 'ns-resize') : 'default',
            }}
            onPointerDown={onGrab(band)}
            title={
              editable
                ? `gap ${Math.round(css)}px — drag to change` +
                  (margins > 0 ? ` · ${Math.round(band.value)}px apart including ${margins}px of child margin` : '')
                : `${Math.round(band.value)}px between children`
            }
          >
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[3px] px-[4px] py-[1px] text-[10px] leading-[13px] font-semibold text-paper"
              style={{ background: COLORS.gapLine, whiteSpace: 'nowrap' }}
            >
              {Math.round(shown)}
            </span>
            {editable && <GapHandle alongX={alongX} />}
          </div>
        )
      })}
    </>
  )
}

/**
 * The affordance. Without it a pink band looks like a measurement, and there is
 * nothing to tell you the same band is the control for changing it. Offset from
 * the value badge along the band so the two never collide.
 */
function GapHandle({ alongX }: { alongX: boolean }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 left-1/2 grid place-items-center rounded-[999px]"
      style={{
        background: COLORS.gapLine,
        boxShadow: 'var(--shadow-handle)',
        width: alongX ? 7 : 20,
        height: alongX ? 20 : 7,
        transform: alongX
          ? 'translate(-50%, calc(-50% + 18px))'
          : 'translate(calc(-50% + 22px), -50%)',
      }}
    >
      <svg
        width={alongX ? 3 : 10}
        height={alongX ? 10 : 3}
        viewBox={alongX ? '0 0 3 10' : '0 0 10 3'}
        aria-hidden="true"
      >
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx={alongX ? 1.5 : 1.5 + i * 3.5}
            cy={alongX ? 1.5 + i * 3.5 : 1.5}
            r="1.1"
            fill="white"
          />
        ))}
      </svg>
    </span>
  )
}
