import { restoreStyle } from './styles'

export interface Step {
  label: string
  undo: () => void
}

const LIMIT = 60
const stack: Step[] = []

/** Bound on how much of a subtree a style step captures — matches cascade(). */
const TREE_LIMIT = 800

type Snapshot = [HTMLElement, string | null][]

function snapshot(el: HTMLElement): Snapshot {
  const nodes: HTMLElement[] = [el]
  const descendants = el.querySelectorAll<HTMLElement>('*')
  if (descendants.length <= TREE_LIMIT) nodes.push(...descendants)
  return nodes.map((node) => [node, node.getAttribute('style')])
}

const restore = (captured: Snapshot) => () => {
  for (const [node, value] of captured) restoreStyle(node, value)
}

export function push(step: Step): void {
  stack.push(step)
  if (stack.length > LIMIT) stack.shift()
}

/**
 * A drag is one undo step, not one per frame.
 *
 * begin() captures the subtree before the gesture; commit() turns that capture
 * into a step once the gesture ends. Nested begins are ignored, so a handler
 * that internally triggers another styled write can't split the gesture in two.
 */
let pending: { label: string; captured: Snapshot } | null = null

export function begin(label: string, el: HTMLElement): void {
  if (pending) return
  pending = { label, captured: snapshot(el) }
}

export function commit(): void {
  if (!pending) return
  push({ label: pending.label, undo: restore(pending.captured) })
  pending = null
}

/** Several elements changed as one step — hiding a multi-selection. */
export function stepAll(label: string, elements: HTMLElement[], run: () => void): void {
  const captured = elements.flatMap((el) => snapshot(el))
  run()
  push({ label, undo: restore(captured) })
}

/** One discrete style change — a toolbar click, an align, a nudge. */
export function step(label: string, el: HTMLElement, run: () => void): void {
  const captured = snapshot(el)
  run()
  push({ label, undo: restore(captured) })
}

/**
 * A structural change. The inverse of a move is "put it back where it was",
 * which needs the old parent and the node it used to sit in front of.
 */
export function recordMove(el: HTMLElement, label = 'move'): void {
  const parent = el.parentElement
  if (!parent) return
  const next = el.nextSibling
  push({ label, undo: () => parent.insertBefore(el, next) })
}

export function undo(): Step | null {
  const last = stack.pop()
  if (!last) return null
  last.undo()
  return last
}

export const depth = (): number => stack.length

export function clear(): void {
  stack.length = 0
  pending = null
}
