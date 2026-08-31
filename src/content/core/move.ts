import * as canvas from './canvas'
import { noteMove } from './changes'
import { startDrag } from './drag'
import * as frames from './frames'
import * as history from './history'
import { commitDrop, findDrop } from './reorder'
import { store } from './store'

/**
 * PRD §3.4 — picking a block up and putting it somewhere else.
 *
 * Started either from the 6-dot grip (immediate) or by dragging the selected
 * element's own body past a few pixels, which is why plain clicks and
 * double-clicks still behave normally.
 *
 * The node is dimmed and made transparent to hit-testing for the duration, so
 * the cursor reads the containers *underneath* what it is carrying.
 */
/** Whether a point on screen is off the page's own frame. */
function outsideArtboard(x: number, y: number): boolean {
  if (!canvas.active() || !document.body) return false
  const frame = document.body.getBoundingClientRect()
  return x < frame.left || x > frame.right || y < frame.top || y > frame.bottom
}

export function beginMove(el: HTMLElement, event: PointerEvent, immediate = false): void {
  const prevOpacity = el.style.opacity
  const prevPointer = el.style.pointerEvents
  let last: { x: number; y: number } | null = null

  startDrag(event, {
    cursor: 'grabbing',
    threshold: immediate ? 0 : 4,
    onStart: () => {
      store.set({ interaction: 'move', hovered: null })
      el.style.opacity = '0.35'
      el.style.pointerEvents = 'none'
    },
    onMove: (drag) => {
      last = drag
      /**
       * The block travels with the cursor.
       *
       * It used to stay exactly where it was, dimmed, while a separate indicator
       * showed where it would land — which reads perfectly once you know the
       * convention and reads as nothing at all before you do. Dragging something
       * off the edge of the page was the worst case: out there no container
       * matches, so there was no indicator either, and the gesture looked like it
       * had been ignored right up until the moment you let go.
       *
       * Written through `translate`, which composes with whatever `transform` the
       * page already had and costs no layout — nothing around it reflows while it
       * moves, so the drop indicator stays pointing at the gap it was pointing at.
       * On the canvas only: off it the page still scrolls under the gesture, and
       * a block that both scrolls and translates chases the cursor at double
       * speed.
       */
      if (canvas.active()) {
        const z = canvas.scale()
        el.style.setProperty(
          'translate',
          `${Math.round(drag.dx / z)}px ${Math.round(drag.dy / z)}px`,
          'important',
        )
      }
      store.set({ drop: findDrop(el, drag.x, drag.y) })
    },
    onEnd: () => {
      const { drop } = store.get()
      el.style.opacity = prevOpacity
      el.style.pointerEvents = prevPointer
      /**
       * The carry is over, so the offset goes: from here the element's position
       * is decided by where it was dropped, not by how far the hand travelled.
       * `adopt` re-clears it for the same reason a moment later, harmlessly.
       */
      el.style.removeProperty('translate')
      if (drop) {
        // Recorded *before* the move, so the inverse still knows the old home.
        history.recordMove(el)
        commitDrop(el, drop)
        if (el.parentElement) noteMove(el, el.parentElement)
      } else if (last && outsideArtboard(last.x, last.y)) {
        /**
         * Dragged off the page entirely: it leaves the page.
         *
         * `findDrop` returns nothing out here, because there is no container on
         * the surface to drop into — and that used to be the end of it, so
         * dragging a card out past the edge of the artboard did nothing at all
         * and it sprang back. But "carry it off the page" is the most obvious
         * thing to try on a canvas, and it has an exact meaning: the element
         * stops being part of the document and becomes an object on the surface,
         * which is what `adopt` does (see frames.ts).
         *
         * Measured by where the *cursor* ended rather than by where the element
         * is, because during this gesture the element has not moved — it is
         * dimmed in place while the drop target is hunted for, so its own box is
         * still sitting in the page and would never read as outside.
         */
        const [x, y] = canvas.screenToCanvas(last.x, last.y)
        const width = el.offsetWidth
        frames.adopt(el, { x: x - width / 2, y }, width)
      }
      store.set({ drop: null, interaction: 'idle', ...history.depths() })
      store.remeasure()
    },
  })
}
