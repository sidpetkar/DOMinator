import { OWN_NODE_ATTR } from '@/shared/constants'
import * as canvas from './canvas'
import { describe } from './geometry'
import * as history from './history'
import { store } from './store'
import { deserialize, serialize } from './transfer'

/**
 * Variations: pieces of the page lifted onto the canvas beside it.
 *
 * A frame is an ordinary element with an attribute on it, positioned absolutely
 * as a child of `body`. That sounds too simple to be the design and it is the
 * whole of it: `body` carries the canvas transform, and a transformed element is
 * the containing block for its absolutely-positioned children — so `left` and
 * `top` on a frame *are* canvas coordinates, with no mapping to write and none
 * to keep in sync. Frames pan and zoom with the artboard because they are in it,
 * and every tool that works on the page works on them because they are page
 * elements.
 *
 * They are lifted through transfer.ts, which resolves the cascade into the copy.
 * A plain `cloneNode` would be cheaper and would look right about half the time:
 * the moment a section is styled through its context — `.row > .card`,
 * `.stack .bar` — a copy that is now a child of `body` stops matching the rules
 * that gave it its appearance. Inlining is what makes a lifted section look like
 * the thing you lifted.
 */

export const FRAME_ATTR = 'data-dominator-frame'

/** Where the first variation lands, measured from the artboard's right edge. */
const GUTTER = 80
/** Each new one steps down and across, so a stack of them is still countable. */
const CASCADE = 44

export const isFrame = (el: Element | null): boolean => Boolean(el?.hasAttribute(FRAME_ATTR))

/** The variation an element belongs to, if it is inside one. */
export const frameOf = (el: Element | null): HTMLElement | null =>
  el?.closest<HTMLElement>(`[${FRAME_ATTR}]`) ?? null

