import { deepestAt } from './picker'

/**
 * The thing that actually scrolls.
 *
 * On a plain document that is the window, but application shells — a fixed
 * header, a sidebar, a content pane with `overflow: auto` — keep `<body>` at a
 * fixed height and scroll an inner div instead. `window.scrollBy` is a silent
 * no-op there, and `window.scrollY` never leaves 0, which is exactly why a
 * drag-to-edge auto-scroll appears to do nothing on those sites.
 *
 * Everything that needs to scroll or to convert coordinates goes through this,
 * so both cases are handled by one code path.
 */
export interface Scroller {
  /** null when the page itself is the scroller. */
  readonly el: HTMLElement | null
  x(): number
  y(): number
  maxX(): number
  maxY(): number
  /** Viewport position of the scroller's client box — 0,0 for the page. */
  originX(): number
  originY(): number
  /** Size of the visible slice of content: one "tile" when capturing. */
  width(): number
  height(): number
  scrollTo(x: number, y: number): void
  scrollBy(dx: number, dy: number): void
}

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

export function pageScroller(): Scroller {
  const doc = () => document.scrollingElement ?? document.documentElement
  return {
    el: null,
    x: () => window.scrollX,
    y: () => window.scrollY,
    maxX: () => Math.max(0, doc().scrollWidth - window.innerWidth),
    maxY: () => Math.max(0, doc().scrollHeight - window.innerHeight),
    originX: () => 0,
    originY: () => 0,
    width: () => window.innerWidth,
    height: () => window.innerHeight,
    scrollTo: (x, y) => window.scrollTo(x, y),
    scrollBy: (dx, dy) => window.scrollBy(dx, dy),
  }
}

function elementScroller(el: HTMLElement): Scroller {
  return {
    el,
    x: () => el.scrollLeft,
    y: () => el.scrollTop,
    maxX: () => Math.max(0, el.scrollWidth - el.clientWidth),
    maxY: () => Math.max(0, el.scrollHeight - el.clientHeight),
    originX: () => el.getBoundingClientRect().left + el.clientLeft,
    originY: () => el.getBoundingClientRect().top + el.clientTop,
    width: () => el.clientWidth,
    height: () => el.clientHeight,
    scrollTo: (x, y) => {
      el.scrollLeft = clamp(x, el.scrollWidth - el.clientWidth)
      el.scrollTop = clamp(y, el.scrollHeight - el.clientHeight)
    },
    scrollBy: (dx, dy) => {
      el.scrollLeft += dx
      el.scrollTop += dy
    },
  }
}

const SCROLLABLE = /(auto|scroll|overlay)/

function scrolls(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  const vertical = SCROLLABLE.test(style.overflowY) && el.scrollHeight - el.clientHeight > 2
  const horizontal = SCROLLABLE.test(style.overflowX) && el.scrollWidth - el.clientWidth > 2
  return vertical || horizontal
}

/**
 * The nearest scrollable ancestor of whatever is under the cursor, falling back
 * to the page. Uses deepestAt so our own overlay — which covers the viewport
 * during a capture — is looked straight through.
 */
export function scrollerAt(clientX: number, clientY: number): Scroller {
  let node = deepestAt(clientX, clientY)
  while (node && node !== document.body && node !== document.documentElement) {
    if (scrolls(node)) return elementScroller(node)
    node = node.parentElement
  }
  return pageScroller()
}

/** Content-space point for a viewport point, in the scroller's coordinates. */
export const toContent = (s: Scroller, clientX: number, clientY: number): [number, number] => [
  clientX - s.originX() + s.x(),
  clientY - s.originY() + s.y(),
]

/** Inverse of toContent. */
export const toClient = (s: Scroller, contentX: number, contentY: number): [number, number] => [
  contentX - s.x() + s.originX(),
  contentY - s.y() + s.originY(),
]
