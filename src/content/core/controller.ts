import { OWN_NODE_ATTR } from '@/shared/constants'
import { auditAlt, auditAria, auditContrast, auditTabOrder } from './audit'
import * as clipboard from './clipboard'
import { consumedByDrag } from './drag'
import { describe } from './geometry'
import * as history from './history'
import { commitShift, findShift } from './reorder'
import { setBackground } from './box'
import { clearStyle, editedCount, revertAll, setStyle } from './styles'
import { setXray } from './xray'
import { watchZoom } from './zoom'
import * as group from './group'
import { deepestAt, documentOrder, isOwnNode, isTargetable, resolveTarget } from './picker'
import { beginMove } from './move'
import { imageIn, insertImage, isImageFile, readImage, tooBig } from './images'
import { captureRegion, fullPage, type ShotOutcome, type ShotRect } from './screenshot'
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

/**
 * Everything else the page could act on while the editor is up.
 *
 * Preventing `click` alone freezes links and buttons that behave the way the
 * platform intends, and misses every page that doesn't: a menu that opens on
 * `mousedown`, a carousel that advances on `mouseup`, a router that navigates
 * from a `touchend`, a lightbox on `contextmenu`, a form that submits from a
 * `change`. Those are the ones behind "sometimes it just navigates" — and a
 * tool whose whole premise is that you can click a link to get its box has to
 * mean that on every page, not on the well-behaved ones.
 *
 * These are all swallowed outright. The ones the editor actually reads —
 * pointermove, pointerdown, click, dblclick, keydown — have handlers of their
 * own above and are not in this list.
 *
 * Scroll and wheel are deliberately absent. Freezing the page means freezing
 * what it *does*, not pinning it in place: you have to be able to scroll down
 * to the thing you want to edit.
 */
