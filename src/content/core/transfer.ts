import { EDITED_ATTR, OWN_NODE_ATTR } from '@/shared/constants'

/**
 * Carrying an element from one tab to another.
 *
 * A same-tab copy is a detached clone and needs nothing else: the page's own
 * stylesheets are still there when it lands. Across tabs that assumption
 * collapses — `<div class="card">` pasted into a page that has never heard of
 * `.card` is an unstyled rectangle. So a cross-tab copy has to carry its
 * appearance with it, which means resolving the cascade at the source and
 * writing the result inline.
 *
 * Two things keep that from producing megabytes of unreadable markup:
 *
 *  - Only a curated ~80 properties are considered. Copying all 340 computed
 *    values would bloat the payload, and freezing things like `width` in pixels
 *    would make the paste rigid and clip it in a narrower container.
 *  - Every value is *diffed* before it is written. Non-inherited properties go
 *    against the browser's own default for that tag, read from a throwaway
 *    iframe that has no author CSS in it — the only place a true UA default can
 *    be observed. Inherited ones go against the parent inside the copied
 *    subtree, so a colour set once on a card isn't restated on all forty of its
 *    descendants.
 *
 * What survives is roughly what the page's CSS actually contributed, which is
 * both small and legible. Inline declarations beat any ordinary author rule in
 * the destination, so what is written wins; what is *omitted* — properties that
 * matched the UA default — can still be tinted by a destination page that styles
 * that tag directly. That is the accepted edge of this approach, and it fails in
 * the recoverable direction: the paste is a normal selectable element, so
 * anything that lands wrong is fixable with the tool it just came out of.
 */

/** `[property, inherited]` — inherited ones diff against the in-tree parent. */
const PROPERTIES: [string, boolean][] = [
  // Box and layout
  ['display', false],
  ['position', false],
  ['top', false],
  ['right', false],
  ['bottom', false],
  ['left', false],
  ['z-index', false],
  ['box-sizing', false],
  ['float', false],
  ['clear', false],
  ['min-width', false],
  ['min-height', false],
  ['max-width', false],
  ['max-height', false],
  ['aspect-ratio', false],
  ['overflow-x', false],
  ['overflow-y', false],
  ['padding-top', false],
  ['padding-right', false],
  ['padding-bottom', false],
  ['padding-left', false],
  ['margin-top', false],
  ['margin-right', false],
  ['margin-bottom', false],
  ['margin-left', false],

  // Flex and grid, both as a container and as an item
  ['flex-direction', false],
  ['flex-wrap', false],
  ['justify-content', false],
  ['align-items', false],
  ['align-content', false],
  ['align-self', false],
  ['flex-grow', false],
  ['flex-shrink', false],
  ['flex-basis', false],
  ['order', false],
  ['column-gap', false],
  ['row-gap', false],
  ['grid-template-columns', false],
  ['grid-template-rows', false],
  ['grid-auto-flow', false],
  ['grid-auto-columns', false],
  ['grid-auto-rows', false],
  ['grid-column-start', false],
  ['grid-column-end', false],
  ['grid-row-start', false],
  ['grid-row-end', false],

  // Border and its corners, longhand so a single odd side survives
  ['border-top-width', false],
  ['border-right-width', false],
  ['border-bottom-width', false],
  ['border-left-width', false],
  ['border-top-style', false],
  ['border-right-style', false],
  ['border-bottom-style', false],
  ['border-left-style', false],
  ['border-top-color', false],
  ['border-right-color', false],
  ['border-bottom-color', false],
  ['border-left-color', false],
  ['border-top-left-radius', false],
  ['border-top-right-radius', false],
  ['border-bottom-right-radius', false],
  ['border-bottom-left-radius', false],

  // Paint
  ['background-color', false],
  ['background-image', false],
  ['background-size', false],
  ['background-position', false],
  ['background-repeat', false],
  ['background-clip', false],
  ['background-origin', false],
  ['background-attachment', false],
  ['box-shadow', false],
  ['opacity', false],
  ['mix-blend-mode', false],
  ['filter', false],
  ['transform', false],
  ['transform-origin', false],
  ['object-fit', false],
  ['object-position', false],
  ['clip-path', false],
  /**
   * Masks matter more than they look. Icon strips are built by putting the file
   * in `mask-image` and the colour in `background-color`, so a masked span is
   * invisible to anything that only looks at backgrounds — and because the file
   * is usually reached through a custom property, resolving the cascade is also
   * what makes its relative URL absolute.
   */
  ['mask-image', false],
  ['mask-size', false],
  ['mask-repeat', false],
  ['mask-position', false],
  ['-webkit-mask-image', false],
  ['-webkit-mask-size', false],
  ['-webkit-mask-repeat', false],
  ['-webkit-mask-position', false],

  // Tables, which size themselves by rules of their own
  ['border-collapse', true],
  ['border-spacing', true],
  ['table-layout', false],
  ['vertical-align', false],

  // Type — nearly all inherited, which is what makes the parent diff pay off
  ['color', true],
  ['font-family', true],
  ['font-size', true],
  ['font-weight', true],
  ['font-style', true],
  ['font-variant', true],
  ['font-stretch', true],
  ['line-height', true],
  ['letter-spacing', true],
  ['word-spacing', true],
  ['text-align', true],
  ['text-transform', true],
  ['text-indent', true],
  ['text-shadow', true],
  ['white-space', true],
  ['word-break', true],
  ['overflow-wrap', true],
  ['text-overflow', false],
  ['-webkit-text-fill-color', true],
  ['direction', true],
  ['visibility', true],
  ['cursor', true],
  ['list-style-type', true],
  ['list-style-position', true],
  ['text-decoration-line', false],
  ['text-decoration-color', false],
  ['text-decoration-style', false],
  ['text-decoration-thickness', false],
  ['text-underline-offset', false],

  // SVG paint, so an inline icon arrives the right colour
  ['fill', true],
  ['stroke', true],
  ['stroke-width', true],
]

