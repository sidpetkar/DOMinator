import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { describe } from '../core/geometry'
import { startDrag } from '../core/drag'
import { isGroup } from '../core/group'
import * as history from '../core/history'
import { beginCanvasMove } from '../core/canvasMove'
import { controller } from '../core/controller'
import { beginMove } from '../core/move'
import { store, type Node } from '../core/store'
import { applyResize, handlesFor, HANDLE_CURSOR, type HandleId } from '../core/transforms'
import { DimensionPill } from './DimensionPill'
import { SelectionGripIcon } from './icons'
import { rectStyle } from './util'

/**
 * Dragging the badge moves the whole selection when there is more than one
 * element in it: the badge belongs to the primary, but the primary is not a
 * thing anyone thinks of as separate from the set they just picked.
 */
function elementsInSelection(primary: HTMLElement): HTMLElement[] {
  const { selected, extras } = store.get()
  if (selected?.el !== primary) return [primary]
  return [primary, ...extras.map((node) => node.el)]
}

const HANDLE_POS: Record<HandleId, CSSProperties> = {
  nw: { top: 0, left: 0 },
  n: { top: 0, left: '50%' },
  ne: { top: 0, left: '100%' },
  e: { top: '50%', left: '100%' },
  se: { top: '100%', left: '100%' },
  s: { top: '100%', left: '50%' },
  sw: { top: '100%', left: 0 },
  w: { top: '50%', left: 0 },
}

/**
 * PRD §3.2 + §3.4: the committed selection. Solid frame, eight handles, a grip
 * for structural moves, and a live size readout. Everything is 1px and
 * monochrome so it reads as a tool, not as page content.
 */
export function SelectionFrame({ node }: { node: Node }) {
  const { rect } = node.metrics
  /**
   * The artboard has a name of its own, drawn above its corner by FrameLabel,
   * and two badges in the same corner is what the overlap was: one saying
   * `body` under another saying `body`, with the move grip on top of both.
   * Selecting the page shows the frame and its handles; the naming and the
   * grabbing stay where they already were.
   */
  const isArtboard = node.el === document.body

  const onResize = (handle: HandleId) => (event: ReactPointerEvent) => {
    const start = store.get().selected?.metrics ?? node.metrics
    const el = node.el
    store.set({ interaction: 'resize' })
    history.begin('resize', el)
    startDrag(event.nativeEvent, {
      cursor: HANDLE_CURSOR[handle],
      onMove: (drag) => applyResize(el, start, handle, drag),
      onEnd: () => {
        history.commit()
        store.set({ interaction: 'idle', ...history.depths() })
      },
    })
  }

  return (
    <div style={rectStyle(rect)} className="pointer-events-none">
      {/* Dotted, and doubled with a translucent white outline so the edge stays
          legible over both a white card and a dark hero. */}
      <div
        className="absolute inset-0 border border-dotted border-[color:var(--color-select)]"
        style={{ outline: '1px solid rgba(255,255,255,0.35)', outlineOffset: 0 }}
      />

      {/**
       * The name badge, which is also the handle for moving the element around
       * the canvas.
       *
       * Figma's frame name works exactly this way, and for a reason that shows
       * up the moment you try it any other way: the badge is the one part of the
       * selection chrome that is never over the page content, so it is the one
       * part you can always grab without the press meaning something else —
       * text, a link, a button, a nested card. Dragging the element's body means
       * "re-home it among these siblings"; dragging its name means "move it",
       * which on a canvas is a different verb and now has its own grip.
       */}
      {!isArtboard && (
      <span
        role="button"
        title={`${describe(node.el)} — drag to move it, Alt+drag to pull off a copy`}
        onPointerDown={(event) => {
          /**
           * Alt on the badge duplicates instead of moving, which is the one
           * shortcut every design tool shares and the badge is the natural place
           * to reach for it: it is the handle you are already holding to move
           * the thing, so "move a copy instead" belongs on the same grip rather
           * than on a different press somewhere over the content.
           */
          const set = elementsInSelection(node.el)
          if (event.altKey && controller.carryCopy(event.nativeEvent, set)) return
          beginCanvasMove(set, event.nativeEvent)
        }}
        className="dm-interactive absolute -top-[19px] left-0 flex max-w-[240px] cursor-grab items-center overflow-hidden rounded-[4px] bg-[color:var(--color-select)] px-1.5 py-[2px] text-[10px] font-medium tracking-tight text-paper"
      >
        {/* A group is an empty `div` by description, so the badge names what it
            is instead — otherwise the thing you just made is indistinguishable
            from the page's own wrappers. */}
        <span className="truncate">{isGroup(node.el) ? 'group' : describe(node.el)}</span>
      </span>
      )}

      <DimensionPill rect={rect} />

      {/* 6-dot grip. Dragging the element's body does the same thing; the grip
          exists for elements too small or too crowded to grab by the body. */}
      {!isArtboard && (
      <button
        type="button"
        title="Drag to move this element into another container"
        onPointerDown={(event) => beginMove(node.el, event.nativeEvent, true)}
        className="dm-interactive absolute -top-[20px] -right-[1px] grid h-[18px] w-[18px] cursor-grab place-items-center rounded-[4px] border-0 bg-[color:var(--color-select)] p-0 text-paper"
      >
        <SelectionGripIcon />
      </button>
      )}

      {handlesFor(rect.width, rect.height).map((handle) => (
        <span
          key={handle}
          onPointerDown={onResize(handle)}
          // Filled in the selection blue, ringed in white: a hollow white
          // square disappears against light page chrome.
          className="dm-interactive absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white bg-[color:var(--color-select)]"
          style={{
            ...HANDLE_POS[handle],
            cursor: HANDLE_CURSOR[handle],
            boxShadow: '0 1px 3px rgba(11,11,12,0.4)',
          }}
        />
      ))}
    </div>
  )
}

