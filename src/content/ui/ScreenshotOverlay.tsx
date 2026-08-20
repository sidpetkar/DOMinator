import type { PointerEvent as ReactPointerEvent } from 'react'
import { controller } from '../core/controller'
import { beginRegion, toViewportRect, type ShotState } from '../core/screenshot'
import { zoom } from '../core/zoom'
import { zoomStable } from './util'

/**
 * The capture surface: the page dimmed, with the chosen region punched clear.
 *
 * The hole is one element with an enormous spread shadow rather than four
 * separate mattes — a single box that can't develop seams as it resizes, and it
 * costs one composited layer instead of four.
 *
 * The region is held in document coordinates and converted here, which is why it
 * stays glued to the content while the page auto-scrolls underneath a drag.
 */
export function ScreenshotOverlay({ shot }: { shot: ShotState }) {
  const { phase, rect } = shot
  const viewport = rect ? toViewportRect(rect) : null

  const onDown = (event: ReactPointerEvent) => {
    if (phase === 'busy') return
    beginRegion(event.nativeEvent, (region) => void controller.finishScreenshot(region))
  }

  return (
    <div
      className="dm-interactive"
      onPointerDown={onDown}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: phase === 'busy' ? 'progress' : 'crosshair',
        // No dim of its own: the hole below paints it, so there is never a
        // double-darkened band where two layers overlap.
        background: viewport ? 'transparent' : 'rgba(11, 11, 12, 0.24)',
      }}
    >
      {viewport && (
        <div
          style={{
            position: 'fixed',
            top: viewport.top,
            left: viewport.left,
            width: viewport.width,
            height: viewport.height,
            boxShadow: '0 0 0 100vmax rgba(11, 11, 12, 0.24)',
            outline: '1px solid rgba(255,255,255,0.9)',
            cursor: phase === 'busy' ? 'progress' : 'crosshair',
          }}
        >
          <span
            className="dm-panel absolute px-1.5 py-[2px] text-[10px] font-medium text-ink tabular-nums"
            style={{
              top: viewport.height + 6,
              left: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {Math.round(viewport.width)} × {Math.round(viewport.height)}
            {phase === 'busy' && ' · capturing…'}
          </span>
        </div>
      )}

      {!rect && (
        <div
          className="dm-panel absolute px-3 py-1.5 text-[11px] text-ink"
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            borderRadius: 'var(--radius-pill)',
            ...zoomStable(zoom(), 'top center', 'translateX(-50%)'),
          }}
        >
          Drag to capture · drag past the top or bottom edge to keep going · Esc cancels
        </div>
      )}
    </div>
  )
}
