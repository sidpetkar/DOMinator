import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { OWN_NODE_ATTR } from '@/shared/constants'
import { LOGO_DATA_URL } from '@/shared/logo'
import { controller } from '../core/controller'
import * as frames from '../core/frames'
import { isFrame } from '../core/frames'
import { startDrag } from '../core/drag'
import { nodeOf, store, type EditorSnapshot } from '../core/store'
import { zoom } from '../core/zoom'
import {
  ancestry,
  applyDrop,
  childrenOf,
  dropAt,
  label,
  preview,
  type TreeDrop,
} from '../core/tree'
import {
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  GridIcon,
  SearchIcon,
  StackIcon,
  TextIcon,
  TwistyIcon,
} from './icons'
import { PanelCollapse } from './PanelCollapse'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { cx, dockedBox, useFadingScroll, zoomStable } from './util'

const ROW_HEIGHT = 22

/**
 * One level of nesting, and the row's own left inset.
 *
 * Widened from 11. At eleven the guide for one level landed inside the *next*
 * level's twisty — the lines and the chevrons were fighting for the same three
 * pixels, and on a page five containers deep the result was a hatch rather than
 * a ladder. Fourteen is the smallest indent where a 10px chevron and the guide
 * behind it are visibly separate things.
 */
const INDENT = 14
const PAD = 8
/** The twisty's box, and so the column every guide runs down the middle of. */
const TWISTY = 13

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
  /**
   * Every element in the selection, not just the one the panels act on.
   *
   * Marquee four cards on the canvas and the tree lit exactly one row — which is
   * the tree disagreeing with the screen about what is selected, and the tree is
   * the thing you look at to find out.
   */
  const picked = useMemo(
    () => new Set<Element>([selected?.el, ...snapshot.extras.map((node) => node.el)].filter(Boolean) as Element[]),
    [selected, snapshot.extras],
  )
  const [open, setOpen] = useState<Set<Element>>(() => new Set())
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<{ el: HTMLElement; drop: TreeDrop | null } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** Where a Shift range counts from — see `pick`. */
  const anchor = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const collapsed = Boolean(snapshot.collapsed.tree)
  const fold = (which: 'tree' | 'controls') => controller.foldPanel(which)
  // Held at a constant physical size, exactly as the floating bars are: zooming
  // out to see more of the page is the moment the panels most need to stay
  // legible, and it was the moment they used to shrink.
  const z = zoom() || 1
  useFadingScroll(listRef, !collapsed)
  /**
   * The docked panels are draggable too now, for the reason the floating ones
   * always were: each of them is sometimes on top of the thing you are looking
   * at. A dock is a good default position, not a good permanent one — and
   * double-clicking the grip puts it back.
   */
  const grip = usePanelDrag('tree', panelRef)

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

  /**
   * Picking a row, with the two modifiers every list in the world uses.
   *
   * Plain replaces the selection. Ctrl or Cmd adds and removes one row, which is
   * what you want when the things you need are scattered. Shift takes everything
   * between the last row you picked and this one — and it walks the *rendered*
   * list rather than the DOM, so a range never quietly includes rows that are
   * folded away and invisible.
   *
   * The anchor is the last plain or toggled pick, not the last selection: with
   * the anchor moving on every Shift+click, extending a range twice would keep
   * shrinking it to the pair you were on.
   */
  const pick = (el: HTMLElement, event: React.MouseEvent) => {
    if (event.shiftKey && anchor.current) {
      const from = visible.indexOf(anchor.current)
      const to = visible.indexOf(el)
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from]
        const run = visible.slice(start, end + 1).filter((node) => node !== document.body)
        if (run.length) {
          controller.selectMany(run)
          return
        }
      }
    }
    anchor.current = el
    if (event.ctrlKey || event.metaKey) {
      controller.toggleInSelection(el)
      return
    }
    controller.select(el)
    // The tree exists to reach things you cannot see, so picking one has to
    // bring the page to it.
    controller.reveal(el)
  }

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
  /**
   * The rows as they are actually laid out, which is the only order a
   * Shift+click range can mean. Document order would be the wrong answer: a
   * collapsed subtree contributes nothing to the list, so a range drawn between
   * two visible rows must not sweep up forty elements hidden between them.
   */
  const visible: HTMLElement[] = []
  /**
   * A canvas object is not part of the page, so it is not drawn inside it.
   *
   * They live as absolutely-positioned children of `body` — that is what puts
   * them in canvas coordinates (see frames.ts) — but that is an implementation
   * detail of the surface, not a statement about the document, and showing a
   * lifted section nested under `body` next to the page's own wrapper said the
   * opposite of what the canvas had just done. Filtered here rather than in
   * tree.ts because it is true of this panel's *presentation*, not of the tree.
   */
  const kids = (el: HTMLElement): HTMLElement[] =>
    el === document.body ? childrenOf(el).filter((child) => !isFrame(child)) : childrenOf(el)

  const walk = (el: HTMLElement, depth: number) => {
    const expanded = open.has(el)
    visible.push(el)
    rows.push(
      <Row
        key={rowKey(el, rows.length)}
        el={el}
        depth={depth}
        expanded={expanded}
        selected={picked.has(el)}
        primary={selected?.el === el}
        hovered={hovered?.el === el}
        matched={matches?.has(el) ?? false}
        dimmed={Boolean(matches) && !matches?.has(el)}
        dragging={drag?.el === el}
        drop={drag?.drop?.target === el ? drag.drop.where : null}
        onToggle={() => toggle(el)}
        onGrab={beginDrag(el)}
        onPick={(event) => pick(el, event)}
        /* A root that is not the first stands clear of the tree above it: the
           page and each canvas object are separate things, and rows butted
           together read as one list of siblings. */
        detached={depth === 0 && rows.length > 0}
      />,
    )
    if (!expanded) return
    for (const child of kids(el)) walk(child, depth + 1)
  }
  /**
   * The page, and then everything standing beside it on the canvas.
   *
   * Each object is its own root rather than a row under `body`, because that is
   * what it is: a thing on the surface, a sibling of the page and not a part of
   * it. This replaced an earlier rule that rooted the whole tree at the selected
   * variation and hid everything else — which made sense while a variation was
   * the only kind of loose object there was, and stopped making sense the moment
   * there could be six of them and you needed to see the list.
   */
  if (document.body) walk(document.body, 0)
  for (const object of frames.all()) walk(object, 0)

  return (
    <div
      ref={panelRef}
      className="dm-panel dm-interactive flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        left: grip.pinned ? grip.pinned.left : 12,
        top: grip.pinned ? grip.pinned.top : 12,
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
        <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
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
            className="dm-scroll min-h-0 flex-1 overflow-auto py-1"
          >
            {/*
             * Wide as its widest row, not as the panel.
             *
             * The rows used to truncate, which on a page of
             * `.Body-module-scss-module__z40yvW` class names meant every row
             * ended in an ellipsis and the panel showed the half of each name
             * that is identical to every other. `min-width: max-content` lets
             * the pane scroll sideways to the full name instead, and the rows
             * inherit their width from it so the selected row's tint and the
             * indent guides still run the whole way across.
             */}
            <div style={{ minWidth: 'max-content' }}>{rows}</div>
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
  primary,
  hovered,
  matched,
  dimmed,
  dragging,
  drop,
  onToggle,
  onGrab,
  onPick,
  detached = false,
}: {
  el: HTMLElement
  depth: number
  expanded: boolean
  selected: boolean
  /** The one the single-target controls act on — the only row that scrolls to. */
  primary: boolean
  hovered: boolean
  matched: boolean
  dimmed: boolean
  dragging: boolean
  drop: 'before' | 'after' | 'inside' | null
  onToggle: () => void
  onGrab: (event: ReactPointerEvent) => void
  onPick: (event: React.MouseEvent) => void
  /** A second or later root — the page, then each thing standing beside it. */
  detached?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = ref.current
    if (row) ROW_ELEMENTS.set(row, el)
  })

  // Asks the same question the walk answers, so `body` on a canvas holding
  // nothing but objects does not offer a twisty that opens onto nothing.
  const branches = childCount(el) > 0
  const text = preview(el)
  const concealed = el.style.display === 'none'

  return (
    <div
      ref={ref}
      data-layer-row=""
      data-selected={primary ? 'true' : undefined}
      onPointerDown={onGrab}
      onClick={onPick}
      /* Hovering a row lights the element up on the page, which is most of how
         you find your way around a tree of anonymous divs. */
      onPointerEnter={() => store.set({ hovered: nodeOf(el) })}
      onPointerLeave={() => store.set({ hovered: null })}
      className={cx(
        'relative flex min-w-full cursor-default items-center gap-1 py-[3px] pr-2 text-[11px]',
        selected ? 'bg-[color:var(--color-select)] text-paper' : 'text-ink hover:bg-ink/5',
        hovered && !selected && 'bg-ink/5',
        dragging && 'opacity-40',
        dimmed && !selected && 'opacity-35',
      )}
      style={{
        paddingLeft: PAD + depth * INDENT,
        minHeight: ROW_HEIGHT,
        marginTop: detached ? 10 : undefined,
      }}
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
          'grid shrink-0 place-items-center rounded-[3px] border-0 bg-transparent p-0 leading-none',
          branches ? 'cursor-pointer opacity-70 hover:opacity-100' : 'invisible',
          selected ? 'text-paper' : 'text-ink-soft',
        )}
        style={{
          height: TWISTY,
          width: TWISTY,
          // Down when open, right when shut, and it turns between the two.
          transform: expanded ? undefined : 'rotate(-90deg)',
          transition: 'transform 120ms ease',
        }}
      >
        <TwistyIcon />
      </button>

      {/**
       * What the row *is*, before what it is called.
       *
       * A tree of `div.wrapper` under `div.inner` under `div.row` tells you
       * nothing about the thing you are looking for, and the one fact that
       * actually distinguishes them — this one stacks its children downward,
       * that one across — was only discoverable by selecting each in turn and
       * reading the Stack control. Putting it on the row is how you find the
       * right container without opening five of them.
       */}
      <span
        aria-hidden
        className={cx('flex shrink-0 items-center', selected ? 'text-paper/80' : 'text-ink-soft')}
      >
        <KindIcon el={el} />
      </span>

      <span
        className={cx(
          'font-medium whitespace-nowrap',
          matched && !selected && 'text-[color:var(--color-select)]',
        )}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {label(el)}
      </span>

      {/* A fixed gap rather than `ml-auto`: the row is now as wide as its
          content, so "push to the right edge" has nothing to push against — it
          would sit against the name on every row and against the panel edge on
          none. */}
      {text && (
        <span
          className={cx(
            'ml-3 max-w-[86px] shrink-0 truncate text-[10px]',
            selected ? 'text-paper/70' : 'text-ink-soft',
          )}
        >
          {text}
        </span>
      )}

      {/**
       * The eye, on hover — or always, once it is doing something.
       *
       * Hidden by default because a column of eyes down a tree of two hundred
       * rows is a column of noise: the answer is "visible" for all but a handful
       * of them, and a control that states the default on every row is a control
       * nobody reads. It appears under the pointer, which is where you are when
       * you want it, and stays put on anything actually hidden — that one is not
       * a control any more, it is the only sign the element still exists.
       *
       * Pinned right, and outside the row's scrolling width: the rows are as
       * wide as the widest name, so an eye in the flow would sit at a different
       * distance on every row and scroll off with the text.
       */}
      <span
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          controller.toggleVisible(el)
        }}
        role="button"
        tabIndex={-1}
        aria-label={concealed ? `Show ${label(el)}` : `Hide ${label(el)}`}
        title={concealed ? 'Show this element' : 'Hide this element'}
        className={cx(
          'dm-row-eye sticky right-0 ml-auto flex h-[18px] shrink-0 cursor-pointer items-center justify-end pr-1 pl-4',
          concealed ? 'opacity-100' : 'opacity-0',
          selected ? 'text-paper' : 'text-ink-soft',
        )}
        /**
         * A fade, not a hard edge.
         *
         * The rows are as wide as the longest class name in the tree, so a name
         * long enough to need the horizontal scrollbar runs straight under this
         * — and an eye sitting on top of `Body-module-scss__z40yvW` is unreadable
         * twice over. The gradient is the row's own colour dissolving in from
         * the left, which hides whatever is behind it without drawing a border
         * that would read as a column.
         *
         * `ml-auto` as well as `sticky`: the first pushes it to the end of a row
         * narrower than the panel, the second pins it to the panel's edge on a
         * row wider than it. Neither alone covers both.
         */
        style={{
          background: `linear-gradient(to right, transparent, ${
            selected ? 'var(--color-select)' : 'var(--color-paper)'
          } 55%)`,
        }}
      >
        {concealed ? <EyeOffIcon /> : <EyeIcon />}
      </span>
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
  const tint = selected ? 'rgba(255,255,255,.45)' : 'rgba(11,11,12,.22)'
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0"
          style={{
            // Down the middle of the twisty belonging to that level, which is
            // what makes a guide look like it descends *from* its parent row
            // rather than running alongside the whole column.
            left: PAD + level * INDENT + Math.floor(TWISTY / 2),
            width: 1,
            backgroundImage: `repeating-linear-gradient(to bottom, ${tint} 0 2px, transparent 2px 4px)`,
          }}
        />
      ))}
    </>
  )
}

