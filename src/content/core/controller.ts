import { OWN_NODE_ATTR } from '@/shared/constants'
import { auditAlt, auditAria, auditContrast, auditTabOrder } from './audit'
import * as clipboard from './clipboard'
import { consumedByDrag, startDrag } from './drag'
import { describe } from './geometry'
import * as history from './history'
import { commitShift, findShift } from './reorder'
import { addFill, readFill, readRadius, readSpacing, readStrokeWidths, setBackground } from './box'
import * as canvas from './canvas'
import * as changes from './changes'
import { beginCanvasMove } from './canvasMove'
import { bandBetween, elementsIn } from './marquee'
import * as objects from './objects'
import * as frames from './frames'
import { clearStyle, editedCount, revertAll, setStyle } from './styles'
import { hoveredField } from '../ui/NumberField'
import * as shield from './shield'
import { setXray } from './xray'
import { watchZoom } from './zoom'
import * as group from './group'
import {
  deepestAt,
  documentOrder,
  isOwnNode,
  isTargetable,
  resolveTarget,
  rootScope,
} from './picker'
import { beginMove } from './move'
import { imageIn, insertImage, isImageFile, readImage, tooBig } from './images'
import { captureRegion, fullPage, type ShotOutcome, type ShotRect } from './screenshot'
import * as saveFile from './saveFile'
import { readState, type SnapshotState } from './snapshot'
import { nodeOf, store, type BoxGroup, type Lens, type LensKind } from './store'
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
    window.addEventListener('keyup', this.onKeyUp, opts)
    // Alt-tabbing away is a keydown with no keyup: without this the grab cursor
    // outlives the key that asked for it and the page looks stuck.
    window.addEventListener('blur', this.onBlur)
    /**
     * Not passive, and that is the whole point: on the canvas the wheel is how
     * you pan and zoom, so its default has to be preventable. It is registered
     * whether or not the canvas is on — the handler returns immediately when it
     * is off, which is cheaper than adding and removing a listener every time
     * the switch is flipped.
     */
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false })
    for (const type of FROZEN) window.addEventListener(type, this.freeze, opts)
    window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', this.onViewportChange, { passive: true })
    this.startTracking()
    this.paintCursor()
    this.stopZoomWatch = watchZoom()
    // A copy made in another tab lights up this tab's paste button while the
    // user is still on their way over.
    this.stopClipboardWatch = clipboard.watchShared(() => store.touch())
    saveFile.startAutosave()
    this.reopenSavedCanvas()
  }

  /**
   * A saved canvas, opened again.
   *
   * The file carries the board's view and its surface, so reopening it puts you
   * back exactly where you left rather than at a freshly computed framing. The
   * panels come up too: a `.dom.html` is a document made in canvas mode, and
   * opening it into the ordinary page editor would be answering a question
   * nobody asked.
   */
  private reopenSavedCanvas(): void {
    const state = readState()
    if (!state) return
    this.saved = state
    if (!this.surfaceBound) {
      canvas.onSurface(frames.restore, frames.park)
      this.surfaceBound = true
    }
    /**
     * The reader baked into the file has already painted the board by the time
     * we get here, using the same three declarations `canvas.enter` is about to
     * write. They are cleared first so that what `enter` records as "the page's
     * own style" is the page's own style, and not the viewer's staging — without
     * this, exiting the editor would leave the file transformed and scrolled
     * shut, which looks exactly like a bug and is one.
     */
    document.body.style.removeProperty('transform')
    document.documentElement.style.removeProperty('overflow')
    document.documentElement.style.removeProperty('background')

    canvas.setSurface(state.surface)
    canvas.enter(state.view)
    shield.raise()
    store.set({ layers: true })
  }

  /** The state block of the file this tab is, if it is one. */
  private saved: SnapshotState | null = null

  /** True on a reopened canvas — the panels and the title bar say so. */
  isSavedCanvas(): boolean {
    return Boolean(this.saved)
  }

  savedState(): SnapshotState | null {
    return this.saved
  }

  /** The share copy: a file in Downloads, nothing remembered. */
  downloadCanvas(): void {
    void saveFile.download()
  }

  /** Ctrl+S — the system dialogue once, then straight to that file. */
  saveCanvas(): void {
    void saveFile.save()
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
    window.removeEventListener('keyup', this.onKeyUp, opts)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('wheel', this.onWheel, { capture: true })
    for (const type of FROZEN) window.removeEventListener(type, this.freeze, opts)
    window.removeEventListener('scroll', this.onViewportChange, opts)
    window.removeEventListener('resize', this.onViewportChange)
    this.stopTracking()
    this.stopZoomWatch?.()
    this.stopZoomWatch = null
    this.stopClipboardWatch?.()
    this.stopClipboardWatch = null
    shield.lower()
    saveFile.stopAutosave()
    saveFile.forgetTarget()
    this.saved = null
    this.stopEditing()
    setXray(false)
    this.stopLensWatch()
    canvas.exit()
    frames.clear()
    this.spaceHeld = false
    this.altHeld = false
    this.paintCursor()
    history.clear()
    changes.clear()
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
    const { editing, selected, extras, hovered, xray, lens, shot, adaOpen, shotOpen, tool, shapesOpen } =
      store.get()
    const busy = Boolean(
      editing ||
      selected ||
      extras.length ||
      hovered ||
      xray ||
      lens ||
      shot ||
      adaOpen ||
      shotOpen ||
      tool ||
      shapesOpen,
    )
    if (!busy) return false

    this.stopEditing()
    if (xray) setXray(false)
    if (lens) this.stopLensWatch()
    if (tool) queueMicrotask(() => this.paintCursor())
    // The pending half of a drag would otherwise land on the next thing edited.
    history.commit()
    store.set({
      selected: null,
      extras: [],
      hovered: null,
      peers: [],
      xray: false,
      lens: null,
      adaOpen: false,
      shotOpen: false,
      shapesOpen: false,
      // An armed tool is one of the things Escape is for: you picked the
      // rectangle, changed your mind, and the next click should select again.
      tool: null,
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
    store.set({ selected: nodeOf(el), extras: [], hovered: null, expanded: unfolded(el) })
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
    this.paintCursor()
  }

  stopEditing(): void {
    const { editing } = store.get()
    if (!editing) return
    editing.removeAttribute('contenteditable')
    clearSelection()
    window.getSelection()?.removeAllRanges()
    store.set({ editing: null })
    this.paintCursor()
  }

  // — listeners ————————————————————————————————————————————————

  /**
   * The container the pointer is being read against.
   *
   * Two answers, and the whole drill-down falls out of choosing between them:
   *
   *  - Inside the current selection, the selection. Its children are what is on
   *    offer, which is what makes the next click go one level deeper.
   *  - Still at the depth you have drilled to — over the selection itself, or
   *    over one of its siblings — the selection's parent. So a run of cards can
   *    be walked across at the level you reached them, and pointing at the thing
   *    already selected keeps it rather than throwing you back to the top.
   *  - Anywhere else, the innermost container that still covers most of the
   *    board — see `rootScope`. So the first thing you hover is a main region of
   *    the page rather than either the whole document or the one paragraph your
   *    cursor happens to be over.
   *
   * Derived per event rather than stored, which is what keeps it honest: moving
   * the pointer somewhere unrelated puts you back at the top without anything
   * having to remember to reset, and selecting something else re-roots the chain
   * by itself.
   *
   * Null off the canvas, where the old rule stands (see `resolveTarget`).
   */
  private hitScope(x: number, y: number): HTMLElement | null {
    if (!canvas.active() || !document.body) return null
    const deepest = deepestAt(x, y)
    if (!deepest) return null

    const chosen = store.get().selected?.el
    if (chosen && chosen !== document.body) {
      if (chosen !== deepest && chosen.contains(deepest)) return chosen
      const parent = chosen.parentElement
      if (parent && parent.contains(deepest)) return parent
    }
    // A canvas object is a board of its own, so its own box is the root there.
    return rootScope(deepest, frames.frameOf(deepest) ?? document.body)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (store.get().interaction !== 'idle') return
    if (isOwnNode(event.target)) return
    const { selected, hovered, editing } = store.get()
    if (editing) return
    const target = resolveTarget(
      event,
      selected?.el ?? null,
      this.hitScope(event.clientX, event.clientY),
    )
    if (!target || target === selected?.el) {
      if (hovered) store.set({ hovered: null, peers: [] })
      return
    }
    if (hovered?.el === target) return
    store.set({ hovered: nodeOf(target), peers: peersOf(target) })
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (isOwnNode(event.target)) return
    const { editing, selected, interaction } = store.get()
    // Let the host page keep caret handling while a text node is being edited.
    if (editing?.contains(event.target as Node)) return
    event.preventDefault()

    /**
     * Panning outranks selecting. Held with a threshold, so a shift-*click* still
     * adds to the selection and only a shift-*drag* moves the view — the trailing
     * click of a real drag is swallowed by consumedByDrag() as it is everywhere
     * else in the product.
     */
    /**
     * The right button pans too.
     *
     * Middle-drag is the convention and half the mice in the world make it
     * awkward or impossible — a laptop trackpad has no middle button at all. The
     * context menu is already suppressed while the editor is on (see FROZEN), so
     * the button is sitting there unused, and "hold right and move" is what
     * people try when space-drag does not occur to them.
     */
    if (
      canvas.active() &&
      (event.shiftKey || this.spaceHeld || event.button === 1 || event.button === 2)
    ) {
      this.beginPan(event)
      return
    }
    if (interaction !== 'idle' || event.button !== 0) return

    /**
     * An armed tool owns the next press, ahead of selecting, panning and
     * marquee alike: you picked the rectangle tool, so this press is a
     * rectangle, wherever it landed.
     */
    const armed = store.get().tool
    if (armed && canvas.active()) {
      this.drawWith(armed, event)
      return
    }

    /**
     * Alt+drag lifts a copy of whatever is under the cursor onto the canvas and
     * carries on dragging it, so pulling a section out and putting it somewhere
     * is one gesture rather than three.
     *
     * Ahead of the modifier guard below, which returns on any held key: Alt is
     * the one modifier that now means something on press as well as on click.
     * A threshold inside the drag keeps the two apart — travel lifts, and a bare
     * Alt+*click* still falls through to the handler that steps out to the
     * parent, because it never travelled.
     */
    if (canvas.active() && event.altKey) {
      if (this.liftAndDrag(event)) return
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return

    /**
     * A drag that starts on nothing draws a band. `deepestAt` returning null is
     * what "nothing" means: the empty surface beside the frame, or the frame's
     * own background between two sections. It is checked before the selection
     * branches below because the band has to be available with something already
     * selected — you pick three cards, then pick four different ones, without a
     * deselecting click in between.
     */
    if (canvas.active() && !selected && !deepestAt(event.clientX, event.clientY)) {
      this.beginMarquee(event)
      return
    }

    // Dragging anywhere inside the current selection moves it (PRD §3.4) —
    // including over its own text, which is where a designer naturally grabs a
    // card. The 4px threshold inside beginMove keeps click-to-select and
    // double-click-to-edit intact on the very same pixels; modified clicks are
    // left alone because those mean "re-target the selection", not "move it".
    if (!selected) return

    /**
     * The artboard is a thing on the canvas too, and the first gesture anyone
     * tries on it is to push it around. Dragging it *is* panning the view — the
     * frame is the page, and a page does not move within itself — so it hands
     * over to the same pan the space bar arms.
     *
     * Ahead of the hit test rather than after it, because half of the artboard's
     * draggable area is the part with nothing on it: `deepestAt` returns null
     * over the frame's own background and the gesture died there. And the branch
     * below could never have served: `body` contains everything under the
     * cursor, so it read the drag as "re-home the entire document".
     */
    if (canvas.active() && selected.el === document.body) {
      this.beginPan(event)
      return
    }

    const under = deepestAt(event.clientX, event.clientY)
    if (!under) {
      // Selected, but the press landed on nothing — draw a band from here.
      if (canvas.active()) this.beginMarquee(event)
      return
    }

    /**
     * More than one thing picked: the whole set travels together, freely, as
     * the objects the marquee made them look like. Re-homing a set into a new
     * parent is not a gesture anyone can aim, and it is not what "move these
     * four things left a bit" ever meant.
     */
    const chosen = this.selectionElements()
    if (
      chosen.length > 1 &&
      canvas.active() &&
      chosen.some((el) => el === under || el.contains(under))
    ) {
      beginCanvasMove(chosen, event)
      return
    }

    if (under === selected.el || selected.el.contains(under)) {
      /**
       * A variation is not in the page's flow, so dragging it cannot mean
       * "re-home it among these siblings" the way dragging page content does.
       * It means move it on the surface, which is what a thing on a canvas does.
       */
      if (frames.isFrame(selected.el)) this.beginFrameDrag(selected.el, event)
      else beginMove(selected.el, event)
    }
  }

  private onClick = (event: MouseEvent): void => {
    if (isOwnNode(event.target)) return
    if (store.get().editing?.contains(event.target as Node)) return
    this.swallow(event)
    // The click that closes a drag belongs to the drag, not to selection.
    if (consumedByDrag()) return
    const target = resolveTarget(
      event,
      store.get().selected?.el ?? null,
      this.hitScope(event.clientX, event.clientY),
    )
    if (!target) {
      /**
       * Nothing under the cursor. Off the canvas that is a click on some part of
       * the page we never select — the html or body box — and is rightly
       * ignored. On the canvas it is a click on the empty surface around the
       * frame, which in any design tool means "deselect".
       */
      if (canvas.active() && !event.shiftKey) this.select(null)
      return
    }
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
  /**
   * Variations are parked when the canvas folds away and put back when it
   * returns. Registered here rather than inside canvas.ts so that module goes
   * on owning a transform and nothing else.
   */
  private surfaceBound = false

  toggleLayers(): void {
    if (!this.surfaceBound) {
      canvas.onSurface(frames.restore, frames.park)
      this.surfaceBound = true
    }
    const next = !store.get().layers
    if (next) {
      canvas.enter()
      shield.raise()
    } else {
      canvas.exit()
      shield.lower()
    }
    /**
     * Nothing is selected on the way in.
     *
     * `body` used to be, so that the right-hand panel had something to show. It
     * was the wrong trade by a distance: selecting the artboard makes the
     * artboard the hit-test scope, so hovering anywhere in the page offered only
     * `body`'s own two or three children — on a real site a header and one
     * enormous content box — and the whole page appeared to have no hover state
     * at all. An empty selection shows the canvas's own properties instead,
     * which is a better answer to "nothing is selected" anyway.
     */
    store.set({ layers: next, selected: null, extras: [], hovered: null, peers: [] })
  }

  /**
   * Brings an element into view on the page.
   *
   * Only for selections made somewhere other than the canvas — the tree most of
   * all, where the whole point is reaching things you cannot currently see. A
   * canvas click never calls this: you clicked what was already in front of you,
   * and scrolling the page out from under the cursor in response would be the
   * tool moving the thing you had just pointed at.
   *
   * An element already fully on screen is left alone, so clicking down a list of
   * siblings does not jog the page on every one. Something taller than the
   * window is aligned to its top rather than centred, because the middle of a
   * very tall section shows you nothing that identifies it.
   */
  reveal(el: HTMLElement): void {
    // On the canvas the document does not scroll at all, so "go to it" means
    // moving the view rather than the page.
    if (canvas.active()) {
      canvas.reveal(el)
      return
    }
    const rect = el.getBoundingClientRect()
    const visible =
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth
    if (visible) return
    /**
     * Instant, not smooth. A smooth scroll does not survive the editor being
     * active — measured: with the editor off it lands where it should, with it
     * on it travels two pixels and stops, whether or not anything is selected
     * and whether or not the panels are up. Something in the always-on
     * machinery supersedes the animation, and an animation that is silently
     * cancelled is worse than none.
     *
     * It is also the better interaction for this. Half a second of animated
     * scrolling means half a second of the selection frame chasing the element
     * down the screen, and clicking a layer to go to it is a navigation, not a
     * transition.
     */
    el.scrollIntoView({
      block: rect.height > window.innerHeight ? 'start' : 'center',
      inline: 'nearest',
      behavior: 'auto',
    })
  }

  /**
   * The zoom button: 100%, then fit, then 100% again.
   *
   * Two zooms rather than a menu of them. Life size is where you edit and fit is
   * where you look at the whole thing, and every other value on the way between
   * them is better reached with the wheel than picked off a list.
   */
  stepZoom(): void {
    if (!canvas.active()) return
    if (Math.abs(canvas.scale() - 1) < 0.01) canvas.fit()
    else canvas.zoomTo(1)
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
  /**
   * Delete — and it takes the thing away.
   *
   * This used to hide a page element rather than remove it, on the reasoning
   * that the page belongs to the site and hiding is the reversible edit. That
   * was the wrong call in practice: Delete that leaves the element in the tree,
   * still listed, still occupying its place in the document, is a Delete that
   * appears not to have worked — and the reversibility it was protecting is
   * already provided, properly, by undo and by Reset.
   *
   * So everything goes: shapes we made, variations we lifted, and the page's own
   * markup alike. `recordRemove` keeps each node's parent and next sibling, so
   * Ctrl+Z puts it back exactly where it was.
   */
  hideSelected(): void {
    const elements = this.selectionElements().filter((el) => el !== document.body)
    if (!elements.length) return
    // Written down while they still exist: a removed element cannot describe
    // itself, and the change report needs to be able to name it later.
    for (const el of elements) changes.noteRemoval(el)
    history.recordRemove('delete', elements)
    store.set({ selected: null, extras: [], hovered: null, ...history.depths() })
  }

  /** Ctrl/Cmd+C — takes a detached clone, so the original can change afterwards. */
  /**
   * Hidden, or shown again — the tree's eye.
   *
   * Distinct from Delete, which now removes outright: this is the "let me see
   * the page without this" toggle every layers panel has, and its whole value is
   * that the row stays where it is so you can put the element back. Written as
   * `display: none` through the ordinary style path, so it lands on the undo
   * stack and Reset clears it like any other edit.
   */
  toggleVisible(el: HTMLElement): void {
    const hidden = window.getComputedStyle(el).display === 'none'
    history.step(hidden ? 'show' : 'hide', el, () => {
      if (hidden) clearStyle(el, 'display')
      else setStyle(el, 'display', 'none')
    })
    store.set(history.depths())
    store.remeasure()
  }

  /**
   * A run of elements picked at once — a Shift+click range in the tree.
   *
   * The first is the primary, because the single-target controls have to act on
   * something and the row you started the range from is the one you were
   * thinking about. `select` is deliberately not reused: it clears extras, which
   * is the whole of what this is trying to set.
   */
  selectMany(elements: HTMLElement[]): void {
    const ordered = documentOrder(elements.filter((el) => el.isConnected))
    const [primary, ...rest] = ordered
    if (!primary) return
    this.stopEditing()
    store.set({
      selected: nodeOf(primary),
      extras: rest.map((el) => nodeOf(el)),
      hovered: null,
      expanded: unfolded(primary),
    })
  }

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
    changes.noteInsert(wrapper, plan.parent)
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
    if (!clipboard.has()) return
    /**
     * On the canvas, a paste with nothing picked lands as an object in the
     * middle of the view; a paste *into* something lands inside it.
     *
     * The first half is what a board is for — you copied a section to try it
     * beside the original, and the middle of the screen is where it can be seen.
     * The second is the half this used to refuse: selecting a container and
     * pressing Ctrl+V is an unambiguous instruction about where the copy goes,
     * and answering it by putting the copy somewhere else entirely is the tool
     * overruling a decision the user already made. The artboard does not count
     * as a target — "into the page" is what the free-standing paste already
     * means, and it means it in a place you can see.
     */
    if (canvas.active() && (!selected || selected.el === document.body)) {
      this.pasteAsFrame()
      return
    }
    if (!selected) return
    const result = clipboard.paste(selected.el)
    if (!result) return
    changes.noteInsert(result.node, result.container)
    store.set(history.depths())
    this.select(result.node)
  }

  private pasteFallback = 0

  /**
   * Ctrl/Cmd+V, as the browser sees it.
   *
   * Reached now only when our own clipboard is empty — the keydown handler
   * answers the keystroke itself otherwise — or when the paste came from the
   * browser's own menu. The old rule here was that a system image outranked our
   * element clipboard, on the theory that having an image on the system
   * clipboard is a recent, deliberate act. It is not: on Windows there is
   * almost always a screenshot sitting there, and the theory cost people the
   * thing they had just copied. An image now only wins when there is nothing of
   * ours to lose.
   */
  private onPaste = (event: ClipboardEvent): void => {
    if (isOwnNode(event.target)) return
    // Text being pasted into a node under edit is the browser's business.
    if (store.get().editing) return

    window.clearTimeout(this.pasteFallback)
    this.pasteFallback = 0
    this.swallow(event)

    // A paste onto the canvas needs no selection — it makes its own variation.
    if (!store.get().selected && !canvas.active()) return
    if (clipboard.has()) {
      this.pasteIntoSelected()
      return
    }
    const file = imageIn(event.clipboardData)
    // An image needs something to go into; on the canvas that is not a
    // requirement our own paste has, which is why this is checked here and not
    // at the top.
    if (file && store.get().selected) void this.insertImageFile(file)
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

  /** Whatever is on the clipboard, as a new variation on the surface. */
  private pasteAsFrame(): void {
    // Styled, because this copy is about to leave the context that dressed it.
    const nodes = clipboard.takeStyled()
    if (!nodes.length || !document.body) return

    /**
     * Staged in a live element before being lifted, which is the fix for a paste
     * that produced a 40px sliver of unstyled markup.
     *
     * `lift` resolves the cascade into its copy by reading computed styles, and
     * it sizes the frame from `offsetWidth`. A detached `<div>` — which is what
     * this used to be — has neither: nothing out of the document has a computed
     * style worth reading or any width at all, so the paste arrived with no
     * styling and no size. Hidden by `visibility` rather than by `display`,
     * because `display: none` takes the layout away again, and laid out at the
     * artboard's width so blocks measure as they would on the page.
     */
    const holder = document.createElement('div')
    holder.setAttribute(OWN_NODE_ATTR, '')
    /**
     * `fit-content` inside the artboard's width, not the artboard's width flat.
     *
     * A card that was `flex: 1` in a row has no width of its own — as a block
     * child of a page-wide box it filled all 737 pixels of it, and the paste
     * arrived as a letterbox. Shrink-wrapping gives it the width its content
     * asks for, and the `max-width` keeps a genuinely page-wide section from
     * laying out a mile wide instead.
     */
    holder.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:fit-content;max-width:${document.body.offsetWidth}px`
    holder.append(...nodes)
    document.body.append(holder)
    const lifted = frames.lift(nodes)
    holder.remove()
    if (!lifted) return
    /**
     * Centred on the view, which takes two steps: lifted first so it is in the
     * document and can be measured, then placed once its own size is known. A
     * frame is positioned by its top-left corner, and centring by that corner
     * would leave anything sizeable hanging off the bottom right of the screen.
     */
    const [cx, cy] = canvas.viewCentre()
    frames.place(lifted, cx - lifted.offsetWidth / 2, cy - lifted.offsetHeight / 2)
    this.select(lifted)
    this.toast('Pasted onto the canvas')
  }

  duplicateSelected(): void {
    const { selected } = store.get()
    if (!selected) return
    // A variation duplicates beside itself on the surface; page content
    // duplicates in place next to its original.
    if (frames.isFrame(selected.el)) {
      const copy = frames.duplicate(selected.el)
      if (copy) this.select(copy)
      return
    }
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
    /**
     * Space, wherever the focus happens to be.
     *
     * Holding space arms the pan, and the flag that records it was only ever set
     * when the page had the focus — so after touching any control in our own
     * chrome, which is most of the time, space-drag silently stopped working and
     * there was nothing on screen to say why. It is a canvas modifier, not a
     * control's key, and a control that wants it (a text field) is excluded
     * above along with everything else that takes typing.
     */
    if (event.code === 'Space') return true
    /**
     * Delete, likewise — and this is why it "stopped working after a while".
     *
     * Every key was being dropped whenever the focus sat inside our own chrome,
     * which is where it lands the moment you type into a hex box or the font
     * search and stays until you click the page again. So Delete worked, and
     * worked, and then silently did nothing for the rest of the session with no
     * sign of why. Removing the selection is a whole-editor action like undo, not
     * a control's key; the text fields that genuinely want Backspace are already
     * excluded above, along with everything else that takes typing.
     */
    if (event.key === 'Delete' || event.key === 'Backspace') return true
    if (!(event.ctrlKey || event.metaKey)) return false
    const key = event.key.toLowerCase()
    // Save belongs to the document, not to whatever has the focus — Ctrl+S with
    // the caret in a hex box still means save the board.
    return key === 'z' || key === 'y' || key === 's'
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
    /**
     * A number box under the cursor takes the arrows before the canvas does.
     *
     * Ahead of the own-node guard below, because the field being pointed at is
     * usually not the thing with the focus — the focus is wherever you last
     * clicked, which is generally the page. Without this the keystroke fell
     * through to the branch that reorders the selected element, so pointing at a
     * padding field and pressing Shift+Up moved the card instead of changing its
     * padding.
     */
    if (!store.get().editing && hoveredField.current?.(event)) {
      this.swallow(event)
      return
    }

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

    /**
     * Alt down, on the canvas: the cursor says a copy can be dragged off.
     *
     * Not swallowed and not returned on — Alt is a modifier, other handlers and
     * the page's own may care about the same press, and this only adds the
     * cursor. It is the missing half of a gesture that was otherwise invisible
     * until something had already been lifted.
     */
    if (event.altKey && canvas.active() && !editing && !this.altHeld) {
      this.altHeld = true
      this.paintCursor()
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

    // Ahead of the `!editing` gate below: saving is the one accelerator that
    // means the same thing with a caret in the page as without one.
    if (accel && key === 's') {
      this.swallow(event)
      this.saveCanvas()
      return
    }

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
      if ((selected || canvas.active()) && key === 'v') {
        /**
         * Our own clipboard wins, and it is pasted here and now.
         *
         * This used to hand the keystroke to the browser and wait up to 150ms
         * for a `paste` event, so that onPaste could look at the *system*
         * clipboard — the only way to see it without the clipboardRead
         * permission. Two bugs lived in that wait, and both were reported as
         * "paste doesn't work". Anything on the system clipboard outranked what
         * you had just copied in the editor, so with a screenshot in the OS
         * clipboard — which on Windows is most of the time — Ctrl+V pasted the
         * screenshot, or with nothing selected pasted nothing at all and looked
         * broken. And when no element on the page could take the focus, no paste
         * event ever arrived and the timer was doing all the work anyway.
         *
         * So: if we are holding something, that is what Ctrl+V means, full stop.
         * The system clipboard is still reachable — it is what Ctrl+V does when
         * our own clipboard is empty, and the picture button and drag-and-drop
         * both take an image directly.
         */
        if (clipboard.has()) {
          this.swallow(event)
          window.clearTimeout(this.pasteFallback)
          this.pasteFallback = 0
          this.pasteIntoSelected()
          return
        }
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

    /**
     * Space arms the pan. It is already prevented from scrolling the page by the
     * catch-all at the end of this handler; what is added here is the held state
     * and the cursor that advertises it.
     */
    if (event.code === 'Space' && canvas.active() && !editing) {
      this.swallow(event)
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.paintCursor()
      }
      return
    }

    /**
     * `i` — straight to the colour.
     *
     * Named for the eyedropper it leads to, and bare because picking a colour is
     * the most common thing anyone does to a selected box: the alternative is
     * finding the Fill row and hitting an 18px swatch, which is three actions to
     * reach one. The picker opens on the fill, which is what "the colour of this"
     * means for every element that is not text.
     */
    if (key === 'i' && !accel && !event.shiftKey && !event.altKey && !editing && selected) {
      this.swallow(event)
      this.openPaint('fill')
      return
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

  /**
   * The canvas's one input surface.
   *
   * A trackpad pinch arrives as a wheel event with `ctrlKey` set — the browser
   * has synthesised it that way since long before anyone wanted it to, and it is
   * why pinch-to-zoom needs no separate gesture handling. Two fingers on the pad
   * arrive as a plain wheel with both deltas, which is a pan.
   *
   * `deltaMode` is respected because a real mouse wheel on Windows reports lines
   * rather than pixels, and treating three lines as three pixels makes a mouse
   * wheel feel broken next to a trackpad.
   */
  private onWheel = (event: WheelEvent): void => {
    if (!canvas.active() || isOwnNode(event.target)) return
    event.preventDefault()
    event.stopPropagation()

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
    if (event.ctrlKey || event.metaKey) {
      // Exponential, so a notch is the same proportional step at every zoom.
      canvas.zoomAt(event.clientX, event.clientY, Math.exp((-event.deltaY * unit) / 400))
      return
    }
    canvas.panBy(-event.deltaX * unit, -event.deltaY * unit)
  }

  /**
   * Space is held down. Tracked rather than read off the event because the
   * cursor has to say "you can grab this" *before* the drag starts, which is a
   * moment at which there is no drag to ask.
   */
  private spaceHeld = false

  /** Alt, likewise: the copy-drag cursor has to be up before the drag exists. */
  private altHeld = false

  /**
   * One writer for the page's cursor, because two of them fought: releasing Alt
   * while still holding Space cleared the grab cursor the pan was relying on.
   * Both states are read here and the strongest wins.
   */
  private paintCursor(): void {
    const root = document.documentElement
    const { tool, editing } = store.get()
    if (tool) root.style.setProperty('cursor', 'crosshair', 'important')
    else if (this.spaceHeld || this.altHeld) root.style.setProperty('cursor', 'grab', 'important')
    else if (editing) root.style.removeProperty('cursor')
    /**
     * Otherwise: an arrow, over everything.
     *
     * The page's own cursors are answers to questions the editor is not asking.
     * Passing over a paragraph turned the pointer into an I-beam, which says
     * "you can select this text" — you cannot, the editor swallows the press —
     * and over a link it became a hand promising navigation that is also
     * suppressed. Every one of them describes the page's behaviour rather than
     * the tool's, and the tool's behaviour is the same everywhere: this picks
     * things. The exception is a live text edit, where the I-beam is suddenly
     * telling the truth again.
     */
    else root.style.setProperty('cursor', 'default', 'important')
  }

  private onBlur = (): void => {
    this.spaceHeld = false
    this.altHeld = false
    this.paintCursor()
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && this.spaceHeld) {
      this.spaceHeld = false
      this.paintCursor()
    }
    if (!event.altKey && this.altHeld) {
      this.altHeld = false
      this.paintCursor()
    }
  }

  /**
   * The rubber band.
   *
   * Kept in the store rather than in a local, because the band is drawn by the
   * overlay and the overlay only knows what the store tells it. The selection
   * lands on release rather than live: selecting forty elements on every frame
   * of the drag means forty remeasures a frame, and the band itself is already
   * showing what will be picked.
   */
  private beginMarquee(event: PointerEvent): void {
    const originX = event.clientX
    const originY = event.clientY
    let band = bandBetween(originX, originY, originX, originY)
    startDrag(event, {
      cursor: 'crosshair',
      threshold: 4,
      onStart: () => this.select(null),
      onMove: (drag) => {
        band = bandBetween(originX, originY, drag.x, drag.y)
        store.set({ band })
      },
      onEnd: () => {
        store.set({ band: null })
        // A band nobody could see selected nothing: a stray two-pixel drag on
        // the surface should read as the deselecting click it looks like.
        if (band.width < 6 && band.height < 6) return
        const found = documentOrder(elementsIn(band))
        if (!found.length) return
        store.set({
          selected: nodeOf(found[0]!),
          extras: found.slice(1).map((el) => nodeOf(el)),
          hovered: null,
        })
        this.toast(found.length === 1 ? 'One element' : `${found.length} elements selected`)
      },
    })
  }

  /**
   * Moving the artboard, from the one handle that is always reachable: its name.
   *
   * The same pan the space bar arms, and deliberately so — the frame *is* the
   * viewport's contents, so sliding the frame and sliding the view are the same
   * motion. Public because the label that offers it lives in the overlay.
   */
  grabFrame(event: PointerEvent): void {
    if (!canvas.active()) return
    this.beginPan(event)
  }

  /** Shift, Space or the middle button, dragged: move the view. */
  private beginPan = (event: PointerEvent): void => {
    const from = canvas.transform()
    /**
     * A button press with no other meaning starts panning immediately.
     *
     * The threshold exists for the *left* button, where a press is ambiguous
     * until it travels — Shift+click still adds to the selection, and only
     * Shift+drag pans. The middle and right buttons do nothing else here, so
     * waiting three pixels to show the grabbing hand only makes the tool feel
     * like it noticed late.
     */
    const unambiguous = event.button === 1 || event.button === 2
    startDrag(event, {
      cursor: 'grabbing',
      threshold: unambiguous ? 0 : 3,
      onMove: (drag) => {
        const now = canvas.transform()
        canvas.panBy(from.x + drag.dx - now.x, from.y + drag.dy - now.y)
      },
    })
  }

  /**
   * Moving a variation. Deltas are screen pixels and `left`/`top` are canvas
   * pixels, so the drag is divided by the zoom — the same conversion every other
   * drag on the canvas makes.
   */
  private beginFrameDrag(frame: HTMLElement, event: PointerEvent): void {
    const from = frames.positionOf(frame)
    startDrag(event, {
      cursor: 'grabbing',
      threshold: 3,
      onStart: () => history.begin('move variation', frame),
      onMove: (drag) => {
        const z = canvas.scale()
        frames.place(frame, from.x + drag.dx / z, from.y + drag.dy / z)
        store.remeasure()
      },
      onEnd: () => {
        history.commit()
        store.set(history.depths())
        // Dropped, and therefore done with: the chrome that was wrapped around
        // it while it travelled is just something to click past now.
        this.select(null)
      },
    })
  }

  /**
   * Alt+drag: lift a copy, then carry it.
   *
   * The copy is made on the first movement rather than on the press, so an
   * Alt+click that never travels leaves nothing behind — it is still the
   * gesture that steps out to the parent, and a stray variation appearing every
   * time someone used it would be a tax on an unrelated shortcut.
   */
  private liftAndDrag(event: PointerEvent): boolean {
    /**
     * What gets lifted is the *selection*, whenever the cursor is inside it.
     *
     * It used to be whatever `deepestAt` found under the cursor, which meant
     * Alt+dragging a selected section handed you its innermost child — you
     * grabbed a hero and got the `<h1>` inside it. The deepest element is only
     * the right answer when there is no selection to speak of, or when you are
     * pointing somewhere else entirely, which is precisely when it is also the
     * only answer available.
     */
    const under = deepestAt(event.clientX, event.clientY)
    const chosen = this.selectionElements()
    /**
     * `deepestAt` returns null over a container's own background and over the
     * artboard itself, and that used to be the end of the gesture: with the page
     * or any wrapper selected, Alt+drag did nothing at all — which is the first
     * thing anyone tries, because duplicating the whole thing you are looking at
     * is the most obvious use for a duplicate.
     *
     * Pointing at nothing while something is selected means the selection. It is
     * the only reading available — there is no other candidate under the cursor
     * — and it is the one that makes the artboard and every container draggable
     * off to the side as a copy, the same as a card is.
     */
    const overSelection = chosen.some((el) => hits(el, event.clientX, event.clientY))
    const inSelection = under
      ? chosen.some((el) => el === under || el.contains(under) || under.contains(el))
      : overSelection
    const sources = inSelection ? chosen : under ? [under] : []
    if (!sources.length) return false

    return this.carryCopy(event, sources)
  }

  /**
   * Copy these, then carry the copy — the second half of Alt+drag, on its own.
   *
   * Public because the selection's own name badge and the artboard's label are
   * both grab handles, and Alt held over either of them means the same thing it
   * means over the element itself. They cannot go through `liftAndDrag`: that
   * one works out *what* to lift from whatever is under the cursor, and the
   * cursor is over a badge floating above the element, which is not the element.
   * They already know what they stand for, so they say so.
   */
  carryCopy(event: PointerEvent, sources: HTMLElement[]): boolean {
    if (!canvas.active() || !sources.length) return false

    /**
     * And it appears where it already is, not off beside the artboard.
     *
     * `lift` with no position cascades new variations into the gutter to the
     * right of the frame, which is right for the button and wrong for a drag:
     * the copy you are supposedly holding materialised hundreds of pixels away —
     * often off screen, which is the "position jumps to the far left" of the bug
     * report, since the bar then anchors to a frame nobody can see. Landing it
     * exactly on top of its original means it is under the cursor at the instant
     * it is created, and every pixel of travel after that is the copy following
     * the hand.
     */
    const rect = sources[0]!.getBoundingClientRect()
    const [ox, oy] = canvas.screenToCanvas(rect.left, rect.top)

    let frame: HTMLElement | null = null
    let from = { x: 0, y: 0 }
    startDrag(event, {
      cursor: 'grabbing',
      /**
       * Two pixels, not four.
       *
       * From a badge the gesture is unambiguous the moment it moves — you are
       * holding the thing's name with Alt down, and there is no other reading of
       * that. The larger threshold exists on the element itself to keep a bare
       * Alt+click (which steps out to the parent) from leaving a stray copy
       * behind, and a badge has no such click to protect.
       */
      threshold: 2,
      onStart: () => {
        frame = frames.lift(sources, { x: ox, y: oy })
        if (!frame) return
        from = frames.positionOf(frame)
        this.select(frame)
      },
      onMove: (drag) => {
        if (!frame) return
        const z = canvas.scale()
        frames.place(frame, from.x + drag.dx / z, from.y + drag.dy / z)
        store.remeasure()
      },
      onEnd: () => {
        if (frame) store.set(history.depths())
        // The copy is placed; nothing is being worked on. Leaving it selected
        // left a frame and a badge over the thing you had just put down.
        this.select(null)
      },
    })
    return true
  }

  /**
   * Asks the panel to open one of its colour pickers.
   *
   * A nonce rather than a flag, so pressing `i` twice in a row opens it twice
   * even if it was closed by hand in between — see `paintRequest`.
   */
  openPaint(kind: 'fill' | 'border'): void {
    const selected = store.get().selected
    if (!selected) return
    // The controls have to be on screen for their picker to open in.
    if (!store.get().layers) store.set({ layers: true })

    /**
     * A box with no fill gets one first.
     *
     * The picker hangs off the fill's swatch, and an element that paints no
     * background of its own has no swatch — so `i` on the great majority of
     * elements opened a section containing a heading and a `+`, and nothing
     * happened. The point of the key is to be changing a colour a moment after
     * pressing it, which means there has to be a colour. Undoable in one step
     * like any other add, and the picker's own reset still hands the element
     * back to the page.
     */
    if (kind === 'fill' && !readFill(selected.el).on) {
      history.step('add fill', selected.el, () => addFill(selected.el))
      store.set(history.depths())
    }
    store.set({ paintRequest: { kind, nonce: performance.now() } })
  }

  /**
   * Copies the session's changes out as a brief for a coding agent.
   *
   * The clipboard write is attempted through the async API first and falls back
   * to a hidden textarea, because the modern one refuses whenever the document
   * is not focused — which on a page being driven through an overlay is a state
   * you land in more often than you would think. The old path has no such rule
   * and no permission prompt, so between them something always lands.
   */
  async copyChanges(): Promise<void> {
    const text = changes.brief()
    if (!text) {
      this.toast('No changes to copy yet')
      return
    }
    const count = changes.collect().length + changes.structural().length
    if (await writeToClipboard(text)) {
      this.toast(`Copied ${count} change${count === 1 ? '' : 's'} as a prompt`)
    } else {
      this.toast('Could not reach the clipboard')
    }
  }

  /** Whether the button has anything to offer — drives its enabled state. */
  hasChanges(): boolean {
    return changes.collect().length > 0 || changes.structural().length > 0
  }

  /** Folds the text and shape tools out, and away again. */
  toggleShapes(): void {
    const open = !store.get().shapesOpen
    store.set({ shapesOpen: open, tool: open ? store.get().tool : null })
    this.paintCursor()
  }

  /**
   * Arms a tool. The next press on the canvas draws with it; pressing the same
   * tool again puts it down, and so does Escape.
   */
  arm(kind: objects.ObjectKind): void {
    if (!canvas.active()) return
    const tool = store.get().tool === kind ? null : kind
    store.set({ tool, hovered: null })
    this.paintCursor()
  }

  disarm(): void {
    if (!store.get().tool) return
    store.set({ tool: null })
    this.paintCursor()
  }

  /**
   * Drawing one out, from the press that starts it.
   *
   * A drag gives the object the rect it was dragged; a press that never travels
   * gives it its default size where it was pressed, because a click is a
   * reasonable way to ask for "one of those, here" and demanding a drag for it
   * would be pedantry. The tool is put down afterwards either way — one that
   * stayed armed would turn the next click anywhere into a second rectangle.
   */
  private drawWith(kind: objects.ObjectKind, event: PointerEvent): void {
    const originX = event.clientX
    const originY = event.clientY
    let band = bandBetween(originX, originY, originX, originY)
    let dragged = false
    startDrag(event, {
      cursor: 'crosshair',
      threshold: 4,
      onStart: () => {
        dragged = true
      },
      onMove: (drag) => {
        band = bandBetween(originX, originY, drag.x, drag.y)
        store.set({ band })
      },
      onEnd: () => {
        store.set({ band: null, tool: null })
        this.paintCursor()
        const [x, y] = canvas.screenToCanvas(band.left, band.top)
        const z = canvas.scale()
        const el = dragged
          ? objects.insert(kind, { x, y }, { width: band.width / z, height: band.height / z })
          : objects.insert(kind)
        if (!el) return
        this.select(el)
        // Text arrives with the word "Text" in it, which nobody wants to keep.
        // The caret goes in straight away so the first thing typed replaces it.
        if (kind === 'text') this.startEditing(el)
      },
    })
  }

  /**
   * Lifts the selection onto the canvas as a variation — the button's route to
   * what Alt+drag does by hand.
   */
  liftSelection(): void {
    const elements = this.selectionElements()
    if (!elements.length || !canvas.active()) return
    const frame = frames.lift(elements)
    if (!frame) return
    this.select(frame)
    canvas.reveal(frame)
    this.toast(`Lifted ${describe(elements[0]!)} onto the canvas`)
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

/**
 * Which control groups open themselves for this element.
 *
 * A folded group is a promise that there is nothing under it worth seeing, and
 * on an element with 24px of padding and a 12px radius that promise is false —
 * you select it precisely because those numbers are what you came to change, and
 * finding them costs two clicks on a control that gave no sign of holding
 * anything. So a group whose property is actually in play arrives open.
 *
 * Recomputed per selection rather than remembered, which is the deliberate
 * reversal of how `expanded` used to work: it was a preference about how you
 * like to work, and it is now a statement about the thing in front of you. The
 * stroke is the exception and opens only when its edges disagree — a border of
 * one even weight is completely described by the single field that is already
 * showing, and unfolding it would be four fields saying the same number.
 */
function unfolded(el: HTMLElement): Partial<Record<BoxGroup, boolean>> {
  const padding = readSpacing(el, 'padding')
  const margin = readSpacing(el, 'margin')
  const radius = readRadius(el)
  const widths = readStrokeWidths(el)
  const some = (values: number[]) => values.some((value) => Math.abs(value) > 0.5)
  return {
    padding: some(Object.values(padding.sides)),
    margin: some(Object.values(margin.sides)),
    radius: some(Object.values(radius.corners)),
    stroke: !widths.uniform,
  }
}

/**
 * The other things you could have pointed at instead.
 *
 * The hovered element's siblings — the set it belongs to — which is what makes
 * the dotted outlines mean "and these". Capped, because a list of four hundred
 * rows would cost four hundred rects a frame to say something a dozen of them
 * already say.
 */
const PEER_LIMIT = 60

function peersOf(target: HTMLElement): HTMLElement[] {
  const parent = target.parentElement
  if (!parent) return []
  const siblings: HTMLElement[] = []
  for (const child of parent.children) {
    if (child === target || !isTargetable(child)) continue
    // A sibling with no box of its own has no outline worth drawing.
    const rect = child.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    siblings.push(child)
    if (siblings.length >= PEER_LIMIT) break
  }
  return siblings
}

/**
 * Text onto the system clipboard, by whichever route works.
 *
 * `execCommand` is deprecated and is still the more reliable of the two here: it
 * is synchronous, it needs no permission, and it does not care whether the
 * document currently holds focus. It is the fallback rather than the first
 * choice only because the async API is the one with a future.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* Not focused, or no permission. Fall through. */
  }
  try {
    const holder = document.createElement('textarea')
    holder.value = text
    holder.setAttribute(OWN_NODE_ATTR, '')
    holder.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'
    document.body.append(holder)
    holder.select()
    const ok = document.execCommand('copy')
    holder.remove()
    return ok
  } catch {
    return false
  }
}

/** Whether a point is inside an element's box, in viewport coordinates. */
function hits(el: HTMLElement, x: number, y: number): boolean {
  const box = el.getBoundingClientRect()
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

export const controller = new Controller()
