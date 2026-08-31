import { GROUP_ATTR, OWN_NODE_ATTR } from '@/shared/constants'
import { frameOf, isFrame } from './frames'
import { editedElements, pristineStyle } from './styles'

/**
 * Everything you changed, written out as an instruction.
 *
 * The button this backs answers a question the tool could not previously answer
 * at all: *what did I actually do?* A session leaves the page visibly different
 * and leaves no record — you have a browser full of decisions and a codebase
 * that knows nothing about them, and the gap is retyped by hand from memory.
 * This closes it by reading the edits back out and phrasing them as the brief
 * you would otherwise have written.
 *
 * The hard part is not the formatting, it is deciding what counts. A real
 * session goes: edit the page, open the canvas, pull three copies of a section
 * out to compare, throw two away, keep one, paste it back, edit that. Only some
 * of that is a change to the product; the rest is thinking out loud on a
 * surface. So the rule is strict and mechanical — **an edit counts only if it is
 * live on the page right now**:
 *
 *  - still in the document (`isConnected`), so anything thrown away is gone;
 *  - inside `<body>` and not inside a variation (see `frameOf`), so experiments
 *    standing on the canvas are excluded however long they were worked on;
 *  - not one of our own nodes.
 *
 * Everything the canvas itself writes — the transform, the surface, the frame
 * dressing — is invisible to this for free, because none of it goes through
 * styles.ts. That separation was built for undo and Reset; it pays again here.
 */

export interface Change {
  el: HTMLElement
  selector: string
  label: string
  text: string
  declarations: { property: string; from: string | null; to: string | null }[]
}

// — what is ours to report ————————————————————————————————————

/**
 * Live on the page, rather than on the board beside it.
 *
 * `frameOf` is the whole test for the canvas half: a variation and everything
 * inside it answers to it, so a section lifted out and worked on for an hour is
 * excluded by the same line that excludes a rectangle drawn ten seconds ago.
 */
function onThePage(el: HTMLElement): boolean {
  if (!el.isConnected || !document.body?.contains(el)) return false
  if (el.hasAttribute(OWN_NODE_ATTR) || el.closest(`[${OWN_NODE_ATTR}]`)) return false
  return !isFrame(el) && !frameOf(el)
}

// — describing an element to something that has the source ————————

/** Classes that are ours, or that a framework generated and will not recognise. */
const ignorableClass = (name: string): boolean => name.startsWith('dominator')

/**
 * The shortest selector that picks out this element and nothing else.
 *
 * Built outward from the element and tested against the document at every step,
 * so it stops as soon as it is unambiguous rather than always emitting a path
 * from the root. What comes out is usually short enough to read — `.pricing
 * .card:nth-of-type(3)` — which matters, because the reader is an agent that
 * has to find the same element in a source file where none of this markup
 * literally appears. A short selector rich in class names is something it can
 * search for; a twelve-level `nth-child` chain is not.
 */
