import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { startDrag } from '../core/drag'
import {
  cssColor,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  parseColor,
  report,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type RGB,
  type ContrastReport,
} from '../core/color'
import { store } from '../core/store'
import { DropperIcon, ResetIcon } from './icons'
import { cx, POPOVER_ATTR, useDismiss } from './util'

const SV_HEIGHT = 108
const PANEL_WIDTH = 236

/**
 * Our own picker, because the native one cannot be styled and lands as a black
 * OS panel in the middle of a monochrome toolbar.
 *
 * The part that earns its keep is underneath: live WCAG 2.1 and APCA readouts
 * against the colour actually painted behind the text, so a colour choice is
 * accepted or rejected at the moment it is made rather than in an audit later.
 */
export function ColorPicker({
  value,
  background,
  onChange,
  onClose,
  onGesture,
  onReset,
  dropUp,
  /**
   * Which edge the panel hangs from. It trails to the *left* of its button by
   * default, which is right for the element bar — that bar is anchored to the
   * element's left edge, so there is always room that way. A button sitting near
   * the left of the window needs the opposite, or 236px of panel ends up off
   * screen.
   */
  align = 'right',
  /**
   * Contrast only means something for text. A card's fill or a border colour has
   * no foreground to be legible against, so the readout is dropped rather than
   * shown against an arbitrary pairing.
   */
  showContrast = true,
}: {
  value: string
  background?: RGB
  /**
   * The chosen colour as CSS — six-digit hex while it is opaque, `rgba()` once
   * it is not. Callers write it straight into a declaration; none of them has to
   * know which of the two it got.
   */
  onChange: (color: string) => void
  onClose: () => void
  /** Brackets a drag, so the caller can fold it into one undo step. */
  onGesture?: (active: boolean) => void
  /** Drops our override so the page's own colour returns. */
  onReset?: () => void
  dropUp: boolean
  align?: 'left' | 'right'
  showContrast?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const alphaRef = useRef<HTMLDivElement>(null)
  const parsed = parseColor(value) ?? { rgb: hexToRgb(value), alpha: 1 }
  const [colour, setColour] = useState<{ rgb: RGB; alpha: number }>(parsed)
  /**
   * Which notation the numbers are shown in. Local, not stored: it is a reading
   * preference for the panel in front of you, and every picker in the product
   * opening in whatever mode you last used somewhere else would be a surprise
   * rather than a convenience.
   */
  const [mode, setMode] = useState<'hex' | 'hsl'>('hex')
  /**
   * What the hex box is *showing*, which is not always a colour: "#ff" is a
   * legitimate thing to have typed on the way to "#ff0000". The draft holds the
   * half-finished text and only the parseable states are emitted.
   */
  const [draft, setDraft] = useState<string | null>(null)
  useDismiss(panelRef, true, onClose)

  // Follow the element when its colour changes from outside — a reset, or an
  // undo — without fighting our own writes during a drag.
  const emitted = useRef(value)
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value
      setColour(parseColor(value) ?? { rgb: hexToRgb(value), alpha: 1 })
      setDraft(null)
    }
  }, [value])

  /**
   * While a colour is being judged, the page has to be seen as it really is:
   * the selection wash and the green/orange/pink spacing bands are tinting
   * everything, and the eyedropper would sample *them* rather than the page.
   */
  const preview = (on: boolean) => store.set({ preview: on })

  const { rgb, alpha } = colour
  const hex = rgbToHex(rgb)
  const hsv = rgbToHsv(rgb)
  const hsl = rgbToHsl(rgb)
  /**
   * Contrast is measured on the opaque colour. A half-transparent grey over an
   * unknown backdrop has no single ratio, and quietly reporting the one it would
   * have at full strength is the kind of accessibility number that is worse than
   * none — so the readout describes the pigment, and the alpha slider is left to
   * speak for itself.
   */
  const stats = showContrast && background ? report(rgb, background) : null

  const commit = (next: RGB, nextAlpha = alpha) => {
    const css = cssColor(next, nextAlpha)
    emitted.current = css
    setColour({ rgb: next, alpha: nextAlpha })
    setDraft(null)
    onChange(css)
  }

  const dragSV = (event: ReactPointerEvent) => {
    const box = svRef.current?.getBoundingClientRect()
    if (!box) return
    const pick = (x: number, y: number) =>
      commit(
        hsvToRgb({
          h: hsv.h,
          s: Math.min(1, Math.max(0, (x - box.left) / box.width)),
          v: 1 - Math.min(1, Math.max(0, (y - box.top) / box.height)),
        }),
      )
    onGesture?.(true)
    preview(true)
    pick(event.clientX, event.clientY)
    startDrag(event.nativeEvent, {
      cursor: 'crosshair',
      onMove: (d) => pick(d.x, d.y),
      onEnd: () => {
        onGesture?.(false)
        preview(false)
      },
    })
  }

  const dragHue = (event: ReactPointerEvent) => {
    const box = hueRef.current?.getBoundingClientRect()
    if (!box) return
    const pick = (x: number) =>
      commit(
        hsvToRgb({
          h: (Math.min(1, Math.max(0, (x - box.left) / box.width)) * 360) % 360,
          s: hsv.s || 1,
          v: hsv.v || 1,
        }),
      )
    onGesture?.(true)
    preview(true)
    pick(event.clientX)
    startDrag(event.nativeEvent, {
      cursor: 'ew-resize',
      onMove: (d) => pick(d.x),
      onEnd: () => {
        onGesture?.(false)
        preview(false)
      },
    })
  }

  const dragAlpha = (event: ReactPointerEvent) => {
    const box = alphaRef.current?.getBoundingClientRect()
    if (!box) return
    const pick = (x: number) => commit(rgb, Math.min(1, Math.max(0, (x - box.left) / box.width)))
    onGesture?.(true)
    preview(true)
    pick(event.clientX)
    startDrag(event.nativeEvent, {
      cursor: 'ew-resize',
      onMove: (d) => pick(d.x),
      onEnd: () => {
        onGesture?.(false)
        preview(false)
      },
    })
  }

  const pickFromScreen = async () => {
    const Picker = (
      window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }
    ).EyeDropper
    if (!Picker) return
    // Our own overlays are painted into the page, so they must go before the
    // dropper can sample anything real.
    preview(true)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      const { sRGBHex } = await new Picker().open()
      commit(hexToRgb(sRGBHex), alpha)
    } catch {
      /* dismissed */
    } finally {
      preview(false)
    }
  }

  return (
    <div
      ref={panelRef}
      {...{ [POPOVER_ATTR]: '' }}
      className={cx('dm-panel absolute overflow-hidden', align === 'left' ? 'left-0' : 'right-0')}
      style={{ width: PANEL_WIDTH, ...(dropUp ? { bottom: 30 } : { top: 30 }) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* saturation / value */}
      <div
        ref={svRef}
        onPointerDown={dragSV}
        className="relative cursor-crosshair"
        style={{
          height: SV_HEIGHT,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <span
          className="pointer-events-none absolute h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
          }}
        />
      </div>

      <div className="flex items-center gap-2 px-2 pt-2">
        {'EyeDropper' in window && (
          <button
            type="button"
            aria-label="Pick a colour from the page"
            title="Pick a colour from the page"
            onClick={() => void pickFromScreen()}
            className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] border border-line bg-paper text-ink"
          >
            <DropperIcon />
          </button>
        )}
        <div
          ref={hueRef}
          onPointerDown={dragHue}
          className="relative h-[10px] flex-1 cursor-ew-resize rounded-[999px]"
          style={{
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent"
            style={{ left: `${(hsv.h / 360) * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.3)' }}
          />
        </div>
      </div>

      {/* Transparency. The checkerboard is under the gradient rather than beside
          it, so the track itself demonstrates what the number means: the colour
          fading out over the pattern that stands for "nothing behind this". */}
      <div className="flex items-center gap-2 px-2 pt-2">
        {'EyeDropper' in window && <span className="w-[22px] shrink-0" />}
        <div
          ref={alphaRef}
          onPointerDown={dragAlpha}
          aria-label="Transparency"
          className="relative h-[10px] flex-1 cursor-ew-resize overflow-hidden rounded-[999px]"
          style={CHECKERBOARD}
        >
          <span
            className="pointer-events-none absolute inset-0 rounded-[999px]"
            style={{
              background: `linear-gradient(to right, ${cssColor(rgb, 0)}, ${hex})`,
            }}
          />
          <span
            className="pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent"
            style={{ left: `${alpha * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.3)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-2">
        <select
          aria-label="Colour notation"
          title="Show the value as hex or as HSL"
          value={mode}
          onChange={(event) => setMode(event.target.value as 'hex' | 'hsl')}
          className="dm-field h-[24px] shrink-0 rounded-[6px] border border-line bg-paper px-1 text-[11px] font-medium text-ink"
        >
          <option value="hex">Hex</option>
          <option value="hsl">HSL</option>
        </select>

        {mode === 'hex' ? (
          <input
            aria-label="Hex value"
            value={draft ?? hex.replace('#', '').toUpperCase()}
            onChange={(event) => {
              const next = event.target.value
              setDraft(next)
              const clean = next.trim().replace(/^#/, '')
              if (/^[0-9a-f]{6}$/i.test(clean)) commit(hexToRgb(`#${clean}`))
            }}
            onBlur={() => setDraft(null)}
            className="dm-field min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-1.5 py-[3px] text-[11px] text-ink tabular-nums"
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Channel
              label="Hue"
              value={Math.round(hsl.h)}
              max={360}
              onChange={(h) => commit(hslToRgb({ ...hsl, h }))}
            />
            <Channel
              label="Saturation"
              value={hsl.s}
              max={100}
              onChange={(sat) => commit(hslToRgb({ ...hsl, s: sat }))}
            />
            <Channel
              label="Lightness"
              value={hsl.l}
              max={100}
              onChange={(l) => commit(hslToRgb({ ...hsl, l }))}
            />
          </span>
        )}

        <Channel
          label="Opacity"
          value={Math.round(alpha * 100)}
          max={100}
          suffix="%"
          onChange={(next) => commit(rgb, next / 100)}
        />

        {onReset && (
          <button
            type="button"
            aria-label="Reset to the original colour"
            title="Reset to the original colour"
            onClick={onReset}
            className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-line bg-paper text-ink-soft hover:text-ink"
          >
            <ResetIcon />
          </button>
        )}
      </div>

      {stats && background && (
        <Contrast stats={stats} foreground={hex} background={rgbToHex(background)} />
      )}
    </div>
  )
}

/**
 * The "nothing behind this" pattern, as a pair of offset gradients rather than
 * an image: it costs no bytes, scales with the track, and cannot be blocked by
 * the host page's content policy the way a data: URL background can be.
 */
const CHECKER_TILE = 6
const CHECKERBOARD = {
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg, rgba(0,0,0,.18) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.18) 75%),' +
    'linear-gradient(45deg, rgba(0,0,0,.18) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.18) 75%)',
  backgroundSize: `${CHECKER_TILE}px ${CHECKER_TILE}px`,
  // Both layers at one offset are two identical sets of diagonal stripes lying
  // on top of each other; half a tile apart, they interlock into the checker.
  backgroundPosition: `0 0, ${CHECKER_TILE / 2}px ${CHECKER_TILE / 2}px`,
} as const

/**
 * One number of a colour — a hue, a lightness, an opacity.
 *
 * Typed rather than nudged, and applied on every keystroke that parses, which is
 * the same bargain the number fields in the bar make: the page tracks what you
 * are typing, so a value is judged in place rather than after a commit. Empty is
 * allowed while typing and simply doesn't emit, or backspacing the last digit of
 * "100" would snap the colour to 0 on the way to "20".
 */
function Channel({
  label,
  value,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  max: number
  suffix?: string
  onChange: (next: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <span className="flex min-w-0 items-center rounded-[6px] border border-line bg-paper pr-1">
      <input
        aria-label={label}
        title={label}
        value={draft ?? String(value)}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          const parsed = Number.parseFloat(next)
          if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(0, parsed)))
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => event.stopPropagation()}
        className="dm-field w-[34px] min-w-0 rounded-[6px] border-0 bg-transparent px-1 py-[3px] text-center text-[11px] text-ink tabular-nums"
      />
      {suffix && <span className="text-[10px] text-ink-soft">{suffix}</span>}
    </span>
  )
}

