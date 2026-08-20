import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { COLORS } from '@/shared/constants'
import { contract, expand, type Edge, type Rect } from '../core/geometry'
import { startDrag } from '../core/drag'
import * as history from '../core/history'
import { store, type Node } from '../core/store'
import { applySpacing } from '../core/transforms'
import { rectStyle } from './util'

type Kind = 'padding' | 'margin'

const CURSOR: Record<Edge, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
}

/** The four bands of one spacing ring, laid out so corners don't double up. */
function bands(outer: Rect, inner: Rect): Record<Edge, Rect> {
  return {
    top: { top: outer.top, left: outer.left, width: outer.width, height: inner.top - outer.top },
    bottom: {
      top: inner.top + inner.height,
      left: outer.left,
      width: outer.width,
      height: outer.top + outer.height - (inner.top + inner.height),
    },
    left: { top: inner.top, left: outer.left, width: inner.left - outer.left, height: inner.height },
    right: {
      top: inner.top,
      left: inner.left + inner.width,
      width: outer.left + outer.width - (inner.left + inner.width),
      height: inner.height,
    },
  }
}

/**
 * PRD §3.3. Green for padding, orange for margin — the DevTools mental model —
 * except every band here is a grab target: drag it and the CSS value follows the
 * pixel delta live. The whole band is draggable, not just its 1px edge, because
 * a 4px hit area is not a tactile tool.
 *
 * Each band carries its current value as a badge, visible for the whole time
 * the element is selected rather than only mid-drag, so the box model can be
 * read at a glance. The badges update live during a drag because the store
 * re-measures every frame.
 */
export function SpacingOverlay({ node, readOnly = false }: { node: Node; readOnly?: boolean }) {
  const { rect, padding, border, margin } = node.metrics

  const paddingBox = contract(rect, border)
  const rings: { kind: Kind; zones: Record<Edge, Rect>; values: Record<Edge, number>; fill: string; line: string }[] =
    [
      {
        kind: 'margin',
        zones: bands(expand(rect, margin), rect),
        values: margin,
        fill: COLORS.margin,
        line: COLORS.marginLine,
      },
      {
        kind: 'padding',
        zones: bands(paddingBox, contract(paddingBox, padding)),
        values: padding,
        fill: COLORS.padding,
        line: COLORS.paddingLine,
      },
    ]

  const onGrab = (kind: Kind, edge: Edge) => (event: ReactPointerEvent) => {
    if (readOnly) return
    // Snapshot at grab time: the live metrics keep changing under the drag.
    const start = store.get().selected?.metrics ?? node.metrics
    const el = node.el
    store.set({ interaction: 'spacing' })
    history.begin(`${kind}-${edge}`, el)
    startDrag(event.nativeEvent, {
      cursor: CURSOR[edge],
      onMove: (drag) => applySpacing(el, start, kind, edge, drag),
      onEnd: () => {
        history.commit()
        store.set({ interaction: 'idle', undoDepth: history.depth() })
      },
    })
  }

  return (
    <>
      {rings.map(({ kind, zones, values, fill, line }) =>
        (Object.keys(zones) as Edge[]).map((edge) => {
          const zone = zones[edge]
          if (zone.width <= 0 || zone.height <= 0) return null
          const horizontal = edge === 'top' || edge === 'bottom'
          return (
            <div
              key={`${kind}-${edge}`}
              className={readOnly ? 'pointer-events-none' : 'dm-interactive'}
              style={{
                ...rectStyle(zone),
                background: fill,
                cursor: readOnly ? 'default' : CURSOR[edge],
              }}
              onPointerDown={onGrab(kind, edge)}
              title={
                readOnly
                  ? `${kind}-${edge}: ${Math.round(values[edge])}px`
                  : `${kind}-${edge}: ${Math.round(values[edge])}px — drag to change`
              }
            >
              {/* The movable boundary, brightened so the affordance reads. */}
              <div
                style={{
                  position: 'absolute',
                  background: line,
                  ...((horizontal
                    ? { left: 0, right: 0, height: 1, [edge]: 0 }
                    : { top: 0, bottom: 0, width: 1, [edge]: 0 }) as CSSProperties),
                }}
              />
              <SpacingBadge value={values[edge]} tone={line} />
            </div>
          )
        }),
      )}
    </>
  )
}

/**
 * Centred in its band, and never smaller than the band itself — a 2px padding
 * still needs a readable number, so the chip overflows rather than shrinking.
 */
function SpacingBadge({ value, tone }: { value: number; tone: string }) {
  const rounded = Math.round(value)
  if (rounded === 0) return null
  return (
    <span
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[3px] px-[4px] py-[1px] text-[10px] leading-[13px] font-semibold text-paper"
      style={{ background: tone, whiteSpace: 'nowrap' }}
    >
      {rounded}
    </span>
  )
}
