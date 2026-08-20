import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  DEFAULT_BORDER_COLOR,
  readBox,
  setBackground,
  setBorder,
  setBorderColor,
  setBorderWidth,
  nudgeSpacing,
  readSpacing,
  setRadius,
  setSide,
  setSpacing,
} from '../core/box'
import { controller } from '../core/controller'
import { isGroup } from '../core/group'
import * as history from '../core/history'
import {
  alignChildren,
  distribute,
  readAlign,
  readLayout,
  setAxis,
  setGap,
  setWrap,
  type AlignEdge,
  type AlignPos,
} from '../core/layout'
import { clearStyle } from '../core/styles'
import { store, type Node } from '../core/store'
import { zoom } from '../core/zoom'
import { startDrag } from '../core/drag'
import { ColorPicker } from './ColorPicker'
import { NumberField } from './NumberField'
import { SpacingControl } from './SpacingControl'
import {
  AlignIcon,
  BorderIcon,
  BorderPaintIcon,
  BucketIcon,
  DistributeIcon,
  GripIcon,
  NoBorderIcon,
  StackIcon,
  UngroupIcon,
  WrapIcon,
} from './icons'
import { cx, zoomStable } from './util'

const BAR_HEIGHT = 32
const COLOR_PANEL_HEIGHT = 220

const H_EDGES: { edge: AlignEdge; pos: AlignPos; label: string }[] = [
  { edge: 'left', pos: 'start', label: 'Align left' },
  { edge: 'hcenter', pos: 'center', label: 'Align horizontal centres' },
  { edge: 'right', pos: 'end', label: 'Align right' },
]

const V_EDGES: { edge: AlignEdge; pos: AlignPos; label: string }[] = [
  { edge: 'top', pos: 'start', label: 'Align top' },
  { edge: 'vcenter', pos: 'center', label: 'Align vertical centres' },
  { edge: 'bottom', pos: 'end', label: 'Align bottom' },
]

type OpenPicker = 'fill' | 'border' | null

/**
 * The controls for the selected element: how it arranges its children, and what
 * its own box looks like.
 *
 * One bar rather than two floating panels — they would fight for the same space
 * above the selection. The layout half only appears when there are children to
 * arrange; the box half applies to anything with a box, which is everything.
 */
