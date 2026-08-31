import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { zoom } from '../core/zoom'
import { CaretIcon } from './icons'
import { cx, overlayRoot, POPOVER_ATTR, useDismiss, zoomStable } from './util'

export interface Option<T extends string> {
  value: T
  label: string
  /** Set at the far end of the row — a weight's number, a size in px. */
  hint?: string
  /** The row is set in this face, for a list of fonts or of weights. */
  style?: React.CSSProperties
}

const ROW = 24
const GAP = 4

/**
 * A dropdown we draw ourselves.
 *
 * A native `<select>` was here first and it had exactly one virtue: its menu
 * escapes every clipping ancestor for free. Everything else about it was wrong
 * in this panel. The menu is drawn by the operating system, so it arrives as a
 * grey Windows list with a blue highlight in the middle of a white, rounded,
 * hairlined toolbar — the screenshots of it beside our own controls are the
 * whole argument. It cannot show a label and a value at opposite ends of a row,
 * which is how a weight wants to read (`Regular` … `400`). It cannot set a row
 * in the face that row names. And its closed state ignores font, padding and
 * radius on most platforms whatever CSS says.
 *
 * So: a button and a list, portalled to the overlay root the same way the colour
 * picker is and for the same reason — the docked column is an `overflow: hidden`
 * box around a scrolling pane, which is precisely the arrangement a popover
 * cannot survive.
 *
 * What has to be earned back is everything the native control gave away for
 * free, so it is a real listbox: arrow keys walk it, Home and End jump, Enter
 * and Space commit, Escape closes, focus returns to the button, and the roles
 * and `aria-activedescendant` are there for a screen reader to read.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  width,
  dropUp = false,
  align = 'left',
  trigger,
  className,
}: {
  value: T
  options: Option<T>[]
  onChange: (next: T) => void
  /** The accessible name — the control has no visible one of its own. */
  label: string
  /** Menu width. Defaults to the button's, which is what most of them want. */
  width?: number
  dropUp?: boolean
  align?: 'left' | 'right'
  /**
   * The closed control. Given one, this renders only the menu behaviour around
   * it — for the size field, whose trigger is a whole number chip.
   */
  trigger?: (props: { open: boolean; toggle: () => void }) => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const buttonRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [seat, setSeat] = useState<{ left: number; top: number; width: number } | null>(null)
  const chosen = options.find((option) => option.value === value)

  useDismiss(menuRef, open, () => setOpen(false))

  // Opening lands on the current value rather than at the top of the list.
  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((option) => option.value === value)))
  }, [open, options, value])

  /**
   * Seated against the button on every render, like the colour picker: the
   * overlay repaints as the page is tracked, so a menu whose control has been
   * scrolled or panned away corrects itself on the next frame instead of
   * floating where the button used to be.
   */
  useLayoutEffect(() => {
    if (!open) return
    const anchor = buttonRef.current?.getBoundingClientRect()
    const menu = menuRef.current
    if (!anchor || !menu) return
    const z = zoom() || 1
    const shown = (width ?? anchor.width * z) / z
    const height = menu.offsetHeight / z
    const gap = GAP / z
    const wanted = {
      width: shown,
      left: clamp(align === 'right' ? anchor.right - shown : anchor.left, shown, window.innerWidth),
      top: clamp(
        dropUp ? anchor.top - gap - height : anchor.bottom + gap,
        height,
        window.innerHeight,
      ),
    }
    if (
      !seat ||
      Math.abs(seat.left - wanted.left) > 0.5 ||
      Math.abs(seat.top - wanted.top) > 0.5 ||
      Math.abs(seat.width - wanted.width) > 0.5
    ) {
      setSeat(wanted)
    }
  })

  const commit = (next: T) => {
    onChange(next)
    setOpen(false)
  }

  const onKey = (event: React.KeyboardEvent) => {
    // Every one of these means something to the editor at large; inside an open
    // menu they belong to the menu.
    event.stopPropagation()
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[active]
      if (option) commit(option.value)
      return
    }
    const step =
      event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step) {
      event.preventDefault()
      setActive((current) => Math.min(options.length - 1, Math.max(0, current + step)))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : options.length - 1)
    }
  }

  const toggle = () => setOpen((prev) => !prev)
  const root = overlayRoot()

  return (
    <>
      <span
        ref={buttonRef}
        className={cx('relative flex min-w-0', trigger ? 'shrink-0' : 'flex-1', className)}
      >
        {trigger ? (
          <span onKeyDown={onKey}>{trigger({ open, toggle })}</span>
        ) : (
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="listbox"
            title={label}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggle}
            onKeyDown={onKey}
            className={cx(
              'dm-select flex h-[24px] min-w-0 flex-1 items-center gap-1 rounded-[6px] border-0 px-1.5 text-[11px] text-ink',
              open ? 'bg-ink/[0.10]' : 'bg-ink/[0.06] hover:bg-ink/[0.09]',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left" style={chosen?.style}>
              {chosen?.label ?? value}
            </span>
            {chosen?.hint && (
              <span className="shrink-0 text-[10px] text-ink-soft tabular-nums">{chosen.hint}</span>
            )}
            <span className="shrink-0 text-ink-soft">
              <CaretIcon />
            </span>
          </button>
        )}
      </span>

      {open &&
        root &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            {...{ [POPOVER_ATTR]: '' }}
            className="dm-panel dm-scroll dm-interactive overflow-y-auto py-1"
            style={{
              position: 'fixed',
              left: seat?.left ?? -9999,
              top: seat?.top ?? -9999,
              width: seat?.width,
              maxHeight: 260,
              borderRadius: 8,
              ...zoomStable(zoom(), dropUp ? 'bottom left' : 'top left'),
              // Until it has been measured it must not flash at the top left.
              visibility: seat ? 'visible' : 'hidden',
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onPointerEnter={() => setActive(index)}
                onClick={() => commit(option.value)}
                className={cx(
                  'flex w-full items-center gap-2 border-0 px-2 text-left text-[11px]',
                  index === active ? 'bg-ink/[0.07]' : 'bg-transparent',
                  option.value === value
                    ? 'text-[color:var(--color-select)]'
                    : 'text-ink',
                )}
                style={{ height: ROW }}
              >
                <span className="min-w-0 flex-1 truncate" style={option.style}>
                  {option.label}
                </span>
                {option.hint && (
                  <span className="shrink-0 text-[10px] text-ink-soft tabular-nums">
                    {option.hint}
                  </span>
                )}
              </button>
            ))}
          </div>,
          root,
        )}
    </>
  )
}

const clamp = (value: number, size: number, limit: number): number =>
  Math.max(8, Math.min(value, limit - size - 8))
