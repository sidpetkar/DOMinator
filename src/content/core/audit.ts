import { blend, contrastRatio, parseColor, resolveBackground, type RGB } from './color'
import { describe } from './geometry'
import { isOwnNode } from './picker'

/**
 * The contrast audit: every piece of text and every icon on the page, measured
 * against what is actually behind it.
 *
 * Unlike the x-ray lens this can't be a stylesheet — a verdict has to be computed
 * per element, and the result carries a number and a name, not just an outline.
 * It is a *scan* rather than a live projection: run once, re-run when the page
 * changes (see the observer in controller.ts), and each finding holds a live
 * element reference so clicking its label can hand you the thing to fix.
 */

/** Nothing here paints text of its own. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'HEAD', 'BASE',
  'TEMPLATE', 'BR', 'HR', 'OPTION', 'SELECT', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO',
])

/**
 * WCAG 2.1 AA. 4.5:1 for body copy, relaxed to 3:1 for large text — 18.66px when
 * bold, 24px otherwise, which are 14pt and 18pt at the reference resolution.
 * Graphics get the 3:1 of 1.4.11 (non-text contrast).
 */
const AA_NORMAL = 4.5
const AA_LARGE = 3
const AA_GRAPHIC = 3

const LARGE_PX = 24
const LARGE_BOLD_PX = 18.66
const BOLD = 700

/** Painted parts of one icon to sample before giving up on it. */
const PAINT_LIMIT = 24

/**
 * SVG elements that actually draw something.
 *
 * A whitelist rather than a blacklist, and it deliberately excludes the `<svg>`
 * root: its computed `fill` defaults to black whether or not anything is painted
 * with it, so counting the root meant every icon on a light page scored 21:1 and
 * passed. Children that don't set their own fill inherit the root's anyway, so
 * nothing is lost by ignoring it.
 */
const SHAPES = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'use', 'image', 'foreignObject',
])

/** Findings drawn at once. A page past this is telling you something already. */
const FINDING_LIMIT = 200

export type FindingKind = 'text' | 'graphic'

export interface Finding {
  el: HTMLElement
  /** `div.card#hero` — what the label shows. */
  label: string
  ratio: number
  required: number
  kind: FindingKind
  /** The two colours the ratio came from, for the readout. */
  foreground: RGB
  background: RGB
}

export interface ContrastAudit {
  findings: Finding[]
  /** Elements that carried text or paint and got a verdict. */
  checked: number
  /**
   * Elements skipped because a gradient or image sat behind them. Reported
   * rather than silently dropped: a coverage number that quietly excludes the
   * hard cases is worse than no number.
   */
  uncertain: number
  /** True when more failed than could be drawn. */
  capped: boolean
}

/** Text held by this element itself, not by its descendants. */
function ownText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? ''
  }
  return text.trim()
}

const hidden = (style: CSSStyleDeclaration): boolean =>
  style.display === 'none' ||
  style.visibility === 'hidden' ||
  style.visibility === 'collapse' ||
  Number.parseFloat(style.opacity) === 0

/** Foreground over background, so translucent type is judged as it looks. */
function flatten(css: string, background: RGB): RGB | null {
  const parsed = parseColor(css)
  if (!parsed || parsed.alpha === 0) return null
  return parsed.alpha >= 0.999 ? parsed.rgb : blend(parsed.rgb, background, parsed.alpha)
}

/**
 * The bar this text has to clear. Size and weight are read from the element that
 * actually holds the text, so a large heading isn't held to the body-copy rule.
 */
function textThreshold(style: CSSStyleDeclaration): number {
  const size = Number.parseFloat(style.fontSize)
  const weight = Number.parseFloat(style.fontWeight) || 400
  const large = size >= LARGE_PX || (size >= LARGE_BOLD_PX && weight >= BOLD)
  return large ? AA_LARGE : AA_NORMAL
}

/**
 * An icon's contrast, taken from the part of it that shows up *best*.
 *
 * Paint lives on the leaves, not the `<svg>`, so the root's own `fill` is
 * usually a meaningless default. And the best paint rather than the worst,
 * because a two-tone icon with one pale accent is still perfectly discernible —
 * judging it by its faintest stroke would flag most icon sets ever drawn.
 */
