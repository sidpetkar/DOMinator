import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_BORDER_COLOR,
  readBox,
  readRadius,
  setBackground,
  setBorder,
  setBorderColor,
  setBorderWidth,
  readSpacing,
  setCorner,
  setRadius,
  setSide,
  setSize,
  type Corner,
  type Side,
  type SpacingInfo,
  type SpacingKind,
} from '../core/box'
import {
  DEFAULT_SHADOW,
  readPosition,
  readShadow,
  setFlip,
  setRotation,
  setShadow,
  type ShadowInfo,
} from '../core/effects'
import { COLORS } from '@/shared/constants'
import { cssColor, hexToRgb, parseColor, rgbToHex } from '../core/color'
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
import { clearStyle } from '../core/styles'
import { store, type BoxGroup, type Node } from '../core/store'
import { zoom } from '../core/zoom'
import { ColorPicker } from './ColorPicker'
import { PanelCollapse } from './PanelCollapse'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { NumberField } from './NumberField'
import { ExpandGroup } from './ExpandGroup'
import {
  AlignIcon,
  BlurIcon,
  BorderIcon,
  BorderPaintIcon,
  BucketIcon,
  CornerIcon,
  CornersIcon,
  DistributeIcon,
  EdgeIcon,
  FlipIcon,
  ImageIcon,
  NoBorderIcon,
  OpacityIcon,
  RotateStepIcon,
  RotationIcon,
  ShadowIcon,
  SpreadIcon,
  StackIcon,
  UngroupIcon,
  WrapIcon,
} from './icons'
import { cx, zoomStable } from './util'

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
 * Whether the controls are laid out as a bar or as a docked column.
 *
 * A context rather than a prop threaded through every control: the sections are
 * nested inside conditionals several levels deep, and passing a boolean down
 * that whole tree to be read by one component at the bottom is the shape this
 * exists to avoid.
 */
