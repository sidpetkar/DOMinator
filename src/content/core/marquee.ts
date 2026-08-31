import type { Rect } from './geometry'
import { isFrame } from './frames'
import { isTargetable } from './picker'

/**
 * Rubber-band selection: everything the band was drawn across.
 *
 * The hard part is not the intersection test, it is deciding *which* of the
 * dozen nested boxes under the band the user meant. A page is not a flat list of
 * shapes — every element the band touches has a parent it also touches, all the
 * way up to `<body>`, so the naive "everything that intersects" answer selects
 * the whole document every single time. It was tried, and that is exactly what
 * it did: one band across three cards selected the page wrapper.
 *
 * The rule that works is about *coverage*. A box the band has swallowed at least
 * halfway is a box the band is about, and it is taken whole — its own children
 * are not looked at, because you drew a line across three cards and you meant
 * three cards, not their forty spans. Anything the band merely clips is a
 * container the band is passing *through*, so it is stepped into instead, and it
 * is only selected itself if nothing inside it turned out to be a better answer.
 */

const MIN_SIZE = 4

/** Anything past this is a gesture that went wrong, not a selection. */
const LIMIT = 60

/**
 * How much of an element the band has to cover before it counts as selected.
 * Half is generous enough to catch a card the band clipped a corner off in a
 * hurried gesture, and mean enough not to catch the section around it.
 */
const COVER = 0.5

const overlap = (band: Rect, box: DOMRect): number => {
  const w = Math.min(band.left + band.width, box.right) - Math.max(band.left, box.left)
  const h = Math.min(band.top + band.height, box.bottom) - Math.max(band.top, box.top)
  return w > 0 && h > 0 ? w * h : 0
}

export function elementsIn(band: Rect): HTMLElement[] {
  const found: HTMLElement[] = []
  const walk = (el: HTMLElement): void => {
    for (const child of el.children) {
      if (found.length >= LIMIT) return
      if (!isTargetable(child)) continue
      const box = child.getBoundingClientRect()
      if (box.width < MIN_SIZE || box.height < MIN_SIZE) continue
      const area = overlap(band, box)
      if (!area) continue
      /**
       * A canvas object is atomic however little of it the band caught: it is a
       * thing on the surface, and the coverage rule below is about finding your
       * way *into* the page, which an object on the canvas is not part of.
       */
      if (isFrame(child)) {
        found.push(child)
        continue
      }
      if (area / (box.width * box.height) >= COVER) {
        found.push(child)
        continue
      }
      // Clipped rather than covered: look inside, and fall back to the element
      // itself when there is nothing better in there. Without the fallback a
      // band drawn across a box of plain text would select nothing at all.
      const before = found.length
      walk(child)
      if (found.length === before) found.push(child)
    }
  }
  if (document.body) walk(document.body)
  return found
}

/** Two corners to a rect, whichever way round they were dragged. */
export const bandBetween = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  left: Math.min(x1, x2),
  top: Math.min(y1, y2),
  width: Math.abs(x2 - x1),
  height: Math.abs(y2 - y1),
})
