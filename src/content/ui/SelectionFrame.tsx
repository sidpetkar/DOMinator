import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { describe } from '../core/geometry'
import { startDrag } from '../core/drag'
import { isGroup } from '../core/group'
import * as history from '../core/history'
import { beginMove } from '../core/move'
import { store, type Node } from '../core/store'
import { applyResize, HANDLE_CURSOR, HANDLES, type HandleId } from '../core/transforms'
import { SelectionGripIcon } from './icons'
import { rectStyle } from './util'

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
        store.set({ interaction: 'idle', undoDepth: history.depth() })
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

      <span className="absolute -top-[19px] left-0 flex max-w-[240px] items-center overflow-hidden rounded-[4px] bg-[color:var(--color-select)] px-1.5 py-[2px] text-[10px] font-medium tracking-tight text-paper">
        {/* A group is an empty `div` by description, so the badge names what it
            is instead — otherwise the thing you just made is indistinguishable
            from the page's own wrappers. */}
        <span className="truncate">{isGroup(node.el) ? 'group' : describe(node.el)}</span>
      </span>

      <span className="dm-panel absolute -bottom-[26px] left-1/2 -translate-x-1/2 px-1.5 py-[2px] text-[10px] font-medium text-ink-soft">
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </span>

      {/* 6-dot grip. Dragging the element's body does the same thing; the grip
          exists for elements too small or too crowded to grab by the body. */}
      <button
        type="button"
        title="Drag to move this element into another container"
        onPointerDown={(event) => beginMove(node.el, event.nativeEvent, true)}
        className="dm-interactive absolute -top-[20px] -right-[1px] grid h-[18px] w-[18px] cursor-grab place-items-center rounded-[4px] border-0 bg-[color:var(--color-select)] p-0"
      >
        <SelectionGripIcon />
      </button>

      {HANDLES.map((handle) => (
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

