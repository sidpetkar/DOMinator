import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LOGO_DATA_URL } from '@/shared/logo'
import * as clipboard from '../core/clipboard'
import { controller } from '../core/controller'
import { editedCount } from '../core/styles'
import type { EditorSnapshot } from '../core/store'
import { zoom } from '../core/zoom'
import {
  AdaIcon,
  AltTextIcon,
  AriaIcon,
  CameraIcon,
  ContrastIcon,
  InfoIcon,
  PasteIcon,
  TabOrderIcon,
  UndoIcon,
  XrayIcon,
} from './icons'
import { SHORTCUT_GROUPS } from './shortcuts'
import { cx, zoomStable } from './util'

/** One row of pills, used to tell a wrapped bar from a single-line one. */
const ROW_HEIGHT = 30

/**
 * The single piece of persistent chrome: identity, then the actions that have no
 * natural home on the canvas.
 *
 * Deliberately wordless. Every gesture used to be spelled out in a hint here,
 * which is a lot of permanent text to explain a tool the user is already using —
 * the (i) holds the full key map for the moments you actually want it.
 */
export function StatusBar({ snapshot }: { snapshot: EditorSnapshot }) {
  const [hoveringKeys, setHoveringKeys] = useState(false)
  const [keysPinned, setKeysPinned] = useState(false)
  const showKeys = hoveringKeys || keysPinned
  const edits = editedCount()
  const held = clipboard.summary()

  /**
   * The bar has to survive its own contents. With the accessibility group open,
   * a clipboard label and an edit count it is a good deal wider than it was, and
   * a fixed pill would run its right-hand buttons off a laptop screen — so it
   * wraps instead, and rounds its corners like a panel rather than a pill once it
   * is more than one row tall. Measured rather than guessed, the same way the
   * element bar does it, because what fits depends on the browser zoom too.
   */
  const barRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(ROW_HEIGHT)
  useLayoutEffect(() => {
    const measured = barRef.current?.offsetHeight
    if (measured && Math.abs(measured - height) > 2) setHeight(measured)
  })
  const wrapped = height > ROW_HEIGHT + 6

  return (
    <div
      ref={barRef}
      className="dm-panel dm-interactive flex flex-wrap items-center justify-center gap-1.5 py-1 pr-1 pl-2.5"
      style={{
        position: 'fixed',
        bottom: 16,
        /**
         * Centred by `margin: auto` between two pinned edges rather than by
         * `left: 50%` and a translate.
         *
         * They look identical until the bar is allowed to wrap: a fixed box at
         * `left: 50%` has only the right *half* of the viewport as its available
         * width, so it would start wrapping at 385px on a 770px window — half the
         * room it actually has. Pinning both edges hands it the whole width, and
         * `fit-content` keeps it hugging its pills.
         */
        left: 0,
        right: 0,
        marginInline: 'auto',
        width: 'fit-content',
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: wrapped ? 16 : 'var(--radius-pill)',
        ...zoomStable(zoom(), 'bottom center'),
      }}
    >
      <img
        src={LOGO_DATA_URL}
        alt=""
        width="16"
        height="16"
        className="rounded-[4px]"
        style={{ display: 'block' }}
      />
      <span className="text-[11px] font-medium tracking-tight text-ink">DOMinator</span>

      <span className="dm-divider" />

      {/**
       * Hover and pin are tracked separately so they can't fight each other. The
       * card is open while the pointer is anywhere in this wrapper *or* while it
       * has been clicked open — with one `showKeys` boolean, clicking the pill
       * while already hovering it toggled the card shut and hover couldn't
       * reopen it until you left and came back.
       */}
      <div
        className="relative"
        onPointerEnter={() => setHoveringKeys(true)}
        onPointerLeave={() => setHoveringKeys(false)}
      >
        <Pill
          label="Shortcuts"
          title="Keyboard shortcuts"
          active={showKeys}
          onClick={() => setKeysPinned((pinned) => !pinned)}
        >
          <InfoIcon />
        </Pill>
        {showKeys && <ShortcutCard />}
      </div>

      {/* Only shown when it carries information the user can't otherwise see:
          what is currently on the clipboard — and, when it came from another tab,
          where from. A paste that arrives with its styles baked in behaves
          slightly differently from a same-page one, so it says so. */}
      {snapshot.selected && held && (
        <Pill
          label="Paste"
          title={
            held.origin
              ? `Paste ${held.label} from ${held.origin} into the selection — it arrives with its styles baked in (Ctrl/Cmd+V)`
              : `Paste ${held.label} into the selection (Ctrl/Cmd+V)`
          }
          onClick={() => controller.pasteIntoSelected()}
        >
          <PasteIcon />
          <span className="max-w-[92px] truncate">{held.label}</span>
          {held.origin && (
            <span className="max-w-[86px] truncate rounded-[3px] bg-ink/10 px-1 text-[10px] text-ink-soft">
              {held.origin}
            </span>
          )}
        </Pill>
      )}

      <Pill
        label="Screenshot"
        title="Capture a region — drag past the edge for a long screenshot (S, S)"
        onClick={() => controller.startScreenshot()}
      >
        <CameraIcon />
      </Pill>

      <Pill
        label="X-ray"
        title="Show the page skeleton — every box outlined. Editing still works."
        active={snapshot.xray}
        onClick={() => controller.toggleXray()}
      >
        <XrayIcon />
      </Pill>

      <AdaGroup snapshot={snapshot} />

      <Pill
        label="Undo"
        title="Undo the last change (Ctrl/Cmd+Z)"
        disabled={!snapshot.undoDepth}
        onClick={() => controller.undo()}
      >
        <UndoIcon />
        {snapshot.undoDepth ? snapshot.undoDepth : ''}
      </Pill>

      <Pill label="Reset" title="Drop every change" onClick={() => controller.reset()}>
        Reset{edits ? ` (${edits})` : ''}
      </Pill>
      <Pill label="Exit" title="Close DOMinator" onClick={() => controller.deactivate()}>
        Exit
      </Pill>
    </div>
  )
}

