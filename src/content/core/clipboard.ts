import { EDITED_ATTR } from '@/shared/constants'
import { describe } from './geometry'
import * as history from './history'
import { canContainChildren } from './reorder'
import { deserialize, publish, serialize, shared } from './transfer'

export { watchShared } from './transfer'

/**
 * Copy an element, paste it somewhere else — in this tab or in another one.
 *
 * What is stored locally is a detached deep clone, not a reference: the original
 * can be edited, moved or hidden afterwards and the clipboard still holds what
 * was copied. Each paste clones *that* clone, so one copy can be pasted
 * repeatedly.
 *
 * Every copy is *also* published to a shelf shared by every tab, as markup with
 * the cascade resolved into it (see transfer.ts). Both are kept because they are
 * good at different things: the local clone is lossless and free, while the
 * serialised form is the only one that can survive the trip to a page with
 * different stylesheets. Whichever was copied more recently is the one that
 * pastes, so the rule is simply "the last thing you copied, wherever you copied
 * it" — and a same-tab copy/paste never pays the serialisation's cost or its
 * small loss of fidelity.
 */
let stored: { nodes: HTMLElement[]; label: string; at: number } | null = null

/** Whichever clipboard holds the most recent copy. */
const freshest = (): 'local' | 'shared' | null => {
  const remote = shared()
  if (stored && (!remote || stored.at >= remote.at)) return 'local'
  return remote ? 'shared' : null
}

export const has = (): boolean => freshest() !== null

export interface Summary {
  label: string
  count: number
  /** Copied in a different tab, so it arrives with its styles baked in. */
  foreign: boolean
  /** Host it came from, when that isn't this page. */
  origin: string | null
}

/**
 * What the paste button shows. Deliberately does not deserialise: this is read on
 * every render, and parsing a few hundred nodes to draw a label would be absurd.
 */
export function summary(): Summary | null {
  const which = freshest()
  if (which === 'local' && stored) {
    return { label: stored.label, count: stored.nodes.length, foreign: false, origin: null }
  }
  const remote = which === 'shared' ? shared() : null
  if (!remote) return null
  return {
    label: remote.label,
    count: remote.count,
    foreign: true,
    origin: remote.origin === location.host ? null : remote.origin,
  }
}

export const label = (): string | null => summary()?.label ?? null
export const count = (): number => summary()?.count ?? 0

/**
 * Copies one element or a whole multi-selection, in document order.
 *
 * The shared copy is deliberately not awaited: publishing is a storage write and
 * the local clipboard is already usable. Returns whatever went wrong with the
 * shared half, so the caller can say the copy is this-tab-only rather than
 * letting the user discover it in another tab.
 */
export function copy(elements: HTMLElement[]): { label: string; shareError?: string } {
  const list = elements.filter(Boolean)
  if (!list.length) return { label: '' }

  const label = list.length === 1 ? describe(list[0]!) : `${list.length} elements`
  const at = Date.now()
  stored = { nodes: list.map((el) => el.cloneNode(true) as HTMLElement), label, at }

  const packed = serialize(list)
  if (!packed.ok) return { label, shareError: packed.reason }
  void publish({ at, label, count: list.length, origin: location.host, html: packed.html })
  return { label }
}

/**
 * Drops this tab's clone. The shared shelf is left alone on purpose: copying in
 * one tab and then closing the editor there before pasting in another is the
 * whole point, so its lifetime belongs to the browser session, not to a tab's
 * editor being open.
 */
export function clear(): void {
  stored = null
}

let counter = 0

/**
 * A clone carries the original's ids and our own bookkeeping attributes.
 * Duplicate ids break `getElementById`, label/for pairs and anchor links, so
 * they are suffixed rather than dropped — dropping them would also lose any
 * `#id` styling, which is the thing that makes the copy look right.
 */
function sanitise(root: HTMLElement): void {
  counter += 1
  for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute(EDITED_ATTR)
    node.removeAttribute('contenteditable')
    if (node.id) node.id = `${node.id}-copy${counter}`
  }
}

export interface PasteResult {
  /** The first pasted node — what the selection moves to. */
  node: HTMLElement
  /** Where it landed, for the status readout. */
  container: HTMLElement
}

/**
 * Elements that *can* hold children but shouldn't receive a pasted block. A
 * heading or a button will happily nest a card — the DOM allows it and it looks
 * absurd. Pasting lands beside these instead.
 */
const TEXT_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'SPAN', 'A', 'BUTTON', 'LABEL', 'STRONG', 'EM', 'B', 'I', 'SMALL',
  'CODE', 'PRE', 'BLOCKQUOTE', 'CAPTION', 'SUMMARY',
])

const isPasteContainer = (el: HTMLElement): boolean =>
  canContainChildren(el) && !TEXT_TAGS.has(el.tagName.toUpperCase())

/**
 * Pastes into the target when it is a container, otherwise beside it.
 *
 * "Into" is what you want after selecting a card or a section; "beside" is what
 * you want after selecting a heading or a button. Judging that from the target
 * rather than asking keeps it to a single keystroke.
 */
export function paste(target: HTMLElement): PasteResult | null {
  const which = freshest()
  if (!which) return null

  /**
   * The local clone is cloned again so one copy pastes repeatedly; the shared
   * form is parsed fresh each time, which does the same thing for free.
   */
  const sources: Element[] =
    which === 'local' ? (stored?.nodes ?? []) : deserialize(shared()?.html ?? '')
  if (!sources.length) return null

  const into = isPasteContainer(target)
  const added: HTMLElement[] = []

  // A multi-copy pastes in the order it was taken, each after the last, so the
  // group keeps its original sequence rather than arriving reversed.
  let anchor: HTMLElement | null = null
  for (const source of sources) {
    const node = source.cloneNode(true) as HTMLElement
    sanitise(node)
    if (anchor) anchor.after(node)
    else if (into) target.append(node)
    else target.after(node)
    anchor = node
    added.push(node)
  }

  history.push({ label: 'paste', undo: () => added.forEach((node) => node.remove()) })
  const first = added[0]!
  return { node: first, container: into ? target : (first.parentElement ?? target) }
}

/** Same element, dropped in right after the original. */
export function duplicate(el: HTMLElement): HTMLElement {
  const node = el.cloneNode(true) as HTMLElement
  sanitise(node)
  el.after(node)
  history.push({ label: 'duplicate', undo: () => node.remove() })
  return node
}
