import { OWN_NODE_ATTR, SHIELD_ATTR } from '@/shared/constants'

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
  // The shield is over everything and is therefore first out of
  // `elementsFromPoint`; refusing it here is what lets the search fall through
  // to the page beneath, which is the whole point of it being there.
  if (el.hasAttribute(SHIELD_ATTR)) return false
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

/**
 * The thing you are pointing at, seen from a given container.
 *
 * This is the canvas's hit test, and it is a different question from the one
 * `outermostEquivalent` answers. That one asks "what is the most sensible
 * element around this pixel", which on a dense page lands somewhere in the
 * middle of the tree — deep enough that hovering a card offers you the paragraph
 * inside it, and picking up the card at all takes aim. This one asks "what is
 * the *outermost* thing under the pointer that this container holds", which is
 * always exactly one step: the child of the scope you are inside.
 *
 * Drilling then happens by selecting rather than by aiming. The scope is the
 * selection when the pointer is inside it (see `hitScope`), so clicking a
 * section selects the section, and the next hover inside it offers the section's
 * own children — one level per click, all the way down, the way every design
 * tool works.
 */
export function withinScope(scope: HTMLElement, x: number, y: number): HTMLElement | null {
  const deepest = deepestAt(x, y)
  if (!deepest) return null
  if (deepest === scope) return scope
  if (!scope.contains(deepest)) return null

  let node: HTMLElement = deepest
  while (node.parentElement && node.parentElement !== scope) {
    const parent = node.parentElement
    if (!isTargetable(parent)) break
    node = parent
  }
  return throughWrappers(node, deepest)
}

/**
 * How much of the board a box has to cover to count as scaffolding rather than
 * as content.
 *
 * Sixty per cent is generous on purpose. It is not trying to identify wrappers
 * precisely — it is trying to skip the run of them that every site puts between
 * `body` and its actual sections, and anything still covering most of the board
 * is, whatever it is called, not the thing a person means when they point at
 * the page.
 */
const BULK = 0.6

/**
 * Where hit-testing starts when nothing is selected.
 *
 * Not `body`. A real page has two children — a header and one enormous box
 * holding everything else — so hit-testing from `body` offers exactly those two,
 * and the entire content of the site has no hover state at all. That was the bug
 * this replaces, and it is not fixable by picking a different single element:
 * the number of scaffolding layers between the document and its first real
 * section is different on every site.
 *
 * So it is measured rather than counted. Walk down the chain toward whatever is
 * under the cursor, staying inside every box that still covers most of the
 * board, and stop at the first one that does not. That box is a *section*, and
 * the container holding it is where hovering should begin — which makes the
 * first thing you hover a main region of the page, however many `<div>`s the
 * framework wrapped it in.
 */
export function rootScope(deepest: HTMLElement, root: HTMLElement): HTMLElement {
  const bounds = root.getBoundingClientRect()
  const total = Math.max(1, bounds.width * bounds.height)

  const chain: HTMLElement[] = []
  let node: HTMLElement | null = deepest
  while (node && node !== root) {
    chain.unshift(node)
    node = node.parentElement
  }

  let scope: HTMLElement = root
  for (const step of chain) {
    const rect = step.getBoundingClientRect()
    if (rect.width * rect.height < total * BULK) break
    scope = step
  }
  return scope
}

/**
 * Down through containers that hold nothing but the next container.
 *
 * The mirror image of `outermostEquivalent`, and it exists because the web puts
 * three or four of these at the top of every page — `#__next > div > main` —
 * which are structure to a framework and nothing at all to a person. Without it
 * the first three clicks of every drill-down select boxes that are all exactly
 * the same size as each other, and the tool looks like it is ignoring them.
 *
 * A wrapper only counts as one when it has a single child that fills it. The
 * moment a container arranges *several* things it is a real layer, and the
 * descent stops — that is the box the user is being offered.
 */
function throughWrappers(node: HTMLElement, deepest: HTMLElement): HTMLElement {
  let current = node
  for (;;) {
    if (current === deepest) return current
    const kids = [...current.children].filter(isTargetable)
    const only = kids.length === 1 ? kids[0] : null
    if (!only || !(only === deepest || only.contains(deepest))) return current
    const outer = current.getBoundingClientRect()
    const inner = only.getBoundingClientRect()
    const ratio = (inner.width * inner.height) / Math.max(1, outer.width * outer.height)
    if (ratio < AREA_TOLERANCE) return current
    current = only
  }
}

/**
 * How close to an element's edge counts as pointing at the edge rather than at
 * the element.
 */
const EDGE_BAND = 6

/**
 * Elements smaller than this are all edge, so the rule is not applied to them:
 * a 20px icon would become unclickable, since every pixel of it is within six
 * of a border.
 */
const EDGE_MIN = 40

/**
 * True when the pointer is in the frame of an element rather than in its middle.
 *
 * This is the "grab it by its border" gesture: the middle of a card is its
 * content and clicking there means the card, while the strip of padding around
 * the outside belongs to whatever *arranges* the cards — and that is the thing
 * you are reaching for when you aim at the gap between two of them.
 */
function onEdge(el: HTMLElement, x: number, y: number): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width < EDGE_MIN || rect.height < EDGE_MIN) return false
  const inset =
    Math.min(x - rect.left, rect.right - x, y - rect.top, rect.bottom - y) <= EDGE_BAND
  return inset
}

/** Resolves the element a pointer event should act on, honouring modifiers. */
export function resolveTarget(
  event: MouseEvent,
  selected: HTMLElement | null,
  /**
   * The container to hit-test from, on the canvas. Absent off it, where the
   * page is a document being edited in place rather than a board being explored
   * and the older "most sensible element" rule is the better one.
   */
  scope: HTMLElement | null = null,
): HTMLElement | null {
  const deepest = deepestAt(event.clientX, event.clientY)
  if (!deepest) return null
  if (event.altKey) return drillUp(selected, deepest)
  if (event.ctrlKey || event.metaKey) return drillDown(selected, deepest)
  if (scope) {
    /**
     * The edge rule is deliberately not applied here. It exists to let you step
     * *out* by aiming at a border, and out of a scoped hit is out of the scope
     * itself — which would undo the drilling you did to get here. Inside a
     * scope, "one level out" is what clicking the parent's own padding already
     * means.
     */
    return withinScope(scope, event.clientX, event.clientY)
  }
  const target = outermostEquivalent(deepest)
  /**
   * Pointing at the border steps out one level, and it does so for hover as
   * well as for the click — both come through here, so the outline you were
   * shown is the thing you get, which is the only version of this that is
   * usable. Modified clicks are left alone above: they already mean "up" and
   * "down" explicitly, and a modifier should never be second-guessed.
   */
  return onEdge(target, event.clientX, event.clientY) ? drillUp(target, target) : target
}
