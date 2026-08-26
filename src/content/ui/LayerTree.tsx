import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { OWN_NODE_ATTR } from '@/shared/constants'
import { controller } from '../core/controller'
import { startDrag } from '../core/drag'
import { nodeOf, store, type EditorSnapshot } from '../core/store'
import {
  ancestry,
  applyDrop,
  childrenOf,
  dropAt,
  hasChildren,
  label,
  preview,
  type TreeDrop,
} from '../core/tree'
import { SearchIcon } from './icons'
import { cx } from './util'

const ROW_HEIGHT = 22
const INDENT = 11

/**
 * The layers panel: the page as a tree you can pick things out of and rearrange.
 *
 * Two things it is deliberately not. It is not a DOM inspector — see tree.ts for
 * why the head is absent — and it is not a mirror of the canvas selection model:
 * dragging a row *moves the element*, immediately and for real, rather than
 * staging a change you then apply. That is the whole reason it exists. Reaching
 * a card that is three containers deep and dropping it into a different section
 * is a gesture the canvas cannot offer at all, because on the canvas the thing
 * you want to drop into is underneath the thing you are dragging.
 *
 * Only open subtrees are rendered. A page with eight thousand elements costs the
 * rows you can see plus the path to the selection, which is what keeps this
 * usable on a real site rather than on a fixture.
 */