/** Elements whose size is intrinsic rather than derived from their contents. */
const REPLACED = new Set([
  'IMG', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT', 'PROGRESS', 'METER', 'HR',
])

/** Nothing inside to give it a size, so whatever size it has came from CSS. */
const isEmpty = (el: Element): boolean =>
  !el.firstElementChild && !(el.textContent ?? '').trim()

/**
 * When a size has to travel.
 *
 * Not for everything: freezing a card at 328px would clip it in a narrower
 * destination, and flow sizes it perfectly well. But an element with *no content*
 * has nothing else to go on — the three 22px swatch squares in the test donor
 * page arrived as three invisible 0×0 boxes until this existed — and a replaced
 * element's size is intrinsic to it.
 */
const carriesSize = (el: Element): boolean =>
  REPLACED.has(el.tagName.toUpperCase()) || isEmpty(el)

const BLOCKISH = /^(block|flex|grid|flow-root|list-item|table)$/

/**
 * Whether a box's width belongs to it or to its container.
 *
 * Computed style can't say — `width` reports used pixels whether the author wrote
 * `220px` or left it `auto` — so it is inferred by comparing against the parent's
 * content box. A block or an image that exactly fills its parent was almost
 * certainly stretched to it, and carrying that measurement is how a copied
 * divider ends up 602px wide inside a 300px column.
 *
 * Only the *width* is decided this way. The same test on height is circular: a
 * flex row hugs its tallest child, so a 22px swatch square inside a 22px-tall row
 * looks stretched by exactly the height it gave the row, and skipping it left the
 * square 22px wide and invisible. Nothing stretches vertically in normal flow
 * anyway, so height simply travels — and when the two are wrong, the failure that
 * matters is the invisible one, not the one that overflows in plain sight.
 */
function stretchedAcross(el: Element, computed: CSSStyleDeclaration): boolean {
  const parent = el.parentElement
  if (!parent) return false
  const display = computed.getPropertyValue('display')
  if (!BLOCKISH.test(display) && !REPLACED.has(el.tagName.toUpperCase())) return false

  const style = window.getComputedStyle(parent)
  const inner =
    parent.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  return Math.abs(el.getBoundingClientRect().width - inner) <= 1
}

/**
 * Dropped from the payload rather than carried.
 *
 * `script` and `style`/`link` because their effect is global: a stylesheet
 * scoped to the source page would repaint the destination, and running scripts
 * from one origin inside another is not something a paste should do quietly.
 * `iframe`/`object`/`embed` because a frame silently loading a third-party URL
 * into someone else's page is exactly the thing to be deliberate about — and
 * because it would arrive blank anyway.
 */
const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'])

/** URL-bearing attributes, resolved against the source page before they travel. */
const URL_ATTRS = ['src', 'href', 'poster', 'data', 'cite', 'action', 'formaction']