export const all = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[${FRAME_ATTR}]`),
]

export const count = (): number => all().length + parked.length

export interface Point {
  x: number
  y: number
}

export const positionOf = (frame: HTMLElement): Point => ({
  x: Number.parseFloat(frame.style.left) || 0,
  y: Number.parseFloat(frame.style.top) || 0,
})

export function place(frame: HTMLElement, x: number, y: number): void {
  frame.style.setProperty('left', `${Math.round(x)}px`, 'important')
  frame.style.setProperty('top', `${Math.round(y)}px`, 'important')
}

/**
 * Everything that makes a canvas object an object rather than page content.
 *
 * Written directly rather than through styles.ts: these are not edits to the
 * user's page, they are what holds the variation on the canvas, and putting them
 * on the undo stack would mean Reset could strand a frame at 0,0 on top of the
 * artboard.
 */
export function dressAsObject(frame: HTMLElement, width: number): void {
  dress(frame, width)
}

function dress(frame: HTMLElement, width: number): void {
  frame.setAttribute(FRAME_ATTR, '')
  for (const [prop, value] of Object.entries({
    position: 'absolute',
    margin: '0',
    width: `${Math.round(width)}px`,
    'max-width': 'none',
    /**
     * The other two insets, explicitly released.
     *
     * `getComputedStyle` on an absolutely positioned box resolves *all four*
     * edges to pixels — `right` and `bottom` come back as numbers even where the
     * author wrote nothing — so lifting a copy of something that is already a
     * frame carries those numbers into the copy. `place()` then sets `left` and
     * `top`, and a box with `top` and `bottom` both set is sized by the gap
     * between them rather than by its content: the second-generation copy came
     * out 61px tall where the original was 105, with its own text overflowing
     * it. Alt+dragging a card off the page and then Alt+dragging that copy is
     * the two-gesture sequence that finds it.
     */
    right: 'auto',
    bottom: 'auto',
    /**
     * No edge treatment at all — no shadow, and no hairline either.
     *
     * The hairline was tried and it was worse than the shadow it replaced: a
     * lifted section is usually a piece *of* a page rather than a whole page, so
     * a box drawn tightly around it reads as a border someone added to the
     * content. The artboard can carry one because a page has an edge; a fragment
     * does not, and the selection chrome already says where it is.
     */
  })) {
    frame.style.setProperty(prop, value, 'important')
  }
}

/**
 * The opposite of `dress`: everything that held it on the surface, removed.
 *
 * A canvas object is absolutely positioned at a fixed left/top with a frozen
 * width — which is exactly right on the board and exactly wrong the moment it is
 * pasted back into a column of content, where it floats over its new siblings
 * instead of joining them. Out of flow is a property of *being on the surface*,
 * so it is taken off along with the surface.
 *
 * The size goes too. It was captured to stop the box collapsing when it left a
 * container that had been sizing it; landing in a new container, that container
 * is sizing it again and a frozen width is now the thing distorting it.
 */
export function undress(el: HTMLElement): void {
  el.removeAttribute(FRAME_ATTR)
  for (const prop of [
    'position',
    'left',
    'top',
    'right',
    'bottom',
    'width',
    'min-height',
    'max-width',
    'margin',
    'translate',
  ]) {
    el.style.removeProperty(prop)
  }
  for (const node of el.querySelectorAll<HTMLElement>(`[${FRAME_ATTR}]`)) {
    node.removeAttribute(FRAME_ATTR)
  }
}

/**
 * Makes an element a free object on the surface, in place.
 *
 * The counterpart to `lift`, and the difference is a copy: `lift` leaves the
 * original in the page and puts a duplicate on the canvas, while this *takes the
 * element out* — out of its parent, out of the stack it was in, out of the
 * artboard — and stands it on the surface where it already appeared to be. That
 * is the move you want when a section has been dragged off the page: it stopped
 * being part of the page the moment it left it, and everything downstream (the
 * marquee, the border-click, the layer tree's root) then treats it as the
 * independent thing it looks like.
 *
 * The element keeps its identity, which is the whole point — you can take a
 * child out of *it* next, and out of that, indefinitely.
 */
export function adopt(el: HTMLElement, at: Point, width?: number): HTMLElement | null {
  if (!canvas.active() || !document.body || isFrame(el) || el === document.body) return null
  history.recordMove(el, 'take out of the page')
  const box = width ?? el.offsetWidth
  /**
   * The height it had a moment ago, measured before it is moved.
   *
   * Inside the page a box's height is a conversation with its container — a flex
   * row stretches its children to the tallest, a grid cell gives its row's
   * height, a column of text is as tall as the text. Standing it on the surface
   * ends that conversation, and the box collapsed to whatever its own content
   * asks for: a stretched card lost half its height the instant it left the row,
   * which reads as the tool having broken it.
   *
   * `min-height` rather than `height`, so it holds the size it had without ever
   * clipping: type something longer into it later and it grows, which is what an
   * object on a canvas should do. Sizing → Hug releases it deliberately.
   *
   * The distinction the two cases turn on is *leaving*. Moving around inside the
   * page changes nothing here — the container is still answering the question,
   * and freezing the answer would stop the element from adapting the way page
   * content is supposed to.
   */
  const tall = el.getBoundingClientRect().height / canvas.scale()
  // Cleared, because the offset it carried was in the old parent's terms and
  // the position it is about to be given already accounts for where it ended up.
  el.style.removeProperty('translate')
  dress(el, Math.max(box, 40))
  if (tall > 1) el.style.setProperty('min-height', `${Math.round(tall)}px`, 'important')
  place(el, at.x, at.y)
  document.body.append(el)
  store.set(history.depths())
  return el
}

/** The next free spot: to the right of the artboard, stepping down from there. */
function landing(sourceTop: number): Point {
  const width = document.body?.offsetWidth ?? 0
  const taken = all().length
  return { x: width + GUTTER + taken * CASCADE, y: sourceTop + taken * CASCADE }
}

/**
 * Lifts a copy of the given elements onto the canvas.
 *
 * A single element becomes the frame itself, so the layer tree that opens on it
 * shows the thing you lifted rather than a wrapper you did not ask for. Several
 * at once need something to hold them together, and that wrapper is the frame.
 */
export function lift(sources: HTMLElement[], at?: Point): HTMLElement | null {
  if (!canvas.active() || !document.body || !sources.length) return null

  /**
   * A far larger budget than a cross-tab copy gets.
   *
   * `serialize`'s default stops at 1500 nodes, which is right for something that
   * has to fit through `chrome.storage.session` and land in another tab. A lift
   * never leaves this page — it is a clone dropped a few hundred pixels to the
   * right — so the only real limit is memory. At the default, Alt+dragging the
   * artboard on any real site refused with "too big to share across tabs", which
   * is both the wrong answer and an answer about a thing nobody was doing: it is
   * the reason duplicating the whole page appeared to do nothing at all.
   */
  const packed = serialize(sources, { maxNodes: 24_000, maxBytes: 24_000_000 })
  if (!packed.ok) {
    store.set({ toast: packed.reason })
    return null
  }
  const nodes = deserialize(packed.html).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (!nodes.length) return null

  const first = sources[0]!
  const width = Math.max(...sources.map((el) => el.offsetWidth), 40)
  const rect = first.getBoundingClientRect()
  const spot = at ?? landing(canvas.screenToCanvas(rect.left, rect.top)[1])

  let frame: HTMLElement
  if (nodes.length === 1) {
    frame = nodes[0]!
  } else {
    frame = document.createElement('div')
    for (const node of nodes) frame.append(node)
  }
  sanitise(frame)
  dress(frame, width)
  place(frame, spot.x, spot.y)
  document.body.append(frame)

  history.recordInsert('lift', [frame])
  store.set(history.depths())
  return frame
}

/**
 * A clone carries its source's ids and our own bookkeeping. Duplicate ids break
 * `getElementById`, label/for pairs and `#id` styling all at once, so they are
 * suffixed rather than dropped — the same treatment clipboard.ts gives a paste,
 * for the same reasons.
 */
