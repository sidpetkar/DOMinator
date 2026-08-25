import { startDrag } from './drag'
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
export function beginMove(el: HTMLElement, event: PointerEvent, immediate = false): void {
  const prevOpacity = el.style.opacity
  const prevPointer = el.style.pointerEvents

  startDrag(event, {
    cursor: 'grabbing',
    threshold: immediate ? 0 : 4,
    onStart: () => {
      store.set({ interaction: 'move', hovered: null })
      el.style.opacity = '0.35'
      el.style.pointerEvents = 'none'
    },
    onMove: (drag) => {
      store.set({ drop: findDrop(el, drag.x, drag.y) })
    },
    onEnd: () => {
      const { drop } = store.get()
      el.style.opacity = prevOpacity
      el.style.pointerEvents = prevPointer
      if (drop) {
        // Recorded *before* the move, so the inverse still knows the old home.
        history.recordMove(el)
        commitDrop(el, drop)
      }
      store.set({ drop: null, interaction: 'idle', ...history.depths() })
      store.remeasure()
    },
  })
}
