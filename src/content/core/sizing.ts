import { clearStyle, px, setStyle } from './styles'

/**
 * Fixed, hug, fill — the three answers to "how wide is this".
 *
 * Every design tool has settled on the same three because they are the three
 * things a box can be told: be this many pixels, be as big as what is inside
 * you, or be as big as what is around you. CSS says all three, it just says them
 * in three different vocabularies — a length, `fit-content`, and one of
 * `flex-grow` / `align-self: stretch` / `100%` depending on what the parent
 * turns out to be. That last one is the whole reason this file exists: "fill" is
 * not a property, it is a different property per context, and picking the right
 * one is not something a panel can ask the user to do.
 *
 * Nor is *defending* the answer. A width of 100% is defeated by a margin, by a
 * `max-width` three stylesheets away, by `box-sizing: content-box` and by an
 * element that happens to be `display: inline`; a `flex-grow` is defeated by the
 * minimum size flexbox gives every item by default. Each of those turns Fill
 * into a control that visibly does nothing, and every one of them is common on
 * real pages. So each mode writes the whole set of declarations that makes it
 * true, and clears the ones the other two left behind.
 */

export type SizeMode = 'fixed' | 'hug' | 'fill'
export type SizeAxis = 'width' | 'height'

export interface SizeInfo {
  mode: SizeMode
  /** The box as drawn, in CSS pixels — what a Fixed field shows and edits. */
  value: number
  /** Whether Fill is a thing this element could even do (see `canFill`). */
  fillable: boolean
}

/** The four properties that decide one axis, and the two that get in its way. */
const AXIS = {
  width: {
    size: 'width',
    min: 'min-width',
    max: 'max-width',
    near: 'margin-left',
    far: 'margin-right',
  },
  height: {
    size: 'height',
    min: 'min-height',
    max: 'max-height',
    near: 'margin-top',
    far: 'margin-bottom',
  },
} as const

const KEYWORD = /(fit|min|max)-content/

/**
 * The margins Fill overrode, so leaving Fill puts them back.
 *
 * Fill and a margin are two answers to the same question — a box cannot both be
 * exactly as wide as the room and be inset from it — so Fill wins, which is what
 * every design tool means by fill and what was asked for here. Zeroing them
 * without remembering them would make the override permanent, and a mode switch
 * that quietly eats a margin you set two minutes ago is not a mode switch anyone
 * would use twice.
 *
 * The *inline* value is what is kept: that is the only part that was ours to
 * take away. A margin from the page's own stylesheet comes back on its own the
 * moment ours is cleared.
 */
const heldMargins = new WeakMap<HTMLElement, Partial<Record<string, string>>>()

function overrideMargins(el: HTMLElement, axis: SizeAxis): void {
  const { near, far } = AXIS[axis]
  const held = heldMargins.get(el) ?? {}
  for (const prop of [near, far]) {
    if (!(prop in held)) held[prop] = el.style.getPropertyValue(prop)
    setStyle(el, prop, '0px')
  }
  heldMargins.set(el, held)
}

/**
 * Puts back what Fill took, and — crucially — does nothing at all when Fill
 * never took anything.
 *
 * The absent guard was a live bug: `reset()` runs at the top of *every* mode
 * change, so with no record to consult this cleared both margins unconditionally
 * and a margin you had just set through the Margin control vanished the first
 * time you opened the sizing menu. Only a margin this file overrode is this
 * file's to restore.
 */
function restoreMargins(el: HTMLElement, axis: SizeAxis): void {
  const { near, far } = AXIS[axis]
  const held = heldMargins.get(el)
  if (!held) return
  for (const prop of [near, far]) {
    if (!(prop in held)) continue
    const was = held[prop]
    if (was) setStyle(el, prop, was)
    else clearStyle(el, prop)
    delete held[prop]
  }
}

/**
 * Whether the element is being stretched by its parent's flex layout.
 *
 * Only an *explicit* stretch counts. `align-items` defaults to `normal`, which
 * behaves as stretch, so counting the inherited value would report Fill for
 * essentially every child of every flex container on the web — true in a
 * technical sense and useless as a readout, because it would never say anything
 * else. What is reported is what someone chose.
 */
function stretching(el: HTMLElement, axis: SizeAxis): boolean {
  const parent = el.parentElement
  if (!parent) return false
  const parentStyle = window.getComputedStyle(parent)
  if (!parentStyle.display.includes('flex')) return false
  const style = window.getComputedStyle(el)
  if (axis === mainAxis(parentStyle)) return Number.parseFloat(style.flexGrow) > 0
  return style.alignSelf === 'stretch'
}

const mainAxis = (parentStyle: CSSStyleDeclaration): SizeAxis =>
  parentStyle.flexDirection.startsWith('row') ? 'width' : 'height'

/** Already as wide as the room its parent gives it, which is what Fill means. */
function fillsParent(el: HTMLElement, axis: SizeAxis): boolean {
  const parent = el.parentElement
  if (!parent) return false
  const box = parent.getBoundingClientRect()
  const style = window.getComputedStyle(parent)
  const [near, far] =
    axis === 'width'
      ? [
          Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth),
          Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth),
        ]
      : [
          Number.parseFloat(style.paddingTop) + Number.parseFloat(style.borderTopWidth),
          Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth),
        ]
  const room = (axis === 'width' ? box.width : box.height) - near - far
  const own = el.getBoundingClientRect()
  return Math.abs((axis === 'width' ? own.width : own.height) - room) < 1.5
}