let counter = 0

function sanitise(root: HTMLElement): void {
  counter += 1
  for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute(OWN_NODE_ATTR)
    node.removeAttribute('contenteditable')
    if (node.id) node.id = `${node.id}-v${counter}`
  }
}

/** Another copy of a variation, offset so it is visibly a second one. */
export function duplicate(frame: HTMLElement): HTMLElement | null {
  if (!isFrame(frame) || !document.body) return null
  const copy = frame.cloneNode(true) as HTMLElement
  sanitise(copy)
  copy.setAttribute(FRAME_ATTR, '')
  const from = positionOf(frame)
  place(copy, from.x + CASCADE, from.y + CASCADE)
  document.body.append(copy)
  history.recordInsert('duplicate variation', [copy])
  store.set(history.depths())
  return copy
}

export const label = (frame: HTMLElement): string => describe(frame)

// — surviving the switch ————————————————————————————————————————

/**
 * Variations while the canvas is off.
 *
 * They are detached rather than left in place: a frame is positioned in canvas
 * coordinates, so with the transform gone it would sit hundreds of pixels off to
 * the side of an ordinary page, scattering debris through a document the user
 * expects to look untouched. Held here they cost nothing and come back exactly
 * where they were, which is the behaviour anyone flipping the switch twice
 * expects. They live as long as the tab does — the same lifetime as every other
 * edit this tool makes.
 */
let parked: HTMLElement[] = []

export function park(): void {
  parked = all()
  for (const frame of parked) frame.remove()
}

export function restore(): void {
  if (!document.body) return
  for (const frame of parked) document.body.append(frame)
  parked = []
}

/** Forgets them for good — the editor closing, not the canvas folding away. */
export function clear(): void {
  for (const frame of all()) frame.remove()
  parked = []
}