/**
 * The mark at the head of a row.
 *
 * Read off the live computed style rather than stored, like everything else in
 * this product: change a container from a column to a row and the tree says so
 * on the next frame, with nothing to keep in sync.
 */
function KindIcon({ el }: { el: HTMLElement }) {
  const style = window.getComputedStyle(el)
  const display = style.display
  if (display.includes('grid')) return <GridIcon />
  if (display.includes('flex')) {
    return <StackIcon axis={style.flexDirection.startsWith('row') ? 'row' : 'column'} />
  }
  // A leaf with words in it is a text layer, whatever tag it happens to be.
  if (!childCount(el) && (el.textContent ?? '').trim()) return <TextIcon />
  return <FrameIcon />
}

const Edge = ({ side }: { side: 'top' | 'bottom' }) => (
  <span
    className="pointer-events-none absolute right-0 left-0 h-[2px]"
    style={{ [side]: -1, background: 'var(--color-select)' }}
  />
)

/** Marks our own nodes, so the picker never treats a tree row as a page target. */
export const LAYER_PANEL_ATTR = OWN_NODE_ATTR

/**
 * How many rows a given row would open onto — the page's own children for
 * `body`, since the canvas objects beside it are roots of their own.
 */
function childCount(el: HTMLElement): number {
  const children = childrenOf(el)
  return el === document.body ? children.filter((child) => !isFrame(child)).length : children.length
}
