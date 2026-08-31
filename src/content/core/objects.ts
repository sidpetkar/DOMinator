import * as canvas from './canvas'
import * as frames from './frames'
import * as history from './history'
import { store } from './store'

/**
 * Text and shapes: things you put on the canvas that were never in the page.
 *
 * They are ordinary elements dressed as variations, which is why this file is
 * twenty lines rather than a subsystem. A canvas object needs to be positioned
 * on the surface, moved, resized, recoloured, typed into and deleted — and
 * `frames.ts` already gives the first two while the element bar, the text
 * editor, the selection handles and the undo stack give the rest, to anything
 * that is an element on the page. Inventing a shape *model* would mean
 * re-implementing every one of those for objects that are not elements.
 *
 * So a rectangle here is a `div` with a background, and a text object is a `div`
 * with words in it. Double-click already edits text; the handles already resize;
 * Delete already removes. Nothing new had to learn about them.
 */

export type ObjectKind = 'text' | 'rect' | 'ellipse' | 'line'

/** Enough to see and to grab, without being a wall on a zoomed-out canvas. */
const SIZE: Record<ObjectKind, { width: number; height: number }> = {
  text: { width: 240, height: 0 },
  rect: { width: 200, height: 140 },
  ellipse: { width: 160, height: 160 },
  line: { width: 240, height: 0 },
}

const FILL = '#0a84ff'

function build(kind: ObjectKind): HTMLElement {
  const el = document.createElement('div')
  const { height } = SIZE[kind]
  const set = (decls: Record<string, string>) => {
    for (const [prop, value] of Object.entries(decls)) el.style.setProperty(prop, value, 'important')
  }
  if (kind === 'text') {
    el.textContent = 'Text'
    /**
     * Its own type declarations rather than the page's: a text object dropped on
     * a site whose `div` inherits 11px grey would arrive as an unreadable smudge
     * and look like a bug rather than like something you just made.
     */
    set({
      font: '600 28px/1.25 ui-sans-serif, system-ui, sans-serif',
      color: '#0b0b0c',
      'text-align': 'left',
    })
  } else if (kind === 'line') {
    set({ height: '2px', background: '#0b0b0c' })
  } else {
    set({
      height: `${height}px`,
      background: FILL,
      'border-radius': kind === 'ellipse' ? '50%' : '6px',
    })
  }
  return el
}

/**
 * Puts a new object on the surface at the given canvas rect.
 *
 * Drawn rather than dropped, which is the difference between a tool and a
 * button: picking the rectangle tool and having a 200×140 blue box land in the
 * middle of the view means the first thing you do with every shape you make is
 * move and resize it. Dragging out the box you wanted is one gesture instead of
 * three, and it is the gesture every drawing tool ever made has used.
 *
 * A size is optional because a *click* is a legitimate way to use a shape tool
 * too — Figma's own behaviour — and it means "the default size, here".
 */
export function insert(
  kind: ObjectKind,
  at?: { x: number; y: number },
  size?: { width: number; height: number },
): HTMLElement | null {
  if (!canvas.active() || !document.body) return null
  const el = build(kind)
  const width = Math.max(size?.width ?? SIZE[kind].width, 8)
  // Appended before being measured: an element out of the document has no
  // height, and a text object's height is whatever its line box turns out to be.
  document.body.append(el)
  frames.dressAsObject(el, width)
  /**
   * A dragged height is honoured for everything except text, whose height is its
   * type — a text box forced to 300px tall with one line in it is a mystery
   * rectangle you cannot see the edges of.
   */
  if (size && kind !== 'text') {
    el.style.setProperty('height', `${Math.max(size.height, kind === 'line' ? 2 : 8)}px`, 'important')
  }
  const spot = at ?? centred(width, el.offsetHeight)
  frames.place(el, spot.x, spot.y)
  history.recordInsert(`add ${kind}`, [el])
  store.set(history.depths())
  return el
}

/** The middle of the view: where a click with no drag puts things. */
function centred(width: number, height: number): { x: number; y: number } {
  const [cx, cy] = canvas.viewCentre()
  return { x: cx - width / 2, y: cy - height / 2 }
}
