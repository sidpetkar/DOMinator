/** Viewport-space rect. The overlay host is position:fixed, so these map 1:1. */
export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Edges {
  top: number
  right: number
  bottom: number
  left: number
}

/** Everything the overlay needs to draw one element, measured in one pass. */
export interface Metrics {
  rect: Rect
  padding: Edges
  border: Edges
  margin: Edges
}

export type Edge = keyof Edges

const num = (value: string): number => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

function edges(style: CSSStyleDeclaration, prefix: string, suffix = ''): Edges {
  return {
    top: num(style.getPropertyValue(`${prefix}-top${suffix}`)),
    right: num(style.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: num(style.getPropertyValue(`${prefix}-bottom${suffix}`)),
    left: num(style.getPropertyValue(`${prefix}-left${suffix}`)),
  }
}

export function measure(el: Element): Metrics {
  const box = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  return {
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
    padding: edges(style, 'padding'),
    border: edges(style, 'border', '-width'),
    margin: edges(style, 'margin'),
  }
}

/** Grows a rect outward by the given edges (used for the margin zone). */
export function expand(rect: Rect, by: Edges): Rect {
  return {
    top: rect.top - by.top,
    left: rect.left - by.left,
    width: rect.width + by.left + by.right,
    height: rect.height + by.top + by.bottom,
  }
}

/** Shrinks a rect inward by the given edges (used for the content box). */
export function contract(rect: Rect, by: Edges): Rect {
  return {
    top: rect.top + by.top,
    left: rect.left + by.left,
    width: Math.max(0, rect.width - by.left - by.right),
    height: Math.max(0, rect.height - by.top - by.bottom),
  }
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

/** Short human label for the selection badge, e.g. `div.card#hero`. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : ''
  return `${tag}${id}${cls}`
}
