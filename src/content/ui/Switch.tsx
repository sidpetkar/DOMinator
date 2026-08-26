import { cx } from './util'

/**
 * The one control in the product that is a *mode* rather than an action.
 *
 * Everything else in the status bar is a pill you press to make something
 * happen, and pills already show state by going blue. That was tried here first
 * and read as "this button is currently pressed" rather than "the editor is in
 * another layout now" — which is a much larger claim and needed a shape that
 * makes it. A switch is the one shape that is unambiguously a setting.
 *
 * Two elements, no more: the track carries the colour and the knob slides. Both
 * transition on transform and background, so nothing lays out during the
 * animation.
 */
export function Switch({
  on,
  label,
  title,
  onChange,
}: {
  on: boolean
  label: string
  title?: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title ?? label}
      onClick={() => onChange(!on)}
      className={cx(
        'relative inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer items-center rounded-[999px] border-0 p-0',
        'transition-[background-color] duration-200 ease-out',
        on ? 'bg-[color:var(--color-select)]' : 'bg-ink/20',
      )}
    >
      <span
        className="pointer-events-none block h-[12px] w-[12px] rounded-full bg-white transition-transform duration-200 ease-out"
        style={{
          boxShadow: '0 1px 2px rgba(0,0,0,.3)',
          transform: `translateX(${on ? 14 : 2}px)`,
        }}
      />
    </button>
  )
}
