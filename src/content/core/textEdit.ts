import type { Rect } from './geometry'
import { setStyle, setStyles } from './styles'

/**
 * Type controls need a *visible* target. Focus moves to the toolbar the moment
 * a control is touched, which drops the native selection — so we keep our own
 * copy of the range and paint it ourselves (see EditHighlight). The user never
 * loses sight of which words are being restyled.
 */
let saved: Range | null = null

export function rememberSelection(el: HTMLElement): void {
  const selection = window.getSelection()
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null
  if (range && el.contains(range.commonAncestorContainer)) saved = range.cloneRange()
}

export function clearSelection(): void {
  saved = null
}

/** Entering edit mode selects the whole element, so the target is unambiguous. */
export function selectAll(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  saved = range.cloneRange()
}

export function restoreSelection(el: HTMLElement): void {
  if (!saved || !el.contains(saved.commonAncestorContainer)) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(saved)
}

/** Client rects of the remembered range, for the highlight overlay. */
export function selectionRects(): Rect[] {
  if (!saved) return []
  return [...saved.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }))
}

const TEXT_SPAN_ATTR = 'data-dominator-text'

/**
 * Properties worth pushing down into descendants.
 *
 * Component libraries declare `font-family` and `color` on their leaf text
 * nodes — often with !important — so setting them on a container changes
 * nothing visible. That is the "the font just stops applying" case: it depends
 * on which element you picked, not on how many changes you have made.
 *
 * Only these two cascade. Size, weight and spacing are deliberately left alone:
 * a child heading differing there is a type hierarchy, and flattening it would
 * do more damage than the fix is worth.
 */
const CASCADE_PROPS = new Set(['font-family', 'color'])

/** Cap: rewriting an enormous subtree is neither fast nor what anyone meant. */
const CASCADE_LIMIT = 800

const normalise = (value: string): string =>
  value.trim().toLowerCase().replace(/["']/g, '').split(',')[0]?.trim() ?? ''

/** Our value is a hex or family string; computed style speaks rgb() and lists. */
function agrees(prop: string, computed: string, desired: string): boolean {
  if (prop === 'color') {
    const hex = /^#([0-9a-f]{6})$/i.exec(desired.trim())
    if (!hex?.[1]) return normalise(computed) === normalise(desired)
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex[1]!.slice(i, i + 2), 16))
    return computed.replace(/\s/g, '') === `rgb(${r},${g},${b})`
  }
  return normalise(computed) === normalise(desired)
}

/**
 * Descendants are only touched when their computed value *disagrees* with what
 * we just set on the root — which, since everything else inherits, means they
 * declare the property themselves.
 */
function cascade(root: HTMLElement, decls: Record<string, string>): void {
  const entries = Object.entries(decls).filter(([prop]) => CASCADE_PROPS.has(prop))
  if (!entries.length) return
  const descendants = root.querySelectorAll<HTMLElement>('*')
  if (descendants.length > CASCADE_LIMIT) return
  for (const child of descendants) {
    const computed = window.getComputedStyle(child)
    for (const [prop, value] of entries) {
      if (!agrees(prop, computed.getPropertyValue(prop), value)) setStyle(child, prop, value)
    }
  }
}

const coversWholeElement = (range: Range, el: HTMLElement): boolean => {
  const whole = document.createRange()
  whole.selectNodeContents(el)
  return (
    range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0
  )
}

/**
 * Applies type declarations to exactly what is highlighted.
 *
 * A whole-element or collapsed selection styles the element itself. A partial
 * one is wrapped in a span we own and reuse, so repeated tweaks to the same
 * words don't nest a new wrapper each time. Wrapping is limited to selections
 * that live inside a single text node — anything spanning element boundaries
 * would need to split markup, and quietly restructuring someone's DOM is worse
 * than styling one level wider.
 */
export function applyTypeStyle(el: HTMLElement, decls: Record<string, string>): void {
  const range = saved
  if (!range || range.collapsed || coversWholeElement(range, el)) {
    setStyles(el, decls)
    cascade(el, decls)
    return
  }

  const existing = (
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  )?.closest(`[${TEXT_SPAN_ATTR}]`)
  if (existing instanceof HTMLElement && coversWholeElement(range, existing)) {
    setStyles(existing, decls)
    return
  }

  const singleTextNode =
    range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE
  if (!singleTextNode) {
    setStyles(el, decls)
    return
  }

  // Not marked as one of our own nodes: it is page content from here on, and
  // must stay selectable and editable like any other span.
  const span = document.createElement('span')
  span.setAttribute(TEXT_SPAN_ATTR, '')
  span.append(range.extractContents())
  range.insertNode(span)
  setStyles(span, decls)
  cascade(span, decls)

  const next = document.createRange()
  next.selectNodeContents(span)
  saved = next
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(next)
}
