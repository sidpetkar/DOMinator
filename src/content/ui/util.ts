import { useEffect, type CSSProperties, type RefObject } from 'react'
import { HOST_ID } from '@/shared/constants'
import type { Rect } from '../core/geometry'

/** Rects are already in viewport space and our host is fixed — no conversion. */
export const rectStyle = (rect: Rect): CSSProperties => ({
  position: 'fixed',
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
})

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')

/**
 * Keeps a floating panel the same physical size whatever the browser zoom is.
 *
 * Everything we draw is in CSS pixels, and zooming out shrinks a CSS pixel — so
 * without this the toolbars get tiny precisely when the user zoomed out to see
 * more of the page. The anchor point is unaffected; only the panel's own scale
 * is compensated, which is why the origin matters.
 */
export function zoomStable(zoom: number, origin: string, extraTransform = ''): CSSProperties {
  const scale = 1 / (zoom || 1)
  return {
    transform: `${extraTransform} scale(${scale})`.trim(),
    transformOrigin: origin,
  }
}

/**
 * Our own root inside the shadow tree — where a popover goes to escape the panel
 * that opened it.
 *
 * Docked, the element bar is an `overflow: hidden` box around an
 * `overflow-y: auto` pane, which is precisely the arrangement a popover cannot
 * survive: anything hanging off a control in that column is sliced at the
 * column's edge. No `overflow` on the popover can help, because the clipping
 * ancestor is the thing that has to scroll. Rendering somewhere else entirely is
 * the fix, so popovers portal here and position themselves against the control
 * they belong to.
 */
export const overlayRoot = (): HTMLElement | null => {
  const shadow = document.getElementById(HOST_ID)?.shadowRoot
  return (shadow?.firstElementChild as HTMLElement | null) ?? null
}

/** Put this on a popover root so presses inside it are never "outside". */
export const POPOVER_ATTR = 'data-dm-popover'

/**
 * Closes a popover on a press outside it.
 *
 * Uses composedPath because everything we render lives in a Shadow DOM —
 * event.target would be retargeted to the host, making our own panel look like
 * an outside click. The ref comparison alone proved too brittle: a panel that
 * re-renders while being interacted with (the colour picker repaints its own
 * gradient on every drag frame) could be judged outside itself and dismiss
 * mid-gesture, so the marker attribute is checked as well.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return
    const onDown = (event: Event) => {
      const path = event.composedPath()
      const panel = ref.current
      if (panel && path.includes(panel)) return
      const inside = path.some(
        (node) => node instanceof Element && node.closest(`[${POPOVER_ATTR}]`) !== null,
      )
      if (!inside) onDismiss()
    }
    // Capture, so it runs before the controller swallows page pointer events.
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [ref, active, onDismiss])
}

/**
 * Keeps a scrollable pane's scrollbar visible while it is being used and lets it
 * dissolve once it isn't (see `.dm-scroll` in overlay.css).
 *
 * The CSS half can only key off `:hover`, which is the wrong signal: a pane you
 * are scrolling with a wheel or a trackpad often has the pointer nowhere near
 * its edge, and one you are merely passing over does not need a scrollbar at
 * all. The class this toggles is what makes it "while scrolling" rather than
 * "while hovering".
 *
 * `enabled` exists because the panes this runs on are unmounted when their panel
 * is folded away: without it the effect binds once to a ref that is still null
 * and never rebinds when the pane comes back.
 */
export function useFadingScroll(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const pane = ref.current
    if (!enabled || !pane) return
    let idle = 0
    const onScroll = () => {
      pane.classList.add('is-scrolling')
      window.clearTimeout(idle)
      idle = window.setTimeout(() => pane.classList.remove('is-scrolling'), 700)
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      pane.removeEventListener('scroll', onScroll)
      window.clearTimeout(idle)
      pane.classList.remove('is-scrolling')
    }
  }, [ref, enabled])
}

/**
 * How tall a docked panel may be, in its own (pre-counter-scale) pixels.
 *
 * The panel is counter-scaled by 1/zoom so it holds a constant physical size,
 * which means its footprint on screen is `height / zoom` — so a plain
 * `calc(100vh - 86px)` would overflow the window by exactly the zoom factor the
 * moment anyone zoomed out. The height it is *given* has to be divided by the
 * same number its footprint is multiplied by.
 *
 * The 12 is the unscaled top offset, which a transform does not move; the 62 is
 * the room the status bar's own counter-scaled footprint needs at the bottom.
 *
 * Returns the room available, not what to do with it. The caller decides: on
 * the canvas the panels are the window's furniture and take it as a `height`,
 * running the full height of the screen the way a design tool's panels do; off
 * it they take it as a `maxHeight` and hug their contents, so a short tree does
 * not cover half the page for no reason.
 */
export const dockedHeight = (scale: number): number =>
  Math.max(200, (window.innerHeight - 12) * scale - 62)

/** The height rule for a docked panel — filled on the canvas, hugging off it. */
export const dockedBox = (scale: number, stretch: boolean): CSSProperties =>
  stretch ? { height: dockedHeight(scale) } : { maxHeight: dockedHeight(scale) }
