export interface RGB {
  r: number
  g: number
  b: number
}

export interface HSV {
  h: number
  s: number
  v: number
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

export const rgbToHex = ({ r, g, b }: RGB): string =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`

export function hexToRgb(hex: string): RGB {
  const short = /^#([0-9a-f]{3})$/i.exec(hex.trim())
  const full = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const body = short?.[1]
    ? [...short[1]].map((c) => c + c).join('')
    : (full?.[1] ?? '000000')
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16),
  }
}

/** Accepts what getComputedStyle returns — rgb(), rgba(), colour keywords via hex. */
export function parseColor(css: string): { rgb: RGB; alpha: number } | null {
  const value = css.trim()
  if (value.startsWith('#')) return { rgb: hexToRgb(value), alpha: 1 }
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?/i.exec(value)
  if (!match) return null
  const alphaRaw = match[4]
  const alpha = alphaRaw
    ? alphaRaw.endsWith('%')
      ? Number.parseFloat(alphaRaw) / 100
      : Number.parseFloat(alphaRaw)
    : 1
  return {
    rgb: {
      r: Number.parseFloat(match[1] ?? '0'),
      g: Number.parseFloat(match[2] ?? '0'),
      b: Number.parseFloat(match[3] ?? '0'),
    },
    alpha: Number.isFinite(alpha) ? alpha : 1,
  }
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255] as [number, number, number]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = v - c
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 }
}

/** Blends a translucent colour over an opaque one. */
export const blend = (top: RGB, bottom: RGB, alpha: number): RGB => ({
  r: top.r * alpha + bottom.r * (1 - alpha),
  g: top.g * alpha + bottom.g * (1 - alpha),
  b: top.b * alpha + bottom.b * (1 - alpha),
})

// — WCAG 2.1 ————————————————————————————————————————————————

const toLinear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const luminance = ({ r, g, b }: RGB): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** 1–21. Black on white is 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** CIE L*, the perceptual lightness shown alongside the ratio. */
export function lStar(rgb: RGB): number {
  const y = luminance(rgb)
  return y <= 216 / 24389 ? (y * 24389) / 27 : Math.cbrt(y) * 116 - 16
}

// — APCA (0.1.9 constants) ——————————————————————————————————

const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const

const apcaY = ({ r, g, b }: RGB): number =>
  APCA.sRco * (r / 255) ** APCA.mainTRC +
  APCA.sGco * (g / 255) ** APCA.mainTRC +
  APCA.sBco * (b / 255) ** APCA.mainTRC

const softClamp = (y: number): number =>
  y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp

/**
 * APCA lightness contrast (Lc). Signed: positive for dark text on a light
 * background, negative for the reverse. Roughly, |Lc| 60 is body-text minimum
 * and 75 is comfortable — it models thin type far better than the 2.1 ratio,
 * which is why VisBug and friends show both.
 */
export function apcaLc(text: RGB, background: RGB): number {
  const txtY = softClamp(apcaY(text))
  const bgY = softClamp(apcaY(background))
  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0

  if (bgY > txtY) {
    const sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scaleBoW
    return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100
  }
  const sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scaleWoB
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100
}

// — page context ————————————————————————————————————————————

const WHITE: RGB = { r: 255, g: 255, b: 255 }

export interface Backdrop {
  rgb: RGB
  /**
   * True when the walk passed a background *image* — a gradient, a photo, a
   * masked sprite. The resolved colour is then only what shows through it, so
   * any contrast figure derived from it is a guess. Worth saying out loud rather
   * than reporting a confident number nobody can act on.
   */
  uncertain: boolean
}

/**
 * The colour actually *behind* an element — which is what contrast is measured
 * against.
 *
 * Walks up the ancestors for the first painted background, blending translucent
 * layers as it goes, and falls back to white the way a browser does for an
 * unstyled page. A fully transparent element contributes nothing and the walk
 * continues through it, which is the whole point: text is very often several
 * levels below the box that actually carries the colour.
 *
 * The depth cap is a guard against pathological nesting, not a real limit — 24
 * levels is deeper than any page's background actually lives.
 */
export function resolveBackground(el: HTMLElement, depth = 0): Backdrop {
  if (depth > 24 || !el) return { rgb: WHITE, uncertain: false }
  const style = window.getComputedStyle(el)
  const parsed = parseColor(style.backgroundColor)
  const parent = el.parentElement
  const painted = style.backgroundImage !== 'none' && style.backgroundImage !== ''

  const behind = (): Backdrop =>
    parent ? resolveBackground(parent, depth + 1) : { rgb: WHITE, uncertain: false }

  if (!parsed || parsed.alpha === 0) {
    const under = behind()
    return { rgb: under.rgb, uncertain: under.uncertain || painted }
  }
  if (parsed.alpha >= 0.999) return { rgb: parsed.rgb, uncertain: painted }

  const under = behind()
  return {
    rgb: blend(parsed.rgb, under.rgb, parsed.alpha),
    uncertain: under.uncertain || painted,
  }
}

/** Just the colour, for callers that have nothing to do with a verdict. */
export const effectiveBackground = (el: HTMLElement): RGB => resolveBackground(el).rgb

export interface ContrastReport {
  ratio: number
  lc: number
  lStar: number
  /** WCAG 2.1 thresholds for body copy and for large/bold text. */
  aaNormal: boolean
  aaaNormal: boolean
  aaLarge: boolean
  aaaLarge: boolean
}

export function report(text: RGB, background: RGB): ContrastReport {
  const ratio = contrastRatio(text, background)
  return {
    ratio,
    lc: apcaLc(text, background),
    lStar: lStar(text),
    aaNormal: ratio >= 4.5,
    aaaNormal: ratio >= 7,
    aaLarge: ratio >= 3,
    aaaLarge: ratio >= 4.5,
  }
}
