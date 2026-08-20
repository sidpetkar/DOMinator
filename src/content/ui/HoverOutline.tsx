import { describe } from '../core/geometry'
import type { Node } from '../core/store'
import { rectStyle } from './util'

/**
 * PRD §3.1 skeleton view: a dashed hairline that reveals DOM structure without
 * committing to anything. Deliberately quiet — no fills, no handles.
 */
export function HoverOutline({ node }: { node: Node }) {
  const { rect } = node.metrics
  return (
    <div style={rectStyle(rect)} className="pointer-events-none">
      <div className="absolute inset-0 border border-dashed border-[color:var(--color-select)]/60" />
      <span
        className="absolute -top-[19px] left-0 whitespace-nowrap rounded-[4px] bg-ink/85 px-1.5 py-[2px] text-[10px] font-medium tracking-tight text-paper"
        style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {describe(node.el)}
      </span>
    </div>
  )
}
