import { auditAlt, auditAria, auditContrast, auditTabOrder } from './audit'
import * as clipboard from './clipboard'
import { consumedByDrag } from './drag'
import { describe } from './geometry'
import * as history from './history'
import { commitShift, findShift } from './reorder'
import { editedCount, revertAll, setStyle } from './styles'
import { setXray } from './xray'
import { watchZoom } from './zoom'
import * as group from './group'
import { deepestAt, documentOrder, isOwnNode, isTargetable, resolveTarget } from './picker'
import { beginMove } from './move'
import { captureRegion, type ShotRect } from './screenshot'
import { nodeOf, store, type Lens, type LensKind } from './store'
import { clearSelection, selectAll } from './textEdit'

/** What the toast says when a check comes on. */
function summarise(lens: Lens): string {
  if (lens.kind === 'tab') {
    const { stops, positive, capped } = lens.audit
    if (!stops.length) return 'Tab order: nothing on this page can take focus'
    return `Tab order: ${stops.length} stops${capped ? '+' : ''}${
      positive ? ` · ${positive} with a positive tabindex, which jump the queue` : ''
    }`
  }

  if (lens.kind === 'contrast') {
    const { findings, checked, capped, uncertain } = lens.audit
    if (!findings.length) return `Contrast: all ${checked} passed`
    return `Contrast: ${findings.length} of ${checked} failing${
      capped ? ' (showing the first 200)' : ''
    }${uncertain ? ` · ${uncertain} skipped over images` : ''}`
  }

  const { issues, checked, capped } = lens.audit
  const subject = lens.kind === 'aria' ? 'Names' : 'Image alt'
  const looked = lens.kind === 'aria' ? 'controls' : 'images'
  if (!checked) return `${subject}: no ${looked} on this page`
  if (!issues.length) return `${subject}: all ${checked} ${looked} are fine`
  const warnings = issues.filter((issue) => issue.tone === 'warn').length
  const failures = issues.length - warnings
  return `${subject}: ${failures} missing of ${checked} ${looked}${
    warnings ? ` · ${warnings} worth a look` : ''
  }${capped ? ' (showing the first 200)' : ''}`
}

/**
 * Owns every listener on the host page. Nothing here touches React: it maps raw
 * pointer/keyboard events onto the store, and the overlay redraws itself.
 *
 * While the editor is active the page is "frozen" — clicks don't navigate,
 * forms don't submit — so a designer can click a link and get its box instead
 * of leaving the page.
 */
/** Arrow keys, mapped to a step through the sibling list. */
const ARROWS: Record<string, -1 | 1 | undefined> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
}

class Controller {
  private tracking = 0
  private stopZoomWatch: (() => void) | null = null
  private stopClipboardWatch: (() => void) | null = null

  get active(): boolean {
    return store.get().active
  }

  activate(): void {
    if (this.active) return
    store.set({ active: true })
    const opts = { capture: true } as const
    window.addEventListener('pointermove', this.onPointerMove, opts)
    window.addEventListener('pointerdown', this.onPointerDown, opts)
    window.addEventListener('click', this.onClick, opts)
    window.addEventListener('auxclick', this.swallow, opts)
    window.addEventListener('submit', this.swallow, opts)
    window.addEventListener('dblclick', this.onDoubleClick, opts)
    window.addEventListener('keydown', this.onKeyDown, opts)
    window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', this.onViewportChange, { passive: true })
    this.startTracking()
    this.stopZoomWatch = watchZoom()
    // A copy made in another tab lights up this tab's paste button while the
    // user is still on their way over.
    this.stopClipboardWatch = clipboard.watchShared(() => store.touch())
  }

  deactivate(): void {
    if (!this.active) return
    const opts = { capture: true } as const
    window.removeEventListener('pointermove', this.onPointerMove, opts)
    window.removeEventListener('pointerdown', this.onPointerDown, opts)
    window.removeEventListener('click', this.onClick, opts)
    window.removeEventListener('auxclick', this.swallow, opts)
    window.removeEventListener('submit', this.swallow, opts)
    window.removeEventListener('dblclick', this.onDoubleClick, opts)
    window.removeEventListener('keydown', this.onKeyDown, opts)
    window.removeEventListener('scroll', this.onViewportChange, opts)
    window.removeEventListener('resize', this.onViewportChange)
    this.stopTracking()
    this.stopZoomWatch?.()
    this.stopZoomWatch = null
    this.stopClipboardWatch?.()
    this.stopClipboardWatch = null
    this.stopEditing()
    setXray(false)
    this.stopLensWatch()
    history.clear()
    clipboard.clear()
    store.reset()
  }

