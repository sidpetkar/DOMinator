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

/**
 * The surface behind the frame. Near-white by default, so a white page still
 * reads as an object sitting on something rather than as the background itself,
 * and settable because the one thing you cannot judge a design against is a
 * backdrop you are stuck with. Kept in a module variable rather than in the
 * store: it is a property of the canvas, and the canvas is what owns the
 * declaration that paints it.
 */
const DEFAULT_SURFACE = '#f3f3f5'
let surfaceColor = DEFAULT_SURFACE

export const surface = (): string => surfaceColor

/** Repaints the surface. Inert while the canvas is off, as everything here is. */
export function setSurface(color: string): void {
  surfaceColor = color || DEFAULT_SURFACE
  if (!on) return
  document.documentElement.style.setProperty('background', surfaceColor, 'important')
  store.touch()
}

export function resetSurface(): void {
  setSurface(DEFAULT_SURFACE)
}

/**
 * Room the docked panels take on each side of the window, used only to decide
 * where the frame lands when the canvas opens.
 *
 * A number rather than a measurement: the panels mount in the same tick the
 * canvas does, so there is nothing to measure yet, and being twenty pixels out
 * on an opening animation is not a thing anyone can see. 12px offset + 264px
 * panel + a little air.
 */
const PANEL_GUTTER = 288

/** Air above the frame when the canvas opens. */
const INTRO_MARGIN = 56

/**
 * How much of the room between the panels the frame takes when it opens.
 *
 * Not all of it. A frame that exactly fills the gap has its edges against the
 * panels, which looks like a page in a narrow window rather than a board with
 * something on it — the visible surface *around* the frame is what says this is
 * a canvas now.
 */
const INTRO_FILL = 0.74

/** And never so large that the switch looks like it did nothing. */
const INTRO_MAX = 0.7

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

/**
 * Inner scroll containers, released so the whole page lays out at once.
 *
 * The artboard is as tall as the document, which is the right rule for a page
 * and no rule at all for an application: an app shell is a viewport-height box
 * with `overflow: auto` on something inside it, so `scrollHeight` on `body` is
 * one screen and the other eight live in a scroller two levels down. The canvas
 * then showed one screen and left the rest hidden behind a scrollbar *inside*
 * the frame — a board you have to scroll is not a board.
 *
 * So every scrolling descendant is unclamped on the way in and put back exactly
 * as it was on the way out. Written straight to the element and remembered here
 * rather than going through styles.ts, for the reason the transform does: this
 * is not the user's edit and must never reach the undo stack or the Reset count.
 */
let released: [HTMLElement, string | null][] = []

/** Past this many, the page is doing something we should not be rewriting. */
const RELEASE_LIMIT = 400

function unclamp(): void {
  released = []
  if (!document.body) return

  /**
   * Deepest first, and that ordering is load-bearing.
   *
   * An app shell is a chain of clamps: a `100vh` box with `overflow: hidden`,
   * holding a flex column, holding the scroller with the content in it. Walked
   * top-down, the shell is measured while its child is still scrolling — so it
   * reports no overflow at all, is skipped, and goes on clamping everything
   * released beneath it. Reversing the list means each parent is asked only
   * after its children have grown, and the whole chain comes apart in one pass.
   */
  const all = [...document.body.querySelectorAll<HTMLElement>('*')].reverse()

  for (const el of all) {
    if (released.length >= RELEASE_LIMIT) break
    const style = window.getComputedStyle(el)
    const overflow = style.overflowY
    if (overflow === 'visible') continue
    // Only the ones actually holding something back. A box with `overflow: auto`
    // whose content fits is not clamping anything, and rewriting it would be
    // changing a page for no reason.
    if (el.scrollHeight <= el.clientHeight + 2) continue
    /**
     * `hidden` counts too, but only on something shell-sized.
     *
     * A scroller is unambiguous — it exists to be scrolled, and on a board there
     * is nothing to scroll. `hidden` is not: it is equally the tool for clipping
     * a carousel, a marquee, or the corners of an image, and spilling those open
     * would be rewriting the design rather than revealing it. Requiring most of
     * a viewport's height keeps it to the layout shells this is aimed at.
     */
    const scroller = overflow === 'auto' || overflow === 'scroll'
    if (!scroller && el.clientHeight < window.innerHeight * 0.6) continue

    released.push([el, el.getAttribute('style')])
    for (const [prop, value] of Object.entries({
      height: 'auto',
      'max-height': 'none',
      'overflow-y': 'visible',
    })) {
      el.style.setProperty(prop, value, 'important')
    }
  }
}

