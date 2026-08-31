import { cssColor, hexToRgb, parseColor, rgbToHex, type RGB } from './color'
import { clearStyle, px, setStyle } from './styles'

/** The light grey a border starts at when you switch one on. */
export const DEFAULT_BORDER_COLOR = '#c7c7c7'

/**
 * And the grey a fill starts at. Mid rather than white: "add a fill" has to
 * produce something you can see, and on the white page that most of the web is,
 * a white fill is indistinguishable from the empty box you just pressed the
 * button on.
 */
export const DEFAULT_FILL = '#d9d9d9'

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




// — paints ——————————————————————————————————————————————————————

/**
 * A fill or a stroke, as the panel talks about them: a colour, how opaque it is,
 * and whether it is switched on at all.
 *
 * Three states rather than two, because "no fill" and "a fill that is hidden"
 * are different answers to different questions and a page can be in either.
 * Hidden is a *held* colour — the one you spent a minute choosing, kept while
 * you look at the box without it — so it has to survive being turned off, which
 * `background: none` would not let it do.
 */
export interface PaintInfo {
  /** The element paints one of these at all. */
  on: boolean
  /** And it can be seen: a paint at zero alpha is on, and invisible. */
  visible: boolean
  rgb: RGB
  /** 0–1. While hidden this is the value it goes back to, not the 0 on screen. */
  alpha: number
}

/**
 * The opacity a hidden paint returns to.
 *
 * Hiding is written as alpha 0, which keeps the colour itself in the
 * declaration where anyone can read it — including us, on the way back. What it
 * cannot keep is how opaque the paint used to be, and a half-opaque scrim that
 * came back solid would be a quiet edit to the page nobody asked for.
 *
 * A WeakMap rather than a data attribute: this is the panel remembering what it
 * was showing a moment ago, not a fact about the page, and the page is not ours
 * to write bookkeeping into. It lives as long as the element does and no longer.
 */
const held = new WeakMap<HTMLElement, { fill?: number; stroke?: number }>()

const remember = (el: HTMLElement, which: 'fill' | 'stroke', alpha: number): void => {
  held.set(el, { ...held.get(el), [which]: alpha })
}

const recall = (el: HTMLElement, which: 'fill' | 'stroke'): number => held.get(el)?.[which] ?? 1

export function readFill(el: HTMLElement): PaintInfo {
  const parsed = parseColor(window.getComputedStyle(el).backgroundColor)
  const rgb = parsed?.rgb ?? hexToRgb(DEFAULT_FILL)
  const alpha = parsed?.alpha ?? 0
  /**
   * Nothing is showing — but there are two ways for that to be true, and the
   * panel has to say which. A fill that was *removed* is gone and the section
   * offers to add one; a fill that was *hidden* is still there behind a closed
   * eye, waiting to come back in the colour it went away in.
   *
   * The declaration itself is what tells them apart, which is why hiding is
   * written as `rgba(r, g, b, 0)` and removing as `transparent`: the first still
   * names a colour and the second does not. Reading the inline value rather than
   * the computed one matters here — both compute to `rgba(0, 0, 0, 0)`.
   */
  const inline = el.style.backgroundColor
  const hiddenByUs = alpha === 0 && Boolean(inline) && inline !== 'transparent'
  return {
    on: alpha > 0 || hiddenByUs,
    visible: alpha > 0,
    rgb,
    alpha: alpha > 0 ? alpha : recall(el, 'fill'),
  }
}

export const setFill = (el: HTMLElement, rgb: RGB, alpha = 1): void =>
  setStyle(el, 'background-color', cssColor(rgb, alpha))

/** Adds one where there was none, in the grey that says "there is one now". */
export const addFill = (el: HTMLElement): void =>
  setStyle(el, 'background-color', DEFAULT_FILL)

/**
 * No fill — written, not merely un-set.
 *
 * `clearStyle` would hand the box back to whatever the page's own stylesheet
 * paints it, which is the right behaviour for Reset and the wrong one for a
 * button that says "remove this fill": on an element the site already colours,
 * it would look like the button did nothing at all.
 */
export const removeFill = (el: HTMLElement): void =>
  setStyle(el, 'background-color', 'transparent')

export function toggleFill(el: HTMLElement, info: PaintInfo): void {
  if (info.visible) {
    remember(el, 'fill', info.alpha)
    setFill(el, info.rgb, 0)
  } else {
    setFill(el, info.rgb, info.alpha || 1)
  }
}

