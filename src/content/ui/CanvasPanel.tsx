import { useRef, useState } from 'react'
import * as canvas from '../core/canvas'
import { store } from '../core/store'
import { zoom } from '../core/zoom'
import { ColorPicker } from './ColorPicker'
import { BucketIcon } from './icons'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { dockedBox, zoomStable } from './util'

/**
 * The right-hand panel with nothing selected: the canvas itself.
 *
 * Deselecting used to empty that side of the screen, which reads as the tool
 * having lost its place rather than as "nothing is selected" — and it left the
 * one property that belongs to the canvas rather than to any element with
 * nowhere to live. The surface colour is that property: judging a design
 * against a fixed near-white board is the thing designers stop being able to do
 * about a minute in.
 *
 * Deliberately the same shell as the docked element bar — same width, same
 * offsets, same title row — so the panel does not appear to change size or
 * position as the selection comes and goes. It holds one control today; the
 * shape is what makes room for the rest.
 */
export function CanvasPanel() {
  const [picking, setPicking] = useState(false)
  /** What the hex box is showing while it is being typed into. */
  const [draft, setDraft] = useState<string | null>(null)
  const swatch = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const grip = usePanelDrag('canvas', panelRef)
  const z = zoom() || 1
  const fill = canvas.surface()

  return (
    <div
      ref={panelRef}
      className="dm-panel dm-interactive flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        ...(grip.pinned ? { left: grip.pinned.left, top: grip.pinned.top } : { right: 12, top: 12 }),
        width: 264,
        ...dockedBox(z, false),
        borderRadius: 14,
        // Pinned, the panel is placed by its left edge, so the counter-scale has
        // to shrink toward that corner or it slides sideways as the zoom changes.
        ...zoomStable(z, grip.pinned ? 'top left' : 'top right'),
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight text-ink">
          Canvas
        </span>
        <span className="shrink-0 text-[10px] text-ink-soft">nothing selected</span>
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="w-[52px] shrink-0 text-[10px] text-ink-soft">Surface</span>
        <div ref={swatch} className="relative flex items-center gap-1.5">
          <button
            type="button"
            title="The colour of the surface behind the frame"
            aria-label="Surface colour"
            onClick={() => setPicking((open) => !open)}
            className="grid h-[24px] w-[26px] shrink-0 place-items-center rounded-[var(--radius-pill)] border-0 bg-transparent text-[12px] leading-none text-ink hover:bg-ink/5"
          >
            <BucketIcon />
            {/* The chosen colour, under the glyph: the same way the element
                bar's fill button says what it is currently set to. */}
            <span
              aria-hidden
              className="absolute bottom-[2px] h-[3px] w-[14px] rounded-[2px]"
              style={{ background: fill, boxShadow: 'inset 0 0 0 1px rgba(11,11,12,.18)' }}
            />
          </button>
          {/**
           * Typed, not only picked.
           *
           * A hex is how anyone who has a colour already *has* it — out of a
           * brand palette, a Figma inspector, a ticket — and making them open a
           * picker and drag a crosshair to arrive at a number they could read
           * out loud is the wrong end of the tool. The draft is held separately
           * from the value because "#ff" is a legitimate thing to have typed on
           * the way to "#ff0000": only the parseable states are applied, and the
           * field stops fighting the user's cursor.
           */}
          <input
            value={draft ?? fill}
            onChange={(event) => {
              const next = event.target.value
              setDraft(next)
              const hex = next.trim().replace(/^#?/, '#')
              if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) canvas.setSurface(hex)
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') setDraft(null)
            }}
            spellCheck={false}
            aria-label="Surface colour as hex"
            className="dm-field w-[80px] rounded-[6px] border border-line bg-paper px-1.5 py-[3px] text-[11px] text-ink tabular-nums"
          />

          {picking && (
            <ColorPicker
              value={fill}
              showContrast={false}
              dropUp={false}
              align="right"
              onClose={() => setPicking(false)}
              /**
               * Written straight to the canvas rather than through styles.ts, and
               * so never onto the undo stack or the Reset count: the board a
               * design is being viewed against is not an edit to the design. It
               * is the same posture canvas.ts takes with every other declaration
               * it puts on `html`.
               */
              onChange={(color) => {
                setDraft(null)
                canvas.setSurface(color)
              }}
              onReset={() => {
                setDraft(null)
                canvas.resetSurface()
                store.touch()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
