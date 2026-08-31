import * as canvas from './canvas'
import { startDrag } from './drag'
import * as frames from './frames'
import * as history from './history'
import { store } from './store'
import { setStyle } from './styles'

/**
 * Moving things around the surface, rather than around the document.
 *
 * The distinction is the whole of this module. move.ts moves an element by
 * *re-homing* it: pick it up, find a new parent, insert it there — which is what
 * you want in a document, where everything has a place in a flow. On a canvas
 * you often want the other thing entirely: shift this block two hundred pixels
 * left because that is where it looks right, and leave the tree alone.
 *
 * Written through the standalone `translate` property, for the same reason
 * effects.ts writes `rotate` and `scale` there: it composes with whatever
 * `transform` the page already had, and it reads back as the two numbers that
 * were written instead of as a matrix nobody can decompose. It also costs no
 * layout — nothing around the element reflows as it moves, which is what makes
 * dragging a section across a page feel like dragging an object rather than
 * like editing one.
 *
 * A variation is moved by its `left`/`top` instead, because that is what holds
 * it on the surface (see frames.ts) and translating it would leave the position
 * the canvas thinks it has disagreeing with where it is drawn.
 */

/** The `translate` already on an element, in CSS pixels. */
function offsetOf(el: HTMLElement): { x: number; y: number } {
  const value = window.getComputedStyle(el).translate
  if (!value || value === 'none') return { x: 0, y: 0 }
  const [x = 0, y = 0] = value.trim().split(/\s+/).map(Number.parseFloat)
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
}

/**
 * Drags every given element by the same delta, keeping the set's arrangement
 * intact — a marquee selection moves as the thing it looked like when you drew
 * the band around it, not as a pile.
 */
export function beginCanvasMove(
  elements: HTMLElement[],
  event: PointerEvent,
  options: { onEnd?: () => void; threshold?: number } = {},
): void {
  const targets = elements.filter((el) => el !== document.body)
  if (!targets.length) return

  const starts = targets.map((el) =>
    frames.isFrame(el) ? { el, frame: true as const, at: frames.positionOf(el) } : { el, frame: false as const, at: offsetOf(el) },
  )

  startDrag(event, {
    cursor: 'grabbing',
    threshold: options.threshold ?? 3,
    onStart: () => {
      history.beginAll('move on the canvas', targets)
      store.set({ interaction: 'move' })
    },
    onMove: (drag) => {
      // Screen pixels to canvas pixels: at 50% zoom the hand travels twice as
      // far as the thing it is carrying, and the thing has to keep up with the
      // hand, not with the arithmetic.
      const z = canvas.scale()
      const dx = drag.dx / z
      const dy = drag.dy / z
      for (const start of starts) {
        if (start.frame) frames.place(start.el, start.at.x + dx, start.at.y + dy)
        else setStyle(start.el, 'translate', `${Math.round(start.at.x + dx)}px ${Math.round(start.at.y + dy)}px`)
      }
      store.remeasure()
    },
    onEnd: () => {
      history.commit()
      for (const start of starts) if (!start.frame) release(start.el)
      store.set({ interaction: 'idle', ...history.depths() })
      options.onEnd?.()
    },
  })
}

/**
 * Dropped outside the page: the element leaves the page.
 *
 * This is what makes dragging something off the artboard mean anything. Until
 * now the element stayed a child of whatever stack it came from and was merely
 * drawn somewhere else, which looked right and behaved wrong in every way that
 * matters: the marquee found its parent instead of it, clicking its border
 * selected the section it had visibly left, and the layer tree still showed it
 * buried six rows deep in a container it was nowhere near. Reparenting it to the
 * surface makes what you see and what the tools see the same thing again.
 *
 * "Outside" is measured by the majority of the element's area, not by a corner
 * clearing the edge, so nudging a card a little past the margin does not silently
 * tear it out of its layout.
 */
function release(el: HTMLElement): void {
  const body = document.body
  if (!body || !canvas.active() || el.parentElement === body) return
  const box = el.getBoundingClientRect()
  const frame = body.getBoundingClientRect()
  const w = Math.min(box.right, frame.right) - Math.max(box.left, frame.left)
  const h = Math.min(box.bottom, frame.bottom) - Math.max(box.top, frame.top)
  const inside = w > 0 && h > 0 ? (w * h) / Math.max(1, box.width * box.height) : 0
  if (inside >= 0.5) return
  const [x, y] = canvas.screenToCanvas(box.left, box.top)
  frames.adopt(el, { x, y }, box.width / canvas.scale())
}
