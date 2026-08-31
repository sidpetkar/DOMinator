import { describe } from '../core/geometry'
import { hasChildren } from '../core/tree'
import type { Node } from '../core/store'
import { rectStyle } from './util'

/**
 * What the pointer is over, drawn two ways.
 *
 * A container gets the dashed box it always had — that is a statement about a
 * region, and a region has edges. A run of text is not a region: a box drawn
 * tightly around a heading reads as a border someone added to the type, and on a
 * paragraph that wraps three lines it encloses a rectangle of mostly whitespace
 * whose shape has nothing to do with the words. Underlining it says the same
 * thing about the same element without pretending the text is a box.
 *
 * Only the leaf gets it. Hovering a *parent* of some text is pointing at the
 * container, not at the words, and it keeps the outline — which is also what
 * keeps the two readings distinguishable while you drill down through a card
 * into the heading inside it.
 */
export function HoverOutline({ node }: { node: Node }) {
  const { rect } = node.metrics
  const words = !hasChildren(node.el) && Boolean((node.el.textContent ?? '').trim())

  return (
    <div style={rectStyle(rect)} className="pointer-events-none">
      {words ? (
        /**
         * Under the last line, at the element's own baseline-ish edge rather
         * than under every line: one rule reads as "this thing", where a rule
         * per line reads as text that has been marked up.
         */
        <div
          className="absolute right-0 bottom-0 left-0"
          style={{ height: 2, background: 'var(--color-select)', borderRadius: 1 }}
        />
      ) : (
        /**
         * Solid, where its peers are dotted (see PeerOutlines). The pair is the
         * whole readout: one line means "this", the dotted ones mean "or any of
         * these", and the difference has to survive being looked at quickly.
         */
        <div className="absolute inset-0 border border-[color:var(--color-select)]" />
      )}
      <span
        className="absolute -top-[19px] left-0 whitespace-nowrap rounded-[4px] bg-ink/85 px-1.5 py-[2px] text-[10px] font-medium tracking-tight text-paper"
        style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {describe(node.el)}
      </span>
    </div>
  )
}
