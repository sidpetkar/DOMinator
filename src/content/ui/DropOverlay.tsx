import { describe } from '../core/geometry'
import type { Drop } from '../core/reorder'
import { rectStyle } from './util'

/**
 * What the user sees while carrying a block: the container that will accept it,
 * every box that will become a sibling, and the exact seam it will land in.
 * Three layers, all keyed off the same Drop the commit will use — so what is
 * drawn is literally what will happen.
 */
export function DropOverlay({ drop }: { drop: Drop }) {
  return (
    <div className="pointer-events-none">
      {/* Receiving container. */}
      <div
        style={{
          ...rectStyle(drop.containerRect),
          background: 'color-mix(in srgb, var(--color-select) 7%, transparent)',
          outline: '1.5px solid var(--color-select)',
          outlineOffset: -1,
          borderRadius: 2,
        }}
      />

      {/* Future siblings, so the stack you are joining is legible. */}
      {drop.siblings.map((rect, index) => (
        <div
          key={index}
          style={{
            ...rectStyle(rect),
            outline: '1px dashed color-mix(in srgb, var(--color-select) 45%, transparent)',
            outlineOffset: -1,
          }}
        />
      ))}

      {/* The seam. */}
      <div
        style={{
          ...rectStyle(drop.indicator),
          background: 'var(--color-select)',
          borderRadius: 999,
          boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-select) 25%, transparent)',
        }}
      />

      <span
        className="dm-panel absolute flex items-center gap-1 px-1.5 py-[2px] text-[10px] font-medium text-ink"
        style={{
          position: 'fixed',
          top: Math.max(4, drop.containerRect.top - 22),
          left: drop.containerRect.left,
          maxWidth: 260,
        }}
      >
        <span className="text-ink-soft">into</span>
        <span className="truncate">{describe(drop.container)}</span>
        <span className="text-ink-soft">· {drop.axis === 'row' ? 'horizontal' : 'vertical'}</span>
      </span>
    </div>
  )
}
