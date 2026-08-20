import type { Node } from '../core/store'
import { rectStyle } from './util'

/**
 * A very light tint over the selected element, so its extent reads as a shape
 * rather than having to be inferred from four corner handles. Kept at 5% and
 * painted below every other overlay: the green, orange and pink spacing bands
 * must still be judged on their own colour.
 */
export function SelectionWash({ node }: { node: Node }) {
  return (
    <div
      className="pointer-events-none"
      style={{
        ...rectStyle(node.metrics.rect),
        background: 'color-mix(in srgb, var(--color-select) 5%, transparent)',
      }}
    />
  )
}
