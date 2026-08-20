import { createRoot } from 'react-dom/client'
import { HOST_ID, OWN_NODE_ATTR } from '@/shared/constants'
import type { Message, MessageResponse } from '@/shared/messages'
import { App } from './App'
import { controller } from './core/controller'
import { store } from './core/store'
// Imported as a string so the host document never receives our CSS.
import overlayCss from './overlay.css?inline'

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
  shadow.adoptedStyleSheets = [sheet]

  const container = document.createElement('div')
  container.setAttribute(OWN_NODE_ATTR, '')
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
