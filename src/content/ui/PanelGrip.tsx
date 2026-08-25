import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { startDrag } from '../core/drag'
import { store, type PanelId } from '../core/store'
import { GripIcon } from './icons'

/**
 * The 6-dot grip every floating panel carries, and the dragging behind it.
 *
 * All of them need it for the same reason: each one anchors itself to the thing
 * it is about — the selection, the text being edited, the bottom of the window —
 * and each one is therefore sometimes squarely on top of what you are trying to
 * look at. The grip is the way out, and it is the same mark in the same corner
 * on all of them so it never has to be looked for.
 *
 * Double-click puts a panel back where it belongs. Dragging is only ever a
 * temporary escape from the anchor, so there has to be a way home that isn't
 * "drag it back and hope".
 */
export function usePanelDrag(
  id: PanelId,
  ref: RefObject<HTMLElement | null>,
): {
  pinned: { left: number; top: number } | null
  onGrab: (event: ReactPointerEvent) => void
  reset: () => void
} {
  const move = (next: { left: number; top: number } | null): void => {
    const panels = { ...store.get().panels }
    if (next) panels[id] = next
    else delete panels[id]
    store.set({ panels })
  }

  const onGrab = (event: ReactPointerEvent): void => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    // Where in the panel it was grabbed, so it doesn't jump under the cursor.
    const grabX = event.clientX - box.left
    const grabY = event.clientY - box.top
    startDrag(event.nativeEvent, {
      cursor: 'grabbing',
      onMove: (drag) =>
        move({
          // Never draggable off screen: a panel parked past the edge would be
          // unreachable, and the only way back would be to close the editor.
          left: Math.max(8, Math.min(drag.x - grabX, window.innerWidth - box.width - 8)),
          top: Math.max(8, Math.min(drag.y - grabY, window.innerHeight - box.height - 8)),
        }),
    })
  }

  return { pinned: store.get().panels[id] ?? null, onGrab, reset: () => move(null) }
}

export function PanelGrip({
  onGrab,
  reset,
}: {
  onGrab: (event: ReactPointerEvent) => void
  reset: () => void
}) {
  return (
    <span
      role="button"
      aria-label="Move this panel"
      title="Drag to move · double-click to put it back"
      onPointerDown={onGrab}
      onDoubleClick={reset}
      className="grid h-[22px] w-[12px] shrink-0 cursor-grab place-items-center text-ink-soft hover:text-ink"
    >
      <GripIcon />
    </span>
  )
}