function reclamp(): void {
  for (const [el, style] of released) {
    if (style === null) el.removeAttribute('style')
    else el.setAttribute('style', style)
  }
  released = []
}

/**
 * Hooks for whatever else belongs on the surface — today the variations in
 * frames.ts. Registered rather than imported so the canvas keeps knowing
 * nothing about them: it owns a transform, not a scene graph.
 */
let onEnter: (() => void) | null = null
let onExit: (() => void) | null = null

export function onSurface(enter: () => void, leave: () => void): void {
  onEnter = enter
  onExit = leave
}

export const active = (): boolean => on

/** The canvas zoom, or 1 when there is no canvas. */
export const scale = (): number => (on ? view.scale : 1)

export const transform = (): View => view

/** Screen coordinates to the page's own, which is what the frame is drawn in. */
export const screenToCanvas = (x: number, y: number): [number, number] => [
  (x - view.x) / view.scale,
  (y - view.y) / view.scale,
]

/** The middle of the window, in canvas coordinates — where a paste lands. */
export const viewCentre = (): [number, number] =>
  screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)

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

/**
 * Where the canvas opens.
 *
 * Normally it works one out (see `intro`). A reopened file passes the view it
 * was saved with instead — the whole promise of saving a board is that it comes
 * back the way you left it, and a canvas that recomputed its own framing on open
 * would throw that away every time.
 */
export function enter(at?: View): void {
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
   * Released first, then measured. The order is the whole fix: an app whose
   * content lives in an inner scroller reports one screen of `scrollHeight`
   * until that scroller is opened up, so measuring first would freeze the frame
   * at exactly the height this is here to correct.
   */
  unclamp()

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
   * overflowing below — the white would cover the first screen only, and the rest
   * would spill onto the surface with no frame around it.
   */
  const height = Math.max(body.scrollHeight, html.scrollHeight, html.clientHeight)

  const set = (el: HTMLElement, decls: Record<string, string>) => {
    for (const [prop, value] of Object.entries(decls))
      el.style.setProperty(prop, value, 'important')
  }

  set(html, {
    // The document stops scrolling; the canvas pans instead.
    overflow: 'hidden',
    background: surfaceColor,
    height: '100%',
  })
  set(body, {
    'transform-origin': '0 0',
    margin: '0',
    width: `${width}px`,
    'min-height': `${height}px`,
    background: readBackground(body, html),
    /**
     * A hairline instead of a drop shadow. The shadow read as a floating card,
     * which is a decoration on top of the one thing this frame has to be honest
     * about — where the page ends. An outline also costs no layout: it is drawn
     * outside the box, so nothing inside the artboard shifts by a pixel.
     */
    outline: '1px solid rgba(11, 11, 12, 0.12)',
    'outline-offset': '0',
    // A frame that clipped its own content would hide the thing you zoomed out
    // to look at, and detached variations land outside this box in phase two.
    overflow: 'visible',
  })

  view = at ?? intro(width, height, restore.scrollY)
  paint()
  onEnter?.()
}

/**
 * Where the frame sits the moment the canvas opens.
 *
 * Life size and hard against the left edge is indistinguishable from the
 * ordinary page — the switch appears to do nothing until you scroll and find
 * that it doesn't. Backing off far enough to see the frame's own edges, with
 * the surface visible around it and the frame centred in the gap between the
 * two panels, is the picture that says "this is now an object on a canvas".
 *
 * Only the width is fitted. Pages are tall and fitting the height too would
 * open most sites at 8%, which is a thumbnail rather than a document; the
 * reader's scroll position is kept instead, so whatever they were looking at is
 * still the thing in front of them.
 */
function intro(width: number, height: number, scrollY: number): View {
  const room = Math.max(320, window.innerWidth - PANEL_GUTTER * 2)
  const next = clamp(Math.min((room / width) * INTRO_FILL, INTRO_MAX))
  /**
   * Vertically centred when the whole frame fits on screen — a short page
   * pinned to the top edge with a screen of empty surface below it does not
   * look centred, it looks fallen. A long one keeps the reader's scroll
   * position under a fixed margin instead, since there is no "centre" of
   * something eight screens tall.
   */
  const shown = height * next
  const y =
    shown < window.innerHeight - INTRO_MARGIN * 2
      ? (window.innerHeight - shown) / 2
      : INTRO_MARGIN - scrollY * next
  return { scale: next, x: (window.innerWidth - width * next) / 2, y }
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
  onExit?.()
  reclamp()
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