const FROZEN = [
  'mousedown',
  'mouseup',
  'auxclick',
  'contextmenu',
  'submit',
  'reset',
  'change',
  'input',
  'beforeinput',
  'keyup',
  'keypress',
  'touchend',
  'dragstart',
  'drop',
] as const

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
    window.addEventListener('dblclick', this.onDoubleClick, opts)
    window.addEventListener('keydown', this.onKeyDown, opts)
    window.addEventListener('paste', this.onPaste, opts)
    for (const type of FROZEN) window.addEventListener(type, this.freeze, opts)
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
    window.removeEventListener('dblclick', this.onDoubleClick, opts)
    window.removeEventListener('keydown', this.onKeyDown, opts)
    window.removeEventListener('paste', this.onPaste, opts)
    for (const type of FROZEN) window.removeEventListener(type, this.freeze, opts)
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
    store.set(history.depths())
    store.remeasure()
  }

  /**
   * Esc — everything down, nothing selected. The editor stays loaded and the
   * page stays frozen, so it reads as a pause rather than an exit: hover
   * outlines, the selection and its chrome, a half-finished text edit, an
   * accessibility scrim, X-ray, an armed screenshot — all off in one keystroke.
   *
   * One press rather than a walk back up the stack. Escape is the key you reach
   * for when the screen has too much on it, and having to press it four times to
   * clear four different things is the opposite of what that reflex expects.
   *
   * Returns whether it actually did anything, so a second press can mean "then
   * close the tool" without ever being ambiguous about which one it was.
   */
  standDown(): boolean {
    const { editing, selected, extras, hovered, xray, lens, shot, adaOpen, shotOpen } = store.get()
    const busy = Boolean(
      editing ||
      selected ||
      extras.length ||
      hovered ||
      xray ||
      lens ||
      shot ||
      adaOpen ||
      shotOpen,
    )
    if (!busy) return false

    this.stopEditing()
    if (xray) setXray(false)
    if (lens) this.stopLensWatch()
    // The pending half of a drag would otherwise land on the next thing edited.
    history.commit()
    store.set({
      selected: null,
      extras: [],
      hovered: null,
      xray: false,
      lens: null,
      adaOpen: false,
      shotOpen: false,
      shot: null,
      interaction: 'idle',
      drop: null,
      preview: false,
      ...history.depths(),
    })
    return true
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
    // An unfinished gesture is still sitting in the buffer — close it first, or
    // Ctrl+Z would skip past the change the user is looking at.
    history.commit()
    if (!history.undo()) return
    store.set(history.depths())
    store.remeasure()
  }

  /** Puts back what undo took. Ctrl/Cmd+Shift+Z (or Ctrl+Y), or the button. */
  redo(): void {
    if (!history.redo()) return
    store.set(history.depths())
    store.remeasure()
  }

  /** Arms region capture: dim the page and wait for a region to be dragged. */
  startScreenshot(): void {
    if (store.get().shot) return
    this.select(null)
    store.set({ shot: { phase: 'arm', rect: null }, hovered: null })
  }

  /**
   * The docked layout, on or off.
   *
   * Turning it on selects `<body>` if nothing is selected yet, so the right-hand
   * panel has something to show. An empty panel next to a full tree reads as a
   * failure to load rather than as "pick something", and the body is the one
   * element that is always there and always a legitimate thing to be looking at.
   */
  toggleLayers(): void {
    const next = !store.get().layers
    store.set({ layers: next })
    if (next && !store.get().selected && document.body) this.select(document.body)
  }

  /** Folds a docked panel down to its title bar, or back open. */
  foldPanel(which: 'tree' | 'controls'): void {
    const { collapsed } = store.get()
    store.set({ collapsed: { ...collapsed, [which]: !collapsed[which] } })
  }

  /** Folds the two capture buttons out from behind the camera, and back. */
  toggleShotTools(): void {
    store.set({ shotOpen: !store.get().shotOpen })
  }

  cancelScreenshot(): void {
    if (store.get().shot) store.set({ shot: null })
  }

  /** Called by the overlay once a region has been dragged out. */
  async finishScreenshot(rect: ShotRect): Promise<void> {
    store.set({ shot: { phase: 'busy', rect } })
    await this.deliverShot(captureRegion(rect))
  }

  /**
   * The whole page, no dragging. One click, and the only thing to decide
   * afterwards is where to paste it.
   *
   * It goes through the same tile walk as a dragged region — the page is
   * scrolled through the viewport a screen at a time — so a long page takes a
   * few seconds and the page visibly moves while it happens. Our chrome is
   * hidden throughout (it would otherwise be in the picture), which is why the
   * flash at the end matters: it is the only thing that says the scrolling was
   * ours and that it is over.
   */
  async captureFullPage(): Promise<void> {
    if (store.get().shot) return
    const rect = fullPage()
    this.select(null)
    store.set({ shot: { phase: 'busy', rect }, hovered: null })
    await this.deliverShot(captureRegion(rect))
  }

  private async deliverShot(work: Promise<ShotOutcome>): Promise<void> {
    const outcome = await work
    store.set({ shot: null })
    if (outcome.ok) this.flash()
    this.toast(
      outcome.ok
        ? outcome.how === 'clipboard'
          ? 'Screenshot copied to clipboard'
          : 'Clipboard unavailable — saved as PNG'
        : `Screenshot failed: ${outcome.error}`,
    )
  }

  private flashTimer = 0

  /**
   * The shutter. Mounted only while it runs, so the animation restarts from the
   * top on every capture rather than needing to be rewound.
   */
  private flash(): void {
    store.set({ flash: true })
    window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => store.set({ flash: false }), 460)
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
    store.set({ selected: null, extras: [], hovered: null, ...history.depths() })
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
   * One fill across the whole multi-selection.
   *
   * Every other styling control needs one unambiguous target, which is why a
   * multi-selection is otherwise a comparison view — but a fill is the exception
   * for the same reason grouping is: "make these all the same colour" is a
   * statement about the *set*, and doing it one element at a time is exactly the
   * chore the tool exists to remove.
   *
   * Whatever each element had is overridden, not merged. The set arriving in
   * three different colours is the normal case — it is usually *why* you are
   * doing this — so the ones that already differ are the point, not an obstacle.
   * Our write is inline and !important, so it lands whatever the page's own CSS
   * had to say about it.
   *
   * `live` brackets a drag: the whole slide through the picker is one undo step,
   * closed by `finishSelectionBackground` when the pointer comes up.
   */
  paintSelection(hex: string, live = false): void {
    const elements = this.selectionElements()
    if (!elements.length) return
    const write = () => {
      for (const el of elements) setBackground(el, hex)
    }
    if (live) {
      history.beginAll('fill', elements)
      write()
    } else {
      history.stepAll('fill', elements, write)
    }
    store.set(history.depths())
    store.touch()
  }

  /** Closes the step a colour drag across a multi-selection opened. */
  finishSelectionPaint(): void {
    history.commit()
    store.set(history.depths())
  }

  /** The set's own fills come back — the picker's ↺, applied to all of them. */
  clearSelectionBackground(): void {
    const elements = this.selectionElements()
    if (!elements.length) return
    history.stepAll('reset fill', elements, () => {
      for (const el of elements) clearStyle(el, 'background-color')
    })
    store.set(history.depths())
    store.touch()
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
    store.set(history.depths())
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
    store.set(history.depths())
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
    store.set(history.depths())
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
    store.set(history.depths())
    this.select(result.node)
  }

  private pasteFallback = 0

  /**
   * Ctrl/Cmd+V, as the browser sees it.
   *
   * An image wins over whatever is on our own clipboard. Having an image on the
   * system clipboard is a deliberate and recent act — you just took a
   * screenshot, or copied a picture out of another app — whereas our element
   * clipboard holds whatever you last copied here, possibly an hour ago. When
   * the two disagree, the fresher intent is the image.
   */
  private onPaste = (event: ClipboardEvent): void => {
    if (isOwnNode(event.target)) return
    // Text being pasted into a node under edit is the browser's business.
    if (store.get().editing) return

    window.clearTimeout(this.pasteFallback)
    this.pasteFallback = 0
    this.swallow(event)

    if (!store.get().selected) return
    const file = imageIn(event.clipboardData)
    if (file) void this.insertImageFile(file)
    else this.pasteIntoSelected()
  }

  /**
   * The other way in: pick a file. Opens the OS file dialog from the element
   * bar's picture button.
   *
   * The input is tagged as ours, which is load-bearing rather than tidiness —
   * `change` is one of the events the freeze swallows at the window, and it is
   * swallowed in the capture phase, so without the tag our own dialog's result
   * would be thrown away before the input ever heard about it.
   */
  pickImage(): void {
    if (!store.get().selected) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.setAttribute(OWN_NODE_ATTR, '')
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file && isImageFile(file)) void this.insertImageFile(file)
      input.remove()
    })
    document.body.append(input)
    input.click()
  }

  private async insertImageFile(file: File): Promise<void> {
    const { selected } = store.get()
    if (!selected) return
    if (tooBig(file)) {
      this.toast(`That image is too large to embed (${Math.round(file.size / 1024 / 1024)}MB)`)
      return
    }
    try {
      const img = insertImage(selected.el, await readImage(file), file.name)
      store.set(history.depths())
      this.select(img)
      this.toast(file.name ? `Added ${file.name}` : 'Image added')
    } catch (error) {
      this.toast(`Could not add the image: ${error instanceof Error ? error.message : error}`)
    }
  }

  duplicateSelected(): void {
    const { selected } = store.get()
    if (!selected) return
    const copy = clipboard.duplicate(selected.el)
    store.set(history.depths())
    this.select(copy)
  }

  /** Timestamp of the last bare "s", for the double-tap shortcut. */
  private lastS = 0

  /**
   * Keys that belong to the editor as a whole rather than to whatever has the
   * focus: undo, redo, and Escape. They are answered even when a control in our
   * own chrome is focused, because "I just clicked a button, now undo that"
   * is the single most common thing anyone does with this tool.
   *
   * A field being typed into is the exception, and the reason for reading the
   * *composed* target: our overlay lives in a shadow root, so by the time the
   * event reaches window its target has been retargeted to the host div and
   * every control in the bar looks identical from out here. Inside a field,
   * Ctrl+Z is text undo and Escape reverts the value — both are the field's.
   */
  private isGlobalKey(event: KeyboardEvent): boolean {
    const focused = event.composedPath()[0]
    if (focused instanceof HTMLElement) {
      const typing =
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused.isContentEditable
      if (typing) return false
    }
    if (event.key === 'Escape') return true
    if (!(event.ctrlKey || event.metaKey)) return false
    const key = event.key.toLowerCase()
    return key === 'z' || key === 'y'
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    /**
     * Anything typed into our own chrome — a hex box, the font search, a number
     * field — belongs to that control. Without this, typing "s" twice in the
     * font search armed the screenshot, and Delete hid the element being styled.
     *
     * Only *typing*, though. Clicking a swatch or a stack button leaves the
     * focus on that button, and everything after it was arriving here with an
     * own-node target and being dropped on the floor — which is why Ctrl+Z
     * "sometimes" did nothing: it did nothing whenever the last thing you
     * touched was the element bar, which is to say almost always. The
     * whole-editor keys are answered wherever the focus happens to be sitting;
     * a text field still keeps Escape and its own native Ctrl+Z.
     */
    if (isOwnNode(event.target) && !this.isGlobalKey(event)) return

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
      // Shift+Z and Ctrl+Y are the same thing on either half of the world's
      // keyboards; both are accepted so neither camp has to learn the other's.
      if (key === 'z' || key === 'y') {
        this.swallow(event)
        if (key === 'y' || event.shiftKey) this.redo()
        else this.undo()
        return
      }
      if (key === 'g' && event.shiftKey && selected) {
        this.swallow(event)
        this.ungroupSelection()
        return
      }
      if (selected && key === 'v') {
        /**
         * Not swallowed, unlike its neighbours — only kept from the page.
         *
         * Cancelling the keydown would cancel the browser's paste along with it,
         * and the browser's paste is the only way to see what is on the *system*
         * clipboard without asking for the clipboardRead permission. So the
         * keystroke is allowed to produce its `paste` event, onPaste decides
         * between an image and one of our own elements, and the timer below is
         * the safety net for the case where no paste event arrives at all —
         * which is what happens when nothing on the page can take the focus.
         */
        event.stopPropagation()
        window.clearTimeout(this.pasteFallback)
        this.pasteFallback = window.setTimeout(() => {
          this.pasteFallback = 0
          this.pasteIntoSelected()
        }, 150)
        return
      }
      if (selected && (key === 'c' || key === 'x' || key === 'd')) {
        this.swallow(event)
        if (key === 'c') this.copySelected()
        else if (key === 'x') {
          this.copySelected()
          this.hideSelected()
        } else this.duplicateSelected()
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

    if (event.key === 'Escape') {
      this.swallow(event)
      // Everything off in one press; a second press on an already-clear screen
      // closes the tool. Exiting is never something Escape does by surprise —
      // there is always a visibly empty screen in between.
      if (!this.standDown()) this.deactivate()
      return
    }

    /**
     * Nothing else reaches the page. A single letter is a shortcut on a great
     * many sites — "/" opens a search, "j" and "k" walk a feed, "g" then "h"
     * goes home — and a keystroke that navigates out from under the editor is
     * the same failure as a click that does.
     *
     * What is left alone is what was never the page's to begin with: anything
     * held with Ctrl/Cmd (reload, new tab, the browser's own find) and the
     * function keys. Preventing those would be us breaking the browser, which
     * is a good deal worse than a page hotkey firing.
     */
    if (editing || event.ctrlKey || event.metaKey || /^F\d+$/.test(event.key)) return
    this.swallow(event)
  }

  private swallow = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  /**
   * The blanket freeze (see FROZEN). Two things are let through: our own chrome,
   * which is where the event was aimed in the first place, and the text node
   * being edited, which needs its caret, its keystrokes and its input events to
   * behave exactly as the browser would have them.
   */
  private freeze = (event: Event): void => {
    if (isOwnNode(event.target)) return
    const { editing } = store.get()
    if (editing && (event.target === editing || editing.contains(event.target as Node))) return
    this.swallow(event)
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
