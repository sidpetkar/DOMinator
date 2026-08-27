import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { OWN_NODE_ATTR } from '@/shared/constants'
import { LOGO_DATA_URL } from '@/shared/logo'
import { controller } from '../core/controller'
import { frameOf, isFrame } from '../core/frames'
import { startDrag } from '../core/drag'
import { nodeOf, store, type EditorSnapshot } from '../core/store'
import { zoom } from '../core/zoom'
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
import { PanelCollapse } from './PanelCollapse'
import { cx, dockedBox, useFadingScroll, zoomStable } from './util'

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
  const collapsed = Boolean(snapshot.collapsed.tree)
  const fold = (which: 'tree' | 'controls') => controller.foldPanel(which)
  // Held at a constant physical size, exactly as the floating bars are: zooming
  // out to see more of the page is the moment the panels most need to stay
  // legible, and it was the moment they used to shrink.
  const z = zoom() || 1
  useFadingScroll(listRef, !collapsed)

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
      // A variation is also the tree's root while it is selected, and a root
      // that opens collapsed shows one row and none of the structure that is
      // the reason you selected it.
      if (isFrame(selected.el)) next.add(selected.el)
      return next
    })
  }, [selected])

  /**
   * Follow the selection down the list.
   *
   * By moving the list's own `scrollTop`, not by `scrollIntoView` on the row.
   * `scrollIntoView` scrolls *every* scrollable ancestor, and one of a row's
   * ancestors is the document — so selecting a row both scrolled this list and
   * issued a second scroll on the page, which superseded the smooth scroll
   * `reveal` had just started and left the page two pixels from where it began.
   * A tree that scrolls the document as a side effect of scrolling itself is
   * wrong regardless; that it silently ate the reveal is how it was found.
   */
  useEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[data-selected="true"]')
    if (!list || !row) return
    const pane = list.getBoundingClientRect()
    const seat = row.getBoundingClientRect()
    if (seat.top < pane.top) list.scrollTop -= pane.top - seat.top
    else if (seat.bottom > pane.bottom) list.scrollTop += seat.bottom - pane.bottom
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
  /**
   * Rooted at the selected variation when there is one, and at the page
   * otherwise.
   *
   * A variation is a thing you are working on rather than a thing in the page,
   * and while you are inside one the forty rows of document around it are
   * nothing but distance between you and the four you care about. Deselect, or
   * pick something in the page, and the whole tree comes back.
   */
  const root = (selected && frameOf(selected.el)) ?? document.body
  if (root) walk(root, 0)

  return (
    <div
      className="dm-panel dm-interactive flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        width: 252,
        // Hugs its rows rather than reaching for the bottom of the window. A
        // panel that is always full height is mostly empty on a short page, and
        // that empty half is still covering the page underneath it.
        ...dockedBox(z, snapshot.layers),
        borderRadius: 14,
        ...zoomStable(z, 'top left'),
      }}
    >
      {/* Identity, matching the right-hand panel's title bar and the status bar
          — the three pieces of chrome read as one product rather than as three
          panels that happen to be on screen together. */}
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <img
          src={LOGO_DATA_URL}
          alt=""
          width="16"
          height="16"
          className="shrink-0 rounded-[4px]"
          style={{ display: 'block' }}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight text-ink">
          DOMinator
        </span>
        <PanelCollapse collapsed={collapsed} label="the layer tree" onToggle={() => fold('tree')} />
      </div>

      {!collapsed && (
        <>
          <div
            ref={listRef}
            className="dm-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1"
          >
            {rows}
          </div>

          {/* Only while a drag is in flight. The standing hint it replaced was a
              permanent line of text explaining a gesture you have to already be
              making to need it — and it was the bottom half of the whitespace. */}
          {drag && (
            <div className="border-t border-line px-2.5 py-1 text-[9px] leading-tight text-ink-soft">
              {drag.drop
                ? `${drag.drop.where === 'inside' ? 'Into' : drag.drop.where === 'before' ? 'Above' : 'Below'} ${label(drag.drop.target)}`
                : 'Nowhere to drop that'}
            </div>
          )}
          {/* Search sits under the tree rather than over it. It is the panel's
              least used control and the tree is its subject: putting the field
              first pushed the thing you came to look at one row further from the
              top of every glance. */}
          <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-1.5">
            {/* `shrink-0`, which is the whole reason it was invisible: a 12px SVG
                in a flex row next to a `flex-1` input is compressed to nothing. */}
            <span className="flex shrink-0 items-center text-ink-soft">
              <SearchIcon />
            </span>
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
        </>
      )}
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
      onClick={() => {
        controller.select(el)
        // The tree exists to reach things you cannot see, so picking one has to
        // bring the page to it.
        controller.reveal(el)
      }}
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
      <Guides depth={depth} selected={selected} />
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

/**
 * The dotted rules that make the nesting legible.
 *
 * No library. Every tree component that ships these also ships its own data
 * model, its own virtualiser and its own selection and drag handling — all of
 * which this panel already has and none of which would agree with the ones it
 * has. What is actually wanted is a vertical line per level of indent, and that
 * is what this is.
 *
 * Painted as a repeating gradient rather than a dotted border. A 1px dotted
 * border lands on 0.8 of a device pixel at most zoom levels and the browser
 * quietly renders it at a fraction of the requested alpha — which is exactly
 * what happened the first time: the lines were all there in the DOM, correct
 * to the pixel, and invisible on screen.
 *
 * They are drawn per row rather than as one continuous overlay, which is what
 * makes them continuous: consecutive rows at the same depth each paint their own
 * segment edge-to-edge, and the segments meet. A single absolutely-positioned
 * ruler would have to know where each run of siblings starts and ends, which is
 * a thing the flat list deliberately does not track.
 *
 * On the selected row they turn pale rather than disappearing — a gap in the
 * ladder is more distracting than the ladder.
 */
function Guides({ depth, selected }: { depth: number; selected: boolean }) {
  const tint = selected ? 'rgba(255,255,255,.5)' : 'rgba(11,11,12,.32)'
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0"
          style={{
            left: 11 + level * INDENT,
            width: 1,
            backgroundImage: `repeating-linear-gradient(to bottom, ${tint} 0 2px, transparent 2px 4px)`,
          }}
        />
      ))}
      {/* The elbow into this row, so a row reads as hanging off its parent's
          line rather than merely sitting near it. */}
      {depth > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: 11 + (depth - 1) * INDENT,
            top: '50%',
            height: 1,
            width: INDENT - 3,
            backgroundImage: `repeating-linear-gradient(to right, ${tint} 0 2px, transparent 2px 4px)`,
          }}
        />
      )}
    </>
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