export function ElementBar({ node }: { node: Node }) {
  const [picker, setPicker] = useState<OpenPicker>(null)
  const gesture = useRef(false)
  const info = readLayout(node.el)
  const align = readAlign(node.el)
  const box = readBox(node.el)
  const pad = readSpacing(node.el, 'padding')
  const mar = readSpacing(node.el, 'margin')
  const hasLayout = info.items.length > 0
  const grouped = isGroup(node.el)

  /**
   * Discrete clicks are one undo step each. A colour *drag* opens a step on the
   * first write and closes it when the gesture ends, so a slide through fifty
   * shades is still one Ctrl+Z.
   */
  const act = (run: () => void) => () => {
    history.step('element', node.el, run)
    store.set({ undoDepth: history.depth() })
    store.touch()
  }

  const live = (run: () => void) => {
    history.begin('colour', node.el)
    run()
    if (!gesture.current) history.commit()
    store.set({ undoDepth: history.depth() })
    store.touch()
  }

  const onGesture = (active: boolean) => {
    gesture.current = active
    if (!active) {
      history.commit()
      store.set({ undoDepth: history.depth() })
    }
  }

  /**
   * The bar's size depends on what it is showing — a leaf gets the box controls
   * alone, a flex container gets everything, and on a narrow window the whole
   * lot wraps onto a second row. Both dimensions are measured rather than
   * assumed: guessing the width clipped the right-hand controls off screen, and
   * guessing the height made a wrapped bar sit on top of the element it belongs
   * to. Divided by the zoom, since the bar is counter-scaled and it is the
   * on-screen size that has to fit.
   */
  const barRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(BAR_HEIGHT)
  useLayoutEffect(() => {
    const measured = barRef.current?.offsetHeight
    if (measured && Math.abs(measured - height) > 2) setHeight(measured)
  })

  const scale = zoom() || 1
  const shownHeight = height / scale
  const { rect } = node.metrics
  const above = rect.top > shownHeight + 46
  const anchoredTop = above ? rect.top - shownHeight - 26 : rect.top + rect.height + 34

  /**
   * By default the bar follows the selection, which is where you want it while
   * working on one element — and squarely in the way when the element fills the
   * screen. The grip parks it wherever you like until you double-click to
   * re-anchor it.
   */
  const onGrab = (event: ReactPointerEvent) => {
    const box = barRef.current?.getBoundingClientRect()
    if (!box) return
    const grabX = event.clientX - box.left
    const grabY = event.clientY - box.top
    startDrag(event.nativeEvent, {
      cursor: 'grabbing',
      onMove: (drag) =>
        store.set({
          barPos: {
            left: Math.max(8, Math.min(drag.x - grabX, window.innerWidth - box.width - 8)),
            top: Math.max(8, Math.min(drag.y - grabY, window.innerHeight - box.height - 8)),
          },
        }),
    })
  }

  /**
   * `left` is placed from the bar's *natural* width, estimated from which
   * sections are showing, never from its measured one. Measuring it creates a
   * feedback loop: a wrapped bar measures narrow, which pushes `left` further
   * right, which leaves less room, which wraps it more — ending in a tall thin
   * column. With a fixed estimate the bar simply shifts left far enough to have
   * room, and maxWidth handles whatever is left over.
   */
  const natural = (hasLayout ? 470 : 0) + (grouped ? 32 : 0) + 300
  const anchoredLeft = Math.max(8, Math.min(rect.left, window.innerWidth - natural / scale - 8))

  const pinned = store.get().barPos
  const top = pinned ? pinned.top : anchoredTop
  const left = pinned ? pinned.left : anchoredLeft
  const dropUp = top > window.innerHeight - COLOR_PANEL_HEIGHT - shownHeight

  return (
    <div
      ref={barRef}
      className="dm-panel dm-interactive flex flex-wrap items-center gap-y-1 gap-x-0.5 px-1.5 py-0.5"
      style={{
        position: 'fixed',
        top,
        left,
        minHeight: BAR_HEIGHT,
        // Never wider than the window: past that the bar wraps to a second row
        // rather than running its right-hand controls off the screen.
        maxWidth: `calc(100vw - 16px)`,
        borderRadius: height > BAR_HEIGHT + 4 ? 14 : 'var(--radius-pill)',
        ...zoomStable(zoom(), 'top left'),
      }}
    >
      <span
        role="button"
        aria-label="Move this bar"
        title="Drag to move · double-click to re-anchor to the selection"
        onPointerDown={onGrab}
        onDoubleClick={() => store.set({ barPos: null })}
        className="grid h-[22px] w-[12px] shrink-0 cursor-grab place-items-center text-ink-soft hover:text-ink"
      >
        <GripIcon />
      </span>

      {/* A group has no purpose beyond holding its children, so the way back out
          belongs next to the controls that are the reason it was made. */}
      {grouped && (
        <>
          <Toggle
            label="Ungroup — dissolve this container, leave its children in place (Ctrl/Cmd+Shift+G)"
            onClick={() => controller.ungroupSelection()}
          >
            <UngroupIcon />
          </Toggle>
          <span className="dm-divider" />
        </>
      )}

      {hasLayout && (
        <>
          <Toggle
            label="Stack vertically"
            active={info.axis === 'column'}
            onClick={act(() => setAxis(node.el, 'column'))}
          >
            <StackIcon axis="column" />
          </Toggle>
          <Toggle
            label="Stack horizontally"
            active={info.axis === 'row'}
            onClick={act(() => setAxis(node.el, 'row'))}
          >
            <StackIcon axis="row" />
          </Toggle>
          <Toggle label="Wrap" active={info.wrap} onClick={act(() => setWrap(node.el, !info.wrap))}>
            <WrapIcon />
          </Toggle>

          <span className="dm-divider" />

          {H_EDGES.map(({ edge, pos, label }) => (
            <Toggle
              key={edge}
              label={label}
              active={align.horizontal === pos}
              onClick={act(() => alignChildren(node.el, edge))}
            >
              <AlignIcon axis="h" pos={pos} />
            </Toggle>
          ))}

          <span className="dm-divider" />

          {V_EDGES.map(({ edge, pos, label }) => (
            <Toggle
              key={edge}
              label={label}
              active={align.vertical === pos}
              onClick={act(() => alignChildren(node.el, edge))}
            >
              <AlignIcon axis="v" pos={pos} />
            </Toggle>
          ))}

          <span className="dm-divider" />

          <Toggle
            label="Space between"
            active={align.distribution === 'between'}
            onClick={act(() => distribute(node.el, 'between'))}
          >
            <DistributeIcon axis={info.axis} mode="between" />
          </Toggle>
          <Toggle
            label="Space evenly"
            active={align.distribution === 'evenly'}
            onClick={act(() => distribute(node.el, 'evenly'))}
          >
            <DistributeIcon axis={info.axis} mode="evenly" />
          </Toggle>

          <span className="dm-divider" />

          <NumberField
            label="gap"
            value={info.gap}
            title="CSS gap — the space the pink bands edit"
            onChange={(next) => act(() => setGap(node.el, next))()}
          />

          <span className="dm-divider" />
        </>
      )}

      {/* — the element's own box — */}

      <div className="relative">
        <Toggle
          label="Fill colour"
          onClick={() => setPicker(picker === 'fill' ? null : 'fill')}
          active={picker === 'fill'}
          wide
        >
          <ColorGlyph tint={box.background}>
            <BucketIcon />
          </ColorGlyph>
        </Toggle>
        {picker === 'fill' && (
          <ColorPicker
            value={box.background ?? '#ffffff'}
            showContrast={false}
            dropUp={dropUp}
            onClose={() => setPicker(null)}
            onGesture={onGesture}
            onChange={(hex) => live(() => setBackground(node.el, hex))}
            onReset={act(() => clearStyle(node.el, 'background-color'))}
          />
        )}
      </div>

      <Toggle
        label={box.hasBorder ? 'Hide border' : 'Add border'}
        active={box.hasBorder}
        onClick={act(() => setBorder(node.el, !box.hasBorder, box))}
      >
        {box.hasBorder ? <BorderIcon /> : <NoBorderIcon />}
      </Toggle>

      {box.hasBorder && (
        <>
          <div className="relative">
            <Toggle
              label="Border colour"
              onClick={() => setPicker(picker === 'border' ? null : 'border')}
              active={picker === 'border'}
              wide
            >
              <ColorGlyph tint={box.borderColor}>
                <BorderPaintIcon />
              </ColorGlyph>
            </Toggle>
            {picker === 'border' && (
              <ColorPicker
                value={box.borderColor || DEFAULT_BORDER_COLOR}
                showContrast={false}
                dropUp={dropUp}
                onClose={() => setPicker(null)}
                onGesture={onGesture}
                onChange={(hex) => live(() => setBorderColor(node.el, hex))}
                onReset={act(() => clearStyle(node.el, 'border-color'))}
              />
            )}
          </div>
          <NumberField
            label="w"
            value={box.borderWidth}
            step={1}
            min={0}
            title="Border width"
            onChange={(next) => act(() => setBorderWidth(node.el, next))()}
          />
        </>
      )}

      <span className="dm-divider" />

      <SpacingControl
        kind="padding"
        info={pad}
        dropUp={dropUp}
        onSide={(side, value) => act(() => setSide(node.el, 'padding', side, value))()}
        onAll={(value) => act(() => setSpacing(node.el, 'padding', value))()}
        onNudge={(delta) => act(() => nudgeSpacing(node.el, 'padding', delta))()}
      />
      <SpacingControl
        kind="margin"
        info={mar}
        dropUp={dropUp}
        onSide={(side, value) => act(() => setSide(node.el, 'margin', side, value))()}
        onAll={(value) => act(() => setSpacing(node.el, 'margin', value))()}
        onNudge={(delta) => act(() => nudgeSpacing(node.el, 'margin', delta))()}
      />

      <span className="dm-divider" />

      <NumberField
        label="radius"
        value={box.radius}
        step={2}
        min={0}
        title="Corner radius"
        onChange={(next) => act(() => setRadius(node.el, next))()}
      />
    </div>
  )
}

