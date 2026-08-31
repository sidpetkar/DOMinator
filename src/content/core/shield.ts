import { SHIELD_ATTR } from '@/shared/constants'

/**
 * A pane of glass over the page while the canvas is open.
 *
 * The problem it solves cannot be solved with JavaScript at all. `:hover` is
 * CSS: the browser recomputes it from where the real cursor is, before any
 * listener runs and regardless of what that listener does. So a board being
 * panned across a live application lights up every nav item, tooltip, dropdown
 * and focus ring it passes over — you are looking at a design and the design is
 * reacting to you, which is exactly what a canvas is for *not* doing.
 *
 * Swallowing the events does nothing. `pointer-events: none` on the page does
 * work, and takes the page out of hit-testing with it — which would leave us
 * unable to find anything to select. A transparent element on top is the one
 * arrangement that gets both: the cursor is genuinely over *this*, so the page
 * below never enters a hover state, while `elementsFromPoint` still enumerates
 * everything underneath it, because that API reports the whole stack rather
 * than only what the pointer would hit.
 *
 * Three details make it invisible in every other sense:
 *
 *  - It is not inside our shadow host, so events on it are not "our chrome" and
 *    the editor's own handlers treat them as the page presses they are.
 *  - It carries its own attribute, which `isTargetable` refuses, so it can never
 *    be hovered, selected or serialised.
 *  - Its `z-index` sits below the overlay's, so every panel and handle is still
 *    above it and still clickable.
 */

let pane: HTMLElement | null = null

export function raise(): void {
  if (pane || !document.documentElement) return
  const el = document.createElement('div')
  el.setAttribute(SHIELD_ATTR, '')
  /**
   * `inset: 0` on a fixed element, not the page's size: the shield covers the
   * *viewport*, which is the only thing the cursor can be over. The board can be
   * panned and zoomed underneath it without the shield needing to know.
   */
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483000',
    'background:transparent',
    'cursor:default',
  ].join(';')
  document.documentElement.append(el)
  pane = el
}

export function lower(): void {
  pane?.remove()
  pane = null
}

export const up = (): boolean => Boolean(pane)
