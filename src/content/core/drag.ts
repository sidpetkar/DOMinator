export interface DragState {
  /** Total movement since pointerdown, in CSS pixels. */
  dx: number
  dy: number
  x: number
  y: number
  shift: boolean
  alt: boolean
}

export interface DragOptions {
  onStart?: () => void
  onMove: (state: DragState) => void
  onEnd?: (state: DragState) => void
  /** Cursor forced on the whole document for the duration of the gesture. */
  cursor?: string
  /**
   * Pixels of travel before the gesture counts as a drag. Handles use 0 (the
   * intent is unambiguous); dragging an element by its body uses a few pixels
   * so that a plain click still selects and a double-click still edits text.
   */
  threshold?: number
}

let lastGestureEnd = 0

/**
 * True just after a real drag finished. The controller listens for clicks in
 * the capture phase *before* the swallow listener below can run, so it needs to
 * ask rather than rely on listener order — otherwise dropping a block would
 * immediately re-select whatever sits under the cursor.
 */
export const consumedByDrag = (): boolean => performance.now() - lastGestureEnd < 250

/**
 * One place for every push/pull gesture in the product (resize handles, padding
 * and margin edges, DOM reordering). Coalesces to one update per animation
 * frame so dragging stays smooth on heavy pages, and suppresses the host page's
 * text selection and the trailing click.
 */
export function startDrag(event: PointerEvent, options: DragOptions): void {
  event.preventDefault()
  event.stopPropagation()

  const originX = event.clientX
  const originY = event.clientY
  const threshold = options.threshold ?? 0
  const root = document.documentElement
  const prevCursor = root.style.cursor
  const prevSelect = root.style.userSelect

  let state: DragState = { dx: 0, dy: 0, x: originX, y: originY, shift: false, alt: false }
  let frame = 0
  let engaged = false

  const engage = () => {
    engaged = true
    if (options.cursor) root.style.cursor = options.cursor
    root.style.userSelect = 'none'
    options.onStart?.()
  }

  const flush = () => {
    frame = 0
    options.onMove(state)
  }

  const onMove = (e: PointerEvent) => {
    state = {
      dx: e.clientX - originX,
      dy: e.clientY - originY,
      x: e.clientX,
      y: e.clientY,
      shift: e.shiftKey,
      alt: e.altKey,
    }
    if (!engaged) {
      if (Math.hypot(state.dx, state.dy) < threshold) return
      engage()
    }
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const onUp = () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    if (!engaged) return // Never travelled far enough — leave the click alone.
    root.style.cursor = prevCursor
    root.style.userSelect = prevSelect
    options.onMove(state)
    options.onEnd?.(state)
    // The trailing click is neutralised via consumedByDrag() in the controller,
    // NOT by a one-shot window listener: that listener also ate the next click
    // on our own toolbar, so the first press on any control after a drag —
    // the colour swatch, an align button — silently did nothing.
    lastGestureEnd = performance.now()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  if (threshold === 0) engage()
}
