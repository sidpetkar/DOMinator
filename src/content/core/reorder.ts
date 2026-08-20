import type { Rect } from './geometry'
import { axisOf, childItems, type Axis } from './layout'
import { isOwnNode, isTargetable } from './picker'

export interface Drop {
  container: HTMLElement
  containerRect: Rect
  /** Node the dragged element will be inserted before; null appends. */
  before: HTMLElement | null
  axis: Axis
  /** Insertion bar, in viewport space. */
  indicator: Rect
  /** Boxes of the future siblings, highlighted during the drag. */
  siblings: Rect[]
}

/** Elements that cannot take children, so they can never be a drop container. */
const LEAF_TAGS = new Set([
  'IMG',
  'INPUT',
  'BR',
  'HR',
  'SVG',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'EMBED',
  'OBJECT',
])

/** Whether an element can hold children at all — a drop or paste target. */
export const canContainChildren = (el: Element): boolean => !LEAF_TAGS.has(el.tagName.toUpperCase())

const toRect = (el: Element): Rect => {
  const box = el.getBoundingClientRect()
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

const INDICATOR = 3
const EDGE_BAND = 10

/** True near a box's border — where the intent is "beside this", not "inside it". */
function onEdge(el: Element, x: number, y: number): boolean {
  const r = el.getBoundingClientRect()
  const inset = Math.min(EDGE_BAND, r.width / 4, r.height / 4)
  return (
    x < r.left + inset || x > r.right - inset || y < r.top + inset || y > r.bottom - inset
  )
}

/**
 * The container under the cursor that should receive the drop.
 *
 * Three rules make this feel like Figma rather than like a DOM tree widget:
 * the dragged node and its own subtree are invisible to the search (you can't
 * drop something inside itself); hovering a *leaf* — a heading, an icon —
 * targets its parent, so the thing you're carrying lands beside it; and
 * hovering the outer edge of a box also targets the parent, which is what makes
 * "drop between these two cards" reachable without threading the gap exactly.
 */
function containerAt(dragged: HTMLElement, x: number, y: number): HTMLElement | null {
  const usable = (el: Element | null): el is HTMLElement =>
    isTargetable(el) && el !== dragged && !dragged.contains(el)

  for (const el of document.elementsFromPoint(x, y)) {
    if (isOwnNode(el) || !usable(el) || LEAF_TAGS.has(el.tagName)) continue

    let candidate: HTMLElement | null = childItems(el).length ? el : el.parentElement
    if (!usable(candidate)) continue
    if (onEdge(candidate, x, y) && usable(candidate.parentElement)) {
      candidate = candidate.parentElement
    }
    return candidate
  }
  return null
}

const mainCoord = (axis: Axis, x: number, y: number): number => (axis === 'row' ? x : y)

/** Items sharing the cursor's cross-axis band — i.e. the wrapped line it is on. */
function itemsOnCursorLine(items: HTMLElement[], axis: Axis, x: number, y: number) {
  return items.filter((item) => {
    const rect = item.getBoundingClientRect()
    return axis === 'row'
      ? y >= rect.top && y <= rect.bottom
      : x >= rect.left && x <= rect.right
  })
}

export function findDrop(dragged: HTMLElement, x: number, y: number): Drop | null {
  const container = containerAt(dragged, x, y)
  if (!container) return null

  const items = childItems(container).filter((item) => item !== dragged)
  const axis = axisOf(container, items.length ? items : childItems(container))
  const containerRect = toRect(container)

  // Wrapped rows and grids have several lines; only the cursor's line should
  // decide the insertion point, otherwise the bar jumps to the wrong row.
  const line = itemsOnCursorLine(items, axis, x, y)
  const pool = line.length ? line : items
  const pointer = mainCoord(axis, x, y)

  let before: HTMLElement | null = null
  for (const item of pool) {
    const rect = item.getBoundingClientRect()
    const mid = axis === 'row' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    if (pointer < mid) {
      before = item
      break
    }
  }
  // Past the end of a wrapped line: insert after that line's last item, which
  // is the next item in document order — not the end of the whole container.
  if (!before && line.length) {
    const last = line[line.length - 1]!
    before = items[items.indexOf(last) + 1] ?? null
  }

  return {
    container,
    containerRect,
    before,
    axis,
    indicator: indicatorFor(containerRect, items, before, axis),
    siblings: items.map(toRect),
  }
}

function indicatorFor(
  containerRect: Rect,
  items: HTMLElement[],
  before: HTMLElement | null,
  axis: Axis,
): Rect {
  if (!items.length) {
    // Empty container: a bar across its middle reads as "this will be the first child".
    return axis === 'row'
      ? {
          top: containerRect.top + 4,
          left: containerRect.left + containerRect.width / 2 - INDICATOR / 2,
          width: INDICATOR,
          height: Math.max(INDICATOR, containerRect.height - 8),
        }
      : {
          top: containerRect.top + containerRect.height / 2 - INDICATOR / 2,
          left: containerRect.left + 4,
          width: Math.max(INDICATOR, containerRect.width - 8),
          height: INDICATOR,
        }
  }

  const anchor = before ?? items[items.length - 1]!
  const rect = anchor.getBoundingClientRect()
  const leading = Boolean(before)

  return axis === 'row'
    ? {
        top: rect.top,
        left: (leading ? rect.left : rect.right) - INDICATOR / 2,
        width: INDICATOR,
        height: rect.height,
      }
    : {
        top: (leading ? rect.top : rect.bottom) - INDICATOR / 2,
        left: rect.left,
        width: rect.width,
        height: INDICATOR,
      }
}

export function commitDrop(dragged: HTMLElement, drop: Drop): void {
  drop.container.insertBefore(dragged, drop.before)
}

/** Where a keyboard step would put an element. Same shape as a drop, minus the chrome. */
export interface Shift {
  container: HTMLElement
  before: Node | null
  /** True when the step takes it out of its current container. */
  ejected: boolean
}

/**
 * The keyboard counterpart to dragging: one place earlier or later among its
 * siblings, and *out* of the container once it runs out of them.
 *
 * Ejecting at the ends is what makes this a move rather than a sort. Without it
 * an element could never leave the box it was in without reaching for the mouse,
 * which is the whole point of the gesture — and the direction is unambiguous,
 * since leaving past the first sibling lands you immediately before the container
 * you left, and past the last one immediately after it.
 *
 * Deliberately not axis-aware, matching arrow-key selection: all four arrows mean
 * earlier or later in the sibling list. A row and a column would otherwise need
 * different keys for the same idea, and pressing ↑ in a row has to do *something*
 * or the gesture feels broken.
 *
 * Siblings that can't be selected — comments, scripts — are stepped over rather
 * than counted, so a move never appears to do nothing.
 */
export function findShift(el: HTMLElement, step: -1 | 1): Shift | null {
  const parent = el.parentElement
  if (!parent) return null

  const siblings = childItems(parent)
  const neighbour = siblings[siblings.indexOf(el) + step]
  // Past the neighbour rather than merely up against it: stepping right means
  // trading places with whatever is on the right.
  if (neighbour) {
    return {
      container: parent,
      before: step < 0 ? neighbour : neighbour.nextSibling,
      ejected: false,
    }
  }

  /**
   * `<html>` is where this stops. `<body>` is a fine place to land — it holds
   * children like anything else — but an element parented to the root document
   * element is not something a page ever means.
   */
  const outer = parent.parentElement
  if (!outer || outer === document.documentElement) return null
  return { container: outer, before: step < 0 ? parent : parent.nextSibling, ejected: true }
}

export function commitShift(el: HTMLElement, shift: Shift): void {
  shift.container.insertBefore(el, shift.before)
}
