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
 * Everything that makes a lifted node a frame rather than page content.
 *
 * Written directly rather than through styles.ts: these are not edits to the
 * user's page, they are what holds the variation on the canvas, and putting them
 * on the undo stack would mean Reset could strand a frame at 0,0 on top of the
 * artboard.
 */
function dress(frame: HTMLElement, width: number): void {
  frame.setAttribute(FRAME_ATTR, '')
  for (const [prop, value] of Object.entries({
    position: 'absolute',
    margin: '0',
    width: `${Math.round(width)}px`,
    'max-width': 'none',
    // A variation is a thing on a surface, so it casts the same shadow the
    // artboard does — at half the weight, because it is a smaller object.
    'box-shadow': '0 6px 28px rgba(11, 11, 12, 0.16)',
  })) {
    frame.style.setProperty(prop, value, 'important')
  }
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

  const packed = serialize(sources)
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
