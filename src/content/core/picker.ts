import { OWN_NODE_ATTR } from '@/shared/constants'

/** True for anything DOMinator injected — never a valid edit target. */
export function isOwnNode(node: EventTarget | Node | null): boolean {
  if (!(node instanceof Node)) return false
  const el = node instanceof Element ? node : node.parentElement
  return Boolean(el?.closest(`[${OWN_NODE_ATTR}]`))
}

const NEVER_TARGET = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE'])

/**
 * Inline SVG is targetable as a whole (`<svg>`), but its interior — paths,
 * circles, groups — is not: an icon is one object to a designer, and letting the
 * cursor land on a `<path>` would make icons impossible to grab.
 *
 * SVGSVGElement is not an HTMLElement, but it carries every member we use
 * (style, getBoundingClientRect, closest, children, parentElement), so it is
 * narrowed to the same type rather than threading a union through the codebase.
 */
export function isTargetable(el: Element | null): el is HTMLElement {
  if (!el || isOwnNode(el) || NEVER_TARGET.has(el.tagName.toUpperCase())) return false
  return el instanceof HTMLElement || el instanceof SVGSVGElement
}

/**
 * Sorts elements the way the page reads them. A multi-selection is built in
 * click order, but every operation on a set — copy, group, hide — has to respect
 * document order or the result comes out shuffled.
 */
export function documentOrder(elements: HTMLElement[]): HTMLElement[] {
  return [...elements].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )
}

/** Deepest editable element under the cursor, piercing open shadow roots. */
export function deepestAt(x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (isTargetable(el)) return el
  }
  return null
}

const AREA_TOLERANCE = 0.94

/**
 * PRD §3.1: a plain click should feel like grabbing the *container*, not the
 * innermost span. We climb out of ancestors that add no structure — a parent
 * that wraps this element alone, or one occupying essentially the same box —
 * and stop at the first parent that actually arranges several things, because
 * that parent is a layout region the user probably didn't mean to select.
 *
 * From there Ctrl/Cmd+click drills in and Alt+click steps out, so any depth is
 * two clicks away without guessing at the user's intent.
 */
export function outermostEquivalent(el: HTMLElement): HTMLElement {
  let current = el
  let rect = current.getBoundingClientRect()
  for (;;) {
    const parent = current.parentElement
    if (!isTargetable(parent) || parent === document.body) return current
    const parentRect = parent.getBoundingClientRect()
    const siblings = [...parent.children].filter(isTargetable).length
    const areaRatio =
      (rect.width * rect.height) / Math.max(1, parentRect.width * parentRect.height)
    if (siblings > 1 && areaRatio < AREA_TOLERANCE) return current
    current = parent
    rect = parentRect
  }
}

/**
 * PRD §3.1 deep selection: Ctrl/Cmd+click steps one level *down* the ancestor
 * chain from what is already selected toward whatever is under the cursor.
 * Repeated modified clicks therefore walk div → button → i.
 */
export function drillDown(current: HTMLElement | null, deepest: HTMLElement): HTMLElement {
  if (!current || current === deepest || !current.contains(deepest)) return deepest
  let child: HTMLElement = deepest
  while (child.parentElement && child.parentElement !== current) {
    child = child.parentElement
  }
  return isTargetable(child) ? child : deepest
}

/** One level out — Alt+click, the counterpart to Ctrl+click's drill-down. */
export function drillUp(current: HTMLElement | null, deepest: HTMLElement): HTMLElement {
  const from = current ?? deepest
  const parent = from.parentElement
  return isTargetable(parent) && parent !== document.body ? parent : from
}

/** Resolves the element a pointer event should act on, honouring modifiers. */
export function resolveTarget(
  event: MouseEvent,
  selected: HTMLElement | null,
): HTMLElement | null {
  const deepest = deepestAt(event.clientX, event.clientY)
  if (!deepest) return null
  if (event.altKey) return drillUp(selected, deepest)
  if (event.ctrlKey || event.metaKey) return drillDown(selected, deepest)
  return outermostEquivalent(deepest)
}