export function selectorFor(el: HTMLElement): string {
  if (el.id && !el.id.includes('dominator')) {
    const byId = `#${CSS.escape(el.id)}`
    try {
      if (document.querySelectorAll(byId).length === 1) return byId
    } catch {
      /* An id that is not a valid selector; fall through to the path. */
    }
  }

  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    let part = node.tagName.toLowerCase()
    const classes = [...node.classList].filter((name) => !ignorableClass(name)).slice(0, 3)
    if (classes.length) part += `.${classes.map((name) => CSS.escape(name)).join('.')}`

    const twins = [...(node.parentElement?.children ?? [])].filter(
      (sibling) => sibling.tagName === node!.tagName,
    )
    if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`

    parts.unshift(part)
    const candidate = parts.join(' > ')
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate
    } catch {
      /* Ignore and keep widening. */
    }
    node = node.parentElement
  }
  return parts.length ? parts.join(' > ') : el.tagName.toLowerCase()
}

/** A few words of the element's own text — how a person finds it in a file. */
function textOf(el: HTMLElement): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

const labelFor = (el: HTMLElement): string => {
  const classes = [...el.classList].filter((name) => !ignorableClass(name))
  return el.tagName.toLowerCase() + (classes.length ? `.${classes.join('.')}` : '')
}

// — the diff ————————————————————————————————————————————————

/** A `style` attribute as a map, with `!important` stripped off the values. */
function declarations(style: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!style) return map
  for (const part of style.split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    const property = part.slice(0, at).trim().toLowerCase()
    const value = part
      .slice(at + 1)
      .replace(/!important/i, '')
      .trim()
    if (property && value) map.set(property, value)
  }
  return map
}

/**
 * What changed on one element.
 *
 * Diffed property by property against the style attribute the page shipped with,
 * which styles.ts has been keeping all along for Reset. The `from` is what the
 * *inline* style said, so `null` means "the page had no inline value here" —
 * usually because the value came from a stylesheet, which is exactly where the
 * agent should be going to change it.
 */
function changedOn(el: HTMLElement): Change['declarations'] {
  const before = declarations(pristineStyle(el) ?? null)
  const after = declarations(el.getAttribute('style'))
  const out: Change['declarations'] = []

  for (const [property, value] of after) {
    if (before.get(property) !== value) {
      out.push({ property, from: before.get(property) ?? null, to: value })
    }
  }
  for (const [property, value] of before) {
    if (!after.has(property)) out.push({ property, from: value, to: null })
  }
  return out.sort((a, b) => a.property.localeCompare(b.property))
}

export function collect(): Change[] {
  const changes: Change[] = []
  for (const el of editedElements()) {
    if (!onThePage(el)) continue
    const declarations = changedOn(el)
    if (!declarations.length) continue
    changes.push({
      el,
      selector: selectorFor(el),
      label: labelFor(el),
      text: textOf(el),
      declarations,
    })
  }
  // Document order, so the brief reads down the page the way the page does.
  return changes.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )
}

// — things that are not style ——————————————————————————————————

/**
 * Structural edits, noted as they happen.
 *
 * A deleted element cannot be described after the fact — it is not in the
 * document to be asked — so the description is taken at the moment it goes. The
 * journal is deliberately a list of finished sentences rather than of objects:
 * nothing downstream needs to re-interpret them, and a sentence written while
 * the element still existed can say things a later reader could not work out.
 *
 * Cleared with the editor, like every other session-scoped thing here.
 */
const journal: string[] = []

export function note(sentence: string): void {
  journal.push(sentence)
  if (journal.length > 200) journal.shift()
}

export function noteRemoval(el: HTMLElement): void {
  if (!onThePage(el)) return
  const text = textOf(el)
  note(`Removed \`${selectorFor(el)}\`${text ? ` — "${text}"` : ''}`)
}

export function noteInsert(node: HTMLElement, container: HTMLElement): void {
  if (!onThePage(container)) return
  const what = node.hasAttribute(GROUP_ATTR)
    ? 'a new flex container wrapping the selected children'
    : `a copy of \`${labelFor(node)}\``
  note(`Added ${what} inside \`${selectorFor(container)}\``)
}

export function noteMove(el: HTMLElement, container: HTMLElement): void {
  if (!onThePage(el) || !onThePage(container)) return
  note(`Moved \`${labelFor(el)}\` into \`${selectorFor(container)}\``)
}

export const structural = (): string[] => [...journal]

export function clear(): void {
  journal.length = 0
}

// — the brief ————————————————————————————————————————————————

/**
 * The whole thing as one block of text, ready to be pasted into an agent.
 *
 * Markdown, and phrased as an instruction rather than as a dump, because the
 * thing reading it is going to act on it. Two parts of the wording earn their
 * place: it says these are *rendered* values observed in a browser, so the agent
 * knows they are the end state rather than the source; and it explicitly asks
 * for the change to go into whatever produces the element — the component, the
 * stylesheet, the token — rather than being pasted back as inline styles, which
 * is what a literal-minded reader would otherwise do.
 */
export function brief(): string {
  const changes = collect()
  const events = structural()

  if (!changes.length && !events.length) return ''

  const lines: string[] = []
  lines.push('# UI changes to apply')
  lines.push('')
  lines.push(
    `I made these changes directly in the browser on ${location.href}, using a visual editor.`,
  )
  lines.push(
    'Please apply the equivalent changes to the source. These are the *rendered* values I ended up with — put each one wherever it belongs in the codebase (the component, its stylesheet, a design token), not as inline styles. Keep the existing conventions of the file you are editing.',
  )
  lines.push('')

  if (changes.length) {
    lines.push(`## Styles (${changes.length} element${changes.length === 1 ? '' : 's'})`)
    lines.push('')
    for (const change of changes) {
      lines.push(`### \`${change.selector}\``)
      if (change.text) lines.push(`Text: "${change.text}"`)
      lines.push('')
      for (const { property, from, to } of change.declarations) {
        if (to === null) lines.push(`- \`${property}\`: removed (was \`${from}\`)`)
        else if (from === null) lines.push(`- \`${property}\`: \`${to}\``)
        else lines.push(`- \`${property}\`: \`${from}\` → \`${to}\``)
      }
      lines.push('')
    }
  }

  if (events.length) {
    lines.push('## Structure')
    lines.push('')
    for (const event of events) lines.push(`- ${event}`)
    lines.push('')
  }

  lines.push('---')
  lines.push(
    '_Anything I tried on the side and did not keep is deliberately not listed — only edits live on the page are included._',
  )
  return lines.join('\n')
}
