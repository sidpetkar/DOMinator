import arrowCounterclockwise from 'bootstrap-icons/icons/arrow-counterclockwise.svg?raw'
import borderOuter from 'bootstrap-icons/icons/border-outer.svg?raw'
import borderStyle from 'bootstrap-icons/icons/border-style.svg?raw'
import boundingBox from 'bootstrap-icons/icons/bounding-box.svg?raw'
import boundingBoxCircles from 'bootstrap-icons/icons/bounding-box-circles.svg?raw'
import camera from 'bootstrap-icons/icons/camera.svg?raw'
import check from 'bootstrap-icons/icons/check.svg?raw'
import circleHalf from 'bootstrap-icons/icons/circle-half.svg?raw'
import clipboard from 'bootstrap-icons/icons/clipboard.svg?raw'
import distributeHorizontal from 'bootstrap-icons/icons/distribute-horizontal.svg?raw'
import distributeVertical from 'bootstrap-icons/icons/distribute-vertical.svg?raw'
import download from 'bootstrap-icons/icons/download.svg?raw'
import eyedropper from 'bootstrap-icons/icons/eyedropper.svg?raw'
import gripVertical from 'bootstrap-icons/icons/grip-vertical.svg?raw'
import imageAlt from 'bootstrap-icons/icons/image-alt.svg?raw'
import infoCircle from 'bootstrap-icons/icons/info-circle.svg?raw'
import justify from 'bootstrap-icons/icons/justify.svg?raw'
import link45deg from 'bootstrap-icons/icons/link-45deg.svg?raw'
import listOl from 'bootstrap-icons/icons/list-ol.svg?raw'
import paintBucket from 'bootstrap-icons/icons/paint-bucket.svg?raw'
import search from 'bootstrap-icons/icons/search.svg?raw'
import tag from 'bootstrap-icons/icons/tag.svg?raw'
import textCenter from 'bootstrap-icons/icons/text-center.svg?raw'
import textLeft from 'bootstrap-icons/icons/text-left.svg?raw'
import textRight from 'bootstrap-icons/icons/text-right.svg?raw'
import threeDots from 'bootstrap-icons/icons/three-dots.svg?raw'
import universalAccess from 'bootstrap-icons/icons/universal-access.svg?raw'
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
export const LinkIcon = glyph(link45deg, 13)

// — the status bar ————————————————————————————————————————————————

export const InfoIcon = glyph(infoCircle, 12)
export const CameraIcon = glyph(camera, 12)
export const PasteIcon = glyph(clipboard, 12)
export const UndoIcon = glyph(arrowCounterclockwise, 12)
export const XrayIcon = glyph(boundingBox, 12)

/** Accessibility: the universal access mark, which is the one everyone knows. */
export const AdaIcon = glyph(universalAccess, 13)
export const ContrastIcon = glyph(circleHalf, 12)
export const AriaIcon = glyph(tag, 12)
/** An ordered list — the check numbers its findings 1, 2, 3, and so does this. */
export const TabOrderIcon = glyph(listOl, 13)
export const AltTextIcon = glyph(imageAlt, 13)

// — elsewhere ————————————————————————————————————————————————————

export const SearchIcon = glyph(search, 12)
export const FrameIcon = glyph(boundingBox, 13)
export const DownloadIcon = glyph(download, 15)
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
 * The selection frame's move grip, in white on the selection blue.
 *
 * Not Bootstrap's: it sits on a solid chip where a stroked glyph disappears, so it
 * stays a dot matrix — the one mark in the set that has to read as *filled*.
 */
export const SelectionGripIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    {[2, 5, 8].map((y) =>
      [3.5, 6.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="white" />),
    )}
  </svg>
)
