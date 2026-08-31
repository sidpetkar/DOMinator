import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FontMeta } from '@/shared/messages'
import {
  DEFAULT_BORDER_COLOR,
  addFill,
  clearPaint,
  readBox,
  readFill,
  readRadius,
  readSpacing,
  readStroke,
  readStrokeStyle,
  readStrokeWidths,
  removeFill,
  removeStroke,
  setBackground,
  setBorder,
  setBorderColor,
  setBorderWidth,
  setCorner,
  setFill,
  setRadius,
  setSide,
  setStrokeColor,
  setStrokeStyle,
  setStrokeWidth,
  toggleFill,
  toggleStroke,
  type BorderStyle,
  type Corner,
  type PaintInfo,
  type Side,
  type RadiusInfo,
  type SpacingInfo,
  type SpacingKind,
  type StrokeWidths,
} from '../core/box'
import {
  DEFAULT_SHADOW,
  readPosition,
  readShadow,
  removeShadow,
  setFlip,
  setRotation,
  setShadow,
  shadowOpacity,
  shadowVisible,
  toggleShadow,
  type ShadowInfo,
} from '../core/effects'
import { COLORS } from '@/shared/constants'
import { isFrame } from '../core/frames'
import { scale as canvasScale } from '../core/canvas'
import { cssColor, effectiveBackground, hexToRgb, parseColor, rgbToHex, type RGB } from '../core/color'
import { controller } from '../core/controller'
import { describe } from '../core/geometry'
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
import { loadFamily } from '../core/fonts'
import { applyTypeStyle, rememberSelection, restoreSelection } from '../core/textEdit'
import { clearStyle, px, setStyle } from '../core/styles'
import {
  readSize,
  setFixedSize,
  setSizeMode,
  type SizeAxis,
  type SizeInfo,
  type SizeMode,
} from '../core/sizing'
import { store, type BoxGroup, type Node } from '../core/store'
import { zoom } from '../core/zoom'
import { ColorPicker } from './ColorPicker'
import { PanelCollapse } from './PanelCollapse'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { FontPicker } from './FontPicker'
import { Select } from './Select'
import { NumberField } from './NumberField'
import { EyeIcon, EyeOffIcon, MinusIcon } from './icons'
import { IconButton, PaintRow } from './PaintRow'
import { ExpandGroup, ExpandRows } from './ExpandGroup'
import {
  AlignIcon,
  BlurIcon,
  BoldIcon,
  BorderIcon,
  BorderPaintIcon,
  BucketIcon,
  CornerIcon,
  CornersIcon,
  DistributeIcon,
  EdgeIcon,
  LiftIcon,
  CaretIcon,
  FlipIcon,
  GapIcon,
  ImageIcon,
  NoBorderIcon,
  OpacityIcon,
  RotateStepIcon,
  RotationIcon,
  ItalicIcon,
  PlusIcon,
  ShadowIcon,
  SlidersIcon,
  SpreadIcon,
  StackIcon,
  StrikeIcon,
  TEXT_ALIGN_ICONS,
  UnderlineIcon,
  UngroupIcon,
  WrapIcon,
} from './icons'
import { cx, dockedBox, useFadingScroll, zoomStable } from './util'

const BAR_HEIGHT = 32
const COLOR_PANEL_HEIGHT = 220

/**
 * The order every one of these folds out in: clockwise from the top, which is
 * the order CSS itself states them in and the order Figma lays them out. Reading
 * `10 0 10 0` off the bar and typing it into a stylesheet should not require
 * rearranging it.
 */
const SIDES: { side: Side; label: string }[] = [
  { side: 'top', label: 'top' },
  { side: 'right', label: 'right' },
  { side: 'bottom', label: 'bottom' },
  { side: 'left', label: 'left' },
]

const CORNERS: { corner: Corner; label: string }[] = [
  { corner: 'tl', label: 'top left' },
  { corner: 'tr', label: 'top right' },
  { corner: 'br', label: 'bottom right' },
  { corner: 'bl', label: 'bottom left' },
]

/**
 * The same four corners as a picture of a box rather than as a list.
 *
 * Order matters here in a way it does not in the bar: laid out two-by-two, a
 * field's position on the grid is the only thing saying which corner it is, so
 * top-left has to be top-left. The bar's clockwise reading order would put the
 * bottom-right control at the bottom *left* of the grid, which is a control that
 * lies about itself.
 */
const CORNER_LABEL: Record<Corner, string> = Object.fromEntries(
  CORNERS.map(({ corner, label }) => [corner, label]),
) as Record<Corner, string>

const CORNER_GRID: Corner[][] = [
  ['tl', 'tr'],
  ['bl', 'br'],
]

/**
 * And the four edges clockwise from the top — the order the CSS shorthand is
 * written in, which is the order anyone who has typed `padding: 8px 12px 16px
 * 4px` already reads.
 */
const SIDE_GRID: Side[][] = [
  ['top', 'right'],
  ['bottom', 'left'],
]

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

type OpenPicker = 'fill' | 'border' | 'shadow' | null

/**
 * Whether the controls are laid out as a bar or as a docked column.
 *
 * A context rather than a prop threaded through every control: the sections are
 * nested inside conditionals several levels deep, and passing a boolean down
 * that whole tree to be read by one component at the bottom is the shape this
 * exists to avoid.
 */
const Docked = createContext(false)

/**
 * Where the docked column is, for anything that has to stay off it.
 *
 * A getter rather than a rect: the column is draggable and counter-scales with
 * the browser zoom, so the answer is only good for the frame it was asked in.
 * Null in the bar, where there is no column to avoid and a picker hangs off its
 * button the way it always has.
 */
const PanelBox = createContext<(() => DOMRect | null) | null>(null)

/**
 * One group of controls, and the only thing that differs between the two
 * layouts.
 *
 * In the bar it is its contents followed by a hairline, exactly as before — the
 * divider *is* the grouping, and a title would double the bar's width to say
 * what the icons already say. Docked, the same group becomes a labelled row,
 * because a column of unlabelled icon rows is a much harder thing to scan than
 * a line of them: in a row your eye has the neighbours for context, in a column
 * each row is alone with itself.
 */