/**
 * The accessibility readout. Two systems on purpose: WCAG 2.1 is what audits and
 * legal requirements still cite, APCA is what actually predicts legibility for
 * thin or light type — and they disagree often enough that showing one alone
 * would mislead.
 */
function Contrast({
  stats,
  foreground,
  background,
}: {
  stats: ContrastReport
  foreground: string
  background: string
}) {
  return (
    <div className="border-t border-line">
      <div className="flex">
        <Swatch label="Text" hex={foreground} />
        <Swatch label="Behind" hex={background} />
      </div>

      {/* Light, like the rest of the panel. The dark band it replaces read as a
          separate widget bolted on — and put a near-black rectangle directly
          under two colour swatches, which is the worst possible neighbour for
          judging a colour. */}
      <div className="flex items-center gap-2 border-t border-line bg-paper px-2 py-1.5 text-ink">
        <div className="flex flex-col gap-[3px]">
          <Verdict ok={stats.aaNormal} label="AA" />
          <Verdict ok={stats.aaaNormal} label="AAA" />
        </div>
        <Metric label="WCAG 2.1" value={`${stats.ratio.toFixed(2)}`} />
        <Metric label="APCA Lc" value={Math.abs(stats.lc).toFixed(1)} />
        <Metric label="L*" value={Math.round(stats.lStar).toString()} />
      </div>

      <p className="m-0 px-2 py-1 text-[9px] leading-tight text-ink-soft">
        AA/AAA are for body text ({stats.ratio.toFixed(2)} vs 4.5 / 7). Large or bold text passes at
        3 / 4.5 — {stats.aaLarge ? 'AA ✓' : 'AA ✗'} {stats.aaaLarge ? 'AAA ✓' : 'AAA ✗'}.
      </p>
    </div>
  )
}

