import arrowClockwise from 'bootstrap-icons/icons/arrow-clockwise.svg?raw'
import arrowCounterclockwise from 'bootstrap-icons/icons/arrow-counterclockwise.svg?raw'
import borderOuter from 'bootstrap-icons/icons/border-outer.svg?raw'
import borderStyle from 'bootstrap-icons/icons/border-style.svg?raw'
import boundingBox from 'bootstrap-icons/icons/bounding-box.svg?raw'
import boundingBoxCircles from 'bootstrap-icons/icons/bounding-box-circles.svg?raw'
import camera from 'bootstrap-icons/icons/camera.svg?raw'
import crop from 'bootstrap-icons/icons/crop.svg?raw'
import fileEarmarkImage from 'bootstrap-icons/icons/file-earmark-image.svg?raw'
import imageIcon from 'bootstrap-icons/icons/image.svg?raw'
import check from 'bootstrap-icons/icons/check.svg?raw'
import circleHalf from 'bootstrap-icons/icons/circle-half.svg?raw'
import clipboard from 'bootstrap-icons/icons/clipboard.svg?raw'
import distributeHorizontal from 'bootstrap-icons/icons/distribute-horizontal.svg?raw'
import distributeVertical from 'bootstrap-icons/icons/distribute-vertical.svg?raw'
import download from 'bootstrap-icons/icons/download.svg?raw'
import eye from 'bootstrap-icons/icons/eye.svg?raw'
import eyeSlash from 'bootstrap-icons/icons/eye-slash.svg?raw'
import eyedropper from 'bootstrap-icons/icons/eyedropper.svg?raw'
import dashLg from 'bootstrap-icons/icons/dash-lg.svg?raw'
import chevronDown from 'bootstrap-icons/icons/chevron-down.svg?raw'
import grid from 'bootstrap-icons/icons/grid-3x3-gap.svg?raw'
import gripVertical from 'bootstrap-icons/icons/grip-vertical.svg?raw'
import plusLg from 'bootstrap-icons/icons/plus-lg.svg?raw'
import imageAlt from 'bootstrap-icons/icons/image-alt.svg?raw'
import infoCircle from 'bootstrap-icons/icons/info-circle.svg?raw'
import justify from 'bootstrap-icons/icons/justify.svg?raw'
import link45deg from 'bootstrap-icons/icons/link-45deg.svg?raw'
import listOl from 'bootstrap-icons/icons/list-ol.svg?raw'
import paintBucket from 'bootstrap-icons/icons/paint-bucket.svg?raw'
import search from 'bootstrap-icons/icons/search.svg?raw'
import stars from 'bootstrap-icons/icons/stars.svg?raw'
import sliders from 'bootstrap-icons/icons/sliders.svg?raw'
import tag from 'bootstrap-icons/icons/tag.svg?raw'
import textCenter from 'bootstrap-icons/icons/text-center.svg?raw'
import textLeft from 'bootstrap-icons/icons/text-left.svg?raw'
import textRight from 'bootstrap-icons/icons/text-right.svg?raw'
import threeDots from 'bootstrap-icons/icons/three-dots.svg?raw'
import shapes from 'bootstrap-icons/icons/pentagon.svg?raw'
import typeGlyph from 'bootstrap-icons/icons/fonts.svg?raw'
import typeBold from 'bootstrap-icons/icons/type-bold.svg?raw'
import typeItalic from 'bootstrap-icons/icons/type-italic.svg?raw'
import typeStrikethrough from 'bootstrap-icons/icons/type-strikethrough.svg?raw'
import typeUnderline from 'bootstrap-icons/icons/type-underline.svg?raw'
import universalAccess from 'bootstrap-icons/icons/universal-access.svg?raw'
import type { ReactNode } from 'react'
import type { AlignPos, Axis, Distribution } from '../core/layout'

/**
 * The whole icon vocabulary, in one file.
 *
 * The artwork is Bootstrap Icons, taken from the official package as **raw SVG**
 * rather than through a React wrapper. Two reasons, both of which showed up when
 * the wrapper was tried first: a barrel of 2,078 components took the build from
 * 2s to 20s because Rollup has to walk every one of them to tree-shake, and it
 * dragged `prop-types` into a bundle that is injected into every page the user
 * visits — 35KB for thirty icons.
 *
 * Imported this way, each icon costs only its path data (a few hundred bytes),
 * nothing is fetched at runtime, and no icon font has to survive the page's CSP.
 * The strings are build-time constants from a package, which is what makes
 * `dangerouslySetInnerHTML` the right tool here rather than a risk.
 *
 * A handful are deliberately **not** Bootstrap and live at the bottom of this
 * file: the align, stack, wrap and space-evenly marks are drawn the way Figma
 * draws them. Someone arriving from Figma reads those without a legend, and that
 * recognition is worth more than consistency with the rest of the set. Wherever
 * Bootstrap has a true equivalent — text alignment, paste, undo — it is used.
 */

