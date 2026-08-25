import { HOST_ID, OWN_NODE_ATTR } from '@/shared/constants'
import { askBackground } from '@/shared/messages'
import { pageScroller, scrollerAt, toClient, toContent, type Scroller } from './scroller'
import { store } from './store'

/**
 * A region in the *scroller's content* space, so it survives the content moving
 * under it — whether that's the window scrolling or an inner pane.
 */
export interface ShotRect {
  left: number
  top: number
  width: number
  height: number
}

export type ShotPhase = 'arm' | 'drag' | 'busy'

export interface ShotState {
  phase: ShotPhase
  rect: ShotRect | null
}

/**
 * Which element the current capture scrolls. Set when the drag starts and read
 * by both the overlay (to place the marquee) and the capture (to walk tiles),
 * so all three agree on one coordinate space.
 */
let active: Scroller = pageScroller()

/** Marquee position in viewport coordinates, for drawing. */
export function toViewportRect(rect: ShotRect): ShotRect {
  const [left, top] = toClient(active, rect.left, rect.top)
  return { left, top, width: rect.width, height: rect.height }
}

// — selection ————————————————————————————————————————————————

const EDGE_ZONE = 64
const MAX_SCROLL_SPEED = 26

/**
 * How fast to scroll when the cursor is in an edge zone: zero in the middle,
 * ramping to full speed at the very edge, so the user modulates it by how far
 * they push rather than it being on/off.
 */
function scrollSpeed(position: number, start: number, size: number): number {
  const offset = position - start
  if (offset < EDGE_ZONE) return -Math.ceil(((EDGE_ZONE - offset) / EDGE_ZONE) * MAX_SCROLL_SPEED)
  const fromEnd = size - offset
  if (fromEnd < EDGE_ZONE) return Math.ceil(((EDGE_ZONE - fromEnd) / EDGE_ZONE) * MAX_SCROLL_SPEED)
  return 0
}

const rectBetween = (ax: number, ay: number, bx: number, by: number): ShotRect => ({
  left: Math.min(ax, bx),
  top: Math.min(ay, by),
  width: Math.abs(ax - bx),
  height: Math.abs(ay - by),
})

/**
 * Drives the marquee. The anchor and the cursor are both tracked in the
 * scroller's content coordinates, which is what makes "drag past the edge" work:
 * the content moves underneath, the anchor stays pinned to what it was placed
 * on, and the region simply keeps growing. A viewport-relative anchor would
 * slide with the scroll and the selection could never exceed one screen.
 *
 * The edge zone is measured against the *scroller's* box rather than the
 * viewport, so on a page with a fixed header the trigger sits at the bottom of
 * the scrolling pane where the cursor actually is.
 */
export function beginRegion(event: PointerEvent, onDone: (rect: ShotRect) => void): void {
  event.preventDefault()
  event.stopPropagation()

  active = scrollerAt(event.clientX, event.clientY)
  const [anchorX, anchorY] = toContent(active, event.clientX, event.clientY)
  let clientX = event.clientX
  let clientY = event.clientY
  let frame = 0

  const tick = () => {
    const dy = scrollSpeed(clientY, active.originY(), active.height())
    const dx = scrollSpeed(clientX, active.originX(), active.width())
    if (dy || dx) active.scrollBy(dx, dy)

    const [x, y] = toContent(active, clientX, clientY)
    store.set({ shot: { phase: 'drag', rect: rectBetween(anchorX, anchorY, x, y) } })
    frame = requestAnimationFrame(tick)
  }

  const onMove = (e: PointerEvent) => {
    clientX = e.clientX
    clientY = e.clientY
  }

  const onUp = () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    const [x, y] = toContent(active, clientX, clientY)
    const rect = rectBetween(anchorX, anchorY, x, y)
    if (rect.width < 4 || rect.height < 4) {
      store.set({ shot: { phase: 'arm', rect: null } })
      return
    }
    onDone(rect)
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  frame = requestAnimationFrame(tick)
}