/**
 * The accessibility tools: one button that slides three more out beside it.
 *
 * Folded away by default because none of it is part of laying a page out — it is
 * a second pass you make deliberately, and four permanent buttons would push the
 * bar wider for everyone who never opens it.
 *
 * The reveal animates `grid-template-columns` from `0fr` to `1fr`. That lands on
 * the group's *natural* width without anyone measuring it, which `max-width`
 * can't do without a hardcoded guess that goes stale the moment a fifth tool is
 * added — and it stays a single CSS transition, so no JS runs per frame.
 */
function AdaGroup({ snapshot }: { snapshot: EditorSnapshot }) {
  const open = snapshot.adaOpen
  const { lens } = snapshot

  /**
   * The count rides on the ADA pill so it is still readable with the group
   * folded away — the number is the finding, and it should not need two clicks.
   * Red for failures, blue for a sequence: one is a problem, the other is just
   * information.
   */
  const count =
    lens?.kind === 'contrast'
      ? { value: lens.audit.findings.length, tone: 'var(--color-fail)' }
      : lens?.kind === 'tab'
        ? { value: lens.audit.stops.length, tone: 'var(--color-select)' }
        : lens
          ? { value: lens.audit.issues.length, tone: 'var(--color-fail)' }
          : null

  return (
    <>
      <Pill
        label="Accessibility"
        title="Accessibility checks"
        active={open}
        onClick={() => controller.toggleAda()}
      >
        <AdaIcon />
        {count && count.value > 0 && (
          <span
            className="rounded-[3px] px-1 text-[10px] text-paper tabular-nums"
            style={{ background: count.tone }}
          >
            {count.value}
          </span>
        )}
      </Pill>

      <div
        aria-hidden={!open}
        /**
         * `inert` as well as `aria-hidden`: the buttons stay in the DOM so they
         * can animate, and focusable controls inside an `aria-hidden` subtree are
         * exactly the bug this panel exists to find. `inert` takes them out of the
         * tab order and out of hit testing, which `aria-hidden` alone does not.
         */
        inert={!open}
        style={{
          display: 'grid',
          gridTemplateColumns: open ? '1fr' : '0fr',
          overflow: 'hidden',
          /**
           * A `0fr` track still floors at its content's min-content width, which
           * padding contributes to — so the group's spacing comes from the bar's
           * own flex gap instead, and the closed group is genuinely zero-wide. The
           * negative margin then cancels the trailing gap, or a folded group would
           * leave a 12px hole between X-ray and Undo.
           */
          marginRight: open ? 0 : -6,
          transition:
            'grid-template-columns 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease, margin-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          opacity: open ? 1 : 0,
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Pill
            label="Contrast"
            title="Check every text and icon colour on the page against what is behind it (WCAG AA)"
            active={lens?.kind === 'contrast'}
            onClick={() => controller.toggleLens('contrast')}
          >
            <ContrastIcon />
          </Pill>
          <Pill
            label="Names"
            title="Find controls a screen reader cannot announce — icon-only buttons, unlabelled inputs, broken aria-labelledby"
            active={lens?.kind === 'aria'}
            onClick={() => controller.toggleLens('aria')}
          >
            <AriaIcon />
          </Pill>
          <Pill
            label="Tab order"
            title="Number every keyboard tab stop in the order Tab actually visits them"
            active={lens?.kind === 'tab'}
            onClick={() => controller.toggleLens('tab')}
          >
            <TabOrderIcon />
          </Pill>
          <Pill
            label="Alt text"
            title="Find images with no alt text, a file name for a description, or an empty alt where a link's only name should be"
            active={lens?.kind === 'alt'}
            onClick={() => controller.toggleLens('alt')}
          >
            <AltTextIcon />
          </Pill>
        </div>
      </div>
    </>
  )
}

/**
 * The full key map, on hover.
 *
 * One narrow column rather than three: side by side it came to ~760px, which
 * overflows the viewport on a laptop and gets clipped exactly where the first
 * group is. Tall is free here — the card floats above the bar with the whole
 * page height to grow into.
 */
function ShortcutCard() {
  return (
    /**
     * The gap between the pill and the card is *padding on a wrapper*, not an
     * offset on the card.
     *
     * It looks the same and behaves completely differently: `bottom: 34` left 8px
     * of dead space that belonged to neither element, so moving the pointer up
     * towards the card crossed it, `pointerleave` fired, and the card vanished
     * before it could be reached — which made the link in it unclickable. Pinning
     * the wrapper's bottom to the pill's top edge and pushing the card up with
     * transparent padding makes the whole thing one continuous hover region.
     */
    <div style={{ position: 'absolute', bottom: '100%', left: 0, paddingBottom: 8 }}>
      <div className="dm-panel flex flex-col gap-2 px-3 py-2.5" style={{ width: 268 }}>
        {SHORTCUT_GROUPS.map((group, index) => (
          <div key={group.title} className={index ? 'border-t border-line pt-2' : undefined}>
            <p className="m-0 mb-0.5 text-[9px] font-semibold tracking-wide text-ink-soft uppercase">
              {group.title}
            </p>
            {group.items.map(([keys, what]) => (
              <div key={keys} className="flex items-baseline justify-between gap-3 py-[1px]">
                <span className="shrink-0 text-[10px] whitespace-nowrap text-ink">{keys}</span>
                <span className="truncate text-[10px] text-ink-soft">{what}</span>
              </div>
            ))}
          </div>
        ))}

        {/* `noreferrer` as well as `noopener`: this opens from a content script
            running on whatever page the user happens to be editing, and the
            referrer would leak that URL to the destination. */}
        <p className="m-0 border-t border-line pt-2 text-center text-[10px] text-ink-soft">
          Made with <span style={{ color: 'var(--color-fail)' }}>❤</span> by{' '}
          <a
            href="https://x.com/siddhantpetkar"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: 'var(--color-link)' }}
          >
            @siddhantpetkar
          </a>
        </p>
      </div>
    </div>
  )
}

function Pill({
  label,
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] border-0 px-2.5 py-[3px] text-[11px] font-medium disabled:opacity-35',
        active
          ? 'bg-[color:var(--color-select)] text-paper'
          : 'bg-ink/5 text-ink hover:bg-ink/10',
      )}
    >
      {children}
    </button>
  )
}










