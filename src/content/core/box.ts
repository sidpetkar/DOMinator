import { parseColor, rgbToHex } from './color'
import { px, setStyle } from './styles'

/** The light grey a border starts at when you switch one on. */
export const DEFAULT_BORDER_COLOR = '#c7c7c7'

export interface BoxInfo {
  /** Hex, or null when the element paints no background of its own. */
  background: string | null
  hasBorder: boolean
  borderColor: string
  borderWidth: number
  radius: number
}

export function readBox(el: HTMLElement): BoxInfo {
  const style = window.getComputedStyle(el)
  const background = parseColor(style.backgroundColor)
  const border = parseColor(style.borderTopColor)
  const width = Number.parseFloat(style.borderTopWidth) || 0
  const kind = style.borderTopStyle
  const hasBorder = width > 0 && kind !== 'none' && kind !== 'hidden'

  /**
   * With no border set, `border-color` computes to `currentColor` — the page's
   * text colour — so reading it would make "add a border" paint a near-black
   * one. It is only trusted when a border is actually showing, or when we can
   * see an explicit inline value, which is what carries a chosen colour through
   * a hide/show round trip.
   */
  const chosen = hasBorder || Boolean(el.style.borderTopColor || el.style.borderColor)
  const chosenWidth = hasBorder || Boolean(el.style.borderTopWidth || el.style.borderWidth)

  return {
    // `transparent` and `rgba(…, 0)` both mean "no fill of its own", which the
    // swatch shows as empty rather than as black.
    background: background && background.alpha > 0 ? rgbToHex(background.rgb) : null,
    hasBorder,
    borderColor: chosen && border ? rgbToHex(border.rgb) : DEFAULT_BORDER_COLOR,
    borderWidth: chosenWidth && width > 0 ? width : 1,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
  }
}

export const setBackground = (el: HTMLElement, hex: string): void =>
  setStyle(el, 'background-color', hex)

/**
 * Switching a border on has to write all three properties: a page that never
 * styled a border has `border-style: none`, so setting only a colour or a width
 * paints nothing and the button looks broken.
 */
export function setBorder(el: HTMLElement, on: boolean, info: BoxInfo): void {
  if (!on) {
    setStyle(el, 'border-style', 'none')
    return
  }
  setStyle(el, 'border-style', 'solid')
  setStyle(el, 'border-width', px(info.borderWidth || 1))
  setStyle(el, 'border-color', info.borderColor || DEFAULT_BORDER_COLOR)
}

export const setBorderColor = (el: HTMLElement, hex: string): void =>
  setStyle(el, 'border-color', hex)

export function setBorderWidth(el: HTMLElement, width: number): void {
  setStyle(el, 'border-width', px(Math.max(0, width)))
  setStyle(el, 'border-style', 'solid')
}

export const setRadius = (el: HTMLElement, radius: number): void =>
  setStyle(el, 'border-radius', px(Math.max(0, radius)))

export type SpacingKind = 'padding' | 'margin'

export interface SpacingInfo {
  /** True when all four sides agree, which is the only time one number is honest. */
  uniform: boolean
  /** The shared value when uniform; the top side otherwise, for stepping from. */
  value: number
  sides: { top: number; right: number; bottom: number; left: number }
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

export function readSpacing(el: HTMLElement, kind: SpacingKind): SpacingInfo {
  const style = window.getComputedStyle(el)
  const sides = {
    top: Number.parseFloat(style.getPropertyValue(`${kind}-top`)) || 0,
    right: Number.parseFloat(style.getPropertyValue(`${kind}-right`)) || 0,
    bottom: Number.parseFloat(style.getPropertyValue(`${kind}-bottom`)) || 0,
    left: Number.parseFloat(style.getPropertyValue(`${kind}-left`)) || 0,
  }
  const uniform =
    Math.abs(sides.top - sides.right) < 0.5 &&
    Math.abs(sides.top - sides.bottom) < 0.5 &&
    Math.abs(sides.top - sides.left) < 0.5
  return { uniform, value: sides.top, sides }
}

/**
 * Nudging adds to every side, keeping the shape.
 *
 * Writing the shorthand instead would flatten an asymmetric box the moment you
 * pressed `+` once — a card with `12px 24px` padding would silently become
 * `16px` all round. A relative step preserves the difference the page's designer
 * put there, which is almost always what a nudge is meant to do.
 */
export function nudgeSpacing(el: HTMLElement, kind: SpacingKind, delta: number): void {
  const { sides } = readSpacing(el, kind)
  const floor = kind === 'padding' ? 0 : -Infinity
  for (const side of SIDES) {
    setStyle(el, `${kind}-${side}`, px(Math.max(floor, sides[side] + delta)))
  }
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** One edge, on its own — what the popover's four fields write. */
export const setSide = (
  el: HTMLElement,
  kind: SpacingKind,
  side: Side,
  value: number,
): void =>
  setStyle(el, `${kind}-${side}`, px(kind === 'padding' ? Math.max(0, value) : value))

/**
 * How the bar labels a four-sided quantity in the width of a few characters.
 *
 * `20` when every side agrees, `24·0` for the very common vertical/horizontal
 * pair, and `–` only when all four genuinely differ. Collapsing everything to
 * one number is what made the field look stuck; collapsing nothing would need
 * four boxes in a bar that has no room for them.
 */
export function summarise(info: SpacingInfo): { text: string; mixed: boolean } {
  const { top, right, bottom, left } = info.sides
  const r = (n: number) => Math.round(n)
  if (info.uniform) return { text: String(r(top)), mixed: false }
  if (Math.abs(top - bottom) < 0.5 && Math.abs(left - right) < 0.5) {
    return { text: `${r(top)}·${r(left)}`, mixed: false }
  }
  return { text: '–', mixed: true }
}

/** Typing a number is unambiguous: make every side exactly that. */
export function setSpacing(el: HTMLElement, kind: SpacingKind, value: number): void {
  const floor = kind === 'padding' ? 0 : -Infinity
  setStyle(el, kind, px(Math.max(floor, value)))
}
