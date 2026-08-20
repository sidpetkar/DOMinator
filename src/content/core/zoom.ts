import { askBackground } from '@/shared/messages'
import { store } from './store'

/**
 * Browser zoom, so our chrome can hold a constant physical size.
 *
 * Zooming out shrinks a CSS pixel, and every panel we draw is specified in CSS
 * pixels — so at 50% the toolbars come out half-size and unusable, exactly when
 * the user zoomed out to see more of the page. Counter-scaling by 1/zoom keeps
 * them the size they were.
 *
 * Note this deliberately does *not* apply to the overlays that trace page
 * elements. Those must keep matching the geometry they describe, and CSS-pixel
 * coordinates already do that at any zoom.
 */
let current = 1

export const zoom = (): number => current

/**
 * chrome.tabs.getZoom is the authoritative answer; devicePixelRatio only gives a
 * ratio against whatever it was when we started, which is wrong if the page was
 * already zoomed before the editor was switched on.
 */
async function readZoom(baseline: number): Promise<number> {
  const response = await askBackground({ type: 'zoom:get' })
  if ('ok' in response && response.ok && 'zoom' in response) return response.zoom
  return window.devicePixelRatio / baseline
}

export function watchZoom(): () => void {
  const baseline = window.devicePixelRatio
  let timer = 0

  const sync = async () => {
    const next = await readZoom(baseline)
    if (!Number.isFinite(next) || next <= 0) return
    if (Math.abs(next - current) < 0.005) return
    current = next
    store.touch()
  }

  const schedule = () => {
    window.clearTimeout(timer)
    // Zoom fires a burst of resizes; settle before asking the worker.
    timer = window.setTimeout(() => void sync(), 80)
  }

  void sync()
  window.addEventListener('resize', schedule)
  return () => {
    window.clearTimeout(timer)
    window.removeEventListener('resize', schedule)
    current = 1
  }
}
