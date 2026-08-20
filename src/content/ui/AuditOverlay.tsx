import { useEffect, useState } from 'react'
import { liveFindings, liveIssues, liveStops } from '../core/audit'
import { rgbToHex } from '../core/color'
import { controller } from '../core/controller'
import type { Rect } from '../core/geometry'
import type { Lens } from '../core/store'
import { zoom } from '../core/zoom'
import { rectStyle, zoomStable } from './util'

/**
 * What an accessibility check looks like: the page dimmed, the elements it found
 * punched clear of the dim, and each one boxed with its name and a number.
 *
 * Both checks render through here because they are the same idea pointed at
 * different questions — a set of elements, a badge each, and everything else
 * pushed into the background. Contrast marks what is *wrong* (red, with the
 * ratio); tab order marks a *sequence* (blue, with the position). Neither is a
 * live projection: they are scans, re-run when the page settles.
 */

const TONES = {
  fail: '#e5484d',
  /** The sequence itself — the same blue as the selection, since it is neutral. */
  order: '#0a84ff',
  /** A positive `tabindex`: not broken, but the thing that breaks tab order. */
  warn: '#f6853f',
} as const

type Tone = keyof typeof TONES

/** One element to draw, whichever check produced it. */
interface Marker {
  el: HTMLElement
  /** `div.card#hero` — the name on the left of the label. */
  name: string
  /** The number on the right: a ratio, or a position in the sequence. */
  badge: string
  tone: Tone
  title: string
}

function markersFor(lens: Lens): Marker[] {
  if (lens.kind === 'contrast') {
    return liveFindings(lens.audit.findings).map((finding) => ({
      el: finding.el,
      name: finding.label,
      badge: `${finding.ratio.toFixed(1)}:1`,
      tone: 'fail',
      title: `${finding.label} — ${finding.ratio.toFixed(2)}:1, needs ${finding.required}:1 (${
        finding.kind === 'graphic' ? 'icon' : 'text'
      } ${rgbToHex(finding.foreground)} on ${rgbToHex(finding.background)}). Click to select and fix.`,
    }))
  }
  if (lens.kind === 'aria' || lens.kind === 'alt') {
    return liveIssues(lens.audit.issues).map((issue) => ({
      el: issue.el,
      name: issue.label,
      badge: issue.reason,
      tone: issue.tone,
      title: `${issue.detail} Click to select.`,
    }))
  }

  return liveStops(lens.audit.stops).map((stop) => ({
    el: stop.el,
    name: describeStop(stop.el),
    badge: String(stop.index),
    tone: stop.tabIndex > 0 ? 'warn' : 'order',
    title:
      `Tab stop ${stop.index} — ${describeStop(stop.el)}` +
      (stop.tabIndex > 0
        ? `. tabindex="${stop.tabIndex}" pulls it in front of everything without one.`
        : stop.explicit
          ? '. tabindex="0" — focusable by choice.'
          : '.') +
      ' Click to select.',
  }))
}

/**
 * Tab stops are named by what they are to a keyboard user, not by their classes:
 * "button · Reconnect" says more about a stop than `button.cta` does.
 */
function describeStop(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  const text =
    el.getAttribute('aria-label') ??
    (el instanceof HTMLInputElement ? el.type : '') ??
    ''
  const label = (text || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
  return label ? `${tag} · ${label}` : tag
}

export function AuditOverlay({ lens }: { lens: Lens }) {
  useViewportTick()
  const markers = markersFor(lens)
  const onScreen = markers.filter((marker) => {
    const box = marker.el.getBoundingClientRect()
    return box.bottom > -40 && box.top < window.innerHeight + 40
  })

  return (
    <>
      <Scrim holes={onScreen.map((marker) => marker.el.getBoundingClientRect())} />
      {onScreen.map((marker, index) => (
        <Box key={index} marker={marker} />
      ))}
    </>
  )
}

const DIM = 'rgba(11, 11, 12, 0.55)'
/** Breathing room around each hole, so a box's own border isn't dimmed. */
const HOLE_PAD = 2

/**
 * The page pushed into the background, with the findings cut out of it.
 *
 * One SVG with a mask rather than the giant `box-shadow` trick the screenshot
 * marquee uses: that punches exactly one hole, and several overlapping spreads
 * would darken their overlaps twice over. A mask handles any number of holes in a
 * single composited layer, and the holes can overlap freely.
 */
function Scrim({ holes }: { holes: Rect[] | DOMRect[] }) {
  return (
    <svg
      className="pointer-events-none"
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }}
    >
      <defs>
        <mask id="dm-audit-holes">
          {/* White keeps the dim, black cuts it away. */}
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {[...holes].map((hole, index) => (
            <rect
              key={index}
              x={hole.left - HOLE_PAD}
              y={hole.top - HOLE_PAD}
              width={hole.width + HOLE_PAD * 2}
              height={hole.height + HOLE_PAD * 2}
              rx="3"
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill={DIM} mask="url(#dm-audit-holes)" />
    </svg>
  )
}

/**
 * Re-renders on scroll and resize.
 *
 * The markers hold element references, so both the boxes and the scrim's holes
 * are measured at paint time — which means the overlay has to be told when the
 * page has moved beneath it. Coalesced onto a frame because scroll events arrive
 * far faster than frames, and every one of them would otherwise force a layout
 * read per marker.
 */
function useViewportTick(): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    let frame = 0
    const onChange = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setTick((n) => n + 1)
      })
    }
    window.addEventListener('scroll', onChange, { capture: true, passive: true })
    window.addEventListener('resize', onChange, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [])
}

function Box({ marker }: { marker: Marker }) {
  const box = marker.el.getBoundingClientRect()
  const rect = { top: box.top, left: box.left, width: box.width, height: box.height }
  const colour = TONES[marker.tone]
  // Tucked under the top edge when the box is at the very top of the viewport,
  // where a label sitting above it would be clipped off screen.
  const inside = box.top < 22

  return (
    <div style={rectStyle(rect)} className="pointer-events-none">
      <div className="absolute inset-0" style={{ border: `2px solid ${colour}` }} />
      <button
        type="button"
        title={marker.title}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => controller.select(marker.el)}
        className="dm-interactive absolute flex cursor-pointer items-center gap-1 rounded-[4px] border-0 px-1.5 py-[2px] text-[10px] leading-none font-medium whitespace-nowrap text-paper"
        style={{
          right: 0,
          top: inside ? 1 : -19,
          maxWidth: 260,
          background: colour,
          ...zoomStable(zoom(), inside ? 'top right' : 'bottom right'),
        }}
      >
        <span className="overflow-hidden text-ellipsis">{marker.name}</span>
        <span className="shrink-0 rounded-[3px] bg-paper/25 px-1 tabular-nums">{marker.badge}</span>
      </button>
    </div>
  )
}