const EDGES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Properties that mean nothing without another one, and are skipped when that
 * one isn't there.
 *
 * The diff alone can't catch these. `border-color` resolves to `currentColor`,
 * so on a page that sets any text colour it differs from the UA baseline on
 * *every* node — four declarations each, describing a border with zero width.
 * `transform-origin` is worse than noise: it computes from the box's own size,
 * so a value carried to a container of a different width would be actively
 * wrong. Gating this handful took a copied card from 5.2KB to 3.3KB and made the
 * result readable.
 */
const GATES: Record<string, (computed: CSSStyleDeclaration) => boolean> = {
  'text-decoration-color': (c) => c.getPropertyValue('text-decoration-line') !== 'none',
  'text-decoration-style': (c) => c.getPropertyValue('text-decoration-line') !== 'none',
  'text-decoration-thickness': (c) => c.getPropertyValue('text-decoration-line') !== 'none',
  'text-underline-offset': (c) => c.getPropertyValue('text-decoration-line') !== 'none',
  'transform-origin': (c) => c.getPropertyValue('transform') !== 'none',
  'stroke-width': (c) => {
    const stroke = c.getPropertyValue('stroke')
    return Boolean(stroke) && stroke !== 'none'
  },
  // `auto` is the initial value; stating it explicitly never changes anything.
  'min-width': (c) => c.getPropertyValue('min-width') !== 'auto',
  'min-height': (c) => c.getPropertyValue('min-height') !== 'auto',
  // Another `currentColor`, and one only worth carrying when it isn't the colour.
  '-webkit-text-fill-color': (c) =>
    c.getPropertyValue('-webkit-text-fill-color') !== c.getPropertyValue('color'),
}

for (const prefix of ['mask', '-webkit-mask']) {
  for (const part of ['size', 'repeat', 'position']) {
    GATES[`${prefix}-${part}`] = (c) => {
      const image = c.getPropertyValue(`${prefix}-image`)
      return Boolean(image) && image !== 'none'
    }
  }
}

for (const edge of EDGES) {
  GATES[`border-${edge}-color`] = (c) =>
    c.getPropertyValue(`border-${edge}-style`) !== 'none' &&
    Number.parseFloat(c.getPropertyValue(`border-${edge}-width`)) > 0
}

// — the UA baseline ————————————————————————————————————————————

const SVG_NS = 'http://www.w3.org/2000/svg'

let frame: HTMLIFrameElement | null = null
let baselines = new Map<string, CSSStyleDeclaration>()

/**
 * A document with no author CSS in it, so `getComputedStyle` there reports the
 * browser's own defaults. Probing in the live page instead would read the page's
 * own rules — `p { margin: 0 }` would make a margin of zero look like a default
 * and get dropped, and the paste would pick up the destination's margin instead.
 */
function openSandbox(): Document | null {
  if (frame?.contentDocument) return frame.contentDocument
  frame = document.createElement('iframe')
  frame.setAttribute(OWN_NODE_ATTR, '')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    'position:fixed;top:0;left:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  document.documentElement.append(frame)
  return frame.contentDocument
}

function closeSandbox(): void {
  frame?.remove()
  frame = null
  baselines = new Map()
}

/** The browser's default computed style for one kind of element. */
function baseline(el: Element): CSSStyleDeclaration | null {
  const doc = openSandbox()
  if (!doc?.body) return null

  const tag = el.tagName.toLowerCase()
  const type = el instanceof HTMLInputElement ? el.type : ''
  const key = `${el.namespaceURI}|${tag}|${type}`
  const cached = baselines.get(key)
  if (cached) return cached

  try {
    // SVG interiors only compute sensibly inside an <svg>, and `fill`/`stroke`
    // are the whole reason an icon arrives looking right.
    const svg = el.namespaceURI === SVG_NS
    const probe = svg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag)
    if (type) probe.setAttribute('type', type)
    const host = svg && tag !== 'svg' ? doc.createElementNS(SVG_NS, 'svg') : doc.body
    if (host !== doc.body) doc.body.append(host)
    host.append(probe)

    const computed = doc.defaultView?.getComputedStyle(probe)
    if (!computed) return null
    // Read every value now: the declaration is live, and the probe is about to
    // be thrown away with the rest of the sandbox.
    const frozen = new Map<string, string>()
    for (const [prop] of PROPERTIES) frozen.set(prop, computed.getPropertyValue(prop))
    frozen.set('width', computed.getPropertyValue('width'))
    frozen.set('height', computed.getPropertyValue('height'))
    const snapshot = {
      getPropertyValue: (prop: string) => frozen.get(prop) ?? '',
    } as CSSStyleDeclaration
    baselines.set(key, snapshot)
    return snapshot
  } catch {
    return null
  }
}

