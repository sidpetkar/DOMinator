import type { ContrastAudit, IssueAudit, TabOrderAudit } from './audit'
import { measure, sameRect, type Metrics } from './geometry'
import type { Drop } from './reorder'
import type { ShotState } from './screenshot'

export interface Node {
  el: HTMLElement
  metrics: Metrics
  /**
   * Cheap fingerprint of the children's geometry. The gap overlay is derived
   * from it, and a gap change moves the *children* without necessarily moving
   * the container — so without this the tracker has nothing to notice and the
   * pink bands would only catch up when the drag ends.
   */
  childSig: string
}

/** Bounded: a container with hundreds of children isn't worth fingerprinting. */
const SIG_LIMIT = 40

function childSignature(el: HTMLElement): string {
  const children = el.children
  if (children.length > SIG_LIMIT) return `n${children.length}`
  let sig = ''
  for (const child of children) {
    const r = child.getBoundingClientRect()
    sig += `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)};`
  }
  return sig
}

export type Interaction = 'idle' | 'resize' | 'spacing' | 'move'

/** Which accessibility check is showing. Also the tag the overlay switches on. */
export type LensKind = 'contrast' | 'tab' | 'aria' | 'alt'

export type Lens =
  | { kind: 'contrast'; audit: ContrastAudit }
  | { kind: 'tab'; audit: TabOrderAudit }
  /**
   * Two checks, one shape: an element and a short reason (see audit.ts). Listed
   * separately rather than as `kind: 'aria' | 'alt'` so each `kind` is a single
   * literal — a union member with two tags doesn't discriminate, and every
   * `switch` on it would have to cast its way out.
   */
  | { kind: 'aria'; audit: IssueAudit }
  | { kind: 'alt'; audit: IssueAudit }

export interface EditorSnapshot {
  active: boolean
  hovered: Node | null
  selected: Node | null
  /**
   * Additional shift-picked elements. The primary `selected` stays the one the
   * editing tools act on — spacing, type and layout all need one unambiguous
   * target — while these ride along for the operations that are meaningful on a
   * set: delete, copy, duplicate.
   */
  extras: Node[]
  /** Element currently in contenteditable mode (PRD §3.5). */
  editing: HTMLElement | null
  interaction: Interaction
  /** Live drop target while a move gesture is in flight. */
  drop: Drop | null
  /** Page-skeleton lens (see xray.ts). */
  xray: boolean
  /** Whether the accessibility tools are revealed in the status bar. */
  adaOpen: boolean
  /**
   * The accessibility lens in force, if any. One slot rather than a flag per
   * check: they each dim the page and box up their own findings, so two at once
   * would be two scrims and two sets of labels fighting over the same pixels.
   * Making them one field means they can't both be on.
   */
  lens: Lens | null
  /** Undo depth, mirrored here purely so the status bar re-renders. */
  undoDepth: number
  /** Screenshot mode: null when off (see screenshot.ts). */
  shot: ShotState | null
  /** Transient confirmation, cleared on a timer. */
  toast: string | null
  /**
   * True while a colour is being chosen. Every overlay that tints the page —
   * the wash, the green/orange/pink spacing bands — steps aside, because you
   * cannot judge a colour through them, and the eyedropper would sample them
   * instead of the page.
   */
  preview: boolean
  /**
   * Where the status bar has been dragged to, in viewport coordinates. Null
   * keeps it at its default bottom-centre spot.
   */
  barPos: { left: number; top: number } | null
}

const EMPTY: EditorSnapshot = {
  active: false,
  hovered: null,
  selected: null,
  extras: [],
  editing: null,
  interaction: 'idle',
  drop: null,
  xray: false,
  adaOpen: false,
  lens: null,
  undoDepth: 0,
  shot: null,
  toast: null,
  preview: false,
  barPos: null,
}

type Listener = () => void

/**
 * Deliberately tiny: the vanilla interaction layer owns the truth and the React
 * overlay is a pure projection of it (via useSyncExternalStore). No React state
 * lives on the hot path of a drag.
 */
class Store {
  private snapshot: EditorSnapshot = EMPTY
  private listeners = new Set<Listener>()

  get = (): EditorSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(patch: Partial<EditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Forces a redraw without changing state. Needed after a write that the
   * overlay reads from computed style rather than from the store — alignment,
   * wrap, gap — where the selected element's own rect may not move at all, so
   * remeasure() has nothing to notice.
   */
  touch(): void {
    this.set({})
  }

  /** Re-measures hovered/selected and notifies only if something moved. */
  remeasure(): void {
    const next: Partial<EditorSnapshot> = {}
    for (const key of ['hovered', 'selected'] as const) {
      const node = this.snapshot[key]
      if (!node) continue
      if (!node.el.isConnected) {
        next[key] = null
        continue
      }
      const metrics = measure(node.el)
      const childSig = key === 'selected' ? childSignature(node.el) : node.childSig
      if (!sameRect(metrics.rect, node.metrics.rect) || childSig !== node.childSig) {
        next[key] = { el: node.el, metrics, childSig }
      }
    }
    // Extras are outline-only, so a rect change is all that matters for them.
    const extras = this.snapshot.extras
    if (extras.length) {
      let changed = false
      const nextExtras = extras
        .filter((node) => node.el.isConnected)
        .map((node) => {
          const metrics = measure(node.el)
          if (sameRect(metrics.rect, node.metrics.rect)) return node
          changed = true
          return { ...node, metrics }
        })
      if (changed || nextExtras.length !== extras.length) next.extras = nextExtras
    }

    if (Object.keys(next).length) this.set(next)
  }

  reset(): void {
    this.snapshot = EMPTY
    for (const listener of this.listeners) listener()
  }
}

export const store = new Store()

export const nodeOf = (el: HTMLElement): Node => ({
  el,
  metrics: measure(el),
  childSig: childSignature(el),
})
