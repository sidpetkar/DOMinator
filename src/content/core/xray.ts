import { OWN_NODE_ATTR } from '@/shared/constants'

const STYLE_ID = 'dominator-xray'
const ROOT_ATTR = 'data-dominator-xray'

/**
 * X-ray: the page's whole skeleton at once.
 *
 * Done with one injected stylesheet rather than thousands of overlay divs — a
 * real page has far too many boxes to outline individually at 60fps. Because it
 * is a stylesheet and not an edit, it never touches inline styles, never enters
 * the undo stack, and vanishes completely when switched off.
 *
 * Our own chrome is unaffected: it lives behind a shadow boundary, which page
 * CSS cannot cross. Selecting, dragging and editing all keep working while it's
 * on — it is a lens, not a mode.
 */
const CSS = `
  [${ROOT_ATTR}] *:not([${OWN_NODE_ATTR}]) {
    outline: 1px dashed rgba(10, 132, 255, 0.32) !important;
    outline-offset: -1px !important;
  }
  /* Structure is the subject, so pictures step back out of the way. */
  [${ROOT_ATTR}] img:not([${OWN_NODE_ATTR}]),
  [${ROOT_ATTR}] video:not([${OWN_NODE_ATTR}]),
  [${ROOT_ATTR}] canvas:not([${OWN_NODE_ATTR}]),
  [${ROOT_ATTR}] svg:not([${OWN_NODE_ATTR}]) {
    filter: grayscale(1) contrast(0.35) opacity(0.45) !important;
  }
  [${ROOT_ATTR}] *:not([${OWN_NODE_ATTR}]):empty {
    background-image: radial-gradient(rgba(10, 132, 255, 0.28) 1px, transparent 1px) !important;
    background-size: 4px 4px !important;
  }
`

export function setXray(on: boolean): void {
  const root = document.documentElement
  const existing = document.getElementById(STYLE_ID)

  if (!on) {
    existing?.remove()
    root.removeAttribute(ROOT_ATTR)
    return
  }

  if (!existing) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.setAttribute(OWN_NODE_ATTR, '')
    style.textContent = CSS
    document.head.append(style)
  }
  root.setAttribute(ROOT_ATTR, '')
}
