import { restoreStyle } from './styles'

/**
 * Undo *and* redo, from one idea: a step knows how to apply itself and hands
 * back the step that puts things back.
 *
 * Running a step returns its inverse, so undo and redo are the same machine
 * pointed in opposite directions — pop from one stack, run it, push what comes
 * back onto the other. Nothing has to remember which direction it is facing,
 * and a step can never end up with a stale inverse, because the inverse is
 * built at the moment the change is actually applied.
 */
export interface Step {
  label: string
  /** Applies the change and returns the step that undoes it. */
  run: () => Step
}

const LIMIT = 60
const stack: Step[] = []
const redoStack: Step[] = []

/** Bound on how much of a subtree a style step captures — matches cascade(). */
const TREE_LIMIT = 800

type Snapshot = [HTMLElement, string | null][]

function snapshot(el: HTMLElement): Snapshot {
  const nodes: HTMLElement[] = [el]
  const descendants = el.querySelectorAll<HTMLElement>('*')
  if (descendants.length <= TREE_LIMIT) nodes.push(...descendants)
  return nodes.map((node) => [node, node.getAttribute('style')])
}

/** The same nodes, as they look right now. The "after" half of a style step. */
const resnapshot = (before: Snapshot): Snapshot =>
  before.map(([node]) => [node, node.getAttribute('style')])

const apply = (captured: Snapshot) => () => {
  for (const [node, value] of captured) restoreStyle(node, value)
}

/**
 * Ties two one-way functions into a step and its mirror. They point at each
 * other, so the pair can be walked back and forth any number of times.
 */
function pair(label: string, undo: () => void, redo: () => void): Step {
  const backward: Step = { label, run: () => (undo(), forward) }
  const forward: Step = { label, run: () => (redo(), backward) }
  return backward
}

function pushStep(step: Step): void {
  stack.push(step)
  if (stack.length > LIMIT) stack.shift()
}

/**
 * Records a change that has already happened (or is about to, for the
 * structural recorders below). A new step invalidates the redo branch: once you
 * undo three things and then do something else, those three have nowhere to
 * come back to.
 */
export function record(label: string, undo: () => void, redo: () => void): void {
  pushStep(pair(label, undo, redo))
  redoStack.length = 0
}

/**
 * A drag is one undo step, not one per frame.
 *
 * begin() captures the subtree before the gesture; commit() turns that capture
 * into a step once the gesture ends. A second begin() on the *same* element is
 * ignored, so a handler that internally triggers another styled write can't
 * split the gesture in two — but one on a different element means the previous
 * gesture ended without ever committing (a pointer lost off-window, a control
 * unmounted mid-drag). That capture is closed off rather than dropped, because
 * silently discarding it is exactly the "Ctrl+Z did nothing" bug: every change
 * from then on would land inside a step that never gets pushed.
 */
let pending: { label: string; root: HTMLElement | null; captured: Snapshot } | null = null

export function begin(label: string, el: HTMLElement): void {
  beginAll(label, [el])
}

/**
 * The same bracket over a whole set — dragging one colour across a
 * multi-selection. Identity comes from the first element, which is the primary
 * selection and so is stable for as long as the set is.
 */
export function beginAll(label: string, elements: HTMLElement[]): void {
  const root = elements[0] ?? null
  if (pending) {
    if (pending.root === root) return
    commit()
  }
  pending = { label, root, captured: elements.flatMap((el) => snapshot(el)) }
}

export function commit(): void {
  if (!pending) return
  const { label, captured } = pending
  pending = null
  // A gesture that ended up changing nothing leaves no step behind.
  const after = resnapshot(captured)
  if (after.every(([, value], i) => value === captured[i]![1])) return
  record(label, apply(captured), apply(after))
}

/** Several elements changed as one step — hiding a multi-selection. */
export function stepAll(label: string, elements: HTMLElement[], run: () => void): void {
  const captured = elements.flatMap((el) => snapshot(el))
  run()
  record(label, apply(captured), apply(resnapshot(captured)))
}

/** One discrete style change — a toolbar click, an align, a nudge. */
export function step(label: string, el: HTMLElement, run: () => void): void {
  const captured = snapshot(el)
  run()
  record(label, apply(captured), apply(resnapshot(captured)))
}

/**
 * A structural change. The inverse of a move is "put it back where it was",
 * which needs the old parent and the node it used to sit in front of. Called
 * *before* the move; the redo half reads where it ended up at undo time, which
 * is the only moment that is known.
 */
export function recordMove(el: HTMLElement, label = 'move'): void {
  const parent = el.parentElement
  if (!parent) return
  const next = el.nextSibling
  let home: Node | null = null
  let homeNext: Node | null = null
  record(
    label,
    () => {
      home = el.parentNode
      homeNext = el.nextSibling
      parent.insertBefore(el, next)
    },
    () => home?.insertBefore(el, homeNext),
  )
}

/**
 * Nodes that have just been added to the page — a paste, a duplicate. Undo
 * lifts them back out, remembering where they sat so redo can put them back.
 */
export function recordInsert(label: string, nodes: HTMLElement[]): void {
  let places: [HTMLElement, Node | null, Node | null][] = []
  record(
    label,
    () => {
      places = nodes.map((node) => [node, node.parentNode, node.nextSibling])
      for (const node of nodes) node.remove()
    },
    () => {
      for (const [node, parent, next] of places) parent?.insertBefore(node, next)
    },
  )
}

export function undo(): Step | null {
  const last = stack.pop()
  if (!last) return null
  redoStack.push(last.run())
  return last
}

export function redo(): Step | null {
  const next = redoStack.pop()
  if (!next) return null
  pushStep(next.run())
  return next
}

export const depth = (): number => stack.length

/**
 * Both counters as a store patch. Every caller that pushes a step has to
 * refresh both — a step recorded after an undo throws the redo branch away, and
 * a Redo button that stays lit over a branch that no longer exists is a button
 * that lies.
 */
export const depths = (): { undoDepth: number; redoDepth: number } => ({
  undoDepth: stack.length,
  redoDepth: redoStack.length,
})

export function clear(): void {
  stack.length = 0
  redoStack.length = 0
  pending = null
}