/**
 * An icon with the current colour as a bar beneath it — the arrangement every
 * office suite uses for "this tool, in this colour".
 *
 * The plain swatch it replaces failed twice over: a 13px square of #c7c7c7 on a
 * white button is indistinguishable from an empty one, and a square alone never
 * said *what* it would paint. The bar is a solid 4px so even a pale colour
 * reads, and the hatch means "nothing of its own" rather than a misleading black.
 */
function ColorGlyph({ tint, children }: { tint: string | null; children: ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-[2px]">
      <span className="flex h-[12px] items-center">{children}</span>
      <span
        className="block h-[4px] w-[15px] rounded-[1px]"
        style={
          tint
            ? { background: tint, boxShadow: 'inset 0 0 0 0.5px rgba(11,11,12,.25)' }
            : {
                backgroundImage:
                  'linear-gradient(45deg, transparent 42%, rgba(11,11,12,.5) 42%, rgba(11,11,12,.5) 58%, transparent 58%)',
                boxShadow: 'inset 0 0 0 0.5px rgba(11,11,12,.25)',
              }
        }
      />
    </span>
  )
}



function Toggle({
  label,
  active,
  onClick,
  wide = false,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  wide?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cx(
        'grid h-[24px] shrink-0 place-items-center rounded-[var(--radius-pill)] border-0 text-[12px] leading-none',
        // The colour buttons carry a swatch under their glyph, so they get two
        // more pixels to put it in.
        wide ? 'w-[26px]' : 'w-[24px]',
        active ? 'bg-[color:var(--color-select)] text-paper' : 'bg-transparent text-ink hover:bg-ink/5',
      )}
    >
      {children}
    </button>
  )
}








