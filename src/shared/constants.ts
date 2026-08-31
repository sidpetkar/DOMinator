/** Attribute stamped on every node we create inside the host page. */
export const OWN_NODE_ATTR = 'data-dominator'

/** id of the single host element we append to <body> to carry our Shadow DOM. */
export const HOST_ID = 'dominator-root'

/**
 * The transparent pane held over the page in canvas mode (see shield.ts).
 *
 * Deliberately *not* `OWN_NODE_ATTR`: the shield has to be invisible to the
 * picker but visible to the event handlers, and those two are told apart by
 * exactly this. Own nodes are chrome, whose events belong to the chrome; the
 * shield's events are the page's, arriving through it.
 */
export const SHIELD_ATTR = 'data-dominator-shield'

/** Marks elements DOMinator has edited, so edits are findable/revertable. */
export const EDITED_ATTR = 'data-dominator-edited'

/**
 * Marks an auto-layout wrapper DOMinator created (Shift+A). Distinct from
 * OWN_NODE_ATTR: a group lives *in* the page and must stay selectable, whereas
 * OWN_NODE_ATTR means "chrome, never a target".
 */
export const GROUP_ATTR = 'data-dominator-group'

/**
 * The id of the JSON block a saved canvas carries, and the thing that makes a
 * `.dom.html` file recognisable as one of ours.
 *
 * A saved canvas is an ordinary web page — that is the whole point of the
 * format, since it means anyone can open it with nothing installed. What makes
 * it *ours* is this one script block: the view transform, the surface colour,
 * where it came from, and which elements carry our edits. Finding it is how the
 * extension knows to open in canvas mode instead of treating the file as a
 * random page.
 */
export const SNAPSHOT_STATE_ID = 'dominator-canvas-state'

/**
 * Set on `<html>` by the content script the moment it takes over a saved
 * canvas, so the viewer baked into the file can stand down.
 *
 * The file's own bar and the extension's own bar do the same job, and two of
 * them on screen is the file arguing with the tool that made it. The attribute
 * is the handshake: it is on the DOM rather than sent as a message because the
 * viewer runs in the page's world and the content script does not, and an
 * attribute is the one thing both of them can see.
 */
export const EDITOR_PRESENT_ATTR = 'data-dominator-editor'

/** Where the "install it" button in a saved file points. */
export const STORE_URL = 'https://chromewebstore.google.com/'

/** Functional palette. The only saturated colours in the product (see PRD §4). */
export const COLORS = {
  padding: 'rgba(122, 201, 67, 0.32)',
  paddingLine: 'rgba(122, 201, 67, 0.9)',
  margin: 'rgba(246, 133, 63, 0.28)',
  marginLine: 'rgba(246, 133, 63, 0.85)',
  /** Space between a container's children — distinct from its own margin. */
  gap: 'rgba(232, 62, 156, 0.26)',
  gapLine: 'rgba(232, 62, 156, 0.9)',
  select: '#0a84ff',
  hover: 'rgba(10, 132, 255, 0.65)',
} as const