function Section({
  title,
  last = false,
  wide = false,
  action,
  onAdd,
  children,
}: {
  title: string
  /** The final group: a hairline after it would be a rule against nothing. */
  last?: boolean
  /**
   * Title on its own line, contents across the full width beneath it.
   *
   * For the groups whose contents are rows rather than a handful of icons. A
   * paint row is a swatch, six hex digits, a percentage and two buttons, and
   * with 44 pixels of the column spent on a label to its left there is not
   * enough left for the hex to be readable — which is the one part of it you
   * came to the row to see.
   */
  wide?: boolean
  /** Sits at the far end of the title line: the `+` that adds the thing. */
  action?: ReactNode
  /**
   * What the heading does when there is nothing under it yet.
   *
   * The `+` at the end of an empty Fill row is a 20px target in a row 244 wide,
   * and every press on the other 224 did nothing at all — which is a row that
   * looks like a button, is labelled like a button, and is not one. Given this,
   * the whole heading becomes the control. It is only wired while the section is
   * empty: once there is a fill to see, the heading is a heading again and the
   * row below it is what you are aiming at.
   */
  onAdd?: () => void
  children: ReactNode
}) {
  const docked = useContext(Docked)
  if (!docked) {
    return (
      <>
        {children}
        {!last && <span className="dm-divider" />}
      </>
    )
  }
  if (wide) {
    return (
      <div className="flex flex-col gap-1 px-2.5 py-[7px]">
        <div
          onPointerDown={(event) => onAdd && event.stopPropagation()}
          onClick={(event) => {
            if (!onAdd) return
            // The `+` answers its own click; this is for everywhere else.
            if ((event.target as HTMLElement).closest('button')) return
            onAdd()
          }}
          className={cx(
            'flex items-center gap-1 rounded-[5px]',
            onAdd && 'cursor-pointer hover:bg-ink/[0.04]',
          )}
        >
          <span className="min-w-0 flex-1 text-[10px] leading-tight font-medium text-ink-soft">
            {title}
          </span>
          {action}
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="flex items-start gap-1.5 px-2.5 py-[5px]">
      <span className="w-[44px] shrink-0 pt-[5px] text-[10px] leading-tight font-medium text-ink-soft">
        {title}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * The controls for the selected element: how it arranges its children, and what
 * its own box looks like.
 *
 * One bar rather than two floating panels — they would fight for the same space
 * above the selection. The layout half only appears when there are children to
 * arrange; the box half applies to anything with a box, which is everything.
 *
 * Docked, it is the same controls in the same order, stacked and labelled down
 * the right-hand side. Nothing is added or taken away between the two: a control
 * that only exists in one of them is a control someone will look for in the
 * other and conclude is broken.
 */
export function ElementBar({
  node,
  docked = false,
  editing = false,
  paintRequest = null,
}: {
  node: Node
  docked?: boolean
  /**
   * The words in this element are being typed into right now.
   *
   * The panel then leads with type — the family, the size, the colour of the
   * thing under the caret — because that is what you are doing, and hunting for
   * the font past three rows of padding is the panel making you prove you meant
   * it. Everything else stays where it was underneath.
   */
  editing?: boolean
  /** A keystroke asking for a picker — see the store's `paintRequest`. */
  paintRequest?: { kind: 'fill' | 'border'; nonce: number } | null
}) {
  const [picker, setPicker] = useState<OpenPicker>(null)
  // Opened on the nonce, not on the kind: pressing `i` again has to reopen a
  // picker that was closed by hand, and the kind alone cannot say so.
  const answered = useRef(0)
  useEffect(() => {
    if (!paintRequest || paintRequest.nonce === answered.current) return
    answered.current = paintRequest.nonce
    setPicker(paintRequest.kind)
  }, [paintRequest])
  const gesture = useRef(false)
  const info = readLayout(node.el)
  const align = readAlign(node.el)
  const box = readBox(node.el)
  const fill = readFill(node.el)
  const stroke = readStroke(node.el)
  const strokeWidths = readStrokeWidths(node.el)
  const strokeStyle = readStrokeStyle(node.el)
  const width = readSize(node.el, 'width')
  const height = readSize(node.el, 'height')
  const pad = readSpacing(node.el, 'padding')
  const mar = readSpacing(node.el, 'margin')
  const radius = readRadius(node.el)
  const shadow = readShadow(node.el)
  const position = readPosition(node.el)
  const type = readType(node.el)
  const expanded = store.get().expanded
  const unfold = (group: BoxGroup) =>
    store.set({ expanded: { ...expanded, [group]: !expanded[group] } })
  const hasLayout = info.items.length > 0
  const grouped = isGroup(node.el)

  /**
   * Discrete clicks are one undo step each. A colour *drag* opens a step on the
   * first write and closes it when the gesture ends, so a slide through fifty
   * shades is still one Ctrl+Z.
   */
  const act = (run: () => void) => () => {
    history.step('element', node.el, run)
    store.set(history.depths())
    store.touch()
  }

  const live = (run: () => void) => {
    history.begin('edit', node.el)
    run()
    if (!gesture.current) history.commit()
    store.set(history.depths())
    store.touch()
  }

  /**
   * A scrub is a drag, and gets the same bracket a colour drag does: forty
   * writes on the way from 0 to 20, one step on the undo stack.
   */
  const onGesture = (active: boolean) => {
    gesture.current = active
    if (!active) {
      history.commit()
      store.set(history.depths())
    }
  }

  /**
   * A scrub is a drag, and gets the same bracket a colour drag does: forty
   * writes on the way from 0 to 20, one step on the undo stack.
   */
  const settle = onGesture

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
  const [barHeight, setBarHeight] = useState(BAR_HEIGHT)
  useLayoutEffect(() => {
    const measured = barRef.current?.offsetHeight
    if (measured && Math.abs(measured - barHeight) > 2) setBarHeight(measured)
  })

  const scale = zoom() || 1
  const shownHeight = barHeight / scale
  const { rect } = node.metrics
  const above = rect.top > shownHeight + 46
  /**
   * Below the element, or above it when there is no room below — and inside the
   * window either way.
   *
   * The clamp is the whole fix for the bar that disappeared when you selected
   * the page. Anything taller than the viewport — `<body>` itself, a full-height
   * hero — has its bottom edge thousands of pixels below the fold, so anchoring
   * under it put the bar that far off screen, and there was no sign that a bar
   * existed at all: the controls for the one element you can always select were
   * simply gone. Clamping to the window means the bar lands against the bottom
   * edge instead, which is where a panel belonging to something that fills the
   * screen ought to be.
   */
  const room = window.innerHeight - shownHeight - 12
  const anchoredTop = Math.max(
    12,
    Math.min(above ? rect.top - shownHeight - 26 : rect.top + rect.height + 34, room),
  )

  /**
   * By default the bar follows the selection, which is where you want it while
   * working on one element — and squarely in the way when the element fills the
   * screen. The grip parks it wherever you like until you double-click to
   * re-anchor it.
   */
  const grip = usePanelDrag('element', barRef)

  /**
   * `left` is placed from the bar's *natural* width, estimated from which
   * sections are showing, never from its measured one. Measuring it creates a
   * feedback loop: a wrapped bar measures narrow, which pushes `left` further
   * right, which leaves less room, which wraps it more — ending in a tall thin
   * column. With a fixed estimate the bar simply shifts left far enough to have
   * room, and maxWidth handles whatever is left over.
   */
  // 130 of the constant is the type group added below: four toggles and a
  // divider. An estimate that has not kept up with the bar's contents puts the
  // bar's right-hand end off the window, which is the bug the estimate exists
  // to prevent.
  const natural = (hasLayout ? 470 : 0) + (grouped ? 32 : 0) + 540
  // Same treatment sideways: an element that starts off the left of the window
  // — a carousel track mid-scroll — would otherwise take the bar with it.
  const anchoredLeft = Math.max(8, Math.min(rect.left, window.innerWidth - natural / scale - 8))

  const top = grip.pinned ? grip.pinned.top : anchoredTop
  const left = grip.pinned ? grip.pinned.left : anchoredLeft
  const dropUp = top > window.innerHeight - COLOR_PANEL_HEIGHT - shownHeight

  /**
   * Written once and rendered by both layouts. Keeping two copies in sync is not
   * a thing anyone succeeds at for long, and the failure mode is the worst kind:
   * a control that quietly exists in one layout and not the other.
   */
  /**
   * Typing into the words, with the column up: the column becomes the type
   * panel and nothing else.
   *
   * Not because the other controls stop working — they would all still apply to
   * the element around the text. Because *this* is the moment you asked a
   * different question. You double-clicked to change what the words say and how
   * they look, and a padding stepper, a stroke and a corner radius stacked under
   * the font are eleven rows of answer to a question you did not ask, with the
   * one you did at the top of them. Escape or a click elsewhere ends the edit
   * and the whole panel comes back, which is what makes hiding it fair rather
   * than merely tidy.
   */
  const sections = docked && editing ? (
    <TypographySection el={node.el} dropUp={dropUp} />
  ) : (
    <>
      {/**
       * The order is how the work goes, not how the CSS is grouped.
       *
       * Where a thing sits and how it is arranged come before what it is made
       * of: you place a block, then you size it, then you decide it is grey with
       * a border. Reading down the panel should feel like the order you would
       * make the decisions in, and every group that only exists for a container
       * — align, stack, space — sits with the others that do.
       */}
      {hasLayout && (
        <>
          <Section title="Align">
            <Segments>
              {H_EDGES.map(({ edge, pos, label }) => (
                <Segment
                  key={edge}
                  label={label}
                  active={align.horizontal === pos}
                  onClick={act(() => alignChildren(node.el, edge))}
                >
                  <AlignIcon axis="h" pos={pos} />
                </Segment>
              ))}
            </Segments>
            <Segments>
              {V_EDGES.map(({ edge, pos, label }) => (
                <Segment
                  key={edge}
                  label={label}
                  active={align.vertical === pos}
                  onClick={act(() => alignChildren(node.el, edge))}
                >
                  <AlignIcon axis="v" pos={pos} />
                </Segment>
              ))}
            </Segments>
          </Section>

        </>
      )}

      <Section title="Position">
        <NumberField
          compact
          label="rotation"
          title="Rotation — drag to scrub, double-click to type"
          icon={<RotationIcon />}
          value={position.rotation}
          step={15}
          min={-Infinity}
          suffix="°"
          onGesture={settle}
          onChange={(next) => live(() => setRotation(node.el, next))}
        />
        <Toggle
          label="Turn a quarter clockwise"
          onClick={act(() => setRotation(node.el, position.rotation + 90))}
        >
          <RotateStepIcon />
        </Toggle>
        <Toggle
          label="Flip horizontally"
          active={position.flipX}
          onClick={act(() => setFlip(node.el, 'x', !position.flipX))}
        >
          <FlipIcon axis="row" />
        </Toggle>
        <Toggle
          label="Flip vertically"
          active={position.flipY}
          onClick={act(() => setFlip(node.el, 'y', !position.flipY))}
        >
          <FlipIcon axis="column" />
        </Toggle>
      </Section>

      {hasLayout && (
        <>
          <Section title="Stack">
            <Segments>
              <Segment
                label="Stack vertically"
                active={info.axis === 'column'}
                onClick={act(() => setAxis(node.el, 'column'))}
              >
                <StackIcon axis="column" />
              </Segment>
              <Segment
                label="Stack horizontally"
                active={info.axis === 'row'}
                onClick={act(() => setAxis(node.el, 'row'))}
              >
                <StackIcon axis="row" />
              </Segment>
              <Segment
                label="Wrap"
                active={info.wrap}
                onClick={act(() => setWrap(node.el, !info.wrap))}
              >
                <WrapIcon />
              </Segment>
            </Segments>
          </Section>

        </>
      )}

      {/* The element's own size, not its size on screen: `rect` comes from
          getBoundingClientRect and so carries the canvas zoom, and a card that
          reads 300 at life size should not read 150 because you zoomed out. */}
      <Section title={docked ? 'Sizing' : 'Size'}>
        <SizeField
          axis="width"
          letter="W"
          info={width}
          el={node.el}
          docked={docked}
          act={act}
          settle={settle}
          live={live}
        />
        <SizeField
          axis="height"
          letter="H"
          info={height}
          el={node.el}
          docked={docked}
          act={act}
          settle={settle}
          live={live}
        />
      </Section>

      {hasLayout && (
        <>
          <Section title="Space">
            <Segments>
              <Segment
                label="Space between"
                active={align.distribution === 'between'}
                onClick={act(() => distribute(node.el, 'between'))}
              >
                <DistributeIcon axis={info.axis} mode="between" />
              </Segment>
              <Segment
                label="Space evenly"
                active={align.distribution === 'evenly'}
                onClick={act(() => distribute(node.el, 'evenly'))}
              >
                <DistributeIcon axis={info.axis} mode="evenly" />
              </Segment>
            </Segments>

            <NumberField
              compact
              fill={docked}
              label="gap"
              title="CSS gap — the space the pink bands edit"
              icon={<GapIcon />}
              value={info.gap}
              min={0}
              onGesture={settle}
              onChange={(next) => live(() => setGap(node.el, next))}
            />
          </Section>
        </>
      )}

      {/* A group has no purpose beyond holding its children, so the way back out
          belongs next to the controls that are the reason it was made. */}
      {grouped && (
        <Section title="Group">
          <Toggle
            label="Ungroup — dissolve this container, leave its children in place (Ctrl/Cmd+Shift+G)"
            onClick={() => controller.ungroupSelection()}
          >
            <UngroupIcon />
          </Toggle>
        </Section>
      )}

      {/* — the element's own box — */}

      {/**
       * Exact size, for when the handles can't give it: matching a spec, making
       * two cards agree to the pixel, or sizing something whose handles are off
       * screen. The values are what the frame's readout shows — the rendered
       * box — so typing back the number already displayed changes nothing, which
       * is the only behaviour that makes the pair trustworthy.
       *
       * Each axis is written on its own, so setting a width leaves the height to
       * the content rather than quietly freezing both.
       */}
      <Section title="Radius">
        <RadiusGroup
          info={radius}
          open={Boolean(expanded.radius)}
          el={node.el}
          onUnfold={() => unfold('radius')}
          live={live}
          settle={settle}
        />
      </Section>

      <Section title="Padding">
        <SpacingGroup
          kind="padding"
          info={pad}
          open={Boolean(expanded.padding)}
          el={node.el}
          onUnfold={() => unfold('padding')}
          live={live}
          settle={settle}
        />
      </Section>

      <Section title="Margin">
        <SpacingGroup
          kind="margin"
          info={mar}
          open={Boolean(expanded.margin)}
          el={node.el}
          onUnfold={() => unfold('margin')}
          live={live}
          settle={settle}
        />
      </Section>

      {/**
       * Bold, italic, underline, strike — on the *element*, not on a text range.
       *
       * The bar only. Docked, this is said better by the Typography section that
       * appears the moment you are actually editing text, and two rows offering
       * the same underline is a panel that has not decided what it thinks. The
       * bar has no such section, so without these there would be no way at all
       * to say "this whole heading is italic" without first double-clicking into
       * it and selecting the words.
       *
       * Written as `font-weight`, `font-style` and `text-decoration-line` rather
       * than through `document.execCommand`, so they are ordinary declarations:
       * readable back off the computed style, undoable through the same stack as
       * everything else here, and no `<b>`/`<i>` wrappers injected into the
       * page's markup.
       */}
      {!docked && (
        <Section title="Type">
          <Toggle label="Bold" active={type.bold} onClick={act(() => toggleBold(node.el, type))}>
            <BoldIcon />
          </Toggle>
          <Toggle
            label="Italic"
            active={type.italic}
            onClick={act(() => setStyle(node.el, 'font-style', type.italic ? 'normal' : 'italic'))}
          >
            <ItalicIcon />
          </Toggle>
          <Toggle
            label="Underline"
            active={type.underline}
            onClick={act(() => setDecoration(node.el, type, 'underline'))}
          >
            <UnderlineIcon />
          </Toggle>
          <Toggle
            label="Strikethrough"
            active={type.strike}
            onClick={act(() => setDecoration(node.el, type, 'line-through'))}
          >
            <StrikeIcon />
          </Toggle>
        </Section>
      )}

      {/**
       * Two paints, and two shapes for them.
       *
       * Docked, each is a row that says what it actually is — a colour, an
       * opacity, and whether it is switched on — because the column has the
       * width to say it and because a swatch alone cannot. In the bar they stay
       * the compact icons they were: the bar is one line anchored to the
       * selection, and three stacked rows there would cover the element they
       * describe. Nothing is taken away in either — the picker behind the swatch
       * is the same picker, and it carries its own opacity slider.
       */}
      {docked ? (
        <>
          <FillSection
            el={node.el}
            fill={fill}
            picker={picker}
            setPicker={setPicker}
            live={live}
            act={act}
            onGesture={onGesture}
            dropUp={dropUp}
          />
          <StrokeSection
            el={node.el}
            stroke={stroke}
            widths={strokeWidths}
            kind={strokeStyle}
            open={Boolean(expanded.stroke)}
            onUnfold={() => unfold('stroke')}
            picker={picker}
            setPicker={setPicker}
            live={live}
            act={act}
            onGesture={onGesture}
            settle={settle}
            dropUp={dropUp}
          />
        </>
      ) : (
        <Section title="Fill">
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

          {/* Next to the fill, because both answer "what is inside this box" — one
            with a colour, one with a picture. */}
          <Toggle
            label="Put an image in this box — or paste one straight in with Ctrl/Cmd+V"
            onClick={() => controller.pickImage()}
          >
            <ImageIcon />
          </Toggle>

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
        </Section>
      )}

      {docked ? (
        <ShadowSection
          el={node.el}
          shadow={shadow}
          open={Boolean(expanded.shadow)}
          onUnfold={() => unfold('shadow')}
          live={live}
          act={act}
          settle={settle}
          onGesture={onGesture}
          dropUp={dropUp}
          picker={picker}
          setPicker={setPicker}
        />
      ) : (
        <Section title="Shadow" last>
          {/* — shadow — */}
          <Toggle
            label={shadow.on ? 'Shadow — click to open its settings' : 'Add a drop shadow'}
            active={Boolean(expanded.shadow)}
            onClick={() => {
              // The first click on a box with no shadow gives it one, because an
              // unfolded row of zeroes that paints nothing looks broken. After that
              // the button is only the door to the settings.
              if (!shadow.on) act(() => setShadow(node.el, DEFAULT_SHADOW))()
              unfold('shadow')
            }}
          >
            <ShadowIcon />
          </Toggle>
          <ExpandGroup open={Boolean(expanded.shadow)}>
            <ShadowFields
              shadow={shadow}
              el={node.el}
              live={live}
              settle={settle}
              act={act}
              dropUp={dropUp}
              onGesture={onGesture}
            />
          </ExpandGroup>
        </Section>
      )}
    </>
  )

  const shut = Boolean(store.get().collapsed.controls)
  const dockRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  // A second grip, for the same panel in its other shape. `usePanelDrag` keys
  // by panel, so the column and the bar remember their positions separately —
  // which is right: they are pushed aside for different reasons.
  const columnGrip = usePanelDrag('controls', columnRef)
  useFadingScroll(dockRef, docked && !shut)

  if (docked) {
    return (
      <Docked.Provider value={true}>
        <PanelBox.Provider value={() => columnRef.current?.getBoundingClientRect() ?? null}>
        <div
          ref={columnRef}
          className="dm-panel dm-interactive flex flex-col overflow-hidden"
          style={{
            position: 'fixed',
            ...(columnGrip.pinned
              ? { left: columnGrip.pinned.left, top: columnGrip.pinned.top }
              : { right: 12, top: 12 }),
            width: 264,
            // Same as the tree: as tall as it needs to be, never taller, and the
            // same constant physical size at any browser zoom.
            ...dockedBox(scale, true),
            borderRadius: 14,
            ...zoomStable(zoom(), columnGrip.pinned ? 'top left' : 'top right'),
          }}
        >
          <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
            <PanelGrip onGrab={columnGrip.onGrab} reset={columnGrip.reset} />
            <span
              className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              title={describe(node.el)}
            >
              {describe(node.el)}
            </span>
            {/* Only on the canvas, and only for something that is not already a
                variation: lifting a variation would copy a copy. */}
            {store.get().layers && !isFrame(node.el) && (
              <Toggle
                label="Lift a copy onto the canvas to try a variation (Alt+drag does the same)"
                onClick={() => controller.liftSelection()}
              >
                <LiftIcon />
              </Toggle>
            )}
            {/* Turned out of the Fill heading and put with the other actions
                that are about the element rather than about one property. */}
            <Toggle
              label="Put an image in this box — or paste one straight in with Ctrl/Cmd+V"
              onClick={() => controller.pickImage()}
            >
              <ImageIcon />
            </Toggle>
            <PanelCollapse
              collapsed={shut}
              label="the controls"
              onToggle={() => controller.foldPanel('controls')}
            />
          </div>
          {!shut && (
            <div
              ref={dockRef}
              className="dm-scroll min-h-0 flex-1 divide-y divide-line overflow-x-hidden overflow-y-auto"
            >
              {sections}
            </div>
          )}
        </div>
        </PanelBox.Provider>
      </Docked.Provider>
    )
  }

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
        borderRadius: barHeight > BAR_HEIGHT + 4 ? 14 : 'var(--radius-pill)',
        ...zoomStable(zoom(), 'top left'),
      }}
    >
      <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
      {sections}
    </div>
  )
}

