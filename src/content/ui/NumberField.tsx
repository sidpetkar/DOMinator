import { useEffect, useRef, useState } from 'react'
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
  mixed = false,
  title,
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
  /** Sides disagree, so no single number would be true. */
  mixed?: boolean
  title?: string
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

  const bump = (delta: number) => {
    if (onNudge) onNudge(delta)
    else onChange(clamp(value + delta))
  }

  return (
    <span className="flex shrink-0 items-center" title={title ?? label}>
      <span className="mr-0.5 text-[10px] font-medium text-ink-soft">{label}</span>
      <Nudge label={`Decrease ${label}`} onClick={() => bump(-step)}>
        −
      </Nudge>

      {editing ? (
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
          onKeyDown={(event) => {
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
          }}
          className="dm-field w-[34px] rounded-[5px] border border-line bg-paper px-0.5 py-[1px] text-center text-[11px] text-ink tabular-nums"
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
            'w-[34px] cursor-text rounded-[5px] border border-transparent py-[1px] text-center text-[11px] tabular-nums',
            'hover:border-line hover:bg-ink/5',
            mixed ? 'text-ink-soft' : 'text-ink',
          )}
        >
          {mixed ? '–' : shown}
        </span>
      )}

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
