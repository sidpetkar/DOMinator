import { useSyncExternalStore } from 'react'
import { isMedia } from './core/media'
import { store } from './core/store'
import { zoom } from './core/zoom'
import { MediaDownload } from './ui/MediaDownload'
import { zoomStable } from './ui/util'
import { DropOverlay } from './ui/DropOverlay'
import { EditHighlight } from './ui/EditHighlight'
import { AuditOverlay } from './ui/AuditOverlay'
import { GapOverlay } from './ui/GapOverlay'
import { GroupPrompt } from './ui/GroupPrompt'
import { MeasureChrome } from './ui/MeasureChrome'
import { HoverOutline } from './ui/HoverOutline'
import { ElementBar } from './ui/ElementBar'
import { SelectionFrame } from './ui/SelectionFrame'
import { ScreenshotOverlay } from './ui/ScreenshotOverlay'
import { SelectionWash } from './ui/SelectionWash'
import { SpacingOverlay } from './ui/SpacingOverlay'
import { StatusBar } from './ui/StatusBar'
import { TextToolbar } from './ui/TextToolbar'

/**
 * Pure projection of the store — no event wiring lives here. Painting order is
 * deliberate: spacing zones sit below the selection frame so handles always win
 * the hit test, and a move gesture replaces the static chrome entirely so the
 * only thing on screen is where the block will land.
 */
export function App() {
  const snapshot = useSyncExternalStore(store.subscribe, store.get)
  if (!snapshot.active) return null

  const { hovered, selected, extras, editing, interaction, drop, shot, toast, preview, lens, flash } =
    snapshot

  // Screenshot mode owns the screen: the editing chrome would only be
  // photographed or get in the way of the marquee.
  if (shot) {
    return (
      <>
        <ScreenshotOverlay shot={shot} />
        {toast && <Toast message={toast} />}
      </>
    )
  }
  const moving = interaction === 'move'
  // While a colour is being chosen every tinted layer steps aside, so what you
  // see is the page in the colour you are actually applying.
  const showChrome = Boolean(selected) && !editing && !moving && !preview
  // More than one element picked: compare, don't edit (see MeasureChrome).
  const comparing = extras.length > 0

  // The download button follows whatever media the user is pointing at, falling
  // back to the selection — hovering is the more common way to reach for an asset.
  const mediaNode =
    !editing && interaction === 'idle'
      ? [hovered, selected].find((node) => node && isMedia(node.el)) ?? null
      : null

  return (
    <>
      {/* First, so everything below paints on top of the dim: the audit is the
          backdrop you work against, never something that covers the handles.
          Stands aside for a colour preview, where a scrim would be the one thing
          you cannot judge a colour through. */}
      {lens && !preview && <AuditOverlay lens={lens} />}

      {hovered && interaction === 'idle' && !editing && <HoverOutline node={hovered} />}

      {/* One element: the full editor. Several: the same measurements on each,
          with the single-target controls withheld. */}
      {selected && showChrome && comparing && (
        <>
          {[selected, ...extras].map((node, index) => (
            <MeasureChrome
              key={index}
              node={node}
              primary={index === 0}
              extraCount={extras.length}
            />
          ))}
        </>
      )}

      {/* The actions whose subject is the set rather than one member. Outside
          the chrome gate above for the same reason the element bar is: it
          carries a colour picker, and a preview must not unmount the panel the
          colour is being dragged in. */}
      {selected && comparing && !editing && !moving && (
        <GroupPrompt nodes={[selected, ...extras]} />
      )}

      {selected && showChrome && !comparing && (
        <>
          {/* Painted first, so the spacing bands and handles all sit above it. */}
          <SelectionWash node={selected} />
          <GapOverlay node={selected} />
          <SpacingOverlay node={selected} />
          <SelectionFrame node={selected} />
        </>
      )}

      {/* Kept through a preview: it carries the picker being used. */}
      {selected && !editing && !moving && !comparing && <ElementBar node={selected} />}

      {moving && drop && <DropOverlay drop={drop} />}

      {mediaNode && <MediaDownload node={mediaNode} />}

      {editing && selected?.el === editing && (
        <>
          {!preview && <EditHighlight el={editing} metrics={selected.metrics} />}
          <TextToolbar el={editing} metrics={selected.metrics} />
        </>
      )}
      <StatusBar snapshot={snapshot} />
      {/* Above everything, including the status bar: a shutter that something
          else painted over would not read as one. */}
      {flash && <ShotFlash />}
      {toast && <Toast message={toast} />}
    </>
  )
}

/**
 * One frame of white and a closing viewfinder, after a capture lands. Mounted
 * only while it plays, so each shot gets the animation from the start.
 */
function ShotFlash() {
  return (
    <>
      <div className="dm-flash" />
      <div className="dm-flash-frame" />
    </>
  )
}

/** Brief confirmation, above the status bar so it never covers it. */
function Toast({ message }: { message: string }) {
  return (
    <div
      className="dm-panel px-3 py-1.5 text-[11px] font-medium text-ink"
      style={{
        position: 'fixed',
        bottom: 60,
        left: '50%',
        borderRadius: 'var(--radius-pill)',
        ...zoomStable(zoom(), 'bottom center', 'translateX(-50%)'),
      }}
    >
      {message}
    </div>
  )
}