/**
 * A group that folds out into its four parts, in the docked panel's shape.
 *
 * Two columns of fields with the unfold button parked at the end of the first
 * row, which is the layout every design tool has settled on and the one the
 * panel's width can actually hold: four chips across 194 pixels leaves each of
 * them room for two digits, while two across leaves room for a mark, a number
 * and air.
 *
 * The button stays on the first row rather than centring itself on the block as
 * it opens — it is the control that opened the group, and a control that jumps
 * somewhere else the moment you press it is one you have to hunt for to press
 * again. The second row reserves the same width beneath it, so the two columns
 * stay columns rather than drifting a button's width to the right.
 */
function FoldOut({
  open,
  toggle,
  first,
  rows,
}: {
  open: boolean
  toggle: ReactNode
  /** The row that is always showing: two fields, then the button. */
  first: ReactNode
  /**
   * The rows that drop out beneath it. A list rather than one row because the
   * stroke reveals four widths *under* two controls it keeps, while the spacing
   * groups replace their pair with a second row of two — the same fold, opening
   * onto different amounts of thing.
   */
  rows: ReactNode[]
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        {first}
        {toggle}
      </div>
      <ExpandRows open={open}>
        <div className="flex flex-col gap-1">
          {rows.map((row, index) => (
            <div key={index} className="flex min-w-0 items-center gap-1">
              {row}
              {/* Under the button, holding its column open. */}
              <span aria-hidden className="w-[24px] shrink-0" />
            </div>
          ))}
        </div>
      </ExpandRows>
    </div>
  )
}