// — serialising ————————————————————————————————————————————————

/** Bounds. A copy this large is a page, not an element. */
const MAX_NODES = 1500
const MAX_BYTES = 3_000_000

export interface Handoff {
  /** `Date.now()` at the copy — decides which clipboard is the fresher one. */
  at: number
  label: string
  count: number
  /** Host the copy came from, for the paste readout. */
  origin: string
  html: string
}

export type SerializeResult =
  | { ok: true; html: string; nodes: number }
  | { ok: false; reason: string }

/**
 * Resolves relative URLs against the page they came from. Without this every
 * image in a copied card 404s the moment it lands on another origin.
 *
 * `url()` inside the styles needs no such treatment: `getComputedStyle` already
 * hands back absolute URLs, which is one of the quieter benefits of resolving
 * the cascade rather than copying declarations.
 */
function absolutise(el: Element, base: string): void {
  for (const attr of URL_ATTRS) {
    const value = el.getAttribute(attr)
    if (!value || value.startsWith('#')) continue
    try {
      el.setAttribute(attr, new URL(value, base).href)
    } catch {
      /* A malformed URL is left exactly as it was. */
    }
  }
  const srcset = el.getAttribute('srcset')
  if (srcset) {
    const resolved = srcset
      .split(',')
      .map((candidate) => {
        const [url, ...rest] = candidate.trim().split(/\s+/)
        if (!url) return candidate.trim()
        try {
          return [new URL(url, base).href, ...rest].join(' ')
        } catch {
          return candidate.trim()
        }
      })
      .join(', ')
    el.setAttribute('srcset', resolved)
  }
}

/**
 * Whether this canvas is already a picture of a canvas.
 *
 * A `<canvas>` in a *reopened* snapshot is genuinely blank — the script that
 * drew it was dropped when the file was written, which is the whole point of a
 * frozen page — while the picture it drew survives as the background image put
 * there by the save before. Capturing it again would therefore replace a good
 * picture with a transparent one, and every re-save of a reopened board would
 * quietly erase another canvas. Found by saving a file twice.
 */
const carriesCapture = (computed: CSSStyleDeclaration): boolean =>
  computed.getPropertyValue('background-image').includes('data:image')

/** Attributes that would run code or re-declare our own bookkeeping. */
function scrub(el: Element): void {
  for (const attr of [...el.attributes]) {
    if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
  }
  el.removeAttribute(EDITED_ATTR)
  el.removeAttribute('contenteditable')
}

/**
 * Walks the live element and its clone in step, reading the cascade from the one
 * that is rendered and writing the result onto the one that travels.
 *
 * `cloneNode(true)` preserves child order exactly, so the two `children` lists
 * stay aligned; text nodes ride along in the markup and need nothing.
 */
function inline(source: Element, clone: Element, inherited: CSSStyleDeclaration | null): number {
  const computed = window.getComputedStyle(source)
  const base = baseline(source)
  const decls: string[] = []

  const consider = (prop: string, isInherited: boolean) => {
    const value = computed.getPropertyValue(prop)
    if (!value) return
    if (GATES[prop]?.(computed) === false) return
    const against = isInherited && inherited ? inherited.getPropertyValue(prop) : base?.getPropertyValue(prop)
    if (against && value === against) return
    decls.push(`${prop}:${value}`)
  }

  for (const [prop, isInherited] of PROPERTIES) consider(prop, isInherited)
  if (carriesSize(source)) {
    if (stretchedAcross(source, computed)) {
      // A replaced element's height follows its width, so pinning one without the
      // other is how a copied image arrives stretched out of shape.
      if (!REPLACED.has(source.tagName.toUpperCase())) consider('height', false)
    } else {
      consider('width', false)
      consider('height', false)
    }
  }

  /**
   * A canvas is pixels, not markup, so it would arrive as a blank box of the
   * right size. Its current contents ride along as a background image instead —
   * a snapshot rather than a live canvas, which is the honest most that can cross
   * a tab boundary, and far better than an empty rectangle.
   */
  if (source instanceof HTMLCanvasElement && !carriesCapture(computed)) {
    try {
      decls.push(`background-image:url(${source.toDataURL()})`, 'background-size:100% 100%')
    } catch {
      /* A canvas tainted by a cross-origin draw can't be read; it stays blank. */
    }
  }

  if (decls.length) clone.setAttribute('style', decls.join(';'))
  else clone.removeAttribute('style')
  scrub(clone)
  absolutise(clone, source.baseURI)

  let count = 1
  const kids = [...clone.children]
  for (const [index, child] of kids.entries()) {
    if (DROP.has(child.tagName.toUpperCase())) {
      child.remove()
      continue
    }
    const twin = source.children[index]
    // Alignment can only break if something mutated the page mid-copy; without
    // a twin there is no cascade to read, so the node travels as plain markup.
    if (twin) count += inline(twin, child, computed)
  }
  return count
}

