import { useEffect, type CSSProperties, type RefObject } from 'react'
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
export function zoomStable(
  zoom: number,
  origin: string,
  extraTransform = '',
): CSSProperties {
  const scale = 1 / (zoom || 1)
  return {
    transform: `${extraTransform} scale(${scale})`.trim(),
    transformOrigin: origin,
  }
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
