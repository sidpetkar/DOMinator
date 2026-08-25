import { useRef, useState } from 'react'
import { readBox } from '../core/box'
import { controller } from '../core/controller'
import { plan } from '../core/group'
import type { Rect } from '../core/geometry'
import type { Node } from '../core/store'
import { zoom } from '../core/zoom'
import { ColorPicker } from './ColorPicker'
import { BucketIcon, FrameIcon } from './icons'
import { PanelGrip, usePanelDrag } from './PanelGrip'
import { cx, zoomStable } from './util'

/**
 * What a multi-selection can do: fill it, and wrap it.
 *
 * A multi-selection is otherwise deliberately a comparison view with no controls
 * (see MeasureChrome) — every styling tool needs one unambiguous target. These
 * two are the exceptions, and for the same reason: their subject is the *set*
 * rather than a member of it. Grouping takes several elements and produces the
 * single parent the align and stack controls have been waiting for; a fill is
 * the one property you genuinely mean to state about all of them at once.
 *
 * When the set can't be grouped the fill stays and the Group button is replaced
 * by the reason. A key that silently does nothing is worse than one that
 * explains itself, and the reason is always actionable — put them in the same
 * container first.
 */
export function GroupPrompt({ nodes }: { nodes: Node[] }) {
  const [picking, setPicking] = useState(false)
  /**
   * This prompt is centred on the set, so its fill button can end up anywhere
   * across the window — including close enough to the left edge that a panel
   * hanging that way would be half off screen. Measured at the moment the picker
   * opens, which is the only moment the answer matters.
   */
  const fillRef = useRef<HTMLDivElement>(null)
  const room = fillRef.current?.getBoundingClientRect().right ?? window.innerWidth
  const panelRef = useRef<HTMLDivElement>(null)
  const grip = usePanelDrag('group', panelRef)
  const check = plan(nodes.map((node) => node.el))
  const box = union(nodes.map((node) => node.metrics.rect))

  /**
   * The swatch shows a colour only when the set agrees on one. Three cards in
   * three colours have no single fill to display, and showing the primary's
   * would be a quiet lie about what the other two are — so it reads as "no one
   * colour" until the fill actually makes them agree.
   */
  const fills = nodes.map((node) => readBox(node.el).background)
  const common = fills.every((fill) => fill === fills[0]) ? fills[0] : null

  // Below the set, unless it runs to the bottom of the window — the members'
  // own size readouts already sit just under each rect, so this clears them.
  const below = box.top + box.height + 42
  const top = below > window.innerHeight - 40 ? Math.max(12, box.top - 46) : below
  const anchoredLeft = Math.min(Math.max(box.left + box.width / 2, 140), window.innerWidth - 140)
  const dropUp = (grip.pinned ? grip.pinned.top : top) > window.innerHeight - 260

  return (
    <div
      ref={panelRef}
      className="dm-panel dm-interactive flex items-center gap-1.5 py-1 pr-1 pl-2"
      style={{
        position: 'fixed',
        top: grip.pinned ? grip.pinned.top : top,
        left: grip.pinned ? grip.pinned.left : anchoredLeft,
        borderRadius: 'var(--radius-pill)',
        maxWidth: 'min(460px, calc(100vw - 24px))',
        // Anchored, it is centred on the set, so it is placed by its own middle.
        // Dragged, the grip already reports a true left edge and half a panel of
        // offset would put it a long way from where it was dropped.
        ...(grip.pinned
          ? zoomStable(zoom(), 'top left')
          : zoomStable(zoom(), 'top center', 'translateX(-50%)')),
      }}
    >
      <PanelGrip onGrab={grip.onGrab} reset={grip.reset} />
      <FrameIcon />
      <span className="text-[11px] font-medium whitespace-nowrap text-ink-soft">
        {nodes.length} selected
      </span>

      <div className="relative" ref={fillRef}>
        <button
          type="button"
          title={`Fill all ${nodes.length} with one colour — whatever each has now is overridden`}
          aria-label="Fill colour for the whole selection"
          aria-pressed={picking}
          onClick={() => setPicking(!picking)}
          className={cx(
            'grid h-[24px] w-[26px] shrink-0 place-items-center rounded-[var(--radius-pill)] border-0 text-[12px] leading-none',
            picking
              ? 'bg-[color:var(--color-select)] text-paper'
              : 'bg-transparent text-ink hover:bg-ink/5',
          )}
        >
          <span className="flex flex-col items-center gap-[2px]">
            <span className="flex h-[12px] items-center">
              <BucketIcon />
            </span>
            <span
              className="block h-[4px] w-[15px] rounded-[1px]"
              style={
                common
                  ? { background: common, boxShadow: 'inset 0 0 0 0.5px rgba(11,11,12,.25)' }
                  : {
                      // The same hatch the element bar uses for "nothing of its
                      // own", doing the neighbouring job here: no one colour.
                      backgroundImage:
                        'linear-gradient(45deg, transparent 42%, rgba(11,11,12,.5) 42%, rgba(11,11,12,.5) 58%, transparent 58%)',
                      boxShadow: 'inset 0 0 0 0.5px rgba(11,11,12,.25)',
                    }
              }
            />
          </span>
        </button>
        {picking && (
          <ColorPicker
            value={common ?? '#ffffff'}
            showContrast={false}
            dropUp={dropUp}
            align={room < 244 ? 'left' : 'right'}
            onClose={() => setPicking(false)}
            onGesture={(active) => {
              if (!active) controller.finishSelectionPaint()
            }}
            onChange={(hex) => controller.paintSelection(hex, true)}
            onReset={() => controller.clearSelectionBackground()}
          />
        )}
      </div>

      {check.ok ? (
        <button
          type="button"
          title="Wrap these in a new auto-layout container, then stack and align them (Shift+A)"
          onClick={() => controller.groupSelection()}
          className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border-0 bg-[color:var(--color-select)] px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap text-paper"
        >
          Group
          <span className="rounded-[3px] bg-paper/25 px-1 text-[10px]">Shift A</span>
        </button>
      ) : (
        <span className="py-[3px] text-[11px] font-medium text-ink-soft">{check.reason}</span>
      )}
    </div>
  )
}

/** Bounding box of the whole set — what the prompt is anchored to. */
function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.left + r.width))
  const bottom = Math.max(...rects.map((r) => r.top + r.height))
  return { left, top, width: right - left, height: bottom - top }
}
