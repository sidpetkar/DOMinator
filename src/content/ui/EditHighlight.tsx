import { useEffect, useState } from 'react'
import type { Metrics } from '../core/geometry'
import { rememberSelection, selectionRects } from '../core/textEdit'
import { rectStyle } from './util'

/**
 * Keeps the edited text visibly highlighted even after focus moves to the
 * toolbar. The browser drops the native selection at that moment, which is what
 * left the earlier toolbar with no visible target — you could not tell which
 * words a font change was about to hit.
 *
 * The element gets a soft wash; the selected run gets the real highlight.
 */
export function EditHighlight({ el, metrics }: { el: HTMLElement; metrics: Metrics }) {
  const [rects, setRects] = useState(selectionRects)

  useEffect(() => {
    const sync = () => {
      rememberSelection(el)
      setRects(selectionRects())
    }
    document.addEventListener('selectionchange', sync)
    // The page can reflow under the selection (a font swap changes metrics), so
    // re-read on a frame cadence rather than only on selection events.
    const timer = window.setInterval(sync, 120)
    return () => {
      document.removeEventListener('selectionchange', sync)
      window.clearInterval(timer)
    }
  }, [el])

  return (
    <div className="pointer-events-none">
      <div
        style={{
          ...rectStyle(metrics.rect),
          background: 'color-mix(in srgb, var(--color-select) 6%, transparent)',
          outline: '1px solid color-mix(in srgb, var(--color-select) 55%, transparent)',
          outlineOffset: -1,
        }}
      />
      {rects.map((rect, index) => (
        <div
          key={index}
          style={{
            ...rectStyle(rect),
            background: 'color-mix(in srgb, var(--color-select) 28%, transparent)',
            borderRadius: 2,
          }}
        />
      ))}
      <span
        className="absolute rounded-[4px] bg-[color:var(--color-select)] px-1.5 py-[2px] text-[10px] font-medium text-paper"
        style={{
          position: 'fixed',
          top: Math.max(4, metrics.rect.top - 19),
          left: metrics.rect.left,
        }}
      >
        editing {el.tagName.toLowerCase()}
      </span>
    </div>
  )
}