/**
 * Padding or margin: one name over four numbers.
 *
 * Folded, it shows the two numbers that describe almost every box anyone
 * actually builds — the vertical pair and the horizontal pair — because that is
 * how the values were written in the first place (`padding: 12px 24px`), and a
 * single number could only ever be a lie about three of the four sides.
 * Unfolded, each edge is its own field and nothing has to be inferred.
 *
 * Editing a *pair* writes both of its sides. That is the whole reason the folded
 * form is honest where one summary number was not: the field says "these two",
 * writes exactly those two, and leaves the other pair alone.
 *
 * Two layouts, one set of controls. In the bar the four sides fold out sideways,
 * because a bar has width to give and no height. Docked they fold *down* into a
 * 2×2 block, because a 264px column has the opposite of that. Which fold is in
 * force is the only difference — the fields, the values they write and the undo
 * steps they make are the same either way.
 */
function SpacingGroup({
  kind,
  info,
  open,
  el,
  onUnfold,
  live,
  settle,
}: {
  kind: SpacingKind
  info: SpacingInfo
  open: boolean
  el: HTMLElement
  onUnfold: () => void
  live: (run: () => void) => void
  settle: (active: boolean) => void
}) {
  const docked = useContext(Docked)
  const floor = kind === 'padding' ? 0 : -Infinity
  const name = kind === 'padding' ? 'padding' : 'margin'
  /**
   * Green for padding, orange for margin — the same two colours the bands on the
   * canvas are drawn in. Without this the two groups are the identical four
   * marks twice over, and the only way to tell which is which is to count along
   * the bar. The old control said "pad" and "mar" in words, which cost eight
   * characters of a bar that no longer has them to spare; the colour was already
   * doing this job everywhere else in the product.
   */
  const tone = kind === 'padding' ? COLORS.paddingLine : COLORS.marginLine
  const tint = (mark: ReactNode) => <span style={{ color: tone }}>{mark}</span>
  const pair = (a: Side, b: Side) => (value: number) =>
    live(() => {
      setSide(el, kind, a, value)
      setSide(el, kind, b, value)
    })

  const vertical = Math.abs(info.sides.top - info.sides.bottom) < 0.5
  const horizontal = Math.abs(info.sides.left - info.sides.right) < 0.5

  const toggle = (
    <Toggle
      label={open ? `Fold ${name} back into pairs` : `Set each ${name} edge on its own`}
      active={open}
      onClick={onUnfold}
    >
      {tint(<CornersIcon />)}
    </Toggle>
  )

  const horizontalField = (fill: boolean) => (
    <NumberField
      key="horizontal"
      compact
      fill={fill}
      label={`horizontal ${name}`}
      title={`Left and right ${name}`}
      icon={tint(<EdgeIcon edges={['left', 'right']} />)}
      value={info.sides.left}
      mixed={!horizontal}
      min={floor}
      onGesture={settle}
      onChange={pair('left', 'right')}
    />
  )

  const verticalField = (fill: boolean) => (
    <NumberField
      key="vertical"
      compact
      fill={fill}
      label={`vertical ${name}`}
      title={`Top and bottom ${name}`}
      icon={tint(<EdgeIcon edges={['top', 'bottom']} />)}
      value={info.sides.top}
      mixed={!vertical}
      min={floor}
      onGesture={settle}
      onChange={pair('top', 'bottom')}
    />
  )

  const sideField = (side: Side, fill: boolean) => (
    <NumberField
      key={side}
      compact
      fill={fill}
      label={`${side} ${name}`}
      title={`${side} ${name}`}
      icon={tint(<EdgeIcon edges={[side]} />)}
      value={info.sides[side]}
      min={floor}
      onGesture={settle}
      onChange={(next) => live(() => setSide(el, kind, side, next))}
    />
  )

  if (docked) {
    return (
      <FoldOut
        open={open}
        toggle={toggle}
        /* Open, the first row is the top and right edges; closed, it is the two
           pairs those same two fields stand in for. The row never empties, so
           the block grows by one row rather than rebuilding itself. */
        first={
          open
            ? SIDE_GRID[0]!.map((side) => sideField(side, true))
            : [horizontalField(true), verticalField(true)]
        }
        rows={[SIDE_GRID[1]!.map((side) => sideField(side, true))]}
      />
    )
  }

  return (
    <>
      {toggle}
      {!open && (
        <>
          {horizontalField(false)}
          {verticalField(false)}
        </>
      )}
      <ExpandGroup open={open}>{SIDES.map(({ side }) => sideField(side, false))}</ExpandGroup>
    </>
  )
}

/**
 * The corner radius, one number or four.
 *
 * The same fold as the spacing groups and deliberately the same shape, because
 * it is the same question asked about a different property. Docked, each field
 * sits where its own corner is (see CORNER_GRID) — the one thing this control
 * can do laid out as a block that it could never do as a row.
 */
function RadiusGroup({
  info,
  open,
  el,
  onUnfold,
  live,
  settle,
}: {
  info: RadiusInfo
  open: boolean
  el: HTMLElement
  onUnfold: () => void
  live: (run: () => void) => void
  settle: (active: boolean) => void
}) {
  const docked = useContext(Docked)

  const toggle = (
    <Toggle
      label={open ? 'Fold the corners back into one radius' : 'Set each corner on its own'}
      active={open}
      onClick={onUnfold}
    >
      <CornersIcon />
    </Toggle>
  )

  const allField = (fill: boolean) => (
    <NumberField
      compact
      fill={fill}
      label="corner radius"
      title="Corner radius — drag to scrub, double-click to type"
      icon={<CornerIcon corner="tl" />}
      value={info.value}
      mixed={!info.uniform}
      step={2}
      min={0}
      onGesture={settle}
      onChange={(next) => live(() => setRadius(el, next))}
    />
  )

  const cornerField = (corner: Corner, fill: boolean) => (
    <NumberField
      key={corner}
      compact
      fill={fill}
      label={`${CORNER_LABEL[corner]} radius`}
      title={`${CORNER_LABEL[corner]} corner radius`}
      icon={<CornerIcon corner={corner} />}
      value={info.corners[corner]}
      step={2}
      min={0}
      onGesture={settle}
      onChange={(next) => live(() => setCorner(el, corner, next))}
    />
  )

  if (docked) {
    return (
      <FoldOut
        open={open}
        toggle={toggle}
        first={open ? CORNER_GRID[0]!.map((corner) => cornerField(corner, true)) : allField(true)}
        rows={[CORNER_GRID[1]!.map((corner) => cornerField(corner, true))]}
      />
    )
  }

  return (
    <>
      {toggle}
      {!open && allField(false)}
      <ExpandGroup open={open}>{CORNERS.map(({ corner }) => cornerField(corner, false))}</ExpandGroup>
    </>
  )
}

