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
import { PeerOutlines } from './ui/PeerOutlines'
import { CanvasPanel } from './ui/CanvasPanel'
import { ElementBar } from './ui/ElementBar'
import { FrameLabel } from './ui/FrameLabel'
import { LayerTree } from './ui/LayerTree'
import { Marquee } from './ui/Marquee'
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

  const {
    hovered,
    selected,
    extras,
    editing,
    interaction,
    drop,
    shot,
    toast,
    preview,
    lens,
    flash,
    layers,
    band,
  } = snapshot

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
      ? ([hovered, selected].find((node) => node && isMedia(node.el)) ?? null)
      : null

  return (
    <>
      {/* First, so everything below paints on top of the dim: the audit is the
          backdrop you work against, never something that covers the handles.
          Stands aside for a colour preview, where a scrim would be the one thing
          you cannot judge a colour through. */}
      {lens && !preview && <AuditOverlay lens={lens} />}

      {/* The level you are pointing at: its other members first, so the solid
          line of the one under the cursor paints over them. */}
      {hovered && interaction === 'idle' && !editing && (
        <>
          <PeerOutlines peers={snapshot.peers} />
          <HoverOutline node={hovered} />
        </>
      )}

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

      {/**
       * Kept through a preview: it carries the picker being used.
       *
       * Docked, it is the same component in its column form and it stays put
       * through a multi-selection too — a docked panel that vanished when you
       * shift-clicked a second element would leave a hole in the layout, which
       * a floating bar disappearing never does.
       */}
      {/**
       * Docked, it stays up *through* a text edit and keeps working — the whole
       * point of a panel that lives at the edge of the screen rather than on top
       * of the thing being edited. The floating bar cannot: it anchors itself to
       * the selection, so during an edit it would sit on the words, which is why
       * the type toolbar exists as a separate, movable thing at all.
       */}
      {selected && !moving && (layers || (!editing && !comparing)) && (
        <ElementBar
          node={selected}
          docked={layers}
          editing={editing === selected.el}
          paintRequest={snapshot.paintRequest}
        />
      )}

      {/* Nothing selected, but the panel stays: on the canvas the right-hand
          column is furniture, and what it holds with an empty selection is the
          canvas's own properties. */}
      {layers && !selected && !editing && <CanvasPanel />}

      {/* The band, above the page but below the panels: one dragged under a
          docked panel should disappear beneath it, not over it. */}
      {band && <Marquee band={band} />}

      {/* The artboard's name, only while there is an artboard to name. Before
          the panels, so that when the frame is panned in behind one the panel
          paints over the label rather than the other way about. */}
      {layers && <FrameLabel />}

      {/* The page as layers, on the left. Independent of the selection: it is
          how you *find* something to select. */}
      {layers && <LayerTree snapshot={snapshot} />}

      {moving && drop && <DropOverlay drop={drop} />}

      {mediaNode && <MediaDownload node={mediaNode} />}

      {editing && selected?.el === editing && (
        <>
          {!preview && <EditHighlight el={editing} metrics={selected.metrics} />}
          {/* One type control at a time. With the column up it holds the
              typography itself, and a floating bar saying the same things over
              the top of the page would be two places to change one font. */}
          {!layers && <TextToolbar el={editing} metrics={selected.metrics} />}
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