  toggle(): void {
    if (this.active) this.deactivate()
    else this.activate()
  }

  /** Drops every inline style DOMinator applied, leaving selection intact. */
  reset(): void {
    revertAll()
    history.clear()
    store.set({ undoDepth: 0 })
    store.remeasure()
  }

  state(): { active: boolean; editedCount: number } {
    return { active: this.active, editedCount: editedCount() }
  }

  select(el: HTMLElement | null): void {
    if (!el) {
      store.set({ selected: null, extras: [] })
      return
    }
    this.stopEditing()
    store.set({ selected: nodeOf(el), extras: [], hovered: null })
  }

  /** PRD §3.5: double-click makes the text node directly editable. */
  startEditing(el: HTMLElement): void {
    const { editing } = store.get()
    if (editing === el) return
    this.stopEditing()
    el.setAttribute('contenteditable', 'true')
    el.focus()
    // Select the whole node up front: the toolbar's first action then has an
    // unambiguous, *visible* target instead of a bare caret.
    selectAll(el)
    store.set({ editing: el, selected: nodeOf(el), hovered: null })
  }

  stopEditing(): void {
    const { editing } = store.get()
    if (!editing) return
    editing.removeAttribute('contenteditable')
    clearSelection()
    window.getSelection()?.removeAllRanges()
    store.set({ editing: null })
  }

  // — listeners ————————————————————————————————————————————————

  private onPointerMove = (event: PointerEvent): void => {
    if (store.get().interaction !== 'idle') return
    if (isOwnNode(event.target)) return
    const { selected, hovered, editing } = store.get()
    if (editing) return
    const target = resolveTarget(event, selected?.el ?? null)
    if (!target || target === selected?.el) {
      if (hovered) store.set({ hovered: null })
      return
    }
    if (hovered?.el === target) return
    store.set({ hovered: nodeOf(target) })
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (isOwnNode(event.target)) return
    const { editing, selected, interaction } = store.get()
    // Let the host page keep caret handling while a text node is being edited.
    if (editing?.contains(event.target as Node)) return
    event.preventDefault()
    if (interaction !== 'idle' || event.button !== 0) return

    // Dragging anywhere inside the current selection moves it (PRD §3.4) —
    // including over its own text, which is where a designer naturally grabs a
    // card. The 4px threshold inside beginMove keeps click-to-select and
    // double-click-to-edit intact on the very same pixels; modified clicks are
    // left alone because those mean "re-target the selection", not "move it".
    if (!selected || event.ctrlKey || event.metaKey || event.altKey) return
    const under = deepestAt(event.clientX, event.clientY)
    if (under && (under === selected.el || selected.el.contains(under))) {
      beginMove(selected.el, event)
    }
  }

  private onClick = (event: MouseEvent): void => {
    if (isOwnNode(event.target)) return
    if (store.get().editing?.contains(event.target as Node)) return
    this.swallow(event)
    // The click that closes a drag belongs to the drag, not to selection.
    if (consumedByDrag()) return
    const target = resolveTarget(event, store.get().selected?.el ?? null)
    if (!target) return
    if (event.shiftKey) this.toggleInSelection(target)
    else this.select(target)
  }

  private onDoubleClick = (event: MouseEvent): void => {
    if (isOwnNode(event.target)) return
    this.swallow(event)
    if (consumedByDrag()) return
    const target = resolveTarget(event, store.get().selected?.el ?? null)
    if (isTargetable(target)) this.startEditing(target)
  }

  /** Drops the last change. Ctrl/Cmd+Z, or the status bar button. */
  undo(): void {
    if (!history.undo()) return
    store.set({ undoDepth: history.depth() })
    store.remeasure()
  }

  /** Arms screenshot mode: dim the page and wait for a region to be dragged. */
  startScreenshot(): void {
    if (store.get().shot) return
    this.select(null)
    store.set({ shot: { phase: 'arm', rect: null }, hovered: null })
  }

  cancelScreenshot(): void {
    if (store.get().shot) store.set({ shot: null })
  }

