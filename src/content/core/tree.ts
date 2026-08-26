import { describe } from './geometry'
import * as history from './history'
import { isTargetable } from './picker'
import { canContainChildren } from './reorder'
import { store } from './store'

/**
 * The page as a list of layers.
 *
 * Rooted at `<body>`, not at `<html>`. The head is a real part of the document
 * and a DOM inspector is right to show it, but this is not an inspector — every
 * row here is something you can select, drag and restyle, and forty `<link>`
 * rows that do none of those things would be forty rows of noise between you and
 * the two you wanted. What is listed is what the editor can act on, which is the
 * same rule the canvas already uses to decide what a click can land on.
 *
 * Nothing is snapshotted. Rows read their children straight off the live DOM at
 * render time, so a paste, an undo or the page's own script rearranging itself
 * all show up without a tree to invalidate — and a subtree that is folded shut
 * costs nothing, because its children are never walked at all.
 */
export const childrenOf = (el: Element): HTMLElement[] => [...el.children].filter(isTargetable)

export const hasChildren = (el: Element): boolean => childrenOf(el).length > 0

/** The chain from `<body>` down to an element — what has to be open to see it. */
export function ancestry(el: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  let current = el.parentElement
  while (current && current !== document.body) {
    chain.push(current)
    current = current.parentElement
  }
  if (document.body) chain.push(document.body)
  return chain
}

/**
 * A short readable line for a row — the text a leaf carries, so a page of
 * `div.flex` rows is still tellable apart.
 */
export function preview(el: HTMLElement): string {
  if (hasChildren(el)) return ''
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

export const label = describe

// — dropping ——————————————————————————————————————————————————

/** Where a dragged row would land relative to the row under the cursor. */
export type DropWhere = 'before' | 'after' | 'inside'

export interface TreeDrop {
  target: HTMLElement
  where: DropWhere
}

/**
 * Whether a move is even expressible.
 *
 * Two things make one impossible rather than merely odd: dropping something
 * into itself or into its own descendant, which would detach the subtree from
 * the document entirely, and moving `<body>`, which has nowhere to go. Both are
 * refused here rather than at the drop, so the indicator never offers a landing
 * that will not happen.
 */
export function canDrop(dragged: HTMLElement, target: HTMLElement, where: DropWhere): boolean {
  if (dragged === document.body) return false
  if (dragged === target || dragged.contains(target)) return false
  if (where === 'inside') return canContainChildren(target)
  // A sibling position needs a parent to be a sibling in.
  return Boolean(target.parentElement) && target !== document.body
}

/**
 * Reads the landing from where in the row the cursor is.
 *
 * The middle of a row means "into this", the edges mean "beside it". Bands of a
 * third rather than an even split: `inside` is the ambiguous one — it is the
 * only landing that changes the shape of the tree rather than just the order —
 * so it gets the part of the row you have to aim at, and the two orderings get
 * the edges you fall into naturally on the way past.
 *
 * A row that cannot hold children has no middle band at all; its whole height
 * splits between before and after, so dragging over a leaf always means "next
 * to this" and never dead-ends on an offer it has to refuse.
 */
export function dropAt(
  dragged: HTMLElement,
  target: HTMLElement,
  y: number,
  rect: DOMRect,
): TreeDrop | null {
  const offset = (y - rect.top) / Math.max(1, rect.height)
  const nestable = canDrop(dragged, target, 'inside')
  const where: DropWhere = !nestable
    ? offset < 0.5
      ? 'before'
      : 'after'
    : offset < 0.33
      ? 'before'
      : offset > 0.67
        ? 'after'
        : 'inside'
  return canDrop(dragged, target, where) ? { target, where } : null
}

/**
 * Performs the move, as one undo step.
 *
 * `recordMove` is taken before anything is touched, because the inverse of a
 * move is "put it back where it was" and once it has gone there is nothing left
 * to read that from.
 */
export function applyDrop(dragged: HTMLElement, drop: TreeDrop): void {
  const { target, where } = drop
  if (!canDrop(dragged, target, where)) return

  history.recordMove(dragged, 'move in tree')
  if (where === 'inside') target.append(dragged)
  else target.parentElement?.insertBefore(dragged, where === 'before' ? target : target.nextSibling)
  store.set(history.depths())
  store.remeasure()
}
