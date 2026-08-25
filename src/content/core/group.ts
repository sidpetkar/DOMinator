import { GROUP_ATTR } from '@/shared/constants'
import { measure, type Edges, type Metrics, type Rect } from './geometry'
import * as history from './history'
import { axisOf, readAxisGap, type Axis } from './layout'
import { px, restoreStyle, setStyle } from './styles'

/**
 * Figma's auto-layout gesture, in the DOM: Shift+A wraps the selection in a flex
 * container so the stack and align controls have something to act on.
 *
 * The whole point is that alignment needs a *parent*. Two sibling cards can't be
 * centred relative to each other — `justify-content` lives on the box that holds
 * them — so the tool has to be able to manufacture that box. This is the only
 * place DOMinator adds structure to a page rather than restyling it.
 *
 * The new container inherits nothing and imposes nothing: direction, gap and
 * cross-axis alignment are all *read off what the elements were already doing*,
 * and the wrapper then takes as much care as it can to occupy exactly the space
 * they did. Grouping is meant to be a change of ownership, not of appearance;
 * anything that visibly moved the page would have to be undone before the user
 * could start using the controls they grouped for.
 *
 * The one thing it does change is where spacing lives: margins along the stack
 * move off the members and onto the container as `gap`. That is what auto-layout
 * *is* — if the members kept their own margins, the gap control would be lying
 * about the space it edits from the very first drag.
 */

/** Only same-parent siblings can be wrapped — see `plan()`. */
export type GroupPlan =
  | { ok: true; items: HTMLElement[]; parent: HTMLElement }
  | { ok: false; reason: string }

export const isGroup = (el: Element | null): boolean => Boolean(el?.hasAttribute?.(GROUP_ATTR))

/**
 * Decides whether a selection can be wrapped, and says why not when it can't.
 *
 * The one hard rule is a shared parent. Wrapping elements from different corners
 * of the page would mean *moving* them — the group can only exist in one place,
 * so one of them has to leave the layout it was part of, and which one is a
 * question only the user can answer. Cut-and-paste already expresses that intent
 * precisely, so the refusal points at it rather than guessing.
 *
 * Siblings need not be adjacent: grouping the 1st and 4th child pulls the 4th up
 * next to the 1st, which is visible, undoable, and what the same gesture does in
 * Figma.
 */
export function plan(elements: HTMLElement[]): GroupPlan {
  const items = elements.filter((el) => el.isConnected)
  if (!items.length) return { ok: false, reason: 'Select something to group' }

  const parent = items[0]!.parentElement
  if (!parent) return { ok: false, reason: "That element isn't inside a container" }
  if (items.some((el) => el.parentElement !== parent)) {
    return {
      ok: false,
      reason:
        'Those live in different containers — cut one (Ctrl/Cmd+X) and paste it beside the other first',
    }
  }
  return { ok: true, items, parent }
}

/** True when the current selection could be grouped — drives the hint pill. */
export const canGroup = (elements: HTMLElement[]): boolean => plan(elements).ok

// — reading the arrangement ————————————————————————————————————

const START: Record<Axis, [keyof Edges, keyof Edges]> = {
  row: ['left', 'right'],
  column: ['top', 'bottom'],
}

const mainStart = (rect: Rect, axis: Axis): number => (axis === 'row' ? rect.left : rect.top)
const mainSize = (rect: Rect, axis: Axis): number => (axis === 'row' ? rect.width : rect.height)
const mainEnd = (rect: Rect, axis: Axis): number => mainStart(rect, axis) + mainSize(rect, axis)

/**
 * Which way the elements already read. Taken from the spread of their centres
 * rather than from any display value: two boxes side by side are a row whether
 * that came from flex, floats, inline-block or a table cell, and it is the
 * arrangement the user can see that the new container has to reproduce.
 */
function inferAxis(rects: Rect[]): Axis {
  const spread = (axis: Axis) => {
    const centres = rects.map((r) => mainStart(r, axis) + mainSize(r, axis) / 2)
    return Math.max(...centres) - Math.min(...centres)
  }
  return spread('row') > spread('column') ? 'row' : 'column'
}