export function LayerTree({ snapshot }: { snapshot: EditorSnapshot }) {
  const { selected, hovered } = snapshot
  const [open, setOpen] = useState<Set<Element>>(() => new Set())
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<{ el: HTMLElement; drop: TreeDrop | null } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * The path to the selection opens itself. Selecting on the canvas and then
   * looking at the tree to see *where* that element lives is the main reason to
   * have both, and it only works if the tree has already gone there.
   */
  useEffect(() => {
    if (!selected) return
    setOpen((current) => {
      const next = new Set(current)
      for (const parent of ancestry(selected.el)) next.add(parent)
      return next
    })
  }, [selected])

  // Follow the selection down the list, but never fight a scroll in progress.
  useEffect(() => {
    if (!selected) return
    const row = listRef.current?.querySelector(`[data-selected="true"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  const toggle = (el: Element) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(el)) next.delete(el)
      else next.add(el)
      return next
    })

  /**
   * Search matches on what the row shows — tag, id, class, and a leaf's text —
   * and reveals every match by opening its ancestors. Filtering the list instead
   * would strip the nesting out of a tree whose only job is to show nesting.
   */
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return null
    const found = new Set<HTMLElement>()
    const walk = (el: HTMLElement) => {
      if (label(el).toLowerCase().includes(term) || preview(el).toLowerCase().includes(term)) {
        found.add(el)
      }
      for (const child of childrenOf(el)) walk(child)
    }
    if (document.body) walk(document.body)
    return found
  }, [query, snapshot])

  useEffect(() => {
    if (!matches?.size) return
    setOpen((current) => {
      const next = new Set(current)
      for (const el of matches) for (const parent of ancestry(el)) next.add(parent)
      return next
    })
  }, [matches])

  /**
   * Dragging a row.
   *
   * The row under the cursor is found by hit-testing the shadow root rather than
   * by per-row pointer handlers: the dragged row is under the cursor itself for
   * most of the gesture, and a handler on it would swallow every enter event
   * meant for the rows it is passing over.
   */
  const beginDrag = (el: HTMLElement) => (event: ReactPointerEvent) => {
    if (el === document.body) return
    const root = (event.currentTarget as HTMLElement).getRootNode() as ShadowRoot
    let landing: TreeDrop | null = null

    startDrag(event.nativeEvent, {
      cursor: 'grabbing',
      threshold: 4,
      onStart: () => setDrag({ el, drop: null }),
      onMove: ({ x, y }) => {
        const under = root.elementFromPoint(x, y) as HTMLElement | null
        const row = under?.closest<HTMLElement>('[data-layer-row]') ?? null
        const target = rowTarget(row)
        landing = target && row ? dropAt(el, target, y, row.getBoundingClientRect()) : null
        setDrag({ el, drop: landing })
      },
      onEnd: () => {
        if (landing) {
          applyDrop(el, landing)
          // Open the new home, or the element you just moved vanishes from view.
          if (landing.where === 'inside') setOpen((c) => new Set(c).add(landing!.target))
          controller.select(el)
        }
        setDrag(null)
      },
    })
  }

  const rows: React.ReactNode[] = []
  const walk = (el: HTMLElement, depth: number) => {
    const expanded = open.has(el)
    rows.push(
      <Row
        key={rowKey(el, rows.length)}
        el={el}
        depth={depth}
        expanded={expanded}
        selected={selected?.el === el}
        hovered={hovered?.el === el}
        matched={matches?.has(el) ?? false}
        dimmed={Boolean(matches) && !matches?.has(el)}
        dragging={drag?.el === el}
        drop={drag?.drop?.target === el ? drag.drop.where : null}
        onToggle={() => toggle(el)}
        onGrab={beginDrag(el)}
      />,
    )
    if (!expanded) return
    for (const child of childrenOf(el)) walk(child, depth + 1)
  }
  if (document.body) walk(document.body, 0)

  return (
    <div
      className="dm-panel dm-interactive flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        bottom: 62,
        width: 252,
        borderRadius: 14,
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Search tag, id, class or text"
          aria-label="Search the layer tree"
          className="dm-field min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] text-ink placeholder:text-ink-soft"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => setQuery('')}
            className="shrink-0 rounded-[4px] border-0 bg-transparent px-1 text-[11px] text-ink-soft hover:bg-ink/5"
          >
            ×
          </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {rows}
      </div>

      <div className="border-t border-line px-2.5 py-1 text-[9px] leading-tight text-ink-soft">
        {drag
          ? drag.drop
            ? `${drag.drop.where === 'inside' ? 'Into' : drag.drop.where === 'before' ? 'Above' : 'Below'} ${label(drag.drop.target)}`
            : 'Nowhere to drop that'
          : 'Drag a row to move the element · click to select'}
      </div>
    </div>
  )
}

/**
 * React needs a stable key and an element has no id of its own. The element
 * itself cannot be one, so position in the flattened list is used — which is
 * correct here precisely because the list *is* rebuilt from the DOM on every
 * render, so index and content never drift apart.
 */
const rowKey = (el: HTMLElement, index: number) => `${index}:${el.tagName}`

/** The page element a row stands for, if the node under the cursor is one. */
function rowTarget(row: HTMLElement | null): HTMLElement | null {
  const held = row && ROW_ELEMENTS.get(row)
  return held ?? null
}

/**
 * Rows are looked up by their DOM node during a drag, so each one registers what
 * it stands for. A WeakMap rather than a data attribute: an element cannot be
 * serialised into one, and round-tripping through an index would go stale the
 * moment the tree re-rendered mid-gesture — which it does, on every move.
 */
const ROW_ELEMENTS = new WeakMap<HTMLElement, HTMLElement>()

function Row({
  el,
  depth,
  expanded,
  selected,
  hovered,
  matched,
  dimmed,
  dragging,
  drop,
  onToggle,
  onGrab,
}: {
  el: HTMLElement
  depth: number
  expanded: boolean
  selected: boolean
  hovered: boolean
  matched: boolean
  dimmed: boolean
  dragging: boolean
  drop: 'before' | 'after' | 'inside' | null
  onToggle: () => void
  onGrab: (event: ReactPointerEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = ref.current
    if (row) ROW_ELEMENTS.set(row, el)
  })

  const branches = hasChildren(el)
  const text = preview(el)

  return (
    <div
      ref={ref}
      data-layer-row=""
      data-selected={selected ? 'true' : undefined}
      onPointerDown={onGrab}
      onClick={() => controller.select(el)}
      /* Hovering a row lights the element up on the page, which is most of how
         you find your way around a tree of anonymous divs. */
      onPointerEnter={() => store.set({ hovered: nodeOf(el) })}
      onPointerLeave={() => store.set({ hovered: null })}
      className={cx(
        'relative flex cursor-default items-center gap-1 py-[3px] pr-2 text-[11px]',
        selected ? 'bg-[color:var(--color-select)] text-paper' : 'text-ink hover:bg-ink/5',
        hovered && !selected && 'bg-ink/5',
        dragging && 'opacity-40',
        dimmed && !selected && 'opacity-35',
      )}
      style={{ paddingLeft: 6 + depth * INDENT, minHeight: ROW_HEIGHT }}
    >
      {/* The landing line, drawn on the row it lands against — a rule at the
          edge for an ordering, a ring around the whole row for a nesting. */}
      {drop === 'before' && <Edge side="top" />}
      {drop === 'after' && <Edge side="bottom" />}
      {drop === 'inside' && (
        <span
          className="pointer-events-none absolute inset-[1px] rounded-[4px]"
          style={{ boxShadow: 'inset 0 0 0 2px var(--color-select)' }}
        />
      )}

      <button
        type="button"
        aria-label={branches ? (expanded ? `Collapse ${label(el)}` : `Expand ${label(el)}`) : ''}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
        className={cx(
          'grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px] border-0 bg-transparent p-0 text-[8px] leading-none',
          branches ? 'cursor-pointer opacity-70 hover:opacity-100' : 'invisible',
          selected ? 'text-paper' : 'text-ink-soft',
        )}
        style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
      >
        ▶
      </button>

      <span
        className={cx(
          'truncate font-medium',
          matched && !selected && 'text-[color:var(--color-select)]',
        )}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {label(el)}
      </span>

      {text && (
        <span
          className={cx(
            'ml-auto max-w-[86px] truncate text-[10px]',
            selected ? 'text-paper/70' : 'text-ink-soft',
          )}
        >
          {text}
        </span>
      )}
    </div>
  )
}

const Edge = ({ side }: { side: 'top' | 'bottom' }) => (
  <span
    className="pointer-events-none absolute right-0 left-0 h-[2px]"
    style={{ [side]: -1, background: 'var(--color-select)' }}
  />
)

/** Marks our own nodes, so the picker never treats a tree row as a page target. */
export const LAYER_PANEL_ATTR = OWN_NODE_ATTR