/**
 * The colour itself, as a button that opens the picker.
 *
 * Chequered underneath, so a paint at 40% reads as a paint at 40% rather than as
 * a lighter colour — the one thing a flat swatch cannot tell you is the
 * difference between pale and see-through, which is exactly what the opacity
 * beside it is about to be edited to.
 */
function Swatch({
  rgb,
  alpha,
  label,
  open,
  onOpen,
  children,
}: {
  rgb: RGB
  alpha: number
  label: string
  open: boolean
  onOpen: () => void
  /** The picker, mounted beside the button it hangs from. */
  children?: ReactNode
}) {
  return (
    <span className="relative flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={open}
        title={`${label} — click to open the picker`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onOpen}
        className="h-[18px] w-[18px] shrink-0 rounded-[4px] border border-line p-0"
        style={{
          backgroundColor: cssColor(rgb, alpha),
          backgroundImage:
            alpha < 1
              ? 'linear-gradient(45deg, rgba(0,0,0,.16) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.16) 75%), linear-gradient(45deg, rgba(0,0,0,.16) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.16) 75%)'
              : undefined,
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 4px 4px',
          backgroundBlendMode: 'normal',
        }}
      />
      {children}
    </span>
  )
}

/** The `+` on a section heading: there is none of this yet, add one. */
const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <IconButton label={label} onClick={onClick}>
    <PlusIcon />
  </IconButton>
)

interface PaintHooks {
  live: (run: () => void) => void
  act: (run: () => void) => () => void
  onGesture: (active: boolean) => void
  dropUp: boolean
  picker: OpenPicker
  setPicker: (next: OpenPicker) => void
}

/**
 * The fill: one colour, or none.
 *
 * One rather than Figma's stack of them, because a CSS `background-color` is one
 * colour and a list that could only ever hold a single entry is a promise the
 * page cannot keep. The `+` therefore appears only while there is nothing to
 * remove — a second one would offer to add a fill that has nowhere to go.
 */
function FillSection({
  el,
  fill,
  live,
  act,
  onGesture,
  dropUp,
  picker,
  setPicker,
}: PaintHooks & { el: HTMLElement; fill: PaintInfo }) {
  const avoid = useContext(PanelBox)
  return (
    <Section
      title="Fill"
      wide
      onAdd={fill.on ? undefined : act(() => addFill(el))}
      /* Only the `+`. The picture button used to sit here on the grounds that a
         fill and an image both answer "what is inside this box", which is true
         and was still the wrong place for it: everything else on this heading
         acts on the row below it, and a control that instead opens a file dialog
         reads as a second way to add a fill. It has moved to the panel's title
         bar, beside Lift, where the actions that are about the element as a
         whole already live. */
      action={!fill.on && <AddButton label="Add a fill" onClick={act(() => addFill(el))} />}
    >
      {fill.on && (
        <PaintRow
          label="fill"
          onOpen={() => setPicker(picker === 'fill' ? null : 'fill')}
          rgb={fill.rgb}
          alpha={fill.alpha}
          visible={fill.visible}
          onHex={(rgb) => live(() => setFill(el, rgb, fill.alpha))}
          onAlpha={(next) => live(() => setFill(el, fill.rgb, next))}
          onToggle={act(() => toggleFill(el, fill))}
          onRemove={act(() => removeFill(el))}
          swatch={
            <Swatch
              rgb={fill.rgb}
              alpha={fill.alpha}
              label="Fill colour"
              open={picker === 'fill'}
              onOpen={() => setPicker(picker === 'fill' ? null : 'fill')}
            >
              {picker === 'fill' && (
                <ColorPicker
                  value={cssColor(fill.rgb, fill.alpha)}
                  showContrast={false}
                  avoid={avoid}
                  dropUp={dropUp}
                  onClose={() => setPicker(null)}
                  onGesture={onGesture}
                  onChange={(color) => live(() => setStyle(el, 'background-color', color))}
                  onReset={act(() => clearPaint(el, 'fill'))}
                />
              )}
            </Swatch>
          }
        />
      )}
    </Section>
  )
}

/**
 * A run of mutually exclusive choices, drawn as one control.
 *
 * Loose toggles say "each of these is on or off"; a segmented group says "one of
 * these is the answer", which is what an axis, an alignment and a distribution
 * each are. The difference is not decoration — with four independent-looking
 * buttons in a row there is nothing on screen ruling out pressing two of them,
 * and the panel spends its first impression teaching you that by refusing.
 *
 * The active segment is a raised white tile rather than a filled blue one. Blue
 * is this product's "you have set this" colour and it is everywhere in the
 * panel; a whole row of blue-capable buttons would drown the two or three places
 * where blue is actually news.
 */
function Segments({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-[2px] rounded-[7px] bg-ink/[0.06] p-[2px]">
      {children}
    </span>
  )
}

