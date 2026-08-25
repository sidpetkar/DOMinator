import { cssColor, parseColor } from './color'
import { px, setStyle } from './styles'

/** The light grey a border starts at when you switch one on. */
export const DEFAULT_BORDER_COLOR = '#c7c7c7'

export interface BoxInfo {
  /**
   * The fill as CSS — hex while it is opaque, `rgba()` once it is not, and null
   * when the element paints no background of its own.
   *
   * Carrying the alpha rather than flattening it to hex is what lets the picker
   * open on the transparency the page already has: reading a half-opaque scrim
   * as solid, then writing that back the moment anything else in the panel was
   * touched, would quietly make it opaque.
   */
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
    background:
      background && background.alpha > 0 ? cssColor(background.rgb, background.alpha) : null,
    hasBorder,
    borderColor:
      chosen && border ? cssColor(border.rgb, border.alpha) : DEFAULT_BORDER_COLOR,
    borderWidth: chosenWidth && width > 0 ? width : 1,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
  }
}

export const setBackground = (el: HTMLElement, hex: string): void =>
  setStyle(el, 'background-color', hex)

/**
 * An exact size, typed rather than dragged.
 *
 * The same three writes a resize handle makes (see applyResize), for the same
 * reasons: `border-box` so the number means the box the user is looking at
 * rather than the box plus its padding and border, and `flex: none` so a flex
 * or grid parent doesn't immediately stretch the element back off the value it
 * was just given. Without those two a typed 300 lands as something other than
 * 300 often enough to look broken.
 *
 * One axis at a time, so setting a width leaves the height to the content.
 */
export function setSize(el: HTMLElement, axis: 'width' | 'height', value: number): void {
  setStyle(el, axis, px(Math.max(0, value)))
  setStyle(el, 'box-sizing', 'border-box')
  setStyle(el, 'flex', 'none')
}

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

export type Corner = 'tl' | 'tr' | 'br' | 'bl'

/** CSS calls them by the two edges that meet there. */
const CORNER_PROP: Record<Corner, string> = {
  tl: 'border-top-left-radius',
  tr: 'border-top-right-radius',
  br: 'border-bottom-right-radius',
  bl: 'border-bottom-left-radius',
}

export interface RadiusInfo {
  /** True when all four corners agree — the only time one number is honest. */
  uniform: boolean
  /** The shared value when uniform; the top-left otherwise. */
  value: number
  corners: Record<Corner, number>
}

export function readRadius(el: HTMLElement): RadiusInfo {
  const style = window.getComputedStyle(el)
  const read = (corner: Corner): number =>
    // An elliptical radius computes as "12px 20px"; the first number is the one
    // a single field can edit without silently discarding the second.
    Number.parseFloat(style.getPropertyValue(CORNER_PROP[corner])) || 0
  const corners = { tl: read('tl'), tr: read('tr'), br: read('br'), bl: read('bl') }
  const uniform = (['tr', 'br', 'bl'] as const).every(
    (corner) => Math.abs(corners[corner] - corners.tl) < 0.5,
  )
  return { uniform, value: corners.tl, corners }
}

export const setCorner = (el: HTMLElement, corner: Corner, value: number): void =>
  setStyle(el, CORNER_PROP[corner], px(Math.max(0, value)))

export type SpacingKind = 'padding' | 'margin'

export interface SpacingInfo {
  /** True when all four sides agree, which is the only time one number is honest. */
  uniform: boolean
  /** The shared value when uniform; the top side otherwise, for stepping from. */
  value: number
  sides: { top: number; right: number; bottom: number; left: number }
}

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


export type Side = 'top' | 'right' | 'bottom' | 'left'

/** One edge, on its own — what the popover's four fields write. */
export const setSide = (
  el: HTMLElement,
  kind: SpacingKind,
  side: Side,
  value: number,
): void =>
  setStyle(el, `${kind}-${side}`, px(kind === 'padding' ? Math.max(0, value) : value))


