import { EDITED_ATTR } from '@/shared/constants'
import { describe } from './geometry'
import * as history from './history'
import { undress } from './frames'
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
let stored: {
  nodes: HTMLElement[]
  label: string
  at: number
  /**
   * The same copy with its cascade resolved, kept even for a same-tab paste.
   *
   * The local clone is lossless *markup*, which is all a paste back into the
   * page needs — the stylesheets that dressed it are still there. It is not
   * enough for a paste onto the canvas: the copy lands as a child of `body`, so
   * every rule that styled it through its context (`.card p`, `.row > .card`)
   * stops matching and the text arrives black, or the block arrives empty. This
   * is the version that carries its own appearance, and it is already being
   * computed for the cross-tab shelf, so keeping it costs nothing.
   */
  html: string | null
  /**
   * The container the copy was taken out of.
   *
   * A clone is only lossless where the stylesheets that dressed it still apply,
   * and that is a fact about *where it lands*, not about the copy. Pasted back
   * among its old siblings it is perfect; pasted into a different section, every
   * rule that reached it through its context — `.card p`, `.pricing .title` —
   * stops matching and the text arrives black. Keeping the old home is what lets
   * the paste tell those two cases apart (see `takeFor`).
   */
  home: HTMLElement | null
} | null = null

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
  const clones = list.map((el) => el.cloneNode(true) as HTMLElement)

  const packed = serialize(list)
  stored = {
    nodes: clones,
    label,
    at,
    html: packed.ok ? packed.html : null,
    home: list[0]?.parentElement ?? null,
  }
  if (!packed.ok) return { label, shareError: packed.reason }
  void publish({ at, label, count: list.length, origin: location.host, html: packed.html })
  return { label }
}

/**
 * Drops this tab's clone.
 *
 * Not called when the editor closes, which it used to be. The shared shelf
 * outlives a closed editor by design, so clearing only the local half meant a
 * toggle off and on silently swapped a lossless clone for its serialised twin —
 * the same element pasted differently depending on whether you had happened to
 * press Ctrl+Shift+E in between, and pasted nothing at all if it had been too
 * large to serialise. Both halves now have the same lifetime: the browser
 * session, which is the lifetime of the thing the user thinks they copied.
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

export const isPasteContainer = (el: HTMLElement): boolean =>
  canContainChildren(el) && !TEXT_TAGS.has(el.tagName.toUpperCase())

/**
 * Pastes into the target when it is a container, otherwise beside it.
 *
 * "Into" is what you want after selecting a card or a section; "beside" is what
 * you want after selecting a heading or a button. Judging that from the target
 * rather than asking keeps it to a single keystroke.
 */
/**
 * Fresh copies of whatever is on the clipboard, inserted nowhere and recorded
 * nowhere.
 *
 * Split out of `paste` for the canvas, which needs the nodes before it knows
 * where they are going: they have to be stood up somewhere in the document to be
 * measured and to have their cascade resolved, and that staging must not become
 * an undo step of its own — one Ctrl+V should be one Ctrl+Z.
 */
export function take(): HTMLElement[] {
  const which = freshest()
  if (!which) return []
  /**
   * The local clone is cloned again so one copy pastes repeatedly; the shared
   * form is parsed fresh each time, which does the same thing for free.
   */
  const sources: Element[] =
    which === 'local' ? (stored?.nodes ?? []) : deserialize(shared()?.html ?? '')
  const copies: HTMLElement[] = []
  for (const source of sources) {
    const node = source.cloneNode(true) as HTMLElement
    sanitise(node)
    copies.push(node)
  }
  return copies
}

/**
 * The same copy, dressed — for a paste that is leaving its old context behind.
 *
 * Used by the canvas paste, which stands the copy on the surface rather than
 * back in the page. Falls through to the ordinary clone whenever there is no
 * resolved form to be had (a selection too large to serialise), which is worse
 * than nothing only in the way it always was.
 */
export function takeStyled(): HTMLElement[] {
  const which = freshest()
  const html = which === 'local' ? stored?.html : shared()?.html
  if (!html) return take()
  const copies = deserialize(html)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => node.cloneNode(true) as HTMLElement)
  for (const node of copies) sanitise(node)
  return copies.length ? copies : take()
}

/**
 * The copies to use for *this* destination.
 *
 * Home is the lossless clone: back among the siblings it came from, the page's
 * own rules still reach it and nothing has to be baked in. Anywhere else is the
 * resolved form, because the context that dressed it is gone.
 *
 * This is the fix for a paste that arrived with black text: the plain clone was
 * used everywhere, so copying a styled paragraph out of one section and pasting
 * it into another produced markup no rule matched any more. The cost of always
 * using the resolved form instead would be a same-place paste that quietly
 * became a wall of inline styles — so the destination decides.
 */
function takeFor(target: HTMLElement): HTMLElement[] {
  const home = stored?.home
  const landing = isPasteContainer(target) ? target : target.parentElement
  return home && landing === home ? take() : takeStyled()
}

export function paste(target: HTMLElement): PasteResult | null {
  const nodes = takeFor(target)
  if (!nodes.length) return null
  /**
   * Anything copied off the canvas arrives still dressed as a canvas object —
   * absolutely positioned, at a fixed size, pinned to coordinates that mean
   * nothing here. Pasting it into a container is a request to make it part of
   * that container, so the dressing comes off and it takes its place in the
   * stack like any other child.
   */
  for (const node of nodes) undress(node)

  const into = isPasteContainer(target)
  const added: HTMLElement[] = []

  // A multi-copy pastes in the order it was taken, each after the last, so the
  // group keeps its original sequence rather than arriving reversed.
  let anchor: HTMLElement | null = null
  for (const node of nodes) {
    if (anchor) anchor.after(node)
    else if (into) target.append(node)
    else target.after(node)
    anchor = node
    added.push(node)
  }

  history.recordInsert('paste', added)
  const first = added[0]!
  return { node: first, container: into ? target : (first.parentElement ?? target) }
}

/** Same element, dropped in right after the original. */
export function duplicate(el: HTMLElement): HTMLElement {
  const node = el.cloneNode(true) as HTMLElement
  sanitise(node)
  el.after(node)
  history.recordInsert('duplicate', [node])
  return node
}