/**
 * The whole document, as a region on the page scroller — the one-click capture.
 *
 * Width is the viewport rather than the document's `scrollWidth`. A page's
 * scrollable width is inflated by any single overflowing element — a decorative
 * blob, a wide table, an off-canvas drawer parked to the right — far more often
 * than it reflects content anyone wants in the picture, and the cost of getting
 * that wrong is a shot that is mostly empty margin. Height is the opposite case:
 * a long page is exactly what this button is for.
 */
export function fullPage(): ShotRect {
  active = pageScroller()
  const doc = document.scrollingElement ?? document.documentElement
  return {
    left: 0,
    top: 0,
    width: Math.min(window.innerWidth, doc.scrollWidth),
    height: Math.max(doc.scrollHeight, window.innerHeight),
  }
}

// — capture ——————————————————————————————————————————————————

const settle = (ms = 90): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, ms)))
  })

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('tile decode failed'))
    image.src = dataUrl
  })
}

/**
 * Our own overlay would otherwise be photographed along with the page — the dim
 * layer, the status bar, the selection frame. Hidden for the duration and put
 * back afterwards.
 */
function hideOwnUi(): () => void {
  const host = document.getElementById(HOST_ID)
  const previous = host?.style.display ?? ''
  if (host) host.style.display = 'none'
  return () => {
    if (host) host.style.display = previous
  }
}

/**
 * Sticky and fixed furniture is pinned to the viewport, so it would be captured
 * again in every tile and appear repeatedly down a long screenshot. Pinning is
 * removed for the capture and restored precisely afterwards.
 *
 * The two cases need different answers, which is the whole of the sticky bug: a
 * sticky element is *in* the flow and its siblings are laid out around the space
 * it occupies. Sending it to `absolute` — as this did for both — takes it out of
 * flow, so everything below jumped up by the header's height the moment the
 * capture began. The tiles were then photographed against a page that no longer
 * matched the region the user had dragged, and the result came out sheared, with
 * a band of content missing or repeated at each tile seam.
 *
 * `static` is the right answer for sticky: it stops sticking, keeps its space,
 * and appears exactly once at the point in the page it belongs to. `fixed` was
 * never in flow to begin with, so `absolute` moves it nowhere and it lands once
 * at the top where a header is expected.
 *
 * These writes bypass styles.ts on purpose: they are not user edits and must
 * never reach the undo stack or the Reset count. The priority is captured with
 * the value because a page that set `position: sticky !important` would
 * otherwise come back from a screenshot with its header no longer sticking.
 */
function unpinFixed(): () => void {
  const touched: { el: HTMLElement; value: string; priority: string }[] = []
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    const position = window.getComputedStyle(el).position
    if (position !== 'fixed' && position !== 'sticky') continue
    touched.push({
      el,
      value: el.style.getPropertyValue('position'),
      priority: el.style.getPropertyPriority('position'),
    })
    el.style.setProperty('position', position === 'sticky' ? 'static' : 'absolute', 'important')
    if (touched.length > 400) break
  }
  return () => {
    for (const { el, value, priority } of touched) {
      el.style.removeProperty('position')
      if (value) el.style.setProperty('position', value, priority)
    }
  }
}

/** Chrome refuses canvases beyond ~268M pixels; stay well inside that. */
const MAX_PIXELS = 220_000_000
const MAX_SIDE = 16_000

export type ShotOutcome =
  | { ok: true; how: 'clipboard' | 'download' }
  | { ok: false; error: string }

/**
 * Photographs a region of any height by scrolling it through the viewport.
 *
 * captureVisibleTab only ever returns what is on screen, so the region is walked
 * one scroller-height at a time, each tile drawn into a canvas at its offset
 * within the region. The device pixel ratio is derived from the first tile
 * rather than assumed, because a captured tile comes back at the display's real
 * resolution.
 */
