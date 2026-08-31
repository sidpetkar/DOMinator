import { controller } from '../core/controller'
import { store } from '../core/store'
import { zoom } from '../core/zoom'
import { zoomStable } from './util'

/**
 * The artboard's name, above its top-left corner.
 *
 * The frame lost its drop shadow, and without a shadow a white page on a
 * near-white surface has only a hairline saying where it ends — which is enough
 * to see but not enough to *identify*. Every design tool answers this the same
 * way and for the same reason: a name over the frame is what turns "the page" on
 * screen into a named object on a canvas, and it is the one piece of chrome that
 * tells you at 20% zoom which of several rectangles you are looking at.
 *
 * It says `body`, which is what the element actually is — the same name the top
 * row of the layer tree gives it, so the two pieces of chrome agree about what
 * is selected rather than offering two different words for one thing.
 *
 * Drawn from `body`'s live rect rather than from the canvas transform. The rect
 * is already post-transform viewport coordinates (see canvas.ts), so the label
 * pans and zooms with the frame without doing any arithmetic — and it stays
 * correct if the page reflows and the artboard changes width underneath it.
 *
 * Its own size is held constant, as the panels and bars are: a name that shrank
 * with the zoom would be illegible exactly when it is most needed.
 */
export function FrameLabel() {
  const body = document.body
  if (!body) return null
  const rect = body.getBoundingClientRect()
  const snapshot = store.get()
  const selected = snapshot.selected?.el === body

  /**
   * Whether anything is wearing a badge in this same corner.
   *
   * Both of this product's element badges — the hover label and the selection
   * label — hang 19px above the thing they name, and the first child of a page
   * usually begins at the artboard's own top-left corner. So whenever that child
   * or one of its own first children is picked, its dark pill lands exactly
   * where the frame's name is.
   *
   * The old fix was to hold the name 26px clear of the frame at all times, which
   * bought a collision that lasts as long as a hover at the price of a caption
   * floating a centimetre off its subject permanently. Asking instead means the
   * label sits where a caption belongs, and steps up only in the moment it would
   * otherwise be sat on.
   */
  const crowded = [snapshot.selected, snapshot.hovered].some((node) => {
    if (!node || node.el === body) return false
    const box = node.metrics.rect
    return Math.abs(box.top - rect.top) < 26 && Math.abs(box.left - rect.left) < 160
  })

  return (
    <button
      type="button"
      className="dm-interactive cursor-grab border-0 bg-transparent p-0 text-[10px] font-medium tracking-tight"
      title="body — the page frame. Click to select it, drag to move it, Alt+drag to copy it."
      /**
       * The label is the frame's handle, not merely its caption.
       *
       * Dragging the artboard by its body works, but only where the body is: on
       * a page whose content fills it there is nowhere to press that is not also
       * a paragraph or a link, and pressing those selects them. The name is
       * outside the frame entirely, so it is always available — the same reason
       * Figma puts the grab target for a frame on its name.
       */
      onPointerDown={(event) => {
        // Alt here means what it means on every other grab handle: take a copy
        // of the whole artboard and carry that instead.
        if (event.altKey && controller.carryCopy(event.nativeEvent, [body])) return
        controller.grabFrame(event.nativeEvent)
      }}
      onClick={() => controller.select(body)}
      style={{
        position: 'fixed',
        /**
         * Glued to the frame's own top-left corner, and nowhere else.
         *
         * It used to stop at the layer tree's right edge rather than slide under
         * it, on the theory that a half-hidden name reads as a layout bug. The
         * cure was worse: pan the frame anywhere left of the panel and the name
         * detached and sat alone at the far side of the window, captioning
         * nothing, while the frame it named was somewhere off to the right. A
         * label that is not attached to its object is not a label. It goes under
         * the panels now, which is what every design tool does with a frame name
         * and what the paint order here has always allowed.
         */
        left: rect.left,
        /**
         * Just above the edge, close enough to read as attached to it — and out
         * of the way when something else has claimed the corner (see `crowded`).
         *
         * `translateY(-100%)` rather than a `top` computed from its height: the
         * gap below the label is then the number written here at every zoom,
         * instead of being however tall the label happened to measure.
         */
        top: rect.top - (crowded ? 32 : 8),
        transition: 'top 120ms ease',
        maxWidth: 420,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: selected ? 'var(--color-select)' : 'var(--color-ink-soft)',
        ...zoomStable(zoom(), 'bottom left', 'translateY(-100%)'),
      }}
    >
      body
    </button>
  )
}

