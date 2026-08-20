import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { startDrag } from '../core/drag'
import {
  hexToRgb,
  hsvToRgb,
  report,
  rgbToHex,
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
   * Contrast only means something for text. A card's fill or a border colour has
   * no foreground to be legible against, so the readout is dropped rather than
   * shown against an arbitrary pairing.
   */
  showContrast = true,
}: {
  value: string
  background?: RGB
  onChange: (hex: string) => void
  onClose: () => void
  /** Brackets a drag, so the caller can fold it into one undo step. */
  onGesture?: (active: boolean) => void
  /** Drops our override so the page's own colour returns. */
  onReset?: () => void
  dropUp: boolean
  showContrast?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const [hex, setHex] = useState(value)
  useDismiss(panelRef, true, onClose)

  // Follow the element when its colour changes from outside — a reset, or an
  // undo — without fighting our own writes during a drag.
  const emitted = useRef(value)
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value
      setHex(value)
    }
  }, [value])

  /**
   * While a colour is being judged, the page has to be seen as it really is:
   * the selection wash and the green/orange/pink spacing bands are tinting
   * everything, and the eyedropper would sample *them* rather than the page.
   */
  const preview = (on: boolean) => store.set({ preview: on })

  const rgb = hexToRgb(hex)
  const hsv = rgbToHsv(rgb)
  const stats = showContrast && background ? report(rgb, background) : null

  const commit = (next: RGB) => {
    const nextHex = rgbToHex(next)
    emitted.current = nextHex
    setHex(nextHex)
    onChange(nextHex)
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

  const pickFromScreen = async () => {
    const Picker = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
      .EyeDropper
    if (!Picker) return
    // Our own overlays are painted into the page, so they must go before the
    // dropper can sample anything real.
    preview(true)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      const { sRGBHex } = await new Picker().open()
      commit(hexToRgb(sRGBHex))
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
      className="dm-panel absolute right-0 overflow-hidden"
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
            background:
              'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent"
            style={{ left: `${(hsv.h / 360) * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.3)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-2">
        <span
          className="h-[20px] w-[20px] shrink-0 rounded-[5px] border border-line"
          style={{ background: hex }}
        />
        <input
          aria-label="Hex value"
          value={hex}
          onChange={(event) => {
            const next = event.target.value
            setHex(next)
            if (/^#?[0-9a-f]{6}$/i.test(next.trim())) {
              emitted.current = rgbToHex(hexToRgb(next))
              onChange(emitted.current)
            }
          }}
          className="dm-field min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-1.5 py-[3px] text-[11px] text-ink tabular-nums"
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
        AA/AAA are for body text ({stats.ratio.toFixed(2)} vs 4.5 / 7). Large or bold text
        passes at 3 / 4.5 — {stats.aaLarge ? 'AA ✓' : 'AA ✗'} {stats.aaaLarge ? 'AAA ✓' : 'AAA ✗'}.
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