  /** Called by the overlay once a region has been dragged out. */
  async finishScreenshot(rect: ShotRect): Promise<void> {
    store.set({ shot: { phase: 'busy', rect } })
    const outcome = await captureRegion(rect)
    store.set({ shot: null })
    this.toast(
      outcome.ok
        ? outcome.how === 'clipboard'
          ? 'Screenshot copied to clipboard'
          : 'Clipboard unavailable — saved as PNG'
        : `Screenshot failed: ${outcome.error}`,
    )
  }

  private toastTimer = 0

  toast(message: string): void {
    store.set({ toast: message })
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => store.set({ toast: null }), 2800)
  }

  toggleXray(): void {
    const next = !store.get().xray
    setXray(next)
    store.set({ xray: next })
  }

  /** The accessibility group in the status bar, revealed on click. */
  toggleAda(): void {
    store.set({ adaOpen: !store.get().adaOpen })
  }

  /**
   * Turns an accessibility check on, or off if it was already the one showing.
   *
   * Asking for a different check while one is up swaps them rather than stacking
   * them: each dims the page and boxes its own findings, so two at once is two
   * scrims fighting over the same pixels.
   */
  toggleLens(kind: LensKind): void {
    if (store.get().lens?.kind === kind) {
      this.stopLensWatch()
      store.set({ lens: null })
      return
    }
    this.runLens(kind)
    this.startLensWatch()

    const lens = store.get().lens
    if (lens) this.toast(summarise(lens))
  }

  private runLens(kind: LensKind): void {
    const lens: Lens =
      kind === 'contrast'
        ? { kind, audit: auditContrast() }
        : kind === 'tab'
          ? { kind, audit: auditTabOrder() }
          : { kind, audit: kind === 'aria' ? auditAria() : auditAlt() }
    store.set({ lens })
  }

  private lensObserver: MutationObserver | null = null
  private lensRescan = 0
  private onVisible = (): void => {
    const kind = store.get().lens?.kind
    if (document.visibilityState === 'visible' && kind) this.runLens(kind)
  }

  /**
   * Re-scans after the page settles.
   *
   * A scan is a full pass over the document, so it can't run per frame — but a
   * result that goes stale the moment you fix something is worse than useless, it
   * is misleading. The debounce buys both: drag a colour through fifty shades and
   * exactly one re-scan lands, 300ms after you stop.
   *
   * A backgrounded tab is skipped and picked up again on the way back, so a page
   * left open in another window isn't re-scanning all day. Only the *re-scan* is
   * skipped, never the explicit one — a button that silently does nothing while
   * the tab happens to be unfocused is its own bug.
   *
   * Our own overlay churns constantly and would otherwise feed the loop back into
   * itself. It can't: the observer watches the page's document, and the overlay
   * lives behind a shadow boundary that mutation records don't cross.
   */
  private startLensWatch(): void {
    if (this.lensObserver) return
    this.lensObserver = new MutationObserver(() => {
      window.clearTimeout(this.lensRescan)
      this.lensRescan = window.setTimeout(() => {
        const kind = store.get().lens?.kind
        if (kind && document.visibilityState === 'visible') this.runLens(kind)
      }, 300)
    })
    this.lensObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      // `tabindex` and `disabled` change the tab sequence without changing a
      // single pixel, so the tab lens needs them watched too.
      attributeFilter: [
        'style',
        'class',
        'tabindex',
        'disabled',
        'hidden',
        'inert',
        'href',
        // The name checks turn entirely on these, and none of them move a pixel.
        'alt',
        'title',
        'role',
        'aria-label',
        'aria-labelledby',
        'aria-hidden',
        'placeholder',
        'for',
        'id',
      ],
    })
    document.addEventListener('visibilitychange', this.onVisible)
  }

  private stopLensWatch(): void {
    this.lensObserver?.disconnect()
    this.lensObserver = null
    window.clearTimeout(this.lensRescan)
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  /**
   * Delete hides rather than removes: the element stays in the DOM so undo can
   * bring it back exactly where it was, and a refresh restores the page anyway
   * because every change we make is inline and in-memory only.
   */
  hideSelected(): void {
    const elements = this.selectionElements()
    if (!elements.length) return
    history.stepAll('hide', elements, () => {
      for (const el of elements) setStyle(el, 'display', 'none')
    })
    store.set({ selected: null, extras: [], hovered: null, undoDepth: history.depth() })
  }

  /** Ctrl/Cmd+C — takes a detached clone, so the original can change afterwards. */
  /** Every element the current selection covers, in document order. */
  selectionElements(): HTMLElement[] {
    const { selected, extras } = store.get()
    if (!selected) return []
    return documentOrder([selected.el, ...extras.map((node) => node.el)])
  }

  /**
   * Shift+click adds to (or removes from) the selection, Figma-style. The
   * primary selection never changes here: the editing tools need one
   * unambiguous target, and silently re-pointing them at the newest click would
   * make a shift-click feel like a plain one.
   */
  toggleInSelection(el: HTMLElement): void {
    const { selected, extras } = store.get()
    if (!selected) {
      this.select(el)
      return
    }
    if (el === selected.el) return
    const without = extras.filter((node) => node.el !== el)
    store.set({
      extras: without.length === extras.length ? [...extras, nodeOf(el)] : without,
      hovered: null,
    })
  }

  /**
   * Shift+A — wraps the selection in a new auto-layout container.
   *
   * The group is selected straight away, which is the whole reason the gesture
   * exists: alignment and stacking are properties of a *parent*, so until one
   * existed there was nothing for those controls to act on. Group, then align —
   * two keystrokes, no trip through the DOM tree.
   */
  groupSelection(): void {
    const plan = group.plan(this.selectionElements())
    if (!plan.ok) {
      this.toast(plan.reason)
      return
    }
    const wrapper = group.wrap(plan)
    store.set({ undoDepth: history.depth() })
    this.select(wrapper)
    this.toast(`Grouped ${plan.items.length} element${plan.items.length === 1 ? '' : 's'}`)
  }

  /**
   * Ctrl/Cmd+Shift+G — dissolves a group, leaving its children in place.
   *
   * Only groups DOMinator made. Unwrapping a page's own `div` would silently
   * discard whatever its class was doing to the layout, which is a much bigger
   * promise than "undo my grouping".
   */
  ungroupSelection(): void {
    const { selected } = store.get()
    if (!selected) return
    if (!group.isGroup(selected.el)) {
      this.toast('Only a group made with Shift+A can be ungrouped')
      return
    }
    const freed = group.unwrap(selected.el)
    store.set({ undoDepth: history.depth() })
    this.select(freed[0] ?? null)
  }

  /** Enter — into the first child that can be selected. */
  selectChild(): void {
    const { selected } = store.get()
    const child = [...(selected?.el.children ?? [])].find(isTargetable)
    if (child) this.select(child)
  }

  /** Shift+Enter — back out to the parent. */
  selectParent(): void {
    const parent = store.get().selected?.el.parentElement ?? null
    if (isTargetable(parent) && parent !== document.body) this.select(parent)
  }

  /**
   * Shift + arrow — move the block itself, the keyboard counterpart to dragging
   * the 6-dot grip. One step earlier or later among its siblings, and out of the
   * container at the ends (see findShift).
   *
   * Acts on the primary selection alone, exactly as the grip does. Every
   * structural edit in the tool takes one unambiguous target; moving three
   * elements at once has no single answer for where they land.
   *
   * The step is planned before anything is recorded, so a press that has nowhere
   * to go leaves no undo step behind — otherwise holding the key at the end of a
   * list would quietly fill the stack with moves that never happened.
   */
  moveSelected(step: -1 | 1): void {
    const { selected } = store.get()
    if (!selected) return
    const shift = findShift(selected.el, step)
    if (!shift) return

    history.recordMove(selected.el)
    commitShift(selected.el, shift)
    store.set({ undoDepth: history.depth() })
    if (shift.ejected) this.toast(`Moved out into ${describe(shift.container)}`)
    // A no-op while it is already on screen, which is why it can run every time.
    selected.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    store.remeasure()
  }

  /**
   * Arrow keys walk the stack the selection sits in. All four directions move to
   * the previous or next sibling rather than being axis-aware: a column and a
   * row would otherwise need different keys for the same idea, and Enter /
   * Shift+Enter already own the up-and-down-the-tree axis.
   */
  selectSibling(step: -1 | 1): void {
    const { selected } = store.get()
    const el = selected?.el
    const parent = el?.parentElement
    if (!el || !parent) return
    const siblings = [...parent.children].filter(isTargetable)
    const index = siblings.indexOf(el)
    const next = siblings[index + step]
    if (index >= 0 && next) this.select(next)
  }

  /**
   * Ctrl/Cmd+C. The copy always lands in this tab; when it is too large to also
   * travel, that is said out loud rather than discovered in the other tab.
   */
  copySelected(): void {
    const elements = this.selectionElements()
    if (!elements.length) return
    const { shareError } = clipboard.copy(elements)
    if (shareError) this.toast(shareError)
    store.touch()
  }

  /**
   * Ctrl/Cmd+V — into the selection when it can hold children, beside it when it
   * can't. The paste is selected immediately so the align tools act on it
   * without a further click.
   */
  pasteIntoSelected(): void {
    const { selected } = store.get()
    if (!selected || !clipboard.has()) return
    const result = clipboard.paste(selected.el)
    if (!result) return
    store.set({ undoDepth: history.depth() })
    this.select(result.node)
  }

  duplicateSelected(): void {
    const { selected } = store.get()
    if (!selected) return
    const copy = clipboard.duplicate(selected.el)
    store.set({ undoDepth: history.depth() })
    this.select(copy)
  }

  /** Timestamp of the last bare "s", for the double-tap shortcut. */
  private lastS = 0

  private onKeyDown = (event: KeyboardEvent): void => {
    /**
     * Anything typed into our own chrome — a hex box, the font search, a number
     * field — belongs to that control. Without this, typing "s" twice in the
     * font search armed the screenshot, and Delete hid the element being styled.
     */
    if (isOwnNode(event.target)) return

    const { editing, selected, shot } = store.get()

    if (shot) {
      // While armed, the only key that means anything is the one that leaves.
      if (event.key === 'Escape') {
        this.swallow(event)
        this.cancelScreenshot()
      }
      return
    }

    // "s s" — two taps inside 600ms. A double tap rather than a modifier so it
    // costs one hand, and bare enough not to collide with the page's own keys
    // more than a single letter already would.
    if (
      event.key.toLowerCase() === 's' &&
      !editing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      this.swallow(event)
      const now = performance.now()
      if (now - this.lastS < 600) {
        this.lastS = 0
        this.startScreenshot()
      } else {
        this.lastS = now
      }
      return
    }

    // Inside contenteditable, every one of these belongs to the browser: Ctrl+Z
    // is text undo, Ctrl+C/V/X operate on the caret's text.
    const key = event.key.toLowerCase()
    const accel = event.ctrlKey || event.metaKey
    if (accel && !editing) {
      if (key === 'z') {
        this.swallow(event)
        this.undo()
        return
      }
      if (key === 'g' && event.shiftKey && selected) {
        this.swallow(event)
        this.ungroupSelection()
        return
      }
      if (selected && (key === 'c' || key === 'x' || key === 'v' || key === 'd')) {
        this.swallow(event)
        if (key === 'c') this.copySelected()
        else if (key === 'x') {
          this.copySelected()
          this.hideSelected()
        } else if (key === 'v') this.pasteIntoSelected()
        else this.duplicateSelected()
        return
      }
    }

    // Shift+A — Figma's auto-layout key, doing the same job here: give these
    // elements a parent so they can be stacked and aligned.
    if (key === 'a' && event.shiftKey && !accel && !event.altKey && !editing && selected) {
      this.swallow(event)
      this.groupSelection()
      return
    }

    if (selected && !editing) {
      if (event.key === 'Enter') {
        this.swallow(event)
        if (event.shiftKey) this.selectParent()
        else this.selectChild()
        return
      }
      const step = ARROWS[event.key]
      if (step) {
        this.swallow(event) // also stops the page scrolling under us
        // Shift moves the block; bare arrows move the selection over it.
        if (event.shiftKey) this.moveSelected(step)
        else this.selectSibling(step)
        return
      }
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !editing) {
      this.swallow(event)
      this.hideSelected()
      return
    }

    if (event.key !== 'Escape') return
    if (editing) this.stopEditing()
    else if (store.get().extras.length) store.set({ extras: [] })
    else if (selected) this.select(null)
    else this.deactivate()
  }

  private swallow = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  private onViewportChange = (): void => store.remeasure()

  /**
   * Host pages animate, lazy-load and reflow constantly, so the overlay follows
   * its target on every frame rather than trusting a one-shot measurement.
   */
  private startTracking(): void {
    const tick = () => {
      store.remeasure()
      this.tracking = requestAnimationFrame(tick)
    }
    this.tracking = requestAnimationFrame(tick)
  }

  private stopTracking(): void {
    if (this.tracking) cancelAnimationFrame(this.tracking)
    this.tracking = 0
  }
}

export const controller = new Controller()