/**
 * Pairs of members that were already sitting next to each other.
 *
 * Only these carry a real seam. Group the 1st and 4th card and the distance
 * between them is two other cards wide — reading that as the group's gap would
 * open a hole the width of the elements that just got squeezed out, which is the
 * opposite of what grouping them was for.
 */
function adjacentPairs(parent: HTMLElement, items: HTMLElement[]): [HTMLElement, HTMLElement][] {
  const members = new Set<Element>(items)
  const pairs: [HTMLElement, HTMLElement][] = []
  let previous: HTMLElement | null = null
  for (const child of parent.children) {
    if (!members.has(child)) {
      previous = null
      continue
    }
    if (previous) pairs.push([previous, child as HTMLElement])
    previous = child as HTMLElement
  }
  return pairs
}

/** True when the members form one unbroken run of siblings. */
const isContiguous = (parent: HTMLElement, items: HTMLElement[]): boolean =>
  items.length === 1 || adjacentPairs(parent, items).length === items.length - 1

/**
 * The space already between them, border box to border box.
 *
 * Border boxes rather than margin boxes because the members' own margins along
 * this axis are about to be zeroed and handed to `gap` — so the number wanted
 * here is the whole visible seam, however it was produced: margin, collapsed
 * margin, the parent's `gap`, or a grid track.
 *
 * Median rather than mean, so one unusually wide seam in a list of five doesn't
 * inflate every other one. With no adjacent pair to measure — a selection picked
 * out of a longer list — the container's own gap is the rhythm to keep.
 */
function inferGap(
  parent: HTMLElement,
  items: HTMLElement[],
  rects: Map<HTMLElement, Rect>,
  axis: Axis,
): number {
  const gaps = adjacentPairs(parent, items)
    .map(([a, b]) => {
      const first = rects.get(a)!
      const second = rects.get(b)!
      return mainStart(first, axis) < mainStart(second, axis)
        ? mainStart(second, axis) - mainEnd(first, axis)
        : mainStart(first, axis) - mainEnd(second, axis)
    })
    .sort((a, b) => a - b)

  if (!gaps.length) return readAxisGap(parent, axis === 'row' ? 'column' : 'row')

  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
  return Math.max(0, Math.round(median))
}

/** Within this many pixels, two edges were meant to line up. */
const ALIGN_TOLERANCE = 2

/**
 * Cross-axis alignment, read off which edge the elements already share. A row of
 * cards whose vertical centres line up was centred; one whose tops line up was
 * top-aligned. When both edges match they were filling the cross axis, so
 * `stretch` — the value that keeps doing that as their content changes.
 */
function inferCrossAlign(rects: Rect[], axis: Axis): string {
  const cross: Axis = axis === 'row' ? 'column' : 'row'
  const lo = rects.map((r) => mainStart(r, cross))
  const hi = rects.map((r) => mainEnd(r, cross))
  const mid = lo.map((value, index) => (value + hi[index]!) / 2)
  const tight = (values: number[]) => Math.max(...values) - Math.min(...values) <= ALIGN_TOLERANCE

  if (tight(lo) && tight(hi)) return 'stretch'
  if (tight(mid)) return 'center'
  if (tight(lo)) return 'flex-start'
  if (tight(hi)) return 'flex-end'
  return 'stretch'
}

// — fitting into the parent ————————————————————————————————————

