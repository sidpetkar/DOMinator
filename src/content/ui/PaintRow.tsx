import { useEffect, useRef, useState, type ReactNode } from 'react'
import { hexToPaint, paintHex } from '../core/box'
import { startDrag } from '../core/drag'
import type { RGB } from '../core/color'
import { EyeIcon, EyeOffIcon, MinusIcon } from './icons'
import { cx } from './util'

/**
 * One paint, as a row: what colour, how opaque, on or off, and gone.
 *
 * The shape is Figma's and the reason is that it is the honest one — a fill is
 * not a button, it is a value with three parts, and the swatch-only control this
 * replaces could show one of them. You could see *that* a box was filled and
 * never what with: the hex lived behind a popover, the opacity behind the same
 * popover's third slider, and "hide this for a second" did not exist at all, so
 * the only way to look at a box without its fill was to remove the fill and
 * undo.
 *
 * Hiding and removing are kept apart for that reason. The eye is a held
 * thought — the colour stays, at zero alpha, and comes back exactly as it was.
 * The minus is a decision.
 */
export function PaintRow({
  rgb,
  alpha,
  visible,
  swatch,
  onAlpha,
  onHex,
  onToggle,
  onRemove,
  label,
  bare = false,
  onOpen,
}: {
  rgb: RGB
  /** 0–1, and what the paint goes back to rather than the 0 it may be showing. */
  alpha: number
  visible: boolean
  /** The swatch button, which is the thing that opens the picker. */
  swatch: ReactNode
  onAlpha: (next: number) => void
  onHex: (rgb: RGB) => void
  onToggle: () => void
  onRemove: () => void
  /** "fill" or "stroke", for the labels a screen reader reads out. */
  label: string
  /**
   * Colour and opacity only.
   *
   * The shadow's colour is a line *inside* the shadow, and the shadow already
   * carries its own eye and its own minus one row up — a second pair here would
   * be two buttons that do what two other buttons on screen already do, which is
   * the kind of thing that makes a panel feel like it is guessing.
   */
  bare?: boolean
  /**
   * Opens the picker — the same thing pressing the swatch does.
   *
   * The swatch is 18 pixels in a row 130 wide, and every press that landed on
   * the other 112 did nothing at all. A colour row means "this colour", so the
   * row opens the colour; only the hex box keeps its own click, because that one
   * is for typing into.
   */
  onOpen?: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        onClick={(event) => {
          if (!onOpen) return
          // The hex field and the swatch button both answer their own clicks.
          if ((event.target as HTMLElement).closest('input, button')) return
          onOpen()
        }}
        className={cx(
          'flex h-[24px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] bg-ink/[0.06] pr-1 pl-[3px]',
          onOpen && 'cursor-pointer',
          !visible && 'opacity-45',
        )}
      >
        {swatch}
        <HexField value={rgb} onCommit={onHex} label={`${label} colour`} disabled={!visible} />
      </div>

      <PercentField
        value={alpha}
        onChange={onAlpha}
        label={`${label} opacity`}
        disabled={!visible}
      />

      {!bare && (
        <>
          <IconButton
            label={visible ? `Hide the ${label}` : `Show the ${label}`}
            onClick={onToggle}
            dim={!visible}
          >
            {visible ? <EyeIcon /> : <EyeOffIcon />}
          </IconButton>
          <IconButton label={`Remove the ${label}`} onClick={onRemove}>
            <MinusIcon />
          </IconButton>
        </>
      )}
    </div>
  )
}

/**
 * Six digits, typed.
 *
 * Held as a draft and committed only when it parses, because "9100" is a
 * legitimate thing to have on the way to "910000" and a field that reverted on
 * every un-parseable keystroke could never be typed into at all. Three-digit
 * shorthand is accepted for the same reason anyone types it.
 *
 * It follows the element while it is not being typed in — an undo, a scrub in
 * the picker, a different element selected — and stops following the moment the
 * caret is in it, which is the only way both of those can be true at once.
 */
function HexField({
  value,
  onCommit,
  label,
  disabled,
}: {
  value: RGB
  onCommit: (rgb: RGB) => void
  label: string
  disabled?: boolean
}) {
  const shown = paintHex(value)
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  return (
    <input
      ref={ref}
      aria-label={label}
      title={label}
      spellCheck={false}
      value={draft ?? shown}
      onChange={(event) => {
        const text = event.target.value.replace(/[^0-9a-fA-F#]/g, '').slice(0, 7)
        setDraft(text)
        const rgb = hexToPaint(text)
        if (rgb) onCommit(rgb)
      }}
      onFocus={() => setDraft(shown)}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        // Enter, Escape and the arrows all mean something to the editor at
        // large; inside a text box they belong to the text box.
        event.stopPropagation()
        if (event.key === 'Enter' || event.key === 'Escape') {
          setDraft(null)
          ref.current?.blur()
        }
      }}
      className="dm-field dm-bare min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] tracking-wide text-ink tabular-nums outline-none"
      disabled={disabled}
    />
  )
}

/**
 * A percentage, scrubbed or typed — the same two gestures as every other number
 * in this panel, so nothing here has to be learned twice.
 */
function PercentField({
  value,
  onChange,
  label,
  disabled,
}: {
  /** 0–1 outside, whole percent inside: alpha is what CSS wants. */
  value: number
  onChange: (next: number) => void
  label: string
  disabled?: boolean
}) {
  const shown = Math.round(value * 100)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])

  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

  const scrub = (event: React.PointerEvent) => {
    if (disabled) return
    const from = shown
    startDrag(event.nativeEvent, {
      cursor: 'ew-resize',
      threshold: 3,
      onMove: (drag) => onChange(clamp(from + drag.dx) / 100),
    })
  }

  return (
    <span
      title={label}
      onPointerDown={scrub}
      className={cx(
        'flex h-[24px] w-[54px] shrink-0 cursor-ew-resize items-center gap-[1px] rounded-[6px] bg-ink/[0.06] px-1.5 text-[11px] tabular-nums',
        disabled && 'opacity-45',
      )}
    >
      {editing ? (
        <input
          ref={ref}
          aria-label={label}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            const next = Number.parseFloat(event.target.value)
            if (Number.isFinite(next)) onChange(clamp(next) / 100)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' || event.key === 'Escape') setEditing(false)
          }}
          className="dm-field dm-bare min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] text-ink tabular-nums outline-none"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          aria-label={`${label} — double-click to type a value`}
          onDoubleClick={() => {
            if (disabled) return
            setDraft(String(shown))
            setEditing(true)
          }}
          className="min-w-0 flex-1 cursor-text text-ink"
        >
          {shown}
        </span>
      )}
      <span aria-hidden className="text-ink-soft">
        %
      </span>
    </span>
  )
}

/** A bare 22px button — the eye and the minus, which carry no background. */
export function IconButton({
  label,
  onClick,
  dim = false,
  children,
}: {
  label: string
  onClick: () => void
  dim?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cx(
        'grid h-[22px] w-[20px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent hover:bg-ink/5',
        dim ? 'text-ink-soft' : 'text-ink',
      )}
    >
      {children}
    </button>
  )
}