/**
 * Whether Fill can be offered at all.
 *
 * It needs something to fill: an element with no parent but the document, or one
 * taken out of the flow entirely — a canvas object, anything absolutely
 * positioned — has no container whose width it could take. Offering the choice
 * there would be a control that silently does nothing, which is worse than a
 * control that is not there.
 */
export function canFill(el: HTMLElement): boolean {
  const parent = el.parentElement
  if (!parent || parent === document.documentElement) return false
  const position = window.getComputedStyle(el).position
  return position !== 'absolute' && position !== 'fixed'
}

export function readSize(el: HTMLElement, axis: SizeAxis): SizeInfo {
  const rect = el.getBoundingClientRect()
  const value = axis === 'width' ? rect.width : rect.height
  const fillable = canFill(el)
  const inline = el.style.getPropertyValue(AXIS[axis].size)

  const mode = ((): SizeMode => {
    if (KEYWORD.test(inline)) return 'hug'
    if (inline === '100%' || stretching(el, axis)) return 'fill'
    if (inline) return 'fixed'
    /**
     * Nothing of ours on it, so the page is deciding — and the page's answer is
     * still one of the three. A height with no declaration is `auto`, which is
     * exactly hug; a width that comes out the full width of its container is
     * what fill produces. Anything else is a length someone wrote, whoever wrote
     * it, and Fixed is the honest word for that.
     */
    if (axis === 'height') return 'hug'
    return fillable && fillsParent(el, axis) ? 'fill' : 'fixed'
  })()

  return { mode, value, fillable }
}

/**
 * Clears every declaration any of the three modes might have left on this axis.
 *
 * Run first, always. A `flex-grow` that survives a switch to Fixed is a box that
 * ignores the number it was just given; a `max-width` left over from a Fill is a
 * ceiling on a Hug. The modes are exclusive, so the writes have to be too.
 */
function reset(el: HTMLElement, axis: SizeAxis): void {
  const { size, min, max } = AXIS[axis]
  for (const prop of [size, min, max, 'flex', 'flex-grow', 'flex-basis', 'align-self', 'display']) {
    clearStyle(el, prop)
  }
  restoreMargins(el, axis)
}

/**
 * An `inline` box has no width, no height and no margins that move it — the
 * properties every one of these modes is written in are simply ignored on it.
 * Promoting it is the only way any of them can mean anything, and it is what the
 * user asked for by choosing a size at all.
 */
function layoutable(el: HTMLElement, mode: SizeMode): void {
  if (window.getComputedStyle(el).display !== 'inline') return
  setStyle(el, 'display', mode === 'hug' ? 'inline-block' : 'block')
}

export function setSizeMode(
  el: HTMLElement,
  axis: SizeAxis,
  mode: SizeMode,
  value?: number,
): void {
  reset(el, axis)
  layoutable(el, mode)
  const { size, min, max } = AXIS[axis]

  if (mode === 'fixed') {
    const rect = el.getBoundingClientRect()
    setStyle(el, size, px(Math.max(0, value ?? (axis === 'width' ? rect.width : rect.height))))
    // The number means the box you are looking at, border included.
    setStyle(el, 'box-sizing', 'border-box')
    // A page `max-width` would otherwise clamp the value straight back, and a
    // parent's flex would stretch it off the number entirely.
    setStyle(el, max, 'none')
    setStyle(el, 'flex', 'none')
    return
  }

  if (mode === 'hug') {
    setStyle(el, size, 'fit-content')
    // Two ways a parent overrules a content-sized box, and both are the default:
    // flex grows it along the main axis, and stretches it across the other.
    setStyle(el, 'flex', 'none')
    if (isCrossAxis(el, axis)) setStyle(el, 'align-self', 'flex-start')
    setStyle(el, max, 'none')
    return
  }

  // — fill ——————————————————————————————————————————————————————
  /**
   * A margin is the one thing that can be inset from the room and still claim to
   * fill it. Fill wins; the values are kept so switching back returns them.
   */
  overrideMargins(el, axis)
  setStyle(el, 'box-sizing', 'border-box')
  setStyle(el, max, 'none')

  const parent = el.parentElement
  const parentStyle = parent ? window.getComputedStyle(parent) : null
  const flexParent = Boolean(parentStyle?.display.includes('flex'))

  if (flexParent && parentStyle && axis === mainAxis(parentStyle)) {
    /**
     * `flex-basis: 0` as well as a grow, or each item's own content still sets
     * its share and two "filling" siblings come out different widths — and
     * `min-width: 0`, because a flex item's automatic minimum size is its
     * content, which is what stops a long word from ever letting the box shrink.
     * These two are the most common reason "fill" appears to do nothing.
     */
    setStyle(el, 'flex', '1 1 0%')
    setStyle(el, min, '0')
    return
  }
  if (flexParent) {
    setStyle(el, 'align-self', 'stretch')
    setStyle(el, min, '0')
    return
  }
  /**
   * A block parent, where filling is a percentage. Width always works; height
   * only when the parent's own height is definite, which is CSS's rule and not
   * one we can write our way around — an auto-height parent has no height for a
   * percentage to be a percentage *of*. The declaration is still written, so the
   * panel and the page agree about what was asked for.
   */
  setStyle(el, size, '100%')
}

const isCrossAxis = (el: HTMLElement, axis: SizeAxis): boolean => {
  const parent = el.parentElement
  if (!parent) return false
  const parentStyle = window.getComputedStyle(parent)
  return parentStyle.display.includes('flex') && axis !== mainAxis(parentStyle)
}

/** Typing a number is also a choice of Fixed — the two cannot disagree. */
export const setFixedSize = (el: HTMLElement, axis: SizeAxis, value: number): void => {
  setSizeMode(el, axis, 'fixed', value)
}
