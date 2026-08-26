import { store } from './store'

/**
 * The page as a frame on an infinite surface.
 *
 * The transform goes on `<body>` itself. The obvious build is to move every body
 * child into an artboard wrapper inside a world div, and it is the wrong one on a
 * live site: it breaks `body > x` selectors, any `body { display: flex }` layout,
 * and any page script that reads `document.body.children` — silently, and
 * visibly. Transforming body in place gets the same picture and restructures
 * nothing, so selection, the layer tree, spacing drags and undo all go on
 * working against the real page.
 *
 * It also means `getBoundingClientRect()` keeps returning post-transform viewport
 * coordinates, which is the single most valuable property of this shape: every
 * overlay already drawn lands correctly at any zoom without being told about the
 * canvas at all.
 *
 * What has to be told is anything mixing those coordinates with CSS pixels — a
 * padding value, a drag delta, a width readout. `scale()` is what those ask, and
 * it returns 1 when the canvas is off, so every one of those call sites is inert
 * outside this mode.
 */

export interface View {
  /** Translation in screen pixels, applied before the scale. */
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 4

/** The surface behind the frame. Near-white, so the frame's shadow still reads. */
const SURFACE = '#f3f3f5'

let on = false
let view: View = { x: 0, y: 0, scale: 1 }

/**
 * What the page's own `style` attributes said before we touched them, restored
 * verbatim on the way out.
 *
 * These writes deliberately bypass styles.ts: they are not the user's edits and
 * must never reach the undo stack or the Reset count — the same posture
 * `unpinFixed()` takes in screenshot.ts for the same reason.
 */
let restore: { html: string | null; body: string | null; scrollY: number } | null = null

export const active = (): boolean => on

/** The canvas zoom, or 1 when there is no canvas. */
export const scale = (): number => (on ? view.scale : 1)

export const transform = (): View => view

/** Screen coordinates to the page's own, which is what the frame is drawn in. */
export const screenToCanvas = (x: number, y: number): [number, number] => [
  (x - view.x) / view.scale,
  (y - view.y) / view.scale,
]

function paint(): void {
  if (!on) return
  const body = document.body
  body.style.setProperty(
    'transform',
    `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    'important',
  )
  store.touch()
}

export function enter(): void {
  if (on || !document.body) return
  const html = document.documentElement
  const body = document.body
  restore = {
    html: html.getAttribute('style'),
    body: body.getAttribute('style'),
    scrollY: window.scrollY,
  }
  on = true

  /**
   * The frame's width is the viewport as it stands, so the page looks exactly as
   * it did a moment ago rather than reflowing into some arbitrary artboard size.
   */
  // Guarded: a viewport that measures zero — a background tab that has never
  // been laid out — would otherwise give the frame no width at all, and a
  // zero-width artboard is not a thing anyone can recover from by looking at it.
  const width = html.clientWidth || window.innerWidth || body.scrollWidth || 1024
  /**
   * And its height is the content's, not the viewport's. A page that sets
   * `body { height: 100% }` has a viewport-tall body box with its content
   * overflowing below — the white and the shadow would cover the first screen
   * only, and the rest would spill onto the surface with no frame around it.
   */
  const height = Math.max(body.scrollHeight, html.scrollHeight, html.clientHeight)

  const set = (el: HTMLElement, decls: Record<string, string>) => {
    for (const [prop, value] of Object.entries(decls))
      el.style.setProperty(prop, value, 'important')
  }

  set(html, {
    // The document stops scrolling; the canvas pans instead.
    overflow: 'hidden',
    background: SURFACE,
    height: '100%',
  })
  set(body, {
    'transform-origin': '0 0',
    margin: '0',
    width: `${width}px`,
    'min-height': `${height}px`,
    background: readBackground(body, html),
    'box-shadow': '0 10px 50px rgba(11, 11, 12, 0.18)',
    // A frame that clipped its own content would hide the thing you zoomed out
    // to look at, and detached variations land outside this box in phase two.
    overflow: 'visible',
  })

  // Start where the reader was: the same content stays under the cursor rather
  // than the page jumping to its top the instant the canvas appears.
  view = { x: 0, y: -restore.scrollY, scale: 1 }
  paint()
}

/**
 * The frame keeps the page's own backdrop. Falling back to white matters more
 * than it sounds: a page that paints its background on `html` rather than `body`
 * — which is most of them, once a dark theme is involved — would otherwise get a
 * transparent frame and show the surface through its own text.
 */
function readBackground(body: HTMLElement, html: HTMLElement): string {
  const own = window.getComputedStyle(body).backgroundColor
  const opaque = (value: string) => value && value !== 'transparent' && !value.endsWith(', 0)')
  if (opaque(own)) return own
  const root = window.getComputedStyle(html).backgroundColor
  return opaque(root) ? root : '#ffffff'
}

export function exit(): void {
  if (!on || !restore) return
  const html = document.documentElement
  const body = document.body
  const put = (el: HTMLElement, value: string | null) => {
    if (value === null) el.removeAttribute('style')
    else el.setAttribute('style', value)
  }
  put(html, restore.html)
  put(body, restore.body)
  on = false
  const { scrollY } = restore
  restore = null
  view = { x: 0, y: 0, scale: 1 }
  window.scrollTo(0, scrollY)
  store.touch()
}

export function panBy(dx: number, dy: number): void {
  if (!on) return
  view = { ...view, x: view.x + dx, y: view.y + dy }
  paint()
}

const clamp = (n: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))

/**
 * Zoom about a point, so the pixel under the cursor stays under the cursor.
 *
 * Without this the view drifts on every notch and you spend the zoom chasing
 * what you were looking at back to the middle of the screen.
 */
export function zoomAt(clientX: number, clientY: number, factor: number): void {
  if (!on) return
  const next = clamp(view.scale * factor)
  if (next === view.scale) return
  const [cx, cy] = screenToCanvas(clientX, clientY)
  view = { scale: next, x: clientX - cx * next, y: clientY - cy * next }
  paint()
}

/** Absolute zoom about the middle of the window — what a readout's click does. */
export function zoomTo(next: number): void {
  if (!on) return
  zoomAt(window.innerWidth / 2, window.innerHeight / 2, clamp(next) / view.scale)
}

/** The whole frame in view, with a margin, centred. */
export function fit(): void {
  if (!on || !document.body) return
  const width = document.body.offsetWidth
  const height = document.body.offsetHeight
  if (!width || !height) return
  const margin = 48
  const next = clamp(
    Math.min((window.innerWidth - margin * 2) / width, (window.innerHeight - margin * 2) / height),
  )
  view = {
    scale: next,
    x: (window.innerWidth - width * next) / 2,
    y: (window.innerHeight - height * next) / 2,
  }
  paint()
}

/** Back to life size, with the top of the frame where the page's top was. */
export function reset(): void {
  if (!on) return
  view = { x: 0, y: 0, scale: 1 }
  paint()
}

/**
 * Brings an element into view by moving the canvas, which is what "scroll to it"
 * means once the document itself no longer scrolls.
 */
export function reveal(el: HTMLElement): void {
  if (!on) return
  const rect = el.getBoundingClientRect()
  const visible =
    rect.top >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth
  if (visible) return
  // Centred vertically, but only nudged horizontally: the frame is usually
  // wider than the gap between the two panels, and centring an element in the
  // window would as often as not put it under one of them.
  const dy = window.innerHeight / 2 - (rect.top + rect.height / 2)
  const dx =
    rect.left < 0
      ? -rect.left + 24
      : rect.right > window.innerWidth
        ? window.innerWidth - rect.right - 24
        : 0
  panBy(dx, dy)
}
