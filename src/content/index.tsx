import { createRoot } from 'react-dom/client'
import { HOST_ID, OWN_NODE_ATTR } from '@/shared/constants'
import type { Message, MessageResponse } from '@/shared/messages'
import { App } from './App'
import { controller } from './core/controller'
import { store } from './core/store'
// Imported as a string so the host document never receives our CSS.
import overlayCss from './overlay.css?inline'

/**
 * Gives Tailwind's `--tw-*` variables the starting values `@property` was
 * supposed to give them.
 *
 * `@property` registers a custom property — its syntax and, crucially, its
 * initial value — but only from a stylesheet in the *document* tree. Ours is
 * adopted by a shadow root, so all forty-odd registrations Tailwind emits are
 * parsed, present in `cssRules`, and completely inert: `--tw-translate-y` has no
 * value, which makes `translate: var(--tw-translate-x) var(--tw-translate-y)`
 * invalid, which makes the declaration vanish.
 *
 * That is not a translate bug, it is every utility built this way — `border`
 * resolved to no border at all (`--tw-border-style` never became `solid`), and
 * `shadow-*`, `leading-*` and `font-*` went the same way. What it looked like
 * from outside was eight resize handles and two dimension pills sitting half
 * their own width off from where they belong.
 *
 * The values are read back out of the registrations themselves rather than
 * listed here, so this keeps working as Tailwind's output changes and there is
 * no table to fall out of date. They land in `@layer base`, which every utility
 * layer outranks — a utility that sets one of these still wins.
 *
 * Registering them in the host document would also work, and is what a page
 * would normally do. We don't: this stylesheet never touches the host page, and
 * a `--tw-*` name we did not choose is not ours to define for someone else's
 * document.
 */
function propertyDefaults(sheet: CSSStyleSheet): string {
  const declarations: string[] = []
  const walk = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSPropertyRule) {
        if (rule.initialValue) declarations.push(`${rule.name}: ${rule.initialValue};`)
      } else if ('cssRules' in rule) {
        walk((rule as CSSGroupingRule).cssRules)
      }
    }
  }
  walk(sheet.cssRules)
  return `@layer base { *, ::before, ::after, ::backdrop { ${declarations.join('')} } }`
}

/**
 * Content-script entry. Mounts the overlay into a closed-off Shadow DOM and
 * wires the message channel. The editor starts inert: no listeners touch the
 * page until it is activated.
 */
function mount(): void {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute(OWN_NODE_ATTR, '')
  const shadow = host.attachShadow({ mode: 'open' })

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(overlayCss)
  sheet.insertRule(propertyDefaults(sheet), sheet.cssRules.length)
  shadow.adoptedStyleSheets = [sheet]

  const container = document.createElement('div')
  container.setAttribute(OWN_NODE_ATTR, '')

  /**
   * Clicking a button in our chrome must not leave the focus sitting on it.
   *
   * Keys typed into our own controls belong to those controls, so the editor's
   * key handler steps aside whenever the focus is inside the overlay — which
   * meant that after clicking Paste, or a swatch, or an align button, the focus
   * stayed there and every editor key went dead until the user clicked the page
   * again. Shift+Enter after a paste is the one you notice, because pasting is
   * the moment you most want to step out to the parent.
   *
   * Suppressing focus on mousedown is the standard toolbar answer: the click
   * still fires, and Tab still reaches everything for anyone driving by
   * keyboard, so nothing is taken away. Fields are exempt — a text box that
   * refuses the caret is not a text box.
   */
  container.addEventListener('mousedown', (event) => {
    const target = event.composedPath()[0]
    if (!(target instanceof HTMLElement)) return
    const takesText =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    if (!takesText) event.preventDefault()
  })

  shadow.append(container)
  document.body.append(host)

  createRoot(container).render(<App />)
}

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, respond: (response: MessageResponse) => void) => {
    switch (message.type) {
      case 'editor:activate':
        controller.activate()
        break
      case 'editor:deactivate':
        controller.deactivate()
        break
      case 'editor:toggle':
        controller.toggle()
        break
      case 'editor:reset':
        controller.reset()
        break
      case 'editor:query-state':
        break
    }
    const { active, editedCount } = controller.state()
    respond({ active, editedCount })
    return true
  },
)

mount()

// Handle for the local harness (test/fixture.html), which evaluates this bundle
// in page context. Content scripts run in an isolated world, so a real page can
// never reach this.
;(window as unknown as Record<string, unknown>).__dominator = { controller, store }