/**
 * Turns a selection into self-contained markup, or says why it can't.
 *
 * The budget is a parameter because the two callers are not doing the same
 * thing. A cross-tab copy has to fit through `chrome.storage.session` and be
 * quick, so it stops at a section's worth; saving a canvas to a file is a
 * deliberate, once-in-a-while act that has to carry a whole page, and refusing
 * at 1500 nodes would mean the save button simply does not work on most of the
 * web. Same machinery, different appetite.
 */
export function serialize(
  elements: Element[],
  limits: { maxNodes?: number; maxBytes?: number } = {},
): SerializeResult {
  const maxNodes = limits.maxNodes ?? MAX_NODES
  const maxBytes = limits.maxBytes ?? MAX_BYTES
  try {
    let nodes = 0
    const parts: string[] = []
    for (const el of elements) {
      if (DROP.has(el.tagName.toUpperCase())) continue
      const clone = el.cloneNode(true) as Element
      nodes += inline(el, clone, null)
      if (nodes > maxNodes) {
        return { ok: false, reason: 'Too big to share across tabs — copied for this tab only' }
      }
      parts.push(clone.outerHTML)
    }
    if (!parts.length) return { ok: false, reason: 'Nothing in that selection can travel' }

    const html = parts.join('')
    if (html.length > maxBytes) {
      return { ok: false, reason: 'Too big to share across tabs — copied for this tab only' }
    }
    return { ok: true, html, nodes }
  } finally {
    // The sandbox exists only for the duration of one copy: keeping it would
    // leave a stray iframe in the page for the rest of the session.
    closeSandbox()
  }
}

/**
 * Markup back into nodes.
 *
 * `DOMParser` builds them in an inert document — scripts don't run and images
 * don't load there — which is the right posture for markup that arrived from
 * another origin. `importNode` then adopts them into this page.
 */
export function deserialize(html: string): Element[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.body.children]
    .filter((el) => !DROP.has(el.tagName.toUpperCase()))
    .map((el) => document.importNode(el, true))
}

// — the shared shelf ————————————————————————————————————————————

const KEY = 'dominator:handoff'

/**
 * `chrome.storage.session` rather than the worker's memory: an MV3 service
 * worker is evicted after about thirty seconds idle, and a clipboard that
 * evaporates while you switch tabs is worse than no clipboard. Session storage
 * is held for the browser session and never touches disk, which is the right
 * lifetime for something copied — and the right one for page content, which has
 * no business being persisted.
 */
const session = (): chrome.storage.StorageArea | null => {
  try {
    return chrome.storage?.session ?? null
  } catch {
    return null
  }
}

let shelf: Handoff | null = null

/** The last cross-tab copy, mirrored locally so the paste path stays synchronous. */
export const shared = (): Handoff | null => shelf

export async function publish(handoff: Handoff): Promise<void> {
  shelf = handoff
  await session()?.set({ [KEY]: handoff })
}

/**
 * Mirrors the shared shelf into this tab and keeps it current.
 *
 * `onChanged` fires in every content script, so a copy made in another tab
 * updates this tab's paste button while the user is still on their way over —
 * and it means `has()` and `label()` can stay synchronous, which matters because
 * they are read during render.
 */
export function watchShared(onChange: () => void): () => void {
  const area = session()
  if (!area) return () => {}

  void area
    .get(KEY)
    .then((held) => {
      const handoff = held?.[KEY] as Handoff | undefined
      if (!handoff) return
      // A copy made in this tab since the read wins: it is the fresher one.
      if (!shelf || handoff.at > shelf.at) {
        shelf = handoff
        onChange()
      }
    })
    .catch(() => {})

  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'session' || !(KEY in changes)) return
    shelf = (changes[KEY]?.newValue as Handoff | undefined) ?? null
    onChange()
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
