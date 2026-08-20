import { describe } from '../core/geometry'
import type { Node } from '../core/store'
import { GapOverlay } from './GapOverlay'
import { SpacingOverlay } from './SpacingOverlay'
import { rectStyle } from './util'

/**
 * What a member of a multi-selection looks like: every measurement the single
 * selection shows — padding, margin, child gaps, size — and none of the controls.
 *
 * With more than one element picked the tool stops being an editor and becomes a
 * comparison view. Handles, the move grip and the layout pill all act on exactly
 * one target, so showing them would promise an edit that can't happen; the
 * numbers, which are the reason to select two things side by side in the first
 * place, are what stay.
 */
export function MeasureChrome({
  node,
  primary,
  extraCount = 0,
}: {
  node: Node
  primary: boolean
  extraCount?: number
}) {
  const { rect } = node.metrics

  return (
    <>
      <div
        className="pointer-events-none"
        style={{
          ...rectStyle(rect),
          background: 'color-mix(in srgb, var(--color-select) 5%, transparent)',
        }}
      />

      <GapOverlay node={node} readOnly />
      <SpacingOverlay node={node} readOnly />

      <div style={rectStyle(rect)} className="pointer-events-none">
        <div
          className="absolute inset-0 border border-dotted border-[color:var(--color-select)]"
          style={{ outline: '1px solid rgba(255,255,255,0.35)', outlineOffset: 0 }}
        />

        <span
          className="absolute -top-[19px] left-0 flex max-w-[240px] items-center overflow-hidden rounded-[4px] px-1.5 py-[2px] text-[10px] font-medium tracking-tight text-paper"
          style={{
            // The first-picked element stays visually the anchor of the set:
            // it is the one bulk actions are described against.
            background: primary
              ? 'var(--color-select)'
              : 'color-mix(in srgb, var(--color-select) 72%, white)',
          }}
        >
          <span className="truncate">{describe(node.el)}</span>
          {primary && extraCount > 0 && (
            <span className="ml-1 shrink-0 rounded-[3px] bg-paper/25 px-1">+{extraCount}</span>
          )}
        </span>

        <span className="dm-panel absolute -bottom-[26px] left-1/2 -translate-x-1/2 px-1.5 py-[2px] text-[10px] font-medium text-ink-soft tabular-nums">
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      </div>
    </>
  )
}
