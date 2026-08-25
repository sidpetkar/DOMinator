import { parseColor, rgbToHex } from './color'
import { clearStyle, px, setStyle } from './styles'

/**
 * The two things a box does that aren't its box: what it casts, and how it sits.
 */

// — shadow ————————————————————————————————————————————————————

export interface ShadowInfo {
  on: boolean
  x: number
  y: number
  blur: number
  spread: number
  /** Hex, without the alpha — opacity is its own control. */
  color: string
  /** 0–100, the way every design tool states it. */
  opacity: number
}

/** What "add a shadow" starts from: the soft, low drop everything defaults to. */
export const DEFAULT_SHADOW: ShadowInfo = {
  on: true,
  x: 0,
  y: 4,
  blur: 8,
  spread: 0,
  color: '#000000',
  opacity: 25,
}

/**
 * Chrome always serialises a computed `box-shadow` as
 * `rgba(0, 0, 0, 0.25) 0px 4px 8px 0px`, colour first and lengths in px — never
 * as the author wrote it. That is what makes this parseable at all: there is no
 * keyword colour, no omitted-and-implied length, and no unit to convert.
 *
 * Only the first shadow of a list is read. A stack of three is a thing the page
 * built deliberately and there is nowhere in a one-row control to say so; the
 * honest move is to report the one on top and leave the rest untouched until the
 * user actually writes, which replaces the whole stack — the same trade the
 * fill control already makes with layered backgrounds.
 */
export function readShadow(el: HTMLElement): ShadowInfo {
  const value = window.getComputedStyle(el).boxShadow
  if (!value || value === 'none') return { ...DEFAULT_SHADOW, on: false }

  const first = splitFirst(value)
  const colorText = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(first.trim())?.[1] ?? ''
  const parsed = colorText ? parseColor(colorText) : null
  const lengths = [...first.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]))

  return {
    on: true,
    x: lengths[0] ?? 0,
    y: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: parsed ? rgbToHex(parsed.rgb) : '#000000',
    opacity: Math.round((parsed?.alpha ?? 1) * 100),
  }
}

/** The first shadow in a comma-separated list, ignoring commas inside `rgb()`. */
function splitFirst(value: string): string {
  let depth = 0
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) return value.slice(0, i)
  }
  return value
}

const rgba = (hex: string, opacity: number): string => {
  const parsed = parseColor(hex)
  const { r, g, b } = parsed?.rgb ?? { r: 0, g: 0, b: 0 }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacity)) / 100})`
}

export function setShadow(el: HTMLElement, shadow: ShadowInfo): void {
  if (!shadow.on) {
    // `none` rather than dropping the declaration: the page's own shadow would
    // come back through, and the button that says "off" would have turned it on.
    setStyle(el, 'box-shadow', 'none')
    return
  }
  const { x, y, blur, spread, color, opacity } = shadow
  setStyle(
    el,
    'box-shadow',
    `${px(x)} ${px(y)} ${px(Math.max(0, blur))} ${px(spread)} ${rgba(color, opacity)}`,
  )
}

/** Hands the element back whatever the page had to say about its shadow. */
export const clearShadow = (el: HTMLElement): void => clearStyle(el, 'box-shadow')

// — position ——————————————————————————————————————————————————

export interface PositionInfo {
  /** Degrees, normalised to 0–359. */
  rotation: number
  flipX: boolean
  flipY: boolean
}

/**
 * Written through the standalone `rotate` and `scale` properties rather than
 * through `transform`.
 *
 * `transform` computes to a matrix, and a matrix cannot be read back apart: a
 * 180° rotation and a pair of flips produce identical numbers, so the controls
 * would disagree with themselves the moment you used two of them. `rotate` and
 * `scale` compute to what was written — `45deg`, `-1 1` — so each control reads
 * its own value and nothing has to be decomposed or remembered on the side.
 *
 * They also compose with, rather than overwrite, whatever `transform` the page
 * already had on the element, which `transform` itself could not do.
 */
export function readPosition(el: HTMLElement): PositionInfo {
  const style = window.getComputedStyle(el)
  const rotation = Number.parseFloat(style.rotate) || 0
  // `scale` computes as "none", "1", or "-1 1".
  const parts = style.scale === 'none' ? [] : style.scale.trim().split(/\s+/).map(Number)
  const [sx = 1, sy = parts[0] ?? 1] = parts
  return {
    rotation: ((rotation % 360) + 360) % 360,
    flipX: sx < 0,
    flipY: sy < 0,
  }
}

export const setRotation = (el: HTMLElement, degrees: number): void =>
  setStyle(el, 'rotate', `${Math.round(((degrees % 360) + 360) % 360)}deg`)

export function setFlip(el: HTMLElement, axis: 'x' | 'y', on: boolean): void {
  const current = readPosition(el)
  const flipX = axis === 'x' ? on : current.flipX
  const flipY = axis === 'y' ? on : current.flipY
  setStyle(el, 'scale', `${flipX ? -1 : 1} ${flipY ? -1 : 1}`)
}