function Segment({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
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
        'grid h-[20px] w-[24px] shrink-0 place-items-center rounded-[5px] border-0 text-[12px] leading-none',
        active
          ? 'bg-paper text-ink shadow-[0_1px_2px_rgba(11,11,12,0.14)]'
          : 'bg-transparent text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * One axis of the element's size: a number, or the word standing in for one.
 *
 * The three modes live in the same chip as the value rather than in a control
 * beside it, because they are the same fact. A panel that showed 240 in one box
 * and "Hug" in another would be showing two answers to one question, and the
 * number would be the stale one the moment the content changed.
 *
 * Fill is withheld rather than disabled where it could not work — an element
 * with nothing around it to fill (see canFill). A greyed-out third option is
 * still an option you have to read and rule out every time.
 */
function SizeField({
  axis,
  letter,
  info,
  el,
  docked,
  act,
  live,
  settle,
}: {
  axis: SizeAxis
  letter: string
  info: SizeInfo
  el: HTMLElement
  docked: boolean
  act: (run: () => void) => () => void
  live: (run: () => void) => void
  settle: (active: boolean) => void
}) {
  const name = axis === 'width' ? 'width' : 'height'
  const modes: SizeMode[] = info.fillable ? ['fixed', 'hug', 'fill'] : ['fixed', 'hug']
  const WORD: Record<SizeMode, string> = { fixed: 'Fixed', hug: 'Hug', fill: 'Fill' }

  return (
    <NumberField
      compact
      fill={docked}
      label={name}
      title={`${name} — drag to scrub, double-click to type`}
      icon={<Letter>{letter}</Letter>}
      /* Rounded through the canvas zoom, so a card that is 300 at life size
         still reads 300 when the board is at 40%. */
      value={Math.round(info.value / canvasScale())}
      min={0}
      step={1}
      readout={info.mode === 'fixed' ? undefined : WORD[info.mode]}
      onGesture={settle}
      /* Typing a number *is* choosing Fixed — a field that took a value while
         still saying Hug would be lying about which of the two won. */
      onChange={(next) => live(() => setFixedSize(el, axis, next))}
      trailing={
        <span className="relative flex h-[18px] w-[16px] shrink-0 items-center justify-center">
          <Select
            label={`${name} sizing`}
            value={info.mode}
            width={112}
            align="right"
            options={modes.map((mode) => ({ value: mode, label: WORD[mode] }))}
            onChange={(next) => act(() => setSizeMode(el, axis, next))()}
            trigger={({ toggle }) => (
              <button
                type="button"
                aria-label={`${name} sizing`}
                title={`How the ${name} is decided`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={toggle}
                className="grid h-[18px] w-[16px] place-items-center rounded-[4px] border-0 bg-transparent text-ink-soft hover:text-ink"
              >
                <CaretIcon />
              </button>
            )}
          />
        </span>
      }
    />
  )
}

/** How the panel offers to recase text: as it is, and the three CSS knows. */
const CASES: { value: string; label: string; title: string }[] = [
  { value: 'none', label: '—', title: 'As typed' },
  { value: 'uppercase', label: 'AG', title: 'Upper case' },
  { value: 'lowercase', label: 'ag', title: 'Lower case' },
  { value: 'capitalize', label: 'Ag', title: 'Title case' },
]

/**
 * Type, while it is being typed.
 *
 * Everything here routes through `applyTypeStyle`, which is what makes the
 * section honest about its own scope: with words highlighted it restyles the
 * highlight, and with only a caret it restyles the element — exactly what the
 * edit highlight is drawing at the time. That is also why the selection is put
 * back after every write. Clicking a control in the panel does not move the
 * caret (the overlay refuses focus on mousedown), but a style write can collapse
 * a range on its own, and a range that vanished when you pressed "bold" would
 * make the second press mean something different from the first.
 *
 * The state is held here rather than read from the computed style on every
 * render, because during an edit the computed value of the *element* is not the
 * value of the *selection* — highlight one word, make it 30px, and the element
 * still computes to 16. What you last asked for is the truthful thing to show.
 */
function TypographySection({ el, dropUp }: { el: HTMLElement; dropUp: boolean }) {
  const computed = useMemo(() => window.getComputedStyle(el), [el])
  const avoid = useContext(PanelBox)
  const [family, setFamily] = useState(
    () => computed.fontFamily.split(',')[0]?.replace(/["']/g, '') ?? '',
  )
  const [weights, setWeights] = useState<number[]>([300, 400, 500, 600, 700])
  const [weight, setWeight] = useState(() => numeric(computed.fontWeight, 400))
  const [size, setSize] = useState(() => numeric(computed.fontSize, 16))
  const [lineHeight, setLineHeight] = useState(() =>
    numeric(computed.lineHeight, numeric(computed.fontSize, 16) * 1.4),
  )
  const [tracking, setTracking] = useState(() =>
    computed.letterSpacing === 'normal' ? 0 : numeric(computed.letterSpacing, 0),
  )
  const [colour, setColour] = useState(
    () => parseColor(computed.color) ?? { rgb: hexToRgb('#000000'), alpha: 1 },
  )
  const [picking, setPicking] = useState(false)
  const gesture = useRef(false)

  // Whatever the user highlighted has to survive a trip to the panel.
  useEffect(() => rememberSelection(el), [el])

  const apply = (decls: Record<string, string>) => {
    history.begin(Object.keys(decls).join('+'), el)
    applyTypeStyle(el, decls)
    restoreSelection(el)
    if (!gesture.current) history.commit()
    store.set(history.depths())
    store.touch()
  }

  const pickFamily = async (meta: FontMeta) => {
    setFamily(meta.family)
    setWeights(meta.weights)
    const nearest = meta.weights.reduce((best, candidate) =>
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
    )
    setWeight(nearest)
    // Register the real face before switching to it, or the first paint falls
    // back to a system font and the change looks like it did nothing.
    await loadFamily(meta.family, nearest)
    apply({ 'font-family': `"${meta.family}"`, 'font-weight': String(nearest) })
  }

  const pickWeight = async (next: number) => {
    setWeight(next)
    if (family) await loadFamily(family, next)
    apply({ 'font-weight': String(next) })
  }

  const align = computed.textAlign
  const decoration = computed.textDecorationLine
  const casing = computed.textTransform

  return (
    <Section title="Typography" wide>
      <div className="flex flex-col gap-1">
        {/**
         * Colour first.
         *
         * It is the one property here you choose by *looking* rather than by
         * knowing — a weight or a size is a value you already have in mind, a
         * colour is one you arrive at — and it was at the bottom, under six rows
         * of things you had to scroll past to reach it.
         */}
        <PaintRow
          label="text"
          bare
          onOpen={() => setPicking(!picking)}
          rgb={colour.rgb}
          alpha={colour.alpha}
          visible
          onHex={(rgb) => {
            setColour({ ...colour, rgb })
            apply({ color: cssColor(rgb, colour.alpha) })
          }}
          onAlpha={(next) => {
            setColour({ ...colour, alpha: next })
            apply({ color: cssColor(colour.rgb, next) })
          }}
          onToggle={() => {}}
          onRemove={() => {}}
          swatch={
            <Swatch
              rgb={colour.rgb}
              alpha={colour.alpha}
              label="Text colour"
              open={picking}
              onOpen={() => setPicking(!picking)}
            >
              {picking && (
                <ColorPicker
                  value={cssColor(colour.rgb, colour.alpha)}
                  /* The one picker in the panel that keeps its contrast
                     readout: this colour has a background to be legible
                     against, which a fill or a border does not. */
                  background={effectiveBackground(el)}
                  avoid={avoid}
                  dropUp={dropUp}
                  onClose={() => setPicking(false)}
                  onGesture={(active) => {
                    gesture.current = active
                    if (!active) {
                      history.commit()
                      store.set(history.depths())
                    }
                  }}
                  onChange={(next) => {
                    const parsed = parseColor(next)
                    if (parsed) setColour(parsed)
                    apply({ color: next })
                  }}
                  onReset={() => {
                    history.step('reset colour', el, () => clearStyle(el, 'color'))
                    const back = parseColor(window.getComputedStyle(el).color)
                    if (back) setColour(back)
                    store.set(history.depths())
                  }}
                />
              )}
            </Swatch>
          }
        />

        {/* Its own row, full width. A family name is the longest string in this
            panel by some way, and sharing a line with anything meant reading
            most of them as an ellipsis. */}
        <FontPicker value={family} onPick={pickFamily} dropUp={dropUp} />

        <div className="flex min-w-0 items-center gap-1">
          {/* Named, with the number at the far end — which is how a weight is
              actually held in mind. "Semibold" is the thing you want; 600 is how
              you have to say it, and both belong in the row. */}
          <Select
            label="Font weight"
            value={String(weight)}
            options={weights.map((option) => ({
              value: String(option),
              label: WEIGHT_NAMES[option] ?? String(option),
              hint: String(option),
            }))}
            onChange={(next) => void pickWeight(Number(next))}
          />
          {/* A menu of the sizes anyone actually types, and still typeable for
              the ones they don't. */}
          <NumberField
            compact
            fill
            label="font size"
            title="Size"
            icon={<Tag>Size</Tag>}
            value={size}
            step={1}
            min={1}
            onGesture={onTypeGesture(gesture)}
            onChange={(next) => {
              setSize(next)
              apply({ 'font-size': px(next) })
            }}
            trailing={
              <Select
                label="Font size"
                value={String(Math.round(size))}
                width={92}
                align="right"
                dropUp={dropUp}
                options={FONT_SIZES.map((option) => ({
                  value: String(option),
                  label: String(option),
                }))}
                onChange={(next) => {
                  setSize(Number(next))
                  apply({ 'font-size': px(Number(next)) })
                }}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    aria-label="Pick a font size"
                    title="Pick a font size"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={toggle}
                    className="grid h-[18px] w-[16px] place-items-center rounded-[4px] border-0 bg-transparent text-ink-soft hover:text-ink"
                  >
                    <CaretIcon />
                  </button>
                )}
              />
            }
          />
        </div>

        <div className="flex min-w-0 items-center gap-1">
          {/* LH and LS rather than L and T: two letters is what every type panel
              in the world abbreviates these to, and one letter was a guess. */}
          <NumberField
            compact
            fill
            label="line height"
            title="Line height"
            icon={<Tag>LH</Tag>}
            value={lineHeight}
            step={1}
            min={0}
            onGesture={onTypeGesture(gesture)}
            onChange={(next) => {
              setLineHeight(next)
              apply({ 'line-height': px(next) })
            }}
          />
          <NumberField
            compact
            fill
            label="letter spacing"
            title="Letter spacing"
            icon={<Tag>LS</Tag>}
            value={tracking}
            step={0.5}
            precision={1}
            onGesture={onTypeGesture(gesture)}
            onChange={(next) => {
              setTracking(next)
              apply({ 'letter-spacing': `${next}px` })
            }}
          />
        </div>

        <Line label="Align">
          <Segments>
            {ALIGNMENTS.map((value) => {
              const Glyph = TEXT_ALIGN_ICONS[value]
              return (
                <Segment
                  key={value}
                  label={`Align ${value}`}
                  active={align === value}
                  onClick={() => apply({ 'text-align': value })}
                >
                  <Glyph />
                </Segment>
              )
            })}
          </Segments>
        </Line>

        <Line label="Case">
          <Segments>
            {CASES.map((option) => (
              <Segment
                key={option.value}
                label={option.title}
                active={(casing || 'none') === option.value}
                onClick={() => apply({ 'text-transform': option.value })}
              >
                <Tag>{option.label}</Tag>
              </Segment>
            ))}
          </Segments>
        </Line>

        <Line label="Decorate">
          <Segments>
            <Segment
              label="No decoration"
              active={!decoration || decoration === 'none'}
              onClick={() => apply({ 'text-decoration-line': 'none' })}
            >
              <Tag>—</Tag>
            </Segment>
            <Segment
              label="Underline"
              active={decoration.includes('underline')}
              onClick={() => apply({ 'text-decoration-line': 'underline' })}
            >
              <UnderlineIcon />
            </Segment>
            <Segment
              label="Strikethrough"
              active={decoration.includes('line-through')}
              onClick={() => apply({ 'text-decoration-line': 'line-through' })}
            >
              <StrikeIcon />
            </Segment>
          </Segments>
        </Line>
      </div>
    </Section>
  )
}

/** A short word or two set as a control's own label, not as a value. */
const Tag = ({ children }: { children: ReactNode }) => (
  <span className="text-[10px] leading-none font-medium whitespace-nowrap">{children}</span>
)

/**
 * The numbers a type panel offers, and nothing between them.
 *
 * Fine steps where type is small and the difference of two pixels is a different
 * design; fours past forty, where it is not. Anything off the list is still
 * typeable — the menu is a shortcut, not a constraint.
 */
const FONT_SIZES = [
  0, 2, 4, 6, 8, 12, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 44, 48, 52, 56, 60, 64,
  68, 72, 76, 80, 84, 88, 92, 96,
]

/** CSS numbers, in the words the rest of the world uses for them. */
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
}

/** A scrub is a drag: one undo step for the whole travel, not forty. */
const onTypeGesture =
  (gesture: { current: boolean }) =>
  (active: boolean): void => {
    gesture.current = active
    if (!active) {
      history.commit()
      store.set(history.depths())
    }
  }

const numeric = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Bootstrap draws these exactly as a type control wants them (see icons.tsx). */
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const

/**
 * A labelled line inside a wide section: a name, then the controls it names.
 *
 * The shadow's six numbers are the one group here where the marks cannot carry
 * the meaning on their own — X and Y are legible, but a blur and a spread are
 * two soft-edged squares that nobody tells apart at 13 pixels, and getting them
 * the wrong way round is a shadow that looks broken for reasons you cannot see.
 * So they get words, which is also what Figma concluded.
 */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="w-[46px] shrink-0 text-[10px] leading-tight font-medium text-ink-soft">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * The shadow: what kind, and — behind the settings button — the six numbers.
 *
 * The row itself is deliberately not six fields. A shadow is one *thing* you
 * either have or do not, and the panel's job at rest is to say which; the
 * numbers are what you go looking for once you have decided to change it. Folded
 * away they cost nothing, and the row that remains is the same shape as the fill
 * and the stroke above it, which is what makes the three read as three of a kind
 * rather than as three unrelated controls that happen to be stacked.
 *
 * Drop versus inner is a real CSS distinction (`inset`) rather than a borrowed
 * word, so it gets the select — the same slot Figma puts it in.
 */
function ShadowSection({
  el,
  shadow,
  open,
  onUnfold,
  live,
  act,
  settle,
  onGesture,
  dropUp,
  picker,
  setPicker,
}: PaintHooks & {
  el: HTMLElement
  shadow: ShadowInfo
  open: boolean
  onUnfold: () => void
  settle: (active: boolean) => void
}) {
  const avoid = useContext(PanelBox)
  const visible = shadowVisible(shadow)
  const opacity = shadowOpacity(el, shadow)
  /** Every field writes the whole declaration — `box-shadow` has no longhands. */
  const write = (patch: Partial<ShadowInfo>) =>
    live(() => setShadow(el, { ...shadow, ...patch, on: true }))

  const number = (
    label: string,
    title: string,
    icon: ReactNode,
    value: number,
    key: 'x' | 'y' | 'blur' | 'spread',
    min = -Infinity,
  ) => (
    <NumberField
      compact
      fill
      label={label}
      title={title}
      icon={icon}
      value={value}
      min={min}
      onGesture={settle}
      onChange={(next) => write({ [key]: next })}
    />
  )

  return (
    <Section
      title="Shadow"
      wide
      last
      onAdd={shadow.on ? undefined : act(() => setShadow(el, DEFAULT_SHADOW))}
      action={
        !shadow.on && (
          <AddButton
            label="Add a drop shadow"
            onClick={act(() => setShadow(el, DEFAULT_SHADOW))}
          />
        )
      }
    >
      {shadow.on && (
        <div className="flex flex-col gap-1">
          <div className={cx('flex min-w-0 items-center gap-1', !visible && 'opacity-45')}>
            <Select
              label="Shadow kind"
              value={shadow.inset ? 'inner' : 'drop'}
              options={[
                { value: 'drop', label: 'Drop shadow' },
                { value: 'inner', label: 'Inner shadow' },
              ]}
              onChange={(next) => write({ inset: next === 'inner' })}
            />
            <Toggle
              label={open ? 'Hide the shadow settings' : 'Shadow settings'}
              active={open}
              onClick={onUnfold}
            >
              <SlidersIcon />
            </Toggle>
            <IconButton
              label={visible ? 'Hide the shadow' : 'Show the shadow'}
              onClick={act(() => toggleShadow(el, shadow))}
              dim={!visible}
            >
              {visible ? <EyeIcon /> : <EyeOffIcon />}
            </IconButton>
            <IconButton label="Remove the shadow" onClick={act(() => removeShadow(el))}>
              <MinusIcon />
            </IconButton>
          </div>

          <ExpandRows open={open}>
            <div className="flex flex-col gap-1">
              <Line label="Position">
                {number('shadow x', 'Horizontal offset', <Letter>X</Letter>, shadow.x, 'x')}
                {number('shadow y', 'Vertical offset', <Letter>Y</Letter>, shadow.y, 'y')}
              </Line>
              <Line label="Blur">
                {number('blur', 'Blur', <BlurIcon />, shadow.blur, 'blur', 0)}
              </Line>
              <Line label="Spread">
                {number('spread', 'Spread', <SpreadIcon />, shadow.spread, 'spread')}
              </Line>
              <Line label="Colour">
                <PaintRow
                  label="shadow"
                  onOpen={() => setPicker(picker === 'shadow' ? null : 'shadow')}
                  rgb={hexToRgb(shadow.color)}
                  alpha={opacity / 100}
                  visible={visible}
                  bare
                  onHex={(rgb) => write({ color: rgbToHex(rgb) })}
                  onAlpha={(next) => write({ opacity: Math.round(next * 100) })}
                  onToggle={act(() => toggleShadow(el, shadow))}
                  onRemove={act(() => removeShadow(el))}
                  swatch={
                    <Swatch
                      rgb={hexToRgb(shadow.color)}
                      alpha={opacity / 100}
                      label="Shadow colour"
                      open={picker === 'shadow'}
                      onOpen={() => setPicker(picker === 'shadow' ? null : 'shadow')}
                    >
                      {picker === 'shadow' && (
                        <ColorPicker
                          /**
                           * The picker's own alpha slider and the `%` beside the
                           * hex are the same number seen twice, deliberately: a
                           * shadow's opacity *is* part of its colour, and a
                           * picker showing a transparency control that did
                           * nothing would be the worse of the two options by a
                           * distance.
                           */
                          value={cssColor(hexToRgb(shadow.color), opacity / 100)}
                          showContrast={false}
                          avoid={avoid}
                          dropUp={dropUp}
                          onClose={() => setPicker(null)}
                          onGesture={onGesture}
                          onChange={(css) =>
                            live(() => {
                              const picked = parseColor(css)
                              setShadow(el, {
                                ...shadow,
                                on: true,
                                color: picked ? rgbToHex(picked.rgb) : shadow.color,
                                opacity: Math.round((picked?.alpha ?? 1) * 100),
                              })
                            })
                          }
                          onReset={act(() => setShadow(el, { ...shadow, color: '#000000', on: true }))}
                        />
                      )}
                    </Swatch>
                  }
                />
              </Line>
            </div>
          </ExpandRows>
        </div>
      )}
    </Section>
  )
}

/** Solid, dashed, dotted — a border's three honest styles. */
const STROKE_STYLES: BorderStyle[] = ['solid', 'dashed', 'dotted']

/**
 * The stroke: a colour row, then how it is drawn.
 *
 * Where Figma puts Position — inside, centre, outside — this puts Style, and the
 * swap is not a shortcut. A CSS border has exactly one position: it is drawn
 * between the padding box and the margin, and no declaration moves it. A
 * three-way control where two of the choices did nothing would be the panel
 * lying about the page. What a border does have, and what Figma's own stroke
 * panel calls the same thing further down, is a style — so the slot goes to the
 * property that is really there.
 *
 * The weight folds out into four edges for the same reason the padding does, and
 * through the same control, because it is the same question.
 */
function StrokeSection({
  el,
  stroke,
  widths,
  kind,
  open,
  onUnfold,
  live,
  act,
  onGesture,
  settle,
  dropUp,
  picker,
  setPicker,
}: PaintHooks & {
  el: HTMLElement
  stroke: PaintInfo
  widths: StrokeWidths
  kind: BorderStyle
  open: boolean
  onUnfold: () => void
  settle: (active: boolean) => void
}) {
  const avoid = useContext(PanelBox)
  const addStroke = act(() =>
    setBorder(el, true, {
      ...readBox(el),
      borderWidth: widths.value || 1,
      borderColor: rgbToHex(stroke.rgb) || DEFAULT_BORDER_COLOR,
    }),
  )
  const widthField = (side: Side) => (
    <NumberField
      key={side}
      compact
      fill
      label={`${side} stroke weight`}
      title={`${side} stroke weight`}
      icon={<EdgeIcon edges={[side]} />}
      value={widths.sides[side]}
      step={1}
      min={0}
      onGesture={settle}
      onChange={(next) => live(() => setStrokeWidth(el, side, next))}
    />
  )

  return (
    <Section
      title="Stroke"
      wide
      onAdd={stroke.on ? undefined : addStroke}
      action={!stroke.on && <AddButton label="Add a stroke" onClick={addStroke} />}
    >
      {stroke.on && (
        <>
          <PaintRow
            label="stroke"
            onOpen={() => setPicker(picker === 'border' ? null : 'border')}
            rgb={stroke.rgb}
            alpha={stroke.alpha}
            visible={stroke.visible}
            onHex={(rgb) => live(() => setStrokeColor(el, rgb, stroke.alpha))}
            onAlpha={(next) => live(() => setStrokeColor(el, stroke.rgb, next))}
            onToggle={act(() => toggleStroke(el, stroke))}
            onRemove={act(() => removeStroke(el))}
            swatch={
              <Swatch
                rgb={stroke.rgb}
                alpha={stroke.alpha}
                label="Stroke colour"
                open={picker === 'border'}
                onOpen={() => setPicker(picker === 'border' ? null : 'border')}
              >
                {picker === 'border' && (
                  <ColorPicker
                    value={cssColor(stroke.rgb, stroke.alpha)}
                    showContrast={false}
                    avoid={avoid}
                    dropUp={dropUp}
                    onClose={() => setPicker(null)}
                    onGesture={onGesture}
                    onChange={(color) => live(() => setStyle(el, 'border-color', color))}
                    onReset={act(() => clearPaint(el, 'stroke'))}
                  />
                )}
              </Swatch>
            }
          />

          <FoldOut
            open={open}

            toggle={
              <Toggle
                label={open ? 'Fold the edges back into one weight' : 'Set each edge on its own'}
                active={open}
                onClick={onUnfold}
              >
                <CornersIcon />
              </Toggle>
            }
            first={[
              <select
                key="style"
                aria-label="Stroke style"
                title="How the line is drawn"
                value={kind}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => live(() => setStrokeStyle(el, event.target.value as BorderStyle))}
                className="dm-field h-[24px] min-w-0 flex-1 rounded-[6px] border-0 bg-ink/[0.06] px-1.5 text-[11px] text-ink capitalize"
              >
                {STROKE_STYLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>,
              <NumberField
                key="weight"
                compact
                fill
                label="stroke weight"
                title="Stroke weight — drag to scrub, double-click to type"
                icon={<BorderIcon />}
                value={widths.value}
                mixed={!widths.uniform}
                step={1}
                min={0}
                onGesture={settle}
                onChange={(next) => live(() => setStrokeWidth(el, 'all', next))}
              />,
            ]}
            rows={[SIDE_GRID[0]!.map(widthField), SIDE_GRID[1]!.map(widthField)]}
          />
        </>
      )}
    </Section>
  )
}

const Letter = ({ children }: { children: string }) => (
  <span className="w-[11px] text-center text-[10px] font-semibold">{children}</span>
)

/** X, Y, blur, spread, colour and opacity — the six numbers a shadow is. */
function ShadowFields({
  shadow,
  el,
  live,
  settle,
  act,
  dropUp,
  onGesture,
}: {
  shadow: ShadowInfo
  el: HTMLElement
  live: (run: () => void) => void
  settle: (active: boolean) => void
  act: (run: () => void) => () => void
  dropUp: boolean
  onGesture: (active: boolean) => void
}) {
  const [picking, setPicking] = useState(false)
  // Every field writes the whole declaration — `box-shadow` has no longhands, so
  // there is nothing to edit in isolation even in principle.
  const write = (patch: Partial<ShadowInfo>) =>
    live(() => setShadow(el, { ...shadow, ...patch, on: true }))

  return (
    <>
      {/* The two axes are the one pair in the bar with no picture worth drawing:
          X and Y already *are* the notation, and a mark meaning "horizontal
          offset" would be a worse version of the letter. The accessible name
          stays the long form, which is what a screen reader needs. */}
      <NumberField
        compact
        label="shadow x"
        title="Horizontal offset"
        icon={<Letter>X</Letter>}
        value={shadow.x}
        min={-Infinity}
        onGesture={settle}
        onChange={(x) => write({ x })}
      />
      <NumberField
        compact
        label="shadow y"
        title="Vertical offset"
        icon={<Letter>Y</Letter>}
        value={shadow.y}
        min={-Infinity}
        onGesture={settle}
        onChange={(y) => write({ y })}
      />
      <NumberField
        compact
        label="blur"
        title="Blur"
        icon={<BlurIcon />}
        value={shadow.blur}
        min={0}
        onGesture={settle}
        onChange={(blur) => write({ blur })}
      />
      <NumberField
        compact
        label="spread"
        title="Spread"
        icon={<SpreadIcon />}
        value={shadow.spread}
        min={-Infinity}
        onGesture={settle}
        onChange={(spread) => write({ spread })}
      />

      <div className="relative">
        <Toggle label="Shadow colour" active={picking} wide onClick={() => setPicking(!picking)}>
          <ColorGlyph tint={shadow.color}>
            <ShadowIcon />
          </ColorGlyph>
        </Toggle>
        {picking && (
          <ColorPicker
            /**
             * The slider and the `%` field beside it are the same number seen
             * twice, deliberately: a shadow's opacity is part of its colour, and
             * a picker that showed a transparency control which did nothing —
             * because the real one lived in the bar — would be the worse of the
             * two options by a distance.
             */
            value={cssColor(hexToRgb(shadow.color), shadow.opacity / 100)}
            showContrast={false}
            dropUp={dropUp}
            onClose={() => setPicking(false)}
            onGesture={onGesture}
            onChange={(css) =>
              live(() => {
                const picked = parseColor(css)
                setShadow(el, {
                  ...shadow,
                  on: true,
                  color: picked ? rgbToHex(picked.rgb) : shadow.color,
                  opacity: Math.round((picked?.alpha ?? 1) * 100),
                })
              })
            }
            onReset={act(() => setShadow(el, { ...shadow, color: '#000000', on: true }))}
          />
        )}
      </div>

      <NumberField
        compact
        label="shadow opacity"
        title="Shadow opacity"
        icon={<OpacityIcon />}
        value={shadow.opacity}
        min={0}
        step={5}
        suffix="%"
        onGesture={settle}
        onChange={(opacity) => write({ opacity })}
      />
    </>
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
            ? {
                background: tint,
                boxShadow: 'inset 0 0 0 0.5px rgba(11,11,12,.25)',
              }
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
        'grid h-[24px] shrink-0 place-items-center rounded-[6px] border-0 text-[12px] leading-none',
        // The colour buttons carry a swatch under their glyph, so they get two
        // more pixels to put it in.
        wide ? 'w-[26px]' : 'w-[24px]',
        /**
         * A pale blue tile with a blue mark on it, rather than a solid blue
         * disc with a white mark.
         *
         * The disc was the loudest thing in the panel by a distance, and it was
         * being used for the quietest fact there is: this option, of four, is
         * the current one. A row of them read as four alerts. The tint says the
         * same thing at the weight it deserves, keeps the icon legible as
         * itself, and — square rather than round — reads as a selected cell in a
         * group instead of as a button that has been switched on.
         */
        active
          ? 'bg-[color:var(--color-select)]/12 text-[color:var(--color-select)]'
          : 'bg-transparent text-ink hover:bg-ink/5',
      )}
    >
      {children}
    </button>
  )
}

