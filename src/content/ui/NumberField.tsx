import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { startDrag } from '../core/drag'
import { cx } from './util'

/**
 * A nudgeable number that becomes a text box on double-click.
 *
 * Steppers alone make you click twenty times to get from 4 to 44; an always-open
 * input in a dense bar swallows keystrokes meant for the page. Double-click is
 * the seam between the two — the same gesture that opens text for editing
 * everywhere else in this tool.
 *
 * Typing applies on every valid keystroke rather than on commit, so the page
 * tracks the number as it is typed. Escape puts back the value the field was
 * opened with, since a live-applied edit has no other way back.
 */
export function NumberField({
  label,
  value,
  step = 4,
  min = -Infinity,
  precision = 0,
  onChange,
  onNudge,
  onGesture,
  mixed = false,
  title,
  icon,
  suffix,
  compact = false,
}: {
  label: string
  value: number
  step?: number
  min?: number
  precision?: number
  /** Absolute: the typed value, applied as-is. */
  onChange: (next: number) => void
  /**
   * Relative, when the quantity has sides that can differ. Stepping then adds to
   * each side rather than flattening them to one number.
   */
  onNudge?: (delta: number) => void
  /**
   * Brackets a scrub, so a drag through forty values is one undo step. Called
   * with true when the gesture starts and false when it ends.
   */
  onGesture?: (active: boolean) => void
  /** Sides disagree, so no single number would be true. */
  mixed?: boolean
  title?: string
  /**
   * Drawn in place of the text label. Which of four sides a field edits is a
   * picture, not a word — see the box-model marks in icons.tsx.
   */
  icon?: ReactNode
  /** Unit shown after the number, where the number alone would be ambiguous. */
  suffix?: string
  /**
   * The dense form: one chip holding the mark and the value, no steppers.
   *
   * Four of the full form do not fit in a bar, and once a control is folded out
   * into its four sides the steppers are the least useful thing in it — you are
   * there because you want *this* side to be a particular number, not four
   * pixels more than it was. Dragging the chip scrubs, which is both faster than
   * a stepper and the gesture anyone arriving from a design tool tries first.
   */
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const opened = useRef(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const shown = Math.round(value * 10 ** precision) / 10 ** precision
  const clamp = (n: number) => Math.max(min, Math.round(n * 10 ** precision) / 10 ** precision)

  const open = () => {
    opened.current = value
    // A mixed field opens empty: there is no current number to edit, and
    // whatever is typed will be applied to every side.
    setDraft(mixed ? '' : String(shown))
    setEditing(true)
  }

  const onFieldKey = (event: ReactKeyboardEvent) => {
    // The controller listens for Enter, arrows and Delete on the window;
    // inside this box they belong to the box.
    event.stopPropagation()
    if (event.key === 'Enter') setEditing(false)
    if (event.key === 'Escape') {
      onChange(opened.current)
      setEditing(false)
    }
    if (event.key === 'ArrowUp') bump(step)
    if (event.key === 'ArrowDown') bump(-step)
  }

  const bump = (delta: number) => {
    if (onNudge) onNudge(delta)
    else onChange(clamp(value + delta))
  }

  /**
   * Scrub. Two pixels to the unit rather than one: at 1:1 a small wrist movement
   * runs a corner radius from 0 to 60 and the value you actually wanted is
   * somewhere in the middle of that. Shift multiplies by ten for the times you
   * do mean to travel.
   */
  const onScrub = (event: ReactPointerEvent) => {
    const from = value
    let engaged = false
    startDrag(event.nativeEvent, {
      cursor: 'ew-resize',
      threshold: 3,
      onStart: () => {
        engaged = true
        onGesture?.(true)
      },
      onMove: (drag) => onChange(clamp(from + Math.round(drag.dx / 2) * (drag.shift ? 10 : 1))),
      onEnd: () => {
        if (engaged) onGesture?.(false)
      },
    })
  }

  const field = editing ? (
    <input
      ref={inputRef}
      aria-label={label}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        const next = Number.parseFloat(event.target.value)
        if (Number.isFinite(next)) onChange(clamp(next))
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={onFieldKey}
      className={cx(
        'dm-field rounded-[5px] border border-line bg-paper px-0.5 py-[1px] text-center text-[11px] text-[color:var(--color-select)] tabular-nums',
        compact ? 'w-[30px]' : 'w-[34px]',
      )}
    />
  ) : (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${label} — double-click to type a value`}
      onDoubleClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation()
          open()
        }
      }}
      className={cx(
        'cursor-text rounded-[5px] border border-transparent py-[1px] text-center text-[11px] tabular-nums',
        compact ? 'w-[27px]' : 'w-[34px] hover:border-line hover:bg-ink/5',
        // Blue is the value, grey is everything around it. The label beside
        // this box, the steppers either side and the dash a mixed field
        // shows are all chrome; the number is the only thing here that is
        // the page's own state, and colouring it is what lets you find it
        // in a bar of thirty small marks.
        mixed ? 'text-ink-soft' : 'text-[color:var(--color-select)]',
      )}
    >
      {mixed ? '–' : shown}
      {suffix && !mixed && <span className="text-ink-soft">{suffix}</span>}
    </span>
  )

  if (compact) {
    return (
      <span
        title={title ?? label}
        aria-label={label}
        onPointerDown={onScrub}
        className="flex h-[24px] shrink-0 cursor-ew-resize items-center gap-[2px] rounded-[6px] bg-ink/[0.06] pr-[2px] pl-[5px] text-ink-soft"
      >
        <span aria-hidden className="flex items-center">
          {icon ?? <span className="text-[10px] font-medium">{label}</span>}
        </span>
        {field}
      </span>
    )
  }

  return (
    <span className="flex shrink-0 items-center" title={title ?? label}>
      <span className="mr-0.5 flex items-center text-[10px] font-medium text-ink-soft">
        {icon ?? label}
      </span>
      <Nudge label={`Decrease ${label}`} onClick={() => bump(-step)}>
        −
      </Nudge>

      {field}

      <Nudge label={`Increase ${label}`} onClick={() => bump(step)}>
        +
      </Nudge>
    </span>
  )
}

const Nudge = ({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: string
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={onClick}
    className="grid h-[22px] w-[18px] shrink-0 place-items-center rounded-[var(--radius-pill)] border-0 bg-transparent text-[12px] leading-none text-ink hover:bg-ink/5"
  >
    {children}
  </button>
)
