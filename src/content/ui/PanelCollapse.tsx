import { cx } from './util'

/**
 * The fold control in a docked panel's title bar.
 *
 * A caret that points the way the panel will go, which is the one affordance
 * that needs no label: down when there is a body to drop open, up when there is
 * one to pull shut. It sits at the top right of both panels rather than beside
 * each title, because two panels that fold from different places do not read as
 * two of the same thing.
 */
export function PanelCollapse({
  collapsed,
  label,
  onToggle,
}: {
  collapsed: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      title={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      onClick={onToggle}
      className={cx(
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent p-0',
        'text-[9px] leading-none text-ink-soft hover:bg-ink/5 hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className="block transition-transform duration-150 ease-out"
        style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
      >
        ▼
      </span>
    </button>
  )
}