function graphicContrast(
  svg: SVGSVGElement,
  background: RGB,
): { ratio: number; paint: RGB } | null {
  const parts = [...svg.querySelectorAll('*')]
    .filter((part) => SHAPES.has(part.tagName))
    .slice(0, PAINT_LIMIT)
  let best: { ratio: number; paint: RGB } | null = null

  for (const part of parts) {
    const style = window.getComputedStyle(part)
    if (hidden(style)) continue
    // Zero-sized means it isn't rendered — a shape parked inside <defs>, a
    // <symbol> waiting to be used. A line is legitimately flat, so either
    // dimension counts.
    const box = part.getBoundingClientRect()
    if (box.width < 0.5 && box.height < 0.5) continue
    for (const prop of ['fill', 'stroke'] as const) {
      const value = style.getPropertyValue(prop)
      if (!value || value === 'none') continue
      const paint = flatten(value, background)
      if (!paint) continue
      const ratio = contrastRatio(paint, background)
      if (!best || ratio > best.ratio) best = { ratio, paint }
    }
  }
  return best
}

/**
 * Walks the page once and returns everything that fails.
 *
 * Ordered for cost: the cheap structural tests come first and `getComputedStyle`
 * — the expensive part — only runs on elements that actually hold text or paint.
 * On a real page that is a small fraction of the DOM, which is what keeps a
 * full-page scan fast enough to re-run whenever an edit lands.
 */
export function auditContrast(): ContrastAudit {
  const findings: Finding[] = []
  let checked = 0
  let uncertain = 0
  let capped = false

  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (isOwnNode(el) || SKIP_TAGS.has(el.tagName.toUpperCase())) continue

    const graphic = el instanceof SVGSVGElement
    const text = graphic ? '' : ownText(el)
    // The early exit that makes this affordable: most elements are containers.
    if (!graphic && !text) continue

    const style = window.getComputedStyle(el)
    if (hidden(style)) continue

    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue

    const backdrop = resolveBackground(el)
    if (backdrop.uncertain) {
      uncertain += 1
      continue
    }

    if (graphic) {
      const paint = graphicContrast(el as unknown as SVGSVGElement, backdrop.rgb)
      // No resolvable paint at all — a spacer, a masked shape, a filter. Nothing
      // to be right or wrong about.
      if (!paint) continue
      checked += 1
      if (paint.ratio >= AA_GRAPHIC) continue
      if (findings.length >= FINDING_LIMIT) {
        capped = true
        continue
      }
      findings.push({
        el,
        label: describe(el),
        ratio: paint.ratio,
        required: AA_GRAPHIC,
        kind: 'graphic',
        foreground: paint.paint,
        background: backdrop.rgb,
      })
      continue
    }

    // `color: transparent` is the image-replacement trick, not a contrast bug.
    const foreground = flatten(style.color, backdrop.rgb)
    if (!foreground) continue

    checked += 1
    const ratio = contrastRatio(foreground, backdrop.rgb)
    const required = textThreshold(style)
    if (ratio >= required) continue
    if (findings.length >= FINDING_LIMIT) {
      capped = true
      continue
    }
    findings.push({
      el,
      label: describe(el),
      ratio,
      required,
      kind: 'text',
      foreground,
      background: backdrop.rgb,
    })
  }

  return { findings, checked, uncertain, capped }
}

/**
 * Drops findings whose element has left the page. Cheap enough to run on every
 * redraw, unlike a re-scan — so a deleted element's red box goes away at once
 * while a genuine re-measure waits for the observer.
 */
export const liveFindings = (findings: Finding[]): Finding[] =>
  findings.filter((finding) => finding.el.isConnected)

// — tab order ————————————————————————————————————————————————

/**
 * Everything that can take sequential focus. `[tabindex]` catches the elements a
 * page opts in by hand; the rest are focusable by nature, and the filtering below
 * takes back the ones that only look it.
 */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  'iframe',
  'object',
  'embed',
  '[tabindex]',
  '[contenteditable]',
].join(',')

/** Runaway guard. A page with more stops than this has a different problem. */
const MAX_STOPS = 400

export interface TabStop {
  el: HTMLElement
  /** 1-based position in the real tab sequence — what the badge shows. */
  index: number
  /** The element's resolved tabindex. */
  tabIndex: number
  /** Set by hand in the markup, rather than inherited from the element's nature. */
  explicit: boolean
}

export interface TabOrderAudit {
  stops: TabStop[]
  /**
   * Stops with a positive `tabindex`. Counted separately because they are the
   * one thing that genuinely breaks tab order: they jump the whole queue, so a
   * single `tabindex="1"` anywhere on the page silently becomes the first stop.
   */
  positive: number
  capped: boolean
}

/**
 * Radios share a stop.
 *
 * A radio group is one tab stop, not one per button: focus enters the checked
 * radio (or the first, when none is checked) and the arrow keys move within the
 * group. Modelling it matters because getting it wrong shifts every number after
 * it, which is exactly what the reader is trying to trust.
 */
