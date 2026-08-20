import type { Rect } from './geometry'
import { axisOf, childItems, type Axis } from './layout'

export interface GapBand {
  rect: Rect
  value: number
  /** 'main' runs along the stack; 'cross' is the space between wrapped lines. */
  kind: 'main' | 'cross'
}

export interface GapReport {
  bands: GapBand[]
  /** Flex and grid honour `gap`, so their bands are draggable. */
  editable: boolean
  axis: Axis
  /**
   * The CSS gap in force along each axis. Kept apart from the measured `value`
   * on a band because they are different quantities: the measurement is the
   * space you can see, which is the gap *plus* the children's own margins.
   */
  mainGap: number
  crossGap: number
}

interface Item {
  rect: DOMRect
}

const OVERLAP = 0.5

/** Groups items into visual lines, so a wrapped row measures per row. */
function lines(items: Item[], axis: Axis): Item[][] {
  const sorted = [...items].sort((a, b) =>
    axis === 'row'
      ? a.rect.top - b.rect.top || a.rect.left - b.rect.left
      : a.rect.left - b.rect.left || a.rect.top - b.rect.top,
  )
  const out: Item[][] = []
  for (const item of sorted) {
    const line = out[out.length - 1]
    const last = line?.[line.length - 1]
    const shares = last
      ? axis === 'row'
        ? Math.min(last.rect.bottom, item.rect.bottom) - Math.max(last.rect.top, item.rect.top) >
          Math.min(last.rect.height, item.rect.height) * OVERLAP
        : Math.min(last.rect.right, item.rect.right) - Math.max(last.rect.left, item.rect.left) >
          Math.min(last.rect.width, item.rect.width) * OVERLAP
      : false
    if (line && shares) line.push(item)
    else out.push([item])
  }
  for (const line of out) {
    line.sort((a, b) => (axis === 'row' ? a.rect.left - b.rect.left : a.rect.top - b.rect.top))
  }
  return out
}

const MIN_GAP = 1

/**
 * The space *between* a container's children — what a designer calls the gap
 * and what CSS may be producing from `gap`, margins or plain flow. Shown as
 * soon as the parent is selected, because that spacing is usually the reason
 * for selecting the parent in the first place.
 */
export function childGaps(el: HTMLElement): GapReport {
  const items: Item[] = childItems(el)
    .map((child) => ({ rect: child.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0)

  const axis = axisOf(el)
  const style = window.getComputedStyle(el)
  const editable = style.display.includes('flex') || style.display.includes('grid')
  const number = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const mainGap = number(axis === 'row' ? style.columnGap : style.rowGap)
  const crossGap = number(axis === 'row' ? style.rowGap : style.columnGap)
  const bands: GapBand[] = []
  if (items.length < 2) return { bands, editable, axis, mainGap, crossGap }

  const grouped = lines(items, axis)

  for (const line of grouped) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]!.rect
      const b = line[i + 1]!.rect
      const value = axis === 'row' ? b.left - a.right : b.top - a.bottom
      if (value < MIN_GAP) continue
      bands.push({
        kind: 'main',
        value,
        rect:
          axis === 'row'
            ? {
                top: Math.max(a.top, b.top),
                left: a.right,
                width: value,
                height: Math.max(1, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
              }
            : {
                top: a.bottom,
                left: Math.max(a.left, b.left),
                width: Math.max(1, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
                height: value,
              },
      })
    }
  }

  // Space between wrapped lines, measured on the cross axis.
  for (let i = 0; i < grouped.length - 1; i += 1) {
    const a = extent(grouped[i]!, axis)
    const b = extent(grouped[i + 1]!, axis)
    const value = axis === 'row' ? b.start - a.end : b.start - a.end
    if (value < MIN_GAP) continue
    bands.push({
      kind: 'cross',
      value,
      rect:
        axis === 'row'
          ? { top: a.end, left: a.left, width: a.width, height: value }
          : { top: a.top, left: a.end, width: value, height: a.height },
    })
  }

  return { bands, editable, axis, mainGap, crossGap }
}

/** Cross-axis span of one line, plus its main-axis box for drawing. */
function extent(line: Item[], axis: Axis) {
  const rects = line.map((item) => item.rect)
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return axis === 'row'
    ? { start: top, end: bottom, left, width: right - left, top, height: bottom - top }
    : { start: left, end: right, left, width: right - left, top, height: bottom - top }
}
