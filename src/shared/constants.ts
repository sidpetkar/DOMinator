/** Attribute stamped on every node we create inside the host page. */
export const OWN_NODE_ATTR = 'data-dominator'

/** id of the single host element we append to <body> to carry our Shadow DOM. */
export const HOST_ID = 'dominator-root'

/** Marks elements DOMinator has edited, so edits are findable/revertable. */
export const EDITED_ATTR = 'data-dominator-edited'

/**
 * Marks an auto-layout wrapper DOMinator created (Shift+A). Distinct from
 * OWN_NODE_ATTR: a group lives *in* the page and must stay selectable, whereas
 * OWN_NODE_ATTR means "chrome, never a target".
 */
export const GROUP_ATTR = 'data-dominator-group'

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