function radioTakesStop(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true
  const group = [
    ...(el.form ?? document).querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`,
    ),
  ].filter((radio) => !radio.disabled)
  if (!group.length) return true
  const checked = group.find((radio) => radio.checked)
  return (checked ?? group[0]) === el
}

/**
 * The page's real tab sequence, in order.
 *
 * Positive `tabindex` values come first, lowest to highest, and only then does
 * everything else follow in document order — which is the rule almost nobody
 * remembers and the reason reading the DOM top to bottom tells you the wrong
 * story. `Array.sort` is stable, so ties inside a tabindex value keep their
 * document order for free.
 *
 * `opacity: 0` is deliberately *not* an exclusion: it hides an element without
 * removing it from the sequence, so those stops are real, and drawing a numbered
 * box over apparently empty space is the tool doing its job.
 */
export function auditTabOrder(): TabOrderAudit {
  const candidates: TabStop[] = []

  for (const el of document.body.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (isOwnNode(el)) continue
    // Negative means reachable by script only, never by Tab.
    if (el.tabIndex < 0) continue
    if (el.matches(':disabled') || el.closest('[inert]')) continue
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue
    // `<summary>` is only a stop for the details it opens, and only the first one.
    if (el.tagName === 'SUMMARY' && el.parentElement?.firstElementChild !== el) continue
    if (!radioTakesStop(el)) continue

    const style = window.getComputedStyle(el)
    // display:none and visibility:hidden genuinely remove an element from the
    // sequence; nothing else about how it looks does.
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      continue
    }
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 && rect.height < 1) continue

    candidates.push({
      el,
      index: 0,
      tabIndex: el.tabIndex,
      explicit: el.hasAttribute('tabindex'),
    })
    if (candidates.length >= MAX_STOPS) break
  }

  const positives = candidates
    .filter((stop) => stop.tabIndex > 0)
    .sort((a, b) => a.tabIndex - b.tabIndex)
  const natural = candidates.filter((stop) => stop.tabIndex === 0)

  const stops = [...positives, ...natural].map((stop, index) => ({ ...stop, index: index + 1 }))
  return { stops, positive: positives.length, capped: candidates.length >= MAX_STOPS }
}

export const liveStops = (stops: TabStop[]): TabStop[] =>
  stops.filter((stop) => stop.el.isConnected)

// — accessible names ————————————————————————————————————————————

/**
 * What a screen reader would announce for an element, and where it came from.
 *
 * A deliberate approximation of the accname spec, which is long and full of
 * cases no page ever hits. What it does cover is the order that decides real
 * outcomes — `aria-labelledby`, then `aria-label`, then the native label, then
 * the element's own text — plus the two things that silently produce nothing: a
 * reference to an id that isn't there, and a name that only exists because of a
 * placeholder.
 */
const tidy = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

export interface AccessibleName {
  text: string
  /** Which mechanism supplied it — `none` when nothing did. */
  from: 'aria-labelledby' | 'aria-label' | 'label' | 'text' | 'alt' | 'title' | 'placeholder' | 'svg-title' | 'value' | 'none'
  /** ids named by `aria-labelledby` that don't exist. */
  brokenRefs: string[]
}

function labelledBy(el: HTMLElement): { text: string; missing: string[] } {
  const ids = tidy(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
  const parts: string[] = []
  const missing: string[] = []
  for (const id of ids) {
    const target = document.getElementById(id)
    if (target) parts.push(tidy(target.textContent))
    else missing.push(id)
  }
  return { text: parts.filter(Boolean).join(' '), missing }
}

/**
 * Text as an assistive technology would gather it: `aria-hidden` subtrees
 * contribute nothing, an `<img>` contributes its alt, and an `<svg>` contributes
 * only a name it was given — its paths are not text.
 */
function announcedText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? ''
      continue
    }
    if (!(node instanceof Element)) continue
    if (node.getAttribute('aria-hidden') === 'true') continue
    if (node.tagName === 'IMG') {
      text += ` ${node.getAttribute('alt') ?? ''} `
      continue
    }
    if (node.tagName === 'svg') {
      text += ` ${node.getAttribute('aria-label') ?? tidy(node.querySelector('title')?.textContent)} `
      continue
    }
    text += ` ${announcedText(node)} `
  }
  return tidy(text)
}

const LABELLABLE = /^(INPUT|SELECT|TEXTAREA)$/

export function accessibleName(el: HTMLElement): AccessibleName {
  const { text: byRef, missing } = labelledBy(el)
  const done = (text: string, from: AccessibleName['from']): AccessibleName => ({
    text,
    from,
    brokenRefs: missing,
  })

  if (byRef) return done(byRef, 'aria-labelledby')

  const label = tidy(el.getAttribute('aria-label'))
  if (label) return done(label, 'aria-label')

  if (LABELLABLE.test(el.tagName)) {
    const labels = (el as HTMLInputElement).labels
    const native = labels?.length ? tidy([...labels].map((one) => one.textContent).join(' ')) : ''
    if (native) return done(native, 'label')
  }

  // Buttons and inputs whose name is their value: `<input type="submit">` reads
  // as "Submit" with nothing set at all, so it is never nameless.
  if (el instanceof HTMLInputElement && /^(submit|button|reset)$/.test(el.type)) {
    return done(tidy(el.value) || el.type, 'value')
  }

  const own = announcedText(el)
  if (own) return done(own, 'text')

  const alt = tidy(el.getAttribute('alt'))
  if (alt) return done(alt, 'alt')

  if (el.tagName === 'svg') {
    const svgTitle = tidy(el.querySelector('title')?.textContent)
    if (svgTitle) return done(svgTitle, 'svg-title')
  }

  const title = tidy(el.getAttribute('title'))
  if (title) return done(title, 'title')

  // Last, and reported as a warning wherever it is the only thing holding a
  // control's name up: a placeholder disappears the moment you type.
  const placeholder = tidy(el.getAttribute('placeholder'))
  if (placeholder) return done(placeholder, 'placeholder')

  return done('', 'none')
}

// — issues (ARIA names, image alt text) —————————————————————————

/**
 * One thing wrong with one element. Shared by the ARIA and alt-text checks
 * because they produce the same shape of answer: an element, a short reason for
 * the badge, and a sentence explaining it.
 */
export interface Issue {
  el: HTMLElement
  label: string
  /** Two or three words — this is what the badge shows. */
  reason: string
  /** `warn` for a real but softer problem, so it reads differently. */
  tone: 'fail' | 'warn'
  detail: string
}

export interface IssueAudit {
  issues: Issue[]
  checked: number
  capped: boolean
}

const invisible = (el: HTMLElement): boolean => {
  const style = window.getComputedStyle(el)
  if (hidden(style)) return true
  const rect = el.getBoundingClientRect()
  return rect.width < 1 && rect.height < 1
}

/** Roles whose whole purpose is to be announced as something. */
const ROLES_NEEDING_NAME = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'combobox',
  'textbox', 'searchbox', 'slider', 'spinbutton', 'img', 'progressbar', 'dialog',
])

const NATIVE_NEEDING_NAME = 'button, a[href], input, select, textarea, summary'

function push(audit: IssueAudit, issue: Issue): void {
  if (audit.issues.length >= FINDING_LIMIT) {
    audit.capped = true
    return
  }
  audit.issues.push(issue)
}

/**
 * Controls a screen reader cannot announce.
 *
 * The headline case is the icon-only button: perfectly usable with a mouse,
 * completely anonymous without one, and invisible to every check that only looks
 * at the page's appearance. The others are the ones that *look* handled —
 * `aria-labelledby` pointing at an id that was renamed, `aria-hidden` on
 * something still reachable by Tab — and so never get noticed by hand.
 */
export function auditAria(): IssueAudit {
  const audit: IssueAudit = { issues: [], checked: 0, capped: false }

  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (isOwnNode(el)) continue

    const role = tidy(el.getAttribute('role'))
    const native = el.matches(NATIVE_NEEDING_NAME)
    const roled = role !== '' && ROLES_NEEDING_NAME.has(role)

    /**
     * `aria-hidden` on something focusable, checked before anything else and
     * regardless of role: the element is removed from the accessibility tree and
     * still reachable by Tab, so a keyboard user lands on a control that
     * announces nothing at all. Nothing about how the page looks reveals it.
     */
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex >= 0 && !el.closest('[inert]')) {
      audit.checked += 1
      push(audit, {
        el,
        label: describe(el),
        reason: 'hidden + focusable',
        tone: 'fail',
        detail: `${describe(el)} is aria-hidden but can still be reached by Tab, so a keyboard user lands on something a screen reader will not announce.`,
      })
      continue
    }

    if (!native && !roled) continue
    // Images are the alt-text check's business, not this one's.
    if (el.tagName === 'IMG' || (el instanceof HTMLInputElement && el.type === 'image')) continue
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue
    if (invisible(el)) continue

    audit.checked += 1
    const name = accessibleName(el)

    if (name.brokenRefs.length) {
      push(audit, {
        el,
        label: describe(el),
        reason: 'broken ref',
        tone: 'fail',
        detail: `${describe(el)} has aria-labelledby="${name.brokenRefs.join(' ')}" but no element with ${
          name.brokenRefs.length > 1 ? 'those ids' : 'that id'
        } exists, so the name it promises never arrives.`,
      })
      continue
    }

    if (!name.text) {
      push(audit, {
        el,
        label: describe(el),
        reason: 'no name',
        tone: 'fail',
        detail: `${describe(el)} has no accessible name — no text, no aria-label, no label. A screen reader announces only its role.`,
      })
      continue
    }

    if (name.from === 'placeholder') {
      push(audit, {
        el,
        label: describe(el),
        reason: 'placeholder only',
        tone: 'warn',
        detail: `${describe(el)} is named only by its placeholder ("${name.text}"), which disappears as soon as anyone types into it. A <label> or aria-label survives.`,
      })
      continue
    }

    if (name.from === 'title') {
      push(audit, {
        el,
        label: describe(el),
        reason: 'title only',
        tone: 'warn',
        detail: `${describe(el)} is named only by its title attribute ("${name.text}"). It works, but it is never shown on touch and inconsistently announced.`,
      })
    }
  }

  return audit
}

/** `photo_1234.JPG`, `DSC00123`, `Screenshot 2024-01-01` — a name, not a description. */
const FILENAME_ALT =
  /(\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)$)|^(img|dsc|dscn|pxl|screenshot|photo|image)[-_ ]?\d+/i

/**
 * Images that hand a screen reader nothing.
 *
 * `alt=""` is deliberately a *pass*: it is the correct way to say "decorative,
 * skip me", and flagging it would train people to remove it. The one place it
 * goes wrong is when the image is all a link or button contains — then the empty
 * alt takes the control's only possible name with it, and the user hears an
 * unlabelled link.
 */
export function auditAlt(): IssueAudit {
  const audit: IssueAudit = { issues: [], checked: 0, capped: false }
  const images = document.body.querySelectorAll<HTMLElement>(
    'img, area, input[type="image"], svg[role="img"], [role="img"]',
  )

  for (const el of images) {
    if (isOwnNode(el) || invisible(el)) continue
    audit.checked += 1

    const isImgLike = el.tagName === 'IMG' || el.tagName === 'AREA' || el instanceof HTMLInputElement
    const alt = el.getAttribute('alt')

    if (isImgLike && alt === null) {
      // No attribute at all is the fail; assistive tech falls back to reading
      // the file name out loud.
      const name = accessibleName(el)
      push(audit, {
        el,
        label: describe(el),
        reason: 'no alt',
        tone: name.text ? 'warn' : 'fail',
        detail: name.text
          ? `${describe(el)} has no alt attribute. It falls back to ${name.from} ("${name.text}"), but alt is what belongs here.`
          : `${describe(el)} has no alt attribute at all, so a screen reader reads out its file name. Use alt="" if it is decorative.`,
      })
      continue
    }

    if (isImgLike && alt === '') {
      const control = el.closest('a[href], button, [role="button"], [role="link"]')
      if (control && !announcedText(control) && !tidy(control.getAttribute('aria-label'))) {
        push(audit, {
          el,
          label: describe(control as HTMLElement),
          reason: 'empty alt in link',
          tone: 'fail',
          detail: `This image is all the ${control.tagName.toLowerCase()} contains, and its alt is empty — so the control has no name at all. Describe the destination in the alt.`,
        })
      }
      continue
    }

    if (alt && FILENAME_ALT.test(alt.trim())) {
      push(audit, {
        el,
        label: describe(el),
        reason: 'filename alt',
        tone: 'warn',
        detail: `alt="${alt}" is a file name rather than a description, which tells a listener nothing about the picture.`,
      })
      continue
    }

    // `role="img"` on an <svg> or a div: no alt attribute applies, so the name
    // has to come from aria-label or a <title> child.
    if (!isImgLike) {
      const name = accessibleName(el)
      if (name.brokenRefs.length || !name.text) {
        push(audit, {
          el,
          label: describe(el),
          reason: 'no name',
          tone: 'fail',
          detail: `${describe(el)} has role="img" but no accessible name. Give it an aria-label, or a <title> as its first child.`,
        })
      }
    }
  }

  return audit
}

export const liveIssues = (issues: Issue[]): Issue[] =>
  issues.filter((issue) => issue.el.isConnected)