const Swatch = ({ label, hex }: { label: string; hex: string }) => (
  <div className="flex-1 px-2 py-1.5" style={{ background: hex }}>
    <span
      className="block text-[9px] leading-tight"
      style={{ color: readableOn(hex), opacity: 0.75 }}
    >
      {label}
    </span>
    <span
      className="block text-[11px] leading-tight font-medium tabular-nums"
      style={{ color: readableOn(hex) }}
    >
      {hex}
    </span>
  </div>
)

/** Label colour for a swatch — picked by contrast so it is never unreadable. */
function readableOn(hex: string): string {
  const rgb = hexToRgb(hex)
  return report({ r: 255, g: 255, b: 255 }, rgb).ratio >= 4.5 ? '#ffffff' : '#0b0b0c'
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <span className="flex flex-col leading-tight">
    <span className="text-[8px] tracking-wide uppercase opacity-60">{label}</span>
    <span className="text-[12px] font-semibold tabular-nums">{value}</span>
  </span>
)

const Verdict = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className="flex items-center gap-1 text-[9px] font-semibold">
    <span
      className={cx(
        'grid h-[11px] w-[11px] place-items-center rounded-full text-[8px] leading-none',
        ok ? 'bg-[#2fbf5f] text-white' : 'bg-[#e5484d] text-white',
      )}
    >
      {ok ? '✓' : '✕'}
    </span>
    {label}
  </span>
)
