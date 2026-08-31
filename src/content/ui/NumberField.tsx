import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { consumedByDrag, startDrag } from '../core/drag'
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
/**
 * The field the cursor is over, if any.
 *
 * Arrow keys on a number box only worked while that box had the keyboard focus,
 * which is almost never: you point at a padding chip, press Shift+Up, and
 * nothing happens — the keystroke goes to the editor at large and nudges the
 * *element* instead. Every design tool answers this the same way, by letting the
 * control under the pointer take the keys, and this is the register that makes
 * that possible: one entry, set on enter and cleared on leave.
 *
 * Read by the controller rather than by a listener of our own, because the
 * controller already owns the window's keydown in the capture phase and would
 * otherwise swallow the arrows before any field could see them.
 */
export const hoveredField: { current: ((event: KeyboardEvent) => boolean) | null } = {
  current: null,
}

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
  fill = false,
  readout,
  trailing,
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
  /**
   * Stretch to the room going rather than hug the number.
   *
   * The docked panel lays its chips out in two columns, and columns only read as
   * columns if the things in them are the same width — four chips each sized to
   * their own digits give a ragged grid where the eye has to find each field
   * instead of landing on it. In the bar the opposite is true, so this is off by
   * default: a chip there takes exactly the room its value needs.
   */
  fill?: boolean
  /**
   * A word in place of the number, for a quantity that is currently not one.
   *
   * "Hug" and "Fill" are sizes the same way 240 is a size, and they belong in
   * the same box — a separate control for them would mean reading two places to
   * learn one thing. The field goes quiet while a word is showing: there is no
   * number to scrub or type, and offering the gesture anyway would be a
   * hair-trigger route back to Fixed.
   */
  readout?: string
  /** Sits at the end of the chip — the size field's mode caret. */
  trailing?: ReactNode
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

  /**
   * The keys a number box answers, in both its states.
   *
   * One by one with the arrows, two by two with Shift — so a value can be walked
   * onto an even number without arithmetic, which is most of what these fields
   * are nudged towards. `+` and `-` do the same thing from the keyboard's other
   * side; they are what anyone reaches for when the field is a chip rather than
   * a spinner, and there is nothing else a plus sign could mean in a box that
   * only holds numbers.
   *
   * Returns whether it took the key, so the caller can decide what else to do
   * with the ones it did not.
   */
  const onArrowKey = (event: ReactKeyboardEvent): boolean => {
    const nudge = event.shiftKey ? 2 : 1
    if (event.key === 'ArrowUp') return bump(nudge)
    if (event.key === 'ArrowDown') return bump(-nudge)
    if (event.key === '+' || event.key === '=') return bump(nudge)
    /**
     * Only on the closed chip. In an open field a minus is the start of a
     * negative number — margins and shadow offsets are routinely negative — and
     * swallowing it would make those impossible to type.
     */
    if (event.key === '-' && !editing) return bump(-nudge)
    return false
  }

  const onFieldKey = (event: ReactKeyboardEvent) => {
    // The controller listens for Enter, arrows and Delete on the window;
    // inside this box they belong to the box.
    event.stopPropagation()
    if (event.key === 'Enter') {
      setEditing(false)
      return
    }
    if (event.key === 'Escape') {
      onChange(opened.current)
      setEditing(false)
      return
    }
    if (onArrowKey(event)) event.preventDefault()
  }

  const bump = (delta: number): boolean => {
    if (readout) return false
    if (onNudge) onNudge(delta)
    else onChange(clamp(value + delta))
    return true
  }

  /**
   * Scrub. Two pixels to the unit rather than one: at 1:1 a small wrist movement
   * runs a corner radius from 0 to 60 and the value you actually wanted is
   * somewhere in the middle of that. Shift multiplies by ten for the times you
   * do mean to travel.
   */
  /**
   * The same keys the field answers when focused, answered from a hover.
   * Returns whether it took the key, so the caller can fall through.
   */
  const handleHoverKey = (event: KeyboardEvent): boolean => {
    if (readout) return false
    const nudge = event.shiftKey ? 2 : 1
    if (event.key === 'ArrowUp') return bump(nudge)
    if (event.key === 'ArrowDown') return bump(-nudge)
    if (event.key === '+' || event.key === '=') return bump(nudge)
    if (event.key === '-') return bump(-nudge)
    return false
  }

  /**
   * A stable identity around a body that is replaced every render.
   *
   * The register is written on pointer *enter* and read on every keystroke after
   * that, so handing it the render's own closure meant it went stale the instant
   * the first nudge landed: every later key was computed from the value the
   * field had when the cursor arrived, and holding Up walked 12 → 13 → 13 → 13.
   * The ref is refreshed each render; the function put in the register never
   * changes, which is also what lets pointer-leave recognise its own entry.
   */
  const latest = useRef(handleHoverKey)
  latest.current = handleHoverKey
  const fromHover = useRef((event: KeyboardEvent): boolean => latest.current(event)).current

  /**
   * Let go of the arrows if this field disappears while it is still the hovered
   * one.
   *
   * `pointerleave` never fires on an element that is unmounted from under the
   * cursor, and the panel unmounts fields constantly — folding a group away,
   * switching to a different element, ending a text edit. The register would go
   * on holding a dead field's handler, and every arrow key from then on would be
   * swallowed by a control that is no longer on screen. Same shape as the Delete
   * bug: works, works, then quietly stops.
   */
  useEffect(
    () => () => {
      if (hoveredField.current === fromHover) hoveredField.current = null
    },
    [fromHover],
  )

  const onScrub = (event: ReactPointerEvent) => {
    if (readout) return
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

  const word = readout ? (
    <span
      aria-label={`${label} — ${readout}`}
      className={cx('min-w-0 flex-1 truncate text-[11px] text-ink-soft', !fill && 'text-center')}
    >
      {readout}
    </span>
  ) : null

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
        'dm-field rounded-[5px] border border-line bg-paper px-0.5 py-[1px] text-[11px] text-[color:var(--color-select)] tabular-nums',
        fill ? 'w-full min-w-0 flex-1 text-left' : 'text-center',
        fill ? '' : compact ? 'w-[30px]' : 'w-[34px]',
      )}
    />
  ) : (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${label} — double-click to type a value`}
      onDoubleClick={open}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
          return
        }
        if (onArrowKey(event)) event.preventDefault()
      }}
      className={cx(
        'cursor-text rounded-[5px] border border-transparent py-[1px] text-[11px] tabular-nums',
        fill ? 'min-w-0 flex-1 text-left' : 'text-center',
        fill ? '' : compact ? 'w-[27px]' : 'w-[34px] hover:border-line hover:bg-ink/5',
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
        onPointerEnter={() => {
          hoveredField.current = fromHover
        }}
        onPointerLeave={() => {
          if (hoveredField.current === fromHover) hoveredField.current = null
        }}
        /**
         * A single click opens the box for typing, not just a double.
         *
         * Double-click was the only way in, inherited from the days when these
         * chips sat inches from the page text and a stray single click had to
         * mean nothing. In a panel there is no such risk, and "click the number,
         * type the number" is what everyone tries first — the double-click was
         * costing a discovery every time.
         *
         * The scrub is what makes this safe to add: `startDrag` only engages
         * past its threshold, so a press that travelled is a scrub and its
         * trailing click is swallowed here exactly as it is everywhere else in
         * the product. A press that did not travel was a click, and means this.
         */
        onClick={(event) => {
          if (editing || readout || consumedByDrag()) return
          // The trailing control is a button of its own — a mode caret, a size
          // menu — and its click is not an invitation to type in the number.
          if ((event.target as HTMLElement).closest('button')) return
          open()
        }}
        className={cx(
          'flex h-[24px] items-center gap-[2px] rounded-[6px] bg-ink/[0.06] pr-[2px] pl-[5px] text-ink-soft',
          readout ? 'cursor-default' : 'cursor-ew-resize',
          fill ? 'min-w-0 flex-1' : 'shrink-0',
        )}
      >
        <span aria-hidden className="flex items-center">
          {icon ?? <span className="text-[10px] font-medium">{label}</span>}
        </span>
        {word ?? field}
        {trailing}
      </span>
    )
  }

  return (
    <span
      className="flex shrink-0 items-center"
      title={title ?? label}
      onPointerEnter={() => {
        hoveredField.current = fromHover
      }}
      onPointerLeave={() => {
        if (hoveredField.current === fromHover) hoveredField.current = null
      }}
    >
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