const sumOf = (elements: HTMLElement[], prop: 'flexGrow' | 'flexShrink'): number =>
  elements.reduce((total, el) => {
    const value = Number.parseFloat(window.getComputedStyle(el)[prop])
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)

/** Padding + border along one axis: the part of a box that never flexes. */
function fixedMain(metrics: Metrics, axis: Axis): number {
  const [from, to] = START[axis]
  return (
    metrics.padding[from] + metrics.padding[to] + metrics.border[from] + metrics.border[to]
  )
}

/**
 * How the wrapper takes over its items' share of the parent's layout.
 *
 * Only flex parents need this, and they need it badly: three cards at `flex: 1`
 * split the row in thirds, so wrapping two of them leaves a parent with two items
 * that splits it in *halves* — the group visibly swells the moment it is made.
 * Summing the members' `flex-grow` restores the ratio.
 *
 * The basis is everything inside the group that never flexed: its own gaps, plus
 * each member's padding and border. Those pixels used to be charged to the parent
 * item by item and are now hidden inside the wrapper, so charging them back as
 * fixed basis leaves the free space — and therefore every sibling's size —
 * exactly as it was. `reconcile()` covers what this can't model.
 *
 * Members that don't grow want the opposite: hug them, and the wrapper's size is
 * the sum of theirs by construction.
 */
function fitToParent(
  parent: HTMLElement,
  items: HTMLElement[],
  metrics: Metrics[],
  gap: number,
): Record<string, string> {
  if (!window.getComputedStyle(parent).display.includes('flex')) return {}
  const grow = sumOf(items, 'flexGrow')
  if (!grow) return { flex: '0 0 auto' }

  const axis = axisOf(parent)
  const basis =
    gap * (items.length - 1) + metrics.reduce((total, m) => total + fixedMain(m, axis), 0)

  return {
    flex: `${grow} ${sumOf(items, 'flexShrink') || grow} ${px(basis)}`,
    /**
     * Without this the basis above is ignored. `min-width: auto` raises a flex
     * item's hypothetical size to its min-content size, and an item whose base
     * size is below its hypothetical size is *frozen* there rather than grown —
     * so the wrapper would sit at min-content and hand every spare pixel to its
     * siblings. Only the parent's main axis is released, so a column group still
     * can't be squashed shorter than its contents.
     */
    ...(axis === 'row' ? { 'min-width': '0' } : { 'min-height': '0' }),
  }
}

/**
 * Last resort when the derived flex participation didn't land.
 *
 * `fitToParent` models the common cases exactly and the exotic ones — a
 * percentage `flex-basis`, an intrinsically sized item, a wrapped line — only
 * approximately, and there is no reading of the box model that covers all of
 * them. So the result is *checked*: if the wrapper isn't occupying the span its
 * members did, it gets pinned to that span outright. Fixed pixels are a worse
 * starting point than a share of the row, which is why this is the fallback and
 * not the rule — but a group that visibly jumped is worse than either.
 */
function reconcile(wrapper: HTMLElement, axis: Axis, target: number): void {
  const actual = mainSize(wrapper.getBoundingClientRect(), axis)
  if (Math.abs(actual - target) <= 1) return
  wrapper.style.setProperty('flex', `0 0 ${px(target)}`, 'important')
}

// — the write ——————————————————————————————————————————————————

/**
 * Where each item goes if this is undone.
 *
 * The anchor has to be the next sibling that *isn't itself moving*: recording
 * "B comes after A" is useless when B is being moved too. Skipping the movers
 * makes the restore order-independent — walk the list forwards, insert each item
 * before its surviving anchor, and non-adjacent selections land back in their
 * original slots.
 */
function returnPlan(
  items: HTMLElement[],
): { el: HTMLElement; parent: HTMLElement; next: Node | null; style: string | null }[] {
  const moving = new Set<Node>(items)
  return items.map((el) => {
    let next: Node | null = el.nextSibling
    while (next && moving.has(next)) next = next.nextSibling
    return { el, parent: el.parentElement!, next, style: el.getAttribute('style') }
  })
}

/**
 * Moves the members' stack-axis margins onto the container as `gap`.
 *
 * Two things need this. Margins don't collapse inside a flex container, so a
 * column of blocks with `margin: 24px 0` would suddenly space itself at 48px;
 * and the gap control the user grouped in order to reach would be editing only
 * part of the space they can see. The group's *outer* margins are kept — folded
 * onto the wrapper, which sits in the parent's flow exactly where the run did.
 *
 * Untouched when there are no margins to move, which is the usual case for flex
 * and grid children — the edit count stays at zero for those.
 */
function absorbMargins(items: HTMLElement[], metrics: Metrics[], axis: Axis): Edges | null {
  const [from, to] = START[axis]
  const order = items.map((_, index) => index).sort((a, b) => mainStart(metrics[a]!.rect, axis) - mainStart(metrics[b]!.rect, axis))
  const first = metrics[order[0]!]!
  const last = metrics[order[order.length - 1]!]!

  let touched = false
  for (const [index, el] of items.entries()) {
    for (const side of [from, to]) {
      if (metrics[index]!.margin[side] === 0) continue
      setStyle(el, `margin-${side}`, '0px')
      touched = true
    }
  }
  if (!touched) return null
  return { top: 0, right: 0, bottom: 0, left: 0, [from]: first.margin[from], [to]: last.margin[to] }
}

/**
 * Wraps the planned items in a fresh auto-layout container and returns it.
 *
 * The wrapper's own styles are written raw rather than through `setStyle`, for
 * two reasons: it has no pristine state to remember — it did not exist before —
 * and Reset must not strip them, or it would leave a bare `div` behind and
 * collapse the group into a block stack. The first edit the user makes through
 * the element bar captures *these* styles as the wrapper's pristine state, so
 * Reset returns the group to how it was grouped.
 */
export function wrap(plan: Extract<GroupPlan, { ok: true }>): HTMLElement {
  const { items, parent } = plan
  const metrics = items.map((el) => measure(el))
  const rects = new Map(items.map((el, index) => [el, metrics[index]!.rect]))

  const axis = inferAxis([...rects.values()])
  const gap = inferGap(parent, items, rects, axis)
  const parentAxis = axisOf(parent)
  // Only a solid run has a span the wrapper can be held to; pulling scattered
  // siblings together necessarily changes the geometry (see reconcile).
  const span = isContiguous(parent, items)
    ? Math.max(...metrics.map((m) => mainEnd(m.rect, parentAxis))) -
      Math.min(...metrics.map((m) => mainStart(m.rect, parentAxis)))
    : null

  const restore = returnPlan(items)
  const wrapper = document.createElement('div')
  wrapper.setAttribute(GROUP_ATTR, '')

  const outer = absorbMargins(items, metrics, axis)
  const decls: Record<string, string> = {
    display: 'flex',
    'flex-direction': axis,
    'align-items': inferCrossAlign([...rects.values()], axis),
    gap: px(gap),
    ...fitToParent(parent, items, metrics, gap),
  }
  for (const [prop, value] of Object.entries(decls)) {
    wrapper.style.setProperty(prop, value, 'important')
  }
  if (outer) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (outer[side]) wrapper.style.setProperty(`margin-${side}`, px(outer[side]), 'important')
    }
  }

  parent.insertBefore(wrapper, items[0]!)
  for (const el of items) wrapper.append(el)
  if (span !== null) reconcile(wrapper, parentAxis, span)

  // Where the wrapper ended up, and what grouping did to each item's styles:
  // between them, everything redo needs to rebuild the group as it stood.
  const wrapperHome = wrapper.parentNode
  const wrapperNext = wrapper.nextSibling
  const grouped = restore.map(({ el }) => [el, el.getAttribute('style')] as const)

  history.record(
    'group',
    () => {
      for (const { el, parent: home, next, style } of restore) {
        restoreStyle(el, style)
        home.insertBefore(el, next)
      }
      wrapper.remove()
    },
    () => {
      wrapperHome?.insertBefore(wrapper, wrapperNext)
      for (const el of items) wrapper.append(el)
      for (const [el, style] of grouped) restoreStyle(el, style)
    },
  )

  return wrapper
}

/**
 * Dissolves a group, leaving its children where they sat.
 *
 * Every child node moves, text and comments included — a wrapper that kept stray
 * text behind would delete visible content. Restricted to our own groups (see
 * `controller.ungroupSelection`): unwrapping an arbitrary page `div` throws away
 * whatever that div's class was doing, which is a different, louder feature.
 */
export function unwrap(wrapper: HTMLElement): HTMLElement[] {
  const parent = wrapper.parentElement
  if (!parent) return []

  const moved = [...wrapper.childNodes]
  const next = wrapper.nextSibling
  for (const node of moved) parent.insertBefore(node, wrapper)
  wrapper.remove()

  history.record(
    'ungroup',
    () => {
      parent.insertBefore(wrapper, next)
      for (const node of moved) wrapper.append(node)
    },
    () => {
      for (const node of moved) parent.insertBefore(node, wrapper)
      wrapper.remove()
    },
  )

  return moved.filter((node): node is HTMLElement => node instanceof HTMLElement)
}