/**
 * The default. Most icons override it by a pixel either way: these sizes were
 * tuned against the containers they sit in — a 24px bar toggle, a 22px picker
 * button, a 26px type-toolbar button — rather than set to one round number, and
 * a uniform size made the bars noticeably heavier when it was tried.
 */
const SIZE = 13

/**
 * The inside of a Bootstrap icon, without its `<svg>` wrapper.
 *
 * Stripping it lets our own element own the size and the `aria-hidden`, and drops
 * the `class="bi bi-…"` and duplicate `xmlns` that would otherwise be repeated on
 * every icon in the bundle.
 */
const paths = (raw: string): string =>
  raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()

interface GlyphProps {
  size?: number
  className?: string
}

/** Bootstrap draws everything on a 16-unit grid. */
const glyph = (raw: string, defaultSize = SIZE) => {
  const inner = paths(raw)
  const Glyph = ({ size = defaultSize, className }: GlyphProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
  return Glyph
}

// — colour ——————————————————————————————————————————————————————

export const DropperIcon = glyph(eyedropper)
export const ResetIcon = glyph(arrowCounterclockwise, 12)
export const BucketIcon = glyph(paintBucket, 12)
export const BorderPaintIcon = glyph(borderOuter, 12)

/**
 * The paint rows' own three marks: add one, hide one, take one away.
 *
 * A shown eye and a struck-through one rather than one eye that changes colour.
 * "Off" has to be legible in the mark itself — a control whose only off state is
 * a paler version of its on state is one you have to remember the meaning of,
 * and the row it sits in is already dimmed for the same reason.
 */
export const PlusIcon = glyph(plusLg, 11)
export const MinusIcon = glyph(dashLg, 11)
export const EyeIcon = glyph(eye, 12)
export const EyeOffIcon = glyph(eyeSlash, 12)
/** The small chevron that says "there is a menu behind this". */
export const CaretIcon = () => (
  <Mark size={11}>
    <path
      d="M4.5 6.5 8 10l3.5-3.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Mark>
)

// — the layer tree ———————————————————————————————————————————————

/**
 * The twisty, as a real chevron rather than the `▶` this used to be.
 *
 * A text triangle is whatever weight the system font decides, which next to a
 * row of hairline SVG marks is a black wedge; it also sits on the text baseline
 * rather than in the middle of its box, so it needed a nudge that went stale at
 * every zoom. It turns rather than swapping glyph, so opening a row is a motion.
 */
export const TwistyIcon = glyph(chevronDown, 10)

/** What a row *is*: a stack running one way, a grid, a box, or words. */
export const GridIcon = glyph(grid, 11)
export const TextIcon = glyph(typeGlyph, 11)

/**
 * Two blocks and the air between them, which is the whole of what gap means.
 *
 * Drawn as solids rather than as two rules with a dash between: the outline
 * version came out reading as the letter H, which is unfortunate in a panel
 * whose next control along is a height field literally labelled H.
 */
export const GapIcon = () => (
  <Mark>
    <g fill="currentColor">
      <rect x="3.4" y="3.6" width="3.2" height="8.8" rx="1" />
      <rect x="9.4" y="3.6" width="3.2" height="8.8" rx="1" />
    </g>
  </Mark>
)

/** "There is more to this than the one line you can see" — the settings door. */
export const SlidersIcon = glyph(sliders, 12)

// — the element bar ——————————————————————————————————————————————

/**
 * 12, not 14: the bar's drag handle is a deliberately narrow 12px-wide strip, and
 * anything larger overflows it sideways.
 */
export const GripIcon = glyph(gripVertical, 12)
export const BorderIcon = glyph(borderOuter, 12)
/** The same square with its edge described rather than drawn: border off. */
export const NoBorderIcon = glyph(borderStyle, 12)
export const UngroupIcon = glyph(boundingBoxCircles, 12)

/**
 * The four type marks, at 13 rather than 12: they are letterforms rather than
 * diagrams, and a glyph of a letter set one pixel smaller than the icons around
 * it reads as a mistake instead of as a smaller icon.
 */
/** The one mark that stands for "draw something": the tools fold out behind it. */
export const ShapesIcon = glyph(shapes, 13)

export const BoldIcon = glyph(typeBold, 13)
export const ItalicIcon = glyph(typeItalic, 13)
export const UnderlineIcon = glyph(typeUnderline, 13)
export const StrikeIcon = glyph(typeStrikethrough, 13)
export const LinkIcon = glyph(link45deg, 13)

// — the status bar ————————————————————————————————————————————————

export const InfoIcon = glyph(infoCircle, 12)
export const CameraIcon = glyph(camera, 12)
export const PasteIcon = glyph(clipboard, 12)
export const UndoIcon = glyph(arrowCounterclockwise, 12)
export const RedoIcon = glyph(arrowClockwise, 12)
export const XrayIcon = glyph(boundingBox, 12)

/** Accessibility: the universal access mark, which is the one everyone knows. */
export const AdaIcon = glyph(universalAccess, 13)
export const ContrastIcon = glyph(circleHalf, 12)
export const AriaIcon = glyph(tag, 12)
/** An ordered list — the check numbers its findings 1, 2, 3, and so does this. */
export const TabOrderIcon = glyph(listOl, 13)
export const AltTextIcon = glyph(imageAlt, 13)

// — elsewhere ————————————————————————————————————————————————————

/** The whole page as one picture — a document with an image in it. */
export const FullPageIcon = glyph(fileEarmarkImage, 13)

/** Crop marks: the capture you draw the edges of yourself. */
export const RegionIcon = glyph(crop, 13)

/** Put a picture in this box. */
export const ImageIcon = glyph(imageIcon, 12)

export const SearchIcon = glyph(search, 12)
export const FrameIcon = glyph(boundingBox, 13)
export const DownloadIcon = glyph(download, 15)
/** The save button's mark, at the bar's own size. */
export const SaveIcon = glyph(download, 13)
/**
 * The hand-off to an agent. Stars rather than a clipboard: what leaves is not a
 * copy of anything on screen, it is a written brief, and the clipboard mark is
 * already spoken for by the paste pill two controls along.
 */
export const HandoffIcon = glyph(stars, 13)
export const TickIcon = glyph(check, 16)
export const DotsIcon = glyph(threeDots, 15)

/** Text alignment — Bootstrap draws these exactly as a type toolbar wants them. */
export const TEXT_ALIGN_ICONS = {
  left: glyph(textLeft, 12),
  center: glyph(textCenter, 12),
  right: glyph(textRight, 12),
  justify: glyph(justify, 12),
} as const

// — the Figma set ————————————————————————————————————————————————

const DistributeBetweenRow = glyph(distributeHorizontal, 12)
const DistributeBetweenColumn = glyph(distributeVertical, 12)

/**
 * Blocks pinned to both ends with a gap between them (`between`), or spread at
 * equal intervals (`evenly`) — drawn along whichever way the stack runs.
 *
 * Bootstrap covers `between` on both axes and has nothing for `evenly`, so that
 * half stays hand-drawn rather than borrowing a mark that means something else.
 */
export function DistributeIcon({ axis, mode }: { axis: Axis; mode: Distribution }) {
  if (mode === 'between') {
    return axis === 'row' ? <DistributeBetweenRow /> : <DistributeBetweenColumn />
  }

  const spans = [
    [1, 2.4],
    [4.8, 2.4],
    [8.6, 2.4],
  ]
  const thickness = 7
  const cross = (12 - thickness) / 2
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {spans.map(([start, length], index) => (
        <rect
          key={index}
          x={axis === 'row' ? start : cross}
          y={axis === 'row' ? cross : start}
          width={axis === 'row' ? length : thickness}
          height={axis === 'row' ? thickness : length}
          rx="1"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

/**
 * Two blocks on a line and a third dropped onto the next one — a row that ran out
 * of room. Bootstrap's `text-wrap` was tried here and reads as a *typographic*
 * setting, which is the wrong idea: this control wraps boxes, not sentences.
 */
export const WrapIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor" />
    <rect x="7" y="1" width="4" height="4" rx="1" fill="currentColor" />
    <rect x="1" y="7" width="4" height="4" rx="1" fill="currentColor" />
  </svg>
)

/** Two blocks side by side or one above the other: auto-layout's direction. */
export const StackIcon = ({ axis }: { axis: Axis }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    {axis === 'row' ? (
      <>
        <rect x="1" y="2" width="4" height="8" rx="1" fill="currentColor" />
        <rect x="7" y="2" width="4" height="8" rx="1" fill="currentColor" />
      </>
    ) : (
      <>
        <rect x="2" y="1" width="8" height="4" rx="1" fill="currentColor" />
        <rect x="2" y="7" width="8" height="4" rx="1" fill="currentColor" />
      </>
    )}
  </svg>
)

/**
 * A rule on the edge being aligned to, with two bars of different lengths pushed
 * against it — the same shorthand Figma uses, so it reads without a legend.
 */
export function AlignIcon({ axis, pos }: { axis: 'h' | 'v'; pos: AlignPos }) {
  const bars = [7, 4]
  const rule = pos === 'start' ? 0.5 : pos === 'end' ? 11.5 : 6
  const offset = (length: number) =>
    pos === 'start' ? 1.5 : pos === 'end' ? 10.5 - length : 6 - length / 2

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {axis === 'h' ? (
        <>
          <rect x={rule - 0.5} y="1" width="1" height="10" rx="0.5" fill="currentColor" />
          {bars.map((length, index) => (
            <rect
              key={index}
              x={offset(length)}
              y={3 + index * 4}
              width={length}
              height="2.5"
              rx="1"
              fill="currentColor"
              opacity="0.75"
            />
          ))}
        </>
      ) : (
        <>
          <rect x="1" y={rule - 0.5} width="10" height="1" rx="0.5" fill="currentColor" />
          {bars.map((length, index) => (
            <rect
              key={index}
              x={3 + index * 4}
              y={offset(length)}
              width="2.5"
              height={length}
              rx="1"
              fill="currentColor"
              opacity="0.75"
            />
          ))}
        </>
      )}
    </svg>
  )
}

/**
 * The selection frame's move grip — the same Bootstrap 6-dot mark the floating
 * panels carry, so "pick this up and move it" is one gesture with one icon
 * wherever it appears. It inherits `currentColor`, which is the white the chip
 * under it sets.
 */
export const SelectionGripIcon = glyph(gripVertical, 11)

// — the box model, drawn (not Bootstrap) —————————————————————————

/**
 * Figma's vocabulary for the quantities that have four of everything.
 *
 * Padding, margin and corner radius are each one name over four numbers, and the
 * only way a dense bar can say *which* of the four a field edits is to draw it:
 * the box, with the edge or the corner in question picked out. Bootstrap has no
 * equivalent set, and the alternative — labelling them "T", "R", "B", "L" —
 * turns a row of controls into a crossword. Anyone arriving from Figma reads
 * these without a legend, which is the same argument the align and stack marks
 * above are drawn on.
 *
 * All of them are outlines at 30% with the subject at full strength, so the
 * mark reads as "this part of that box" at 13px rather than as a texture.
 */
export type BoxEdge = 'top' | 'right' | 'bottom' | 'left'
export type BoxCorner = 'tl' | 'tr' | 'br' | 'bl'

const EDGE_LINE: Record<BoxEdge, { x1: number; y1: number; x2: number; y2: number }> = {
  top: { x1: 4.6, y1: 4.2, x2: 11.4, y2: 4.2 },
  bottom: { x1: 4.6, y1: 11.8, x2: 11.4, y2: 11.8 },
  left: { x1: 4.2, y1: 4.6, x2: 4.2, y2: 11.4 },
  right: { x1: 11.8, y1: 4.6, x2: 11.8, y2: 11.4 },
}

const Mark = ({ children, size = 13 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {children}
  </svg>
)

const Outline = () => (
  <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" stroke="currentColor" strokeOpacity="0.3" />
)

/** A box with some of its edges emphasised — one side, or an opposing pair. */
export const EdgeIcon = ({ edges }: { edges: BoxEdge[] }) => (
  <Mark>
    <Outline />
    {edges.map((edge) => (
      <line
        key={edge}
        {...EDGE_LINE[edge]}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    ))}
  </Mark>
)

const CORNER_PATH: Record<BoxCorner, string> = {
  tl: 'M4.2 10.5V6.2A2 2 0 0 1 6.2 4.2h4.3',
  tr: 'M5.5 4.2h4.3a2 2 0 0 1 2 2v4.3',
  br: 'M11.8 5.5v4.3a2 2 0 0 1-2 2H5.5',
  bl: 'M10.5 11.8H6.2a2 2 0 0 1-2-2V5.5',
}

/** One rounded corner, drawn as the elbow it actually is. */
export const CornerIcon = ({ corner }: { corner: BoxCorner }) => (
  <Mark>
    <path
      d={CORNER_PATH[corner]}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Mark>
)

/**
 * The four-corner bracket. It carries two jobs that turn out to be the same
 * idea: "all four corners at once" on the radius control, and "unfold this into
 * its four parts" on every group that has parts — a frame around a thing you are
 * about to take apart.
 */
export const CornersIcon = () => (
  <Mark>
    <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 6.4V5.4a1.2 1.2 0 0 1 1.2-1.2h1" />
      <path d="M9.6 4.2h1a1.2 1.2 0 0 1 1.2 1.2v1" />
      <path d="M11.8 9.6v1a1.2 1.2 0 0 1-1.2 1.2h-1" />
      <path d="M6.4 11.8h-1a1.2 1.2 0 0 1-1.2-1.2v-1" />
    </g>
  </Mark>
)

/** A card lifted off the page — the shadow is the point, so it is the darker mark. */
export const ShadowIcon = () => (
  <Mark>
    <path
      d="M6.2 6.2h6.6v6.6"
      stroke="currentColor"
      strokeOpacity="0.35"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <rect
      x="3.4"
      y="3.4"
      width="7.2"
      height="7.2"
      rx="1.6"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </Mark>
)

/** Blur: the same dot, losing its edges. */
export const BlurIcon = () => (
  <Mark>
    {[0, 1, 2].map((row) =>
      [0, 1, 2].map((col) => (
        <circle
          key={`${row}-${col}`}
          cx={4.5 + col * 3.5}
          cy={4.5 + row * 3.5}
          r="1.1"
          fill="currentColor"
          opacity={0.25 + 0.75 / (1 + Math.abs(row - 1) + Math.abs(col - 1))}
        />
      )),
    )}
  </Mark>
)

/** Spread: the shadow pushed outwards on every side. */
export const SpreadIcon = () => (
  <Mark>
    <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.55">
      <path d="M8 3.4v1.2M8 11.4v1.2M3.4 8h1.2M11.4 8h1.2" />
    </g>
  </Mark>
)

/** Opacity, as everything draws it: the checkerboard showing through. */
export const OpacityIcon = () => (
  <Mark>
    <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 3.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor" />
  </Mark>
)

/** The angle being measured — a corner with its arc. */
export const RotationIcon = () => (
  <Mark>
    <path
      d="M4 4v8h8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.6 12A7.6 7.6 0 0 0 4 4.4"
      stroke="currentColor"
      strokeOpacity="0.4"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </Mark>
)

/** A quarter turn, in the direction it turns. */
export const RotateStepIcon = () => (
  <Mark>
    <rect x="4" y="7" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M8.4 5.2A3.4 3.4 0 0 1 12 8.6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M6.8 5.6 8.9 3.9l1.1 2.3z" fill="currentColor" />
  </Mark>
)

/** Two halves about to swap across the dashed axis they mirror in. */
export const FlipIcon = ({ axis }: { axis: Axis }) => (
  <Mark>
    <g transform={axis === 'row' ? undefined : 'rotate(90 8 8)'}>
      <path d="M6.8 4.5 3.2 8l3.6 3.5z" fill="currentColor" />
      <path d="M9.2 4.5 12.8 8l-3.6 3.5z" fill="currentColor" fillOpacity="0.4" />
      <path
        d="M8 2.8v10.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="1.6 1.6"
      />
    </g>
  </Mark>
)

/**
 * Lift: a copy coming up off the page. Two of the same rectangle, the upper one
 * shifted and solid — the mark has to read at 13px as "there are now two of
 * these and one of them is out", which an arrow could not say as quickly.
 */
export const LiftIcon = () => (
  <Mark>
    <rect
      x="3.2"
      y="6.6"
      width="6.2"
      height="6.2"
      rx="1.4"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeOpacity="0.45"
    />
    <rect x="6.6" y="3.2" width="6.2" height="6.2" rx="1.4" fill="currentColor" />
  </Mark>
)
