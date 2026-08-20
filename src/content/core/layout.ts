import { px, setStyle } from './styles'
import { isTargetable } from './picker'

export type Axis = 'row' | 'column'

export interface LayoutInfo {
  display: string
  isFlex: boolean
  isGrid: boolean
  axis: Axis
  wrap: boolean
  gap: number
  /** Element children we treat as the stack's items. */
  items: HTMLElement[]
}

export function childItems(el: HTMLElement): HTMLElement[] {
  return [...el.children].filter(isTargetable)
}

/**
 * Which way a container stacks its children. Flex and grid declare it; for
 * ordinary block/inline flow we read it off the geometry, because that is what
 * the user actually sees — two boxes sharing a horizontal band are a row no
 * matter which display value produced them.
 */
export function axisOf(el: HTMLElement, items = childItems(el)): Axis {
  const style = window.getComputedStyle(el)
  if (style.display.includes('flex')) {
    return style.flexDirection.startsWith('row') ? 'row' : 'column'
  }
  if (style.display.includes('grid')) {
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length
    if (columns > 1) return 'row'
  }
  const first = items[0]?.getBoundingClientRect()
  const second = items[1]?.getBoundingClientRect()
  if (first && second) {
    const overlapsVertically = first.bottom > second.top + 1 && second.bottom > first.top + 1
    return overlapsVertically ? 'row' : 'column'
  }
  return 'column'
}

export function readLayout(el: HTMLElement): LayoutInfo {
  const style = window.getComputedStyle(el)
  const items = childItems(el)
  const gap = Number.parseFloat(style.gap === 'normal' ? '0' : style.gap)
  return {
    display: style.display,
    isFlex: style.display.includes('flex'),
    isGrid: style.display.includes('grid'),
    axis: axisOf(el, items),
    wrap: style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse',
    gap: Number.isFinite(gap) ? gap : 0,
    items,
  }
}

/**
 * Auto-layout controls (see LayoutBar). A block container has no direction to
 * change, so the first control that needs one promotes it to flex — that single
 * conversion is what makes "switch this stack to horizontal" work on any page.
 */
function ensureFlex(el: HTMLElement, info: LayoutInfo): void {
  if (info.isFlex) return
  setStyle(el, 'display', 'flex')
  // A converted block container would otherwise stretch its children to the
  // tallest one; keeping the cross axis at its natural size looks closer to
  // what the page did before.
  setStyle(el, 'align-items', info.axis === 'row' ? 'center' : 'stretch')
}

export function setAxis(el: HTMLElement, axis: Axis): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  setStyle(el, 'flex-direction', axis)
}

export function setWrap(el: HTMLElement, wrap: boolean): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  setStyle(el, 'flex-wrap', wrap ? 'wrap' : 'nowrap')
}

export function setGap(el: HTMLElement, gap: number): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  setStyle(el, 'gap', px(Math.max(0, gap)))
}

/** Per-axis gap, so dragging one band doesn't disturb the other direction. */
export function setAxisGap(el: HTMLElement, which: 'column' | 'row', gap: number): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  setStyle(el, `${which}-gap`, px(Math.max(0, gap)))
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type AlignPos = 'start' | 'center' | 'end'

const POS: Record<AlignEdge, AlignPos> = {
  left: 'start',
  hcenter: 'center',
  right: 'end',
  top: 'start',
  vcenter: 'center',
  bottom: 'end',
}

const CSS_POS: Record<AlignPos, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
}

const isHorizontal = (edge: AlignEdge): boolean =>
  edge === 'left' || edge === 'hcenter' || edge === 'right'

/**
 * Figma-style alignment of a container's children.
 *
 * The buttons are named for what the user sees — left, centre, right, top,
 * middle, bottom — and each maps to `justify-content` or `align-items`
 * depending on which way the container stacks. Pressing "centre horizontally"
 * therefore does the same visible thing on a row and on a column, which is the
 * whole point; making the user translate to flex axes would not be alignment,
 * it would be homework.
 */
export function alignChildren(el: HTMLElement, edge: AlignEdge): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  const alongStack = isHorizontal(edge) === (info.axis === 'row')
  setStyle(el, alongStack ? 'justify-content' : 'align-items', CSS_POS[POS[edge]])
}

export type Distribution = 'between' | 'evenly'

/**
 * Pushes the children apart along the stack instead of packing them against an
 * edge — first item hard left, last hard right, space in the middle. It is the
 * answer to "put the button on one end and the message on the other", which
 * alignment alone cannot express because both ends are involved.
 *
 * Always `justify-content`: distribution only has meaning along the main axis.
 */
export function distribute(el: HTMLElement, mode: Distribution): void {
  const info = readLayout(el)
  ensureFlex(el, info)
  setStyle(el, 'justify-content', mode === 'between' ? 'space-between' : 'space-evenly')
}

const readDistribution = (value: string): Distribution | null => {
  if (value.includes('space-between')) return 'between'
  if (value.includes('space-evenly') || value.includes('space-around')) return 'evenly'
  return null
}

/** `normal`, `stretch` and the `space-*` values mean nothing explicit is set. */
const readPos = (value: string): AlignPos | null => {
  const v = value.trim()
  if (v.includes('center')) return 'center'
  if (v === 'flex-end' || v === 'end' || v === 'right' || v === 'bottom') return 'end'
  if (v === 'flex-start' || v === 'start' || v === 'left' || v === 'top') return 'start'
  return null
}

/** Current alignment, so the buttons can show which one is in force. */
export function readAlign(el: HTMLElement): {
  horizontal: AlignPos | null
  vertical: AlignPos | null
  distribution: Distribution | null
} {
  const style = window.getComputedStyle(el)
  const axis = axisOf(el)
  const main = readPos(style.justifyContent)
  const cross = readPos(style.alignItems)
  const distribution = readDistribution(style.justifyContent)
  return axis === 'row'
    ? { horizontal: main, vertical: cross, distribution }
    : { horizontal: cross, vertical: main, distribution }
}

/** The gap value currently in effect along one axis. */
export function readAxisGap(el: HTMLElement, which: 'column' | 'row'): number {
  const value = Number.parseFloat(window.getComputedStyle(el).getPropertyValue(`${which}-gap`))
  return Number.isFinite(value) ? value : 0
}
