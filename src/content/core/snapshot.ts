import { EDITED_ATTR, OWN_NODE_ATTR, SNAPSHOT_STATE_ID } from '@/shared/constants'
import * as canvas from './canvas'
import { Budget, collectFontFaces, embedImages } from './embed'
import { FRAME_ATTR } from './frames'
import { serialize } from './transfer'
import { editedCount } from './styles'
import { viewerScript, viewerStyles } from './viewer'

/**
 * Saving the board as one file.
 *
 * The format is a web page, and that is the whole design. Not a project file
 * with a viewer application behind it — an `.html` that a browser already knows
 * how to open, that renders on a machine with nothing installed, that survives
 * being emailed, and that a person can drag into a tab. Everything else follows
 * from refusing to invent a format: no importer, no second rendering path, and
 * no possibility of the saved version looking different from the live one,
 * because the browser draws both.
 *
 * What makes it *ours* rather than a page-save is a JSON block carrying the view
 * transform, the surface, the provenance and the edit record — enough for the
 * extension to reopen it in canvas mode, exactly where it was left, and know
 * which parts of it are the user's work rather than the site's.
 *
 * Three things go in that a "save page as" would not:
 *
 *  - The cascade, resolved (see transfer.ts). A saved page that still relies on
 *    forty stylesheets is a saved page that needs forty files.
 *  - The fonts and the pictures, as bytes (see embed.ts). This is what makes it
 *    work on a plane, and what every other snapshot tool gets wrong.
 *  - A reader (see viewer.ts), so the file is useful to someone who has never
 *    heard of this extension.
 */

export interface SnapshotState {
  version: 1
  /** Where it came from, kept so the file always knows its own origin. */
  source: string
  title: string
  savedAt: string
  view: { x: number; y: number; scale: number }
  surface: string
  /** How many elements carry our edits — shown in the file's own info card. */
  edits: number
}

export interface SnapshotResult {
  html: string
  filename: string
  bytes: number
}

/** Everything on the surface that is not the page: variations and objects. */
const framesInBody = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`body > [${FRAME_ATTR}]`),
]

/**
 * A filename from the page, not from a counter.
 *
 * `.dom.html` rather than `.html`: it is a real web page and has to keep the
 * extension that makes a browser open it, but the double barrel gives the file
 * an identity in a folder — and on Windows, which hides known extensions, it
 * simply reads as `pricing.dom`, which is the name we would have chosen if
 * choosing one did not cost the thing that makes this work.
 */
export function suggestedName(): string {
  const stem =
    (document.title || location.hostname || 'canvas')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'canvas'
  return `${stem}.dom.html`
}

/**
 * Builds the file.
 *
 * Deliberately async and deliberately slow — it fetches every image and every
 * font face the page uses. That cost is paid once, at save, in exchange for a
 * file that never needs the network again.
 */
export async function build(): Promise<SnapshotResult> {
  const budget = new Budget()

  /**
   * The page's own children, minus ours and minus the variations.
   *
   * Frames are children of `body` because that is what puts them in canvas
   * coordinates (see frames.ts), but they are not part of the document — they
   * are things standing beside it — so they are serialised separately and
   * re-attached in the same relationship on the other side.
   */
  const pageChildren = [...document.body.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.hasAttribute(FRAME_ATTR) &&
      !child.hasAttribute(OWN_NODE_ATTR),
  )
  const frames = framesInBody()

  const page = serialize(pageChildren, { maxNodes: 24_000, maxBytes: 24_000_000 })
  if (!page.ok) throw new Error(page.reason)
  const objects = frames.length
    ? serialize(frames, { maxNodes: 24_000, maxBytes: 24_000_000 })
    : { ok: true as const, html: '', nodes: 0 }
  if (!objects.ok) throw new Error(objects.reason)

  /**
   * Parsed back into a document to have its assets swapped in.
   *
   * `DOMParser` builds them inert — no script runs, no image is fetched — which
   * is the right posture for markup that is about to be rewritten, and it means
   * the embedding pass cannot accidentally trigger a page load.
   */
  const held = new DOMParser().parseFromString(
    `<body>${page.html}${objects.html}</body>`,
    'text/html',
  )
  await embedImages(held.body, budget)
  const fontFaces = await collectFontFaces(budget)

  const view = canvas.active() ? canvas.transform() : { x: 0, y: 0, scale: 1 }
  const state: SnapshotState = {
    version: 1,
    source: location.href,
    title: document.title || location.hostname,
    savedAt: new Date().toISOString(),
    view,
    surface: canvas.surface(),
    edits: editedCount(),
  }

  /**
   * The frame's own metrics, frozen.
   *
   * On the live page the artboard's width is the viewport's; in the file there
   * is no viewport to ask, so the number it had at save time is written down.
   * Without it the saved board reflows to whatever window it is opened in, and
   * a design reviewed at 1440 arrives on a laptop as a different design.
   */
  const width = document.body.offsetWidth || window.innerWidth
  const minHeight = Math.max(document.body.scrollHeight, document.body.offsetHeight)
  const background = window.getComputedStyle(document.body).backgroundColor

  const html = wrap([
    `<meta charset="utf-8">`,
    `<title>${escapeHtml(state.title)}</title>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    // Provenance, in the head where a person or a script can find it without
    // parsing the state block.
    `<meta name="dominator:source" content="${escapeHtml(state.source)}">`,
    `<meta name="dominator:saved" content="${escapeHtml(state.savedAt)}">`,
    // Links still point where they pointed. Everything that decides *appearance*
    // is embedded; this is only so that clicking through means something.
    `<base href="${escapeHtml(location.href)}">`,
    `<style>${baseStyles(width, minHeight, background, state.surface)}${fontFaces}${viewerStyles()}</style>`,
  ], held.body.innerHTML, state)

  return { html, filename: suggestedName(), bytes: html.length }
}

function wrap(head: string[], body: string, state: SnapshotState): string {
  return `<!doctype html>
<html lang="en">
<head>
${head.join('\n')}
</head>
<body>
${body}
<script type="application/json" id="${SNAPSHOT_STATE_ID}">${JSON.stringify(state).replace(/</g, '\\u003c')}</script>
<script>${viewerScript()}</script>
</body>
</html>`
}

/**
 * The little CSS the file needs of its own.
 *
 * Almost nothing, because the cascade is already resolved onto every element.
 * What is left is the board itself: the surface behind the frame, the frame's
 * frozen size, and the hairline that says where the page ends — the same three
 * declarations canvas.ts writes on the live page, so the file opens looking
 * exactly like the thing that was saved.
 */
function baseStyles(width: number, minHeight: number, background: string, surface: string): string {
  return `
html { margin: 0; padding: 0; background: ${surface}; height: 100%; }
body {
  margin: 0;
  width: ${Math.round(width)}px;
  min-height: ${Math.round(minHeight)}px;
  background: ${background && background !== 'rgba(0, 0, 0, 0)' ? background : '#ffffff'};
  transform-origin: 0 0;
  overflow: visible;
}
body[data-dm-canvas] { outline: 1px solid rgba(11, 11, 12, 0.12); }
[${FRAME_ATTR}] { position: absolute; }
[${EDITED_ATTR}] { }
`
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)

/** Reads the state block out of a page that is a saved canvas, if it is one. */
export function readState(): SnapshotState | null {
  const node = document.getElementById(SNAPSHOT_STATE_ID)
  if (!node?.textContent) return null
  try {
    const state = JSON.parse(node.textContent) as SnapshotState
    return state.version === 1 ? state : null
  } catch {
    return null
  }
}