export function readStroke(el: HTMLElement): PaintInfo {
  const style = window.getComputedStyle(el)
  const width = Number.parseFloat(style.borderTopWidth) || 0
  const kind = style.borderTopStyle
  const on = width > 0 && kind !== 'none' && kind !== 'hidden'
  const parsed = parseColor(style.borderTopColor)
  /**
   * With no border showing, `border-color` computes to `currentColor` — the
   * page's text colour — so a stroke added from here would arrive near-black
   * rather than in the grey it is supposed to start at. The computed value is
   * only believed once there is a border for it to be the colour of.
   */
  const chosen = on || Boolean(el.style.borderTopColor || el.style.borderColor)
  const rgb = chosen && parsed ? parsed.rgb : hexToRgb(DEFAULT_BORDER_COLOR)
  const alpha = chosen && parsed ? parsed.alpha : 1
  return {
    on,
    visible: on && alpha > 0,
    rgb,
    alpha: alpha > 0 ? alpha : recall(el, 'stroke'),
  }
}

export const setStrokeColor = (el: HTMLElement, rgb: RGB, alpha = 1): void =>
  setStyle(el, 'border-color', cssColor(rgb, alpha))

export function toggleStroke(el: HTMLElement, info: PaintInfo): void {
  if (info.visible) {
    remember(el, 'stroke', info.alpha)
    setStrokeColor(el, info.rgb, 0)
  } else {
    setStrokeColor(el, info.rgb, info.alpha || 1)
  }
}

/**
 * Takes the stroke away.
 *
 * `border-style: none` rather than clearing the three properties, for the reason
 * `removeFill` writes `transparent`: on an element the page already gives a
 * border, un-setting ours puts the page's back and the button appears broken.
 * Any width and colour we wrote are left inline on purpose: they are what the
 * `+` button reads the stroke back in, so removing and re-adding returns the
 * stroke you had chosen rather than the default grey one.
 */
export const removeStroke = (el: HTMLElement): void => setStyle(el, 'border-style', 'none')

export type BorderStyle = 'solid' | 'dashed' | 'dotted'

export const readStrokeStyle = (el: HTMLElement): BorderStyle => {
  const kind = window.getComputedStyle(el).borderTopStyle
  return kind === 'dashed' || kind === 'dotted' ? kind : 'solid'
}

export const setStrokeStyle = (el: HTMLElement, kind: BorderStyle): void =>
  setStyle(el, 'border-style', kind)

export interface StrokeWidths {
  /** True when all four edges agree — the only time one number is honest. */
  uniform: boolean
  /** The shared width when uniform; the top edge otherwise. */
  value: number
  sides: Record<Side, number>
}

export function readStrokeWidths(el: HTMLElement): StrokeWidths {
  const style = window.getComputedStyle(el)
  const read = (side: Side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
  const sides = { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') }
  const uniform = (['right', 'bottom', 'left'] as const).every(
    (side) => Math.abs(sides[side] - sides.top) < 0.5,
  )
  return { uniform, value: sides.top, sides }
}

/**
 * One edge's weight. The style comes with it because a width alone paints
 * nothing on an element whose `border-style` is still `none` — the same reason
 * `setBorder` writes all three.
 */
export function setStrokeWidth(el: HTMLElement, side: Side | 'all', width: number): void {
  const value = px(Math.max(0, width))
  const kind = window.getComputedStyle(el).borderTopStyle
  if (side === 'all') setStyle(el, 'border-width', value)
  else setStyle(el, `border-${side}-width`, value)
  if (kind === 'none' || kind === 'hidden') setStyle(el, 'border-style', 'solid')
}

/** Back to the page's own — what the picker's reset offers for either paint. */
export function clearPaint(el: HTMLElement, which: 'fill' | 'stroke'): void {
  if (which === 'fill') {
    clearStyle(el, 'background-color')
    return
  }
  for (const prop of ['border-style', 'border-width', 'border-color']) clearStyle(el, prop)
  for (const side of ['top', 'right', 'bottom', 'left']) clearStyle(el, `border-${side}-width`)
}

/** The panel shows six digits and no hash; everything else here speaks RGB. */
export const paintHex = (rgb: RGB): string => rgbToHex(rgb).replace('#', '').toUpperCase()

export const hexToPaint = (text: string): RGB | null => {
  const clean = text.trim().replace(/^#/, '')
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean) ? hexToRgb(`#${clean}`) : null
}
