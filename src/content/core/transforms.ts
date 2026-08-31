import { scale as canvasScale } from './canvas'
import type { DragState } from './drag'
import type { Edge, Metrics } from './geometry'
import { px, setStyle } from './styles'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The four that are always drawn: a corner is unambiguous at any size. */
const CORNERS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw']

/**
 * Below this, an edge has no middle worth aiming at.
 *
 * A handle is 9px wide. On an edge much shorter than this its midpoint sits
 * within a few pixels of both corners, so all it can do is take presses meant
 * for them — which is what made the middles feel like a hazard on small
 * elements and made removing them outright seem like the answer. They are not a
 * hazard on a section eight hundred pixels wide; they are the fastest way to
 * change one dimension.
 */
const EDGE_MIN = 60

/**
 * The handles this particular box gets.
 *
 * Per edge, and measured in *screen* pixels rather than page ones: a card is
 * only as grabbable as it looks, and at 30% zoom a 200px edge is sixty pixels of
 * actual glass. So a wide short card shows its corners plus top and bottom, a
 * tall narrow one shows its corners plus left and right, something large shows
 * all eight, and an icon shows four.
 */
export function handlesFor(width: number, height: number): readonly HandleId[] {
  const handles = [...CORNERS]
  // `n`/`s` ride the horizontal edges, so it is the *width* that has to be long
  // enough to hold them — and the other way about for `e`/`w`.
  if (width >= EDGE_MIN) handles.push('n', 's')
  if (height >= EDGE_MIN) handles.push('e', 'w')
  return handles
}

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

  /**
   * Everything here is converted to CSS pixels before any arithmetic happens.
   *
   * Both halves of the sum arrive in screen space on a zoomed canvas and neither
   * is what gets written: `drag` is screen pixels by definition, and `start` came
   * from `measure()`, whose rect is a client rect and whose edges are scaled to
   * match it. Divide one and not the other and the result is a number that is
   * partly one unit and partly the other — which is how a 40px pull at half zoom
   * produced 70 CSS pixels instead of 80, close enough to look plausible and be
   * wrong.
   */
  const z = canvasScale()
  const startWidth = start.rect.width / z
  const startHeight = start.rect.height / z
  let dx = (east ? drag.dx : west ? -drag.dx : 0) / z
  let dy = (south ? drag.dy : north ? -drag.dy : 0) / z

  const corner = (west || east) && (north || south)
  if (corner && drag.shift) {
    const ratio = startHeight / Math.max(1, startWidth)
    dy = dx * ratio
  }

  if (west || east) {
    const width = Math.max(MIN, startWidth + dx)
    setStyle(el, 'width', px(width))
    if (west) setStyle(el, 'margin-left', px(start.margin.left / z - (width - startWidth)))
  }
  if (north || south) {
    const height = Math.max(MIN, startHeight + dy)
    setStyle(el, 'height', px(height))
    if (north) setStyle(el, 'margin-top', px(start.margin.top / z - (height - startHeight)))
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
  // Both the delta and the value it is added to, in CSS pixels — see applyResize.
  const z = canvasScale()
  const delta = (drag.dx * sx + drag.dy * sy) / z
  const base = (kind === 'padding' ? start.padding[edge] : start.margin[edge]) / z
  const next = kind === 'padding' ? Math.max(0, base + delta) : base + delta
  setStyle(el, `${kind}-${edge}`, px(next))
  return next
}
