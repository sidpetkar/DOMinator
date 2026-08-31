import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { startDrag } from '../core/drag'
import { zoom } from '../core/zoom'
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
import { cx, overlayRoot, POPOVER_ATTR, useDismiss, zoomStable } from './util'

const SV_HEIGHT = 108
const PANEL_WIDTH = 236

/** How far the panel sits from the edge of the control that opened it. */
const OFFSET = 6

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
   * A box the panel must not land on top of — the docked column, in practice.
   *
   * The picker hangs off its swatch, and inside a 264px panel that means it
   * covers the rows underneath the one being edited: you open the fill's colour
   * and it swallows the stroke, the padding and the radius. Worse, it covers the
   * *fill row itself* at some scroll positions, so the hex you are matching a
   * colour against disappears behind the panel you are matching it in.
   *
   * Given a box, the panel steps out beside it and stays anchored to the swatch
   * vertically, which is the arrangement every design tool uses for exactly this
   * reason. A getter rather than a rect because the column moves — it is
   * draggable, and it counter-scales with the browser zoom.
   */
  avoid,
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
  avoid?: (() => DOMRect | null) | null
  showContrast?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  /**
   * A marker left behind in the original tree, purely to be measured. The panel
   * is somewhere else by then, so the control's own box is the only thing that
   * still knows where the picker should point — and a span with `inset: 0`
   * inside the control's positioning context reports exactly that box, clipped
   * or not, since a clip hides pixels rather than moving geometry.
   */
  const probeRef = useRef<HTMLSpanElement>(null)
  const [seat, setSeat] = useState<{ left: number; top: number } | null>(null)
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

  /**
   * Where the panel sits, recomputed on every render.
   *
   * Every render is cheaper than it sounds and is what keeps the picker glued to
   * its button: the overlay re-renders as the page is tracked, so a panel whose
   * control has been scrolled, panned or zoomed away corrects itself on the next
   * frame. The threshold is what stops the state write from looping — a
   * sub-pixel difference is not a move.
   */
  useLayoutEffect(() => {
    const anchor = probeRef.current?.getBoundingClientRect()
    const panel = panelRef.current
    if (!anchor || !panel) return
    const z = zoom() || 1
    const width = PANEL_WIDTH / z
    const height = panel.offsetHeight / z
    const gap = OFFSET / z
    // Trails to whichever side the caller asked for, then is pulled back inside
    // the window: a control near an edge would otherwise hang its picker off it,
    // which is the same bug in the other direction.
    /**
     * Outside the panel when there is one, on whichever side has the room —
     * left first, since the column this exists for is docked to the right.
     */
    const blocked = avoid?.() ?? null
    const beside = blocked
      ? blocked.left - gap - width >= 8
        ? blocked.left - gap - width
        : blocked.right + gap
      : null

    const wanted = {
      left: clampInto(
        beside ?? (align === 'left' ? anchor.left : anchor.right - width),
        width,
        window.innerWidth,
      ),
      top: clampInto(
        dropUp ? anchor.top - gap - height : anchor.bottom + gap,
        height,
        window.innerHeight,
      ),
    }
    if (!seat || Math.abs(seat.left - wanted.left) > 0.5 || Math.abs(seat.top - wanted.top) > 0.5) {
      setSeat(wanted)
    }
  })

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
      /**
       * And that is the end of it.
       *
       * Sampling a colour off the screen is not a step towards choosing one, it
       * *is* choosing one — you went out to the page, found the exact pixel you
       * wanted, and the answer is now applied. Leaving the panel open afterwards
       * meant the thing you had just matched was still hidden behind it, so the
       * next action was always to dismiss it and look.
       */
      onClose()
    } catch {
      /* dismissed */
    } finally {
      preview(false)
    }
  }

  const panel = (
    <div
      ref={panelRef}
      {...{ [POPOVER_ATTR]: '' }}
      /**
       * `dm-interactive` is not decoration here: the overlay root is
       * `pointer-events: none` and every layer opts back in. Inside the element
       * bar the picker inherited that from the panel around it; portalled to the
       * root it has no such parent, and without this the whole picker was
       * click-through — the eyedropper, the sliders and the hex box all silently
       * selecting whatever page element happened to be underneath.
       */
      className="dm-panel dm-interactive overflow-hidden"
      style={{
        position: 'fixed',
        width: PANEL_WIDTH,
        left: seat?.left ?? 0,
        top: seat?.top ?? 0,
        // Nothing is drawn until it has been told where to go: one frame in the
        // corner of the window is a flash everybody sees.
        visibility: seat ? 'visible' : 'hidden',
        ...zoomStable(zoom(), 'top left'),
      }}
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

  const root = overlayRoot()
  return (
    <>
      <span ref={probeRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {root ? createPortal(panel, root) : panel}
    </>
  )
}

/** Keeps a panel of the given size inside the window, with 8px to spare. */
const clampInto = (value: number, size: number, limit: number): number =>
  Math.max(8, Math.min(value, limit - size - 8))

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
