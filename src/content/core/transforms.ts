import type { DragState } from './drag'
import type { Edge, Metrics } from './geometry'
import { px, setStyle } from './styles'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

const MIN = 8

/**
 * PRD §3.2. Corners drive both axes, edges drive one.
 *
 * Dragging a west/north handle would normally make the element grow away from
 * the cursor, because inline width/height always extend right and down. To keep
 * the gesture honest we compensate with margin on that side, which pins the
 * opposite edge where the user left it. Hold Shift on a corner to lock the
 * aspect ratio.
 */
export function applyResize(
  el: HTMLElement,
  start: Metrics,
  handle: HandleId,
  drag: DragState,
): void {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.startsWith('n')
  const south = handle.startsWith('s')

  let dx = east ? drag.dx : west ? -drag.dx : 0
  let dy = south ? drag.dy : north ? -drag.dy : 0

  const corner = (west || east) && (north || south)
  if (corner && drag.shift) {
    const ratio = start.rect.height / Math.max(1, start.rect.width)
    dy = dx * ratio
  }

  if (west || east) {
    const width = Math.max(MIN, start.rect.width + dx)
    setStyle(el, 'width', px(width))
    if (west) setStyle(el, 'margin-left', px(start.margin.left - (width - start.rect.width)))
  }
  if (north || south) {
    const height = Math.max(MIN, start.rect.height + dy)
    setStyle(el, 'height', px(height))
    if (north) setStyle(el, 'margin-top', px(start.margin.top - (height - start.rect.height)))
  }
  // Fixed-size boxes fight flex/grid parents; opt out of the parent's sizing.
  setStyle(el, 'box-sizing', 'border-box')
  setStyle(el, 'flex', 'none')
}

/** Which way the mouse has to move for a given edge's spacing to grow. */
const GROW: Record<'padding' | 'margin', Record<Edge, [number, number]>> = {
  padding: { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] },
  margin: { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] },
}

/**
 * PRD §3.3: pull the edge of the green (padding) or orange (margin) zone and
 * the corresponding CSS value tracks the pixel delta directly. No typing.
 */
export function applySpacing(
  el: HTMLElement,
  start: Metrics,
  kind: 'padding' | 'margin',
  edge: Edge,
  drag: DragState,
): number {
  const [sx, sy] = GROW[kind][edge]
  const delta = drag.dx * sx + drag.dy * sy
  const base = kind === 'padding' ? start.padding[edge] : start.margin[edge]
  const next = kind === 'padding' ? Math.max(0, base + delta) : base + delta
  setStyle(el, `${kind}-${edge}`, px(next))
  return next
}
