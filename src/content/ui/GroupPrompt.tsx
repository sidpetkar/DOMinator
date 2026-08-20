import { controller } from '../core/controller'
import { plan } from '../core/group'
import type { Rect } from '../core/geometry'
import type { Node } from '../core/store'
import { zoom } from '../core/zoom'
import { FrameIcon } from './icons'
import { zoomStable } from './util'

/**
 * The one control a multi-selection gets: wrap these in an auto-layout container.
 *
 * A multi-selection is otherwise deliberately a comparison view with no controls
 * (see MeasureChrome) — every styling tool needs one unambiguous target. Grouping
 * is the exception, because it is the only operation whose *subject is the set*:
 * it takes several elements and produces the single parent the align and stack
 * controls have been waiting for.
 *
 * When the set can't be grouped this still appears, carrying the reason. A key
 * that silently does nothing is worse than one that explains itself, and the
 * reason is always actionable — put them in the same container first.
 */
export function GroupPrompt({ nodes }: { nodes: Node[] }) {
  const check = plan(nodes.map((node) => node.el))
  const box = union(nodes.map((node) => node.metrics.rect))

  // Below the set, unless it runs to the bottom of the window — the members'
  // own size readouts already sit just under each rect, so this clears them.
  const below = box.top + box.height + 42
  const top = below > window.innerHeight - 40 ? Math.max(12, box.top - 46) : below

  return (
    <div
      className="dm-panel dm-interactive flex items-center gap-1.5 py-1 pr-1 pl-2.5"
      style={{
        position: 'fixed',
        top,
        left: Math.min(Math.max(box.left + box.width / 2, 140), window.innerWidth - 140),
        borderRadius: 'var(--radius-pill)',
        maxWidth: 'min(420px, calc(100vw - 24px))',
        ...zoomStable(zoom(), 'top center', 'translateX(-50%)'),
      }}
    >
      <FrameIcon />
      {check.ok ? (
        <>
          <span className="text-[11px] font-medium text-ink-soft">
            {nodes.length} selected
          </span>
          <button
            type="button"
            title="Wrap these in a new auto-layout container, then stack and align them (Shift+A)"
            onClick={() => controller.groupSelection()}
            className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border-0 bg-[color:var(--color-select)] px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap text-paper"
          >
            Group
            <span className="rounded-[3px] bg-paper/25 px-1 text-[10px]">Shift A</span>
          </button>
        </>
      ) : (
        <span className="py-[3px] text-[11px] font-medium text-ink-soft">{check.reason}</span>
      )}
    </div>
  )
}

/** Bounding box of the whole set — what the prompt is anchored to. */
function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.left + r.width))
  const bottom = Math.max(...rects.map((r) => r.top + r.height))
  return { left, top, width: right - left, height: bottom - top }
}

