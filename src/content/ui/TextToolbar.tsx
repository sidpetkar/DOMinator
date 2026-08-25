import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FontMeta } from '@/shared/messages'
import type { Metrics } from '../core/geometry'
import { cssColor, effectiveBackground, parseColor } from '../core/color'
import * as history from '../core/history'
import { loadFamily } from '../core/fonts'
import { clearStyle, px } from '../core/styles'
import { store } from '../core/store'
import { applyTypeStyle, rememberSelection, restoreSelection } from '../core/textEdit'
import { ColorPicker } from './ColorPicker'
import { FontPicker } from './FontPicker'
import { NumberField } from './NumberField'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { TEXT_ALIGN_ICONS } from './icons'
import { zoom } from '../core/zoom'
import { zoomStable } from './util'

/** Bootstrap draws these exactly as a type toolbar wants them (see icons.tsx). */
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const

const TOOLBAR_HEIGHT = 40

const numeric = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * PRD §3.5 — the floating type toolbar, anchored to the text being edited.
 *
 * Every control routes through applyTypeStyle, so it lands on the highlighted
 * words when part of the text is selected and on the whole element otherwise —
 * matching exactly what EditHighlight is drawing at the time.
 */
export function TextToolbar({ el, metrics }: { el: HTMLElement; metrics: Metrics }) {
  const computed = useMemo(() => window.getComputedStyle(el), [el])
  const [family, setFamily] = useState(() => computed.fontFamily.split(',')[0]?.replace(/["']/g, '') ?? '')
  const [weights, setWeights] = useState<number[]>([300, 400, 500, 600, 700])
  const [weight, setWeight] = useState(() => numeric(computed.fontWeight, 400))
  const [size, setSize] = useState(() => numeric(computed.fontSize, 16))
  const [lineHeight, setLineHeight] = useState(() =>
    numeric(computed.lineHeight, numeric(computed.fontSize, 16) * 1.4),
  )
  const [tracking, setTracking] = useState(() =>
    computed.letterSpacing === 'normal' ? 0 : numeric(computed.letterSpacing, 0),
  )
  const [color, setColor] = useState(() => toHex(computed.color))
  const [pickerOpen, setPickerOpen] = useState(false)
  // Re-read every render: the background changes when the element moves, and
  // contrast is meaningless against a stale one.
  const background = effectiveBackground(el)
  // True while the colour picker is being dragged: keeps the per-frame writes
  // collapsed into a single undo step instead of ~60 of them. A ref, not a
  // local — it has to survive the re-renders each frame of the drag causes.
  const gesture = useRef(false)

  // Whatever the user highlighted must survive a trip to the toolbar.
  useEffect(() => rememberSelection(el), [el])

  const apply = (decls: Record<string, string>) => {
    // history.begin() during a colour drag makes the whole drag one step; when
    // no gesture is open this pairs begin/commit around the single change.
    history.begin(Object.keys(decls).join('+'), el)
    applyTypeStyle(el, decls)
    restoreSelection(el)
    if (!gesture.current) history.commit()
    store.set(history.depths())
  }

  const pickFamily = async (meta: FontMeta) => {
    setFamily(meta.family)
    setWeights(meta.weights)
    const nearest = meta.weights.reduce((best, candidate) =>
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
    )
    setWeight(nearest)
    // Register the real face before switching to it, or the first paint falls
    // back to a system font and the change looks like it did nothing.
    await loadFamily(meta.family, nearest)
    apply({ 'font-family': `"${meta.family}"`, 'font-weight': String(nearest) })
  }

  const pickWeight = async (next: number) => {
    setWeight(next)
    if (family) await loadFamily(family, next)
    apply({ 'font-weight': String(next) })
  }

  const { rect } = metrics
  const above = rect.top > TOOLBAR_HEIGHT + 12
  const anchoredTop = above ? rect.top - TOOLBAR_HEIGHT - 8 : rect.top + rect.height + 8
  const anchoredLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 620))

  // Anchored to the words being edited, until the grip parks it somewhere the
  // text isn't underneath it.
  const barRef = useRef<HTMLDivElement>(null)
  const grip = usePanelDrag('text', barRef)
  const top = grip.pinned ? grip.pinned.top : anchoredTop
  const left = grip.pinned ? grip.pinned.left : anchoredLeft

  // The font list must never cover the words being restyled: it opens away from
  // the text, i.e. upward when the toolbar is anchored above it — unless that
  // side is too cramped to be useful.
  const roomAbove = top - 8
  const roomBelow = window.innerHeight - (top + TOOLBAR_HEIGHT) - 8
  const dropUp = above && roomAbove > 180
  const listHeight = Math.max(140, Math.min(280, (dropUp ? roomAbove : roomBelow) - 44))
  // The colour panel is a fixed ~310px tall and cannot be trimmed the way the
  // font list can, so it only opens upward when it genuinely fits.
  const COLOR_PANEL_HEIGHT = 310
  const colorDropUp = above ? roomAbove > COLOR_PANEL_HEIGHT : roomBelow < COLOR_PANEL_HEIGHT

  return (
    <div
      ref={barRef}
      className="dm-panel dm-interactive flex items-center gap-1 px-1"
      style={{ position: 'fixed', top, left, height: TOOLBAR_HEIGHT, ...zoomStable(zoom(), 'top left') }}
      // Controls take focus (the search field needs it); the highlight overlay
      // keeps the target visible and restoreSelection puts the range back.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
      <FontPicker value={family} onPick={pickFamily} dropUp={dropUp} maxHeight={listHeight} />

      <select
        aria-label="Font weight"
        value={weight}
        onChange={(event) => void pickWeight(Number(event.target.value))}
        className="h-[26px] rounded-[6px] border border-line bg-paper px-1 text-[11px] text-ink"
      >
        {weights.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <Divider />

      <NumberField
        label="size"
        value={size}
        step={1}
        min={6}
        onChange={(next) => {
          setSize(next)
          apply({ 'font-size': px(next) })
        }}
      />
      <NumberField
        label="line"
        value={lineHeight}
        step={1}
        min={0}
        title="Line height"
        onChange={(next) => {
          setLineHeight(next)
          apply({ 'line-height': px(next) })
        }}
      />
      <NumberField
        label="track"
        value={tracking}
        step={0.5}
        precision={1}
        title="Letter spacing"
        onChange={(next) => {
          setTracking(next)
          apply({ 'letter-spacing': `${next}px` })
        }}
      />

      <Divider />

      {ALIGNMENTS.map((value) => {
        const Glyph = TEXT_ALIGN_ICONS[value]
        return (
          <IconButton
            key={value}
            label={`Align ${value}`}
            onClick={() => apply({ 'text-align': value })}
          >
            <Glyph />
          </IconButton>
        )
      })}

      <Divider />

      {/* Our own picker, not the native one: it can be styled to match, and it
          carries the contrast readout for the background actually behind this
          text. */}
      <div className="relative">
        <button
          type="button"
          aria-label="Text colour"
          title={`Text colour ${color}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPickerOpen((prev) => !prev)}
          className="flex h-[26px] items-center gap-1 rounded-[6px] border border-line bg-paper pr-1.5 pl-1"
        >
          <span
            className="h-[18px] w-[18px] rounded-[4px] border border-line"
            style={{ background: color }}
          />
          <span className="text-[10px] tracking-tight text-ink-soft tabular-nums">{color}</span>
        </button>
        {pickerOpen && (
          <ColorPicker
            value={color}
            background={background}
            dropUp={colorDropUp}
            onClose={() => setPickerOpen(false)}
            onGesture={(active) => {
              gesture.current = active
              if (!active) {
                history.commit()
                store.set(history.depths())
              }
            }}
            onChange={(next) => {
              setColor(next)
              apply({ color: next })
            }}
            onReset={() => {
              history.step('reset colour', el, () => clearStyle(el, 'color'))
              setColor(toHex(window.getComputedStyle(el).color))
              store.set(history.depths())
            }}
          />
        )}
      </div>
    </div>
  )
}

const Divider = () => <span className="dm-divider" />

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-[26px] w-[22px] place-items-center rounded-[6px] border-0 bg-transparent text-[12px] leading-none text-ink hover:bg-ink/5"
    >
      {children}
    </button>
  )
}


/** Computed colours come back as rgb(); <input type=color> only speaks hex. */
/**
 * The computed colour as CSS the picker can round-trip — including its alpha.
 *
 * It used to drop to six-digit hex, which was fine while there was nothing in
 * the panel that could express transparency. With a slider there, flattening
 * here would mean opening the picker on faded type, seeing the slider sitting at
 * 100%, and making it solid by touching anything at all.
 */
function toHex(value: string): string {
  const parsed = parseColor(value)
  if (parsed) return cssColor(parsed.rgb, parsed.alpha)
  const parts = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  if (!parts) return '#000000'
  return `#${parts
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`
}