// — type ————————————————————————————————————————————————————————

interface TypeInfo {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** The weight as it stands, so un-bolding can go back to it rather than to 400. */
  weight: number
}

/**
 * 600, not 700: the semibolds are what a modern type ramp actually uses for
 * emphasis, and treating 600 as "not bold" makes the button light up wrongly on
 * about half the headings on the web.
 */
const BOLD_FROM = 600

function readType(el: HTMLElement): TypeInfo {
  const style = window.getComputedStyle(el)
  const weight = Number.parseFloat(style.fontWeight) || 400
  // `text-decoration-line` rather than the shorthand: the shorthand computes to
  // a string with the colour and style in it, so "does it have an underline"
  // becomes a substring search over three unrelated values.
  const lines = style.textDecorationLine
  return {
    bold: weight >= BOLD_FROM,
    italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
    underline: lines.includes('underline'),
    strike: lines.includes('line-through'),
    weight,
  }
}

const toggleBold = (el: HTMLElement, type: TypeInfo): void =>
  setStyle(el, 'font-weight', type.bold ? '400' : '700')

/**
 * Underline and strike are two flags in one property, so each button has to
 * write both — setting `text-decoration-line: underline` on struck-through text
 * would silently drop the strike.
 */
function setDecoration(el: HTMLElement, type: TypeInfo, line: 'underline' | 'line-through'): void {
  const wanted = new Set<string>()
  if (type.underline) wanted.add('underline')
  if (type.strike) wanted.add('line-through')
  if (wanted.has(line)) wanted.delete(line)
  else wanted.add(line)
  setStyle(el, 'text-decoration-line', wanted.size ? [...wanted].join(' ') : 'none')
}