const Docked = createContext(false)

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
  children,
}: {
  title: string
  /** The final group: a hairline after it would be a rule against nothing. */
  last?: boolean
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
export function ElementBar({ node, docked = false }: { node: Node; docked?: boolean }) {
  const [picker, setPicker] = useState<OpenPicker>(null)
  const gesture = useRef(false)
  const info = readLayout(node.el)
  const align = readAlign(node.el)
  const box = readBox(node.el)
  const pad = readSpacing(node.el, 'padding')
  const mar = readSpacing(node.el, 'margin')
  const radius = readRadius(node.el)
  const shadow = readShadow(node.el)
  const position = readPosition(node.el)
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
  const grip = usePanelDrag('element', barRef)

  /**
   * `left` is placed from the bar's *natural* width, estimated from which
   * sections are showing, never from its measured one. Measuring it creates a
   * feedback loop: a wrapped bar measures narrow, which pushes `left` further
   * right, which leaves less room, which wraps it more — ending in a tall thin
   * column. With a fixed estimate the bar simply shifts left far enough to have
   * room, and maxWidth handles whatever is left over.
   */
  const natural = (hasLayout ? 470 : 0) + (grouped ? 32 : 0) + 410
  const anchoredLeft = Math.max(8, Math.min(rect.left, window.innerWidth - natural / scale - 8))

  const top = grip.pinned ? grip.pinned.top : anchoredTop
  const left = grip.pinned ? grip.pinned.left : anchoredLeft
  const dropUp = top > window.innerHeight - COLOR_PANEL_HEIGHT - shownHeight

  /**
   * Written once and rendered by both layouts. Keeping two copies in sync is not
   * a thing anyone succeeds at for long, and the failure mode is the worst kind:
   * a control that quietly exists in one layout and not the other.
   */
  const sections = (
    <>
      {/* — position: no folded state, because there is nothing to summarise.
          Four unrelated verbs, not four parts of one number. */}
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

      <Section title="Size">
        <NumberField
          label="W"
          value={Math.round(rect.width)}
          step={1}
          min={0}
          title="Width in px — the box as drawn, border included"
          onChange={(next) => act(() => setSize(node.el, 'width', next))()}
        />
        <NumberField
          label="H"
          value={Math.round(rect.height)}
          step={1}
          min={0}
          title="Height in px — the box as drawn, border included"
          onChange={(next) => act(() => setSize(node.el, 'height', next))()}
        />
      </Section>

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

      {hasLayout && (
        <>
          <Section title="Stack">
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
            <Toggle
              label="Wrap"
              active={info.wrap}
              onClick={act(() => setWrap(node.el, !info.wrap))}
            >
              <WrapIcon />
            </Toggle>
          </Section>

          <Section title="Align">
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
          </Section>

          <Section title="Space">
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
          </Section>
        </>
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

      <Section title="Radius">
        {/* — corners — */}
        <Toggle
          label={
            expanded.radius ? 'Fold the corners back into one radius' : 'Set each corner on its own'
          }
          active={Boolean(expanded.radius)}
          onClick={() => unfold('radius')}
        >
          <CornersIcon />
        </Toggle>
        {!expanded.radius && (
          <NumberField
            compact
            label="corner radius"
            title="Corner radius — drag to scrub, double-click to type"
            icon={<CornerIcon corner="tl" />}
            value={radius.value}
            mixed={!radius.uniform}
            step={2}
            min={0}
            onGesture={settle}
            onChange={(next) => live(() => setRadius(node.el, next))}
          />
        )}
        <ExpandGroup open={Boolean(expanded.radius)}>
          {CORNERS.map(({ corner, label }) => (
            <NumberField
              key={corner}
              compact
              label={`${label} radius`}
              title={`${label} corner radius`}
              icon={<CornerIcon corner={corner} />}
              value={radius.corners[corner]}
              step={2}
              min={0}
              onGesture={settle}
              onChange={(next) => live(() => setCorner(node.el, corner, next))}
            />
          ))}
        </ExpandGroup>
      </Section>

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
    </>
  )

  const shut = Boolean(store.get().collapsed.controls)

  if (docked) {
    return (
      <Docked.Provider value={true}>
        <div
          className="dm-panel dm-interactive flex flex-col overflow-hidden"
          style={{
            position: 'fixed',
            right: 12,
            top: 12,
            width: 264,
            // Same as the tree: as tall as it needs to be, never taller.
            maxHeight: 'calc(100vh - 86px)',
            borderRadius: 14,
          }}
        >
          <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
            <span
              className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              title={describe(node.el)}
            >
              {describe(node.el)}
            </span>
            <PanelCollapse
              collapsed={shut}
              label="the controls"
              onToggle={() => controller.foldPanel('controls')}
            />
          </div>
          {!shut && (
            <div className="min-h-0 flex-1 divide-y divide-line overflow-x-hidden overflow-y-auto">
              {sections}
            </div>
          )}
        </div>
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
        borderRadius: height > BAR_HEIGHT + 4 ? 14 : 'var(--radius-pill)',
        ...zoomStable(zoom(), 'top left'),
      }}
    >
      <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
      {sections}
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

  return (
    <>
      <Toggle
        label={open ? `Fold ${name} back into pairs` : `Set each ${name} edge on its own`}
        active={open}
        onClick={onUnfold}
      >
        {tint(<CornersIcon />)}
      </Toggle>

      {!open && (
        <>
          <NumberField
            compact
            label={`horizontal ${name}`}
            title={`Left and right ${name}`}
            icon={tint(<EdgeIcon edges={['left', 'right']} />)}
            value={info.sides.left}
            mixed={!horizontal}
            min={floor}
            onGesture={settle}
            onChange={pair('left', 'right')}
          />
          <NumberField
            compact
            label={`vertical ${name}`}
            title={`Top and bottom ${name}`}
            icon={tint(<EdgeIcon edges={['top', 'bottom']} />)}
            value={info.sides.top}
            mixed={!vertical}
            min={floor}
            onGesture={settle}
            onChange={pair('top', 'bottom')}
          />
        </>
      )}

      <ExpandGroup open={open}>
        {SIDES.map(({ side, label }) => (
          <NumberField
            key={side}
            compact
            label={`${label} ${name}`}
            title={`${label} ${name}`}
            icon={tint(<EdgeIcon edges={[side]} />)}
            value={info.sides[side]}
            min={floor}
            onGesture={settle}
            onChange={(next) => live(() => setSide(el, kind, side, next))}
          />
        ))}
      </ExpandGroup>
    </>
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
        'grid h-[24px] shrink-0 place-items-center rounded-[var(--radius-pill)] border-0 text-[12px] leading-none',
        // The colour buttons carry a swatch under their glyph, so they get two
        // more pixels to put it in.
        wide ? 'w-[26px]' : 'w-[24px]',
        active
          ? 'bg-[color:var(--color-select)] text-paper'
          : 'bg-transparent text-ink hover:bg-ink/5',
      )}
    >
      {children}
    </button>
  )
}