export async function captureRegion(rect: ShotRect): Promise<ShotOutcome> {
  const scroller = active
  const originScrollX = scroller.x()
  const originScrollY = scroller.y()
  const restoreUi = hideOwnUi()
  const tall = rect.height > scroller.height()
  const restorePins = tall ? unpinFixed() : () => {}

  try {
    const stepX = scroller.width()
    const stepY = scroller.height()

    scroller.scrollTo(Math.min(rect.left, scroller.maxX()), Math.min(rect.top, scroller.maxY()))
    await settle(120)
    const first = await grab()
    if (!first) return { ok: false, error: 'capture refused' }
    const scale = first.width / window.innerWidth

    let output = scale
    let outWidth = Math.round(rect.width * scale)
    let outHeight = Math.round(rect.height * scale)
    // Extremely long regions can exceed the canvas limit; shrink rather than fail.
    const overrun = Math.max(
      (outWidth * outHeight) / MAX_PIXELS,
      outWidth / MAX_SIDE,
      outHeight / MAX_SIDE,
      1,
    )
    if (overrun > 1) {
      output = scale / overrun
      outWidth = Math.round(rect.width * output)
      outHeight = Math.round(rect.height * output)
    }

    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, error: 'no 2d context' }

    let tile: HTMLImageElement | null = first

    for (let y = rect.top; y < rect.top + rect.height; y += stepY) {
      for (let x = rect.left; x < rect.left + rect.width; x += stepX) {
        // Near the content's end the scroll clamps, so the slice we want starts
        // further into the tile than the loop position alone would suggest.
        const sx = Math.min(x, scroller.maxX())
        const sy = Math.min(y, scroller.maxY())
        if (tile === null || Math.abs(scroller.x() - sx) > 0.5 || Math.abs(scroller.y() - sy) > 0.5) {
          scroller.scrollTo(sx, sy)
          await settle()
          tile = await grab()
          if (!tile) return { ok: false, error: 'capture refused mid-scroll' }
        }

        const [clientX, clientY] = toClient(scroller, x, y)
        const availW = Math.min(stepX - (x - sx), rect.left + rect.width - x)
        const availH = Math.min(stepY - (y - sy), rect.top + rect.height - y)
        if (availW <= 0 || availH <= 0) continue

        ctx.drawImage(
          tile,
          clientX * scale,
          clientY * scale,
          availW * scale,
          availH * scale,
          (x - rect.left) * output,
          (y - rect.top) * output,
          availW * output,
          availH * output,
        )
        tile = null // the next position needs its own capture
      }
    }

    return await deliver(canvas)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    restorePins()
    scroller.scrollTo(originScrollX, originScrollY)
    restoreUi()
  }
}

async function grab(): Promise<HTMLImageElement | null> {
  const response = await askBackground({ type: 'capture:viewport' })
  if (!('ok' in response) || !response.ok || !('data' in response)) return null
  return loadImage(response.data)
}

/**
 * Clipboard first, since that is what the gesture promises. It can legitimately
 * fail — writing an image needs the document focused and, on a long capture, the
 * user activation may have expired while we scrolled — so a PNG download is the
 * fallback rather than losing the shot.
 */
async function deliver(canvas: HTMLCanvasElement): Promise<ShotOutcome> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return { ok: false, error: 'encode failed' }

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return { ok: true, how: 'clipboard' }
  } catch {
    const link = document.createElement('a')
    /**
     * Ours, not the page's. Without this the editor treats the link's own
     * synthetic click as a click on the page: it swallows it — which cancels the
     * download, so the fallback quietly delivered nothing — and then selects
     * whatever happens to sit at (0, 0), because a dispatched click carries no
     * real coordinates. The whole point of the fallback is to not lose a capture
     * the clipboard refused, and it was losing every one of them.
     */
    link.setAttribute(OWN_NODE_ATTR, '')
    link.href = URL.createObjectURL(blob)
    link.download = `dominator-screenshot-${canvas.width}x${canvas.height}.png`
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
    return { ok: true, how: 'download' }
  }
}
