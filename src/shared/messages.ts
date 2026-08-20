/**
 * Editor messages are sent to the content script (background → tab).
 * Font messages go the other way, to the background worker: only it can reach
 * fonts.google.com without tripping over the host page's CORS and CSP.
 */
export type Message =
  | { type: 'editor:activate' }
  | { type: 'editor:deactivate' }
  | { type: 'editor:toggle' }
  | { type: 'editor:reset' }
  | { type: 'editor:query-state' }

export type MessageResponse = {
  active: boolean
  /** Number of elements carrying DOMinator edits. */
  editedCount: number
}

export interface FontMeta {
  family: string
  /** Numeric weights the family actually ships, ascending. */
  weights: number[]
  category: string
}

export type WorkerRequest =
  | { type: 'fonts:list' }
  /**
   * One woff2, returned as base64 so it survives the message boundary. With
   * `preview` the file is subset to the family name's own glyphs — a couple of
   * KB, which is what makes rendering a 1500-row list in situ affordable.
   */
  | { type: 'fonts:face'; family: string; weight: number; preview?: boolean }
  /** Saves a file the user asked for via the media download button. */
  | { type: 'media:download'; url: string; filename: string }
  /**
   * One PNG of the tab's *visible viewport*. A region taller than the viewport
   * is assembled from several of these by the content script (see screenshot.ts)
   * — this is the only API that can read the page's pixels, and it can only ever
   * see what is on screen.
   */
  | { type: 'capture:viewport' }
  /** The tab's browser zoom factor — 0.25 at 25%, 1 at 100%. */
  | { type: 'zoom:get' }

export type WorkerResponse =
  | { ok: true; fonts: FontMeta[] }
  | { ok: true; data: string }
  | { ok: true; id: number }
  | { ok: true; zoom: number }
  | { ok: false; error: string }

export function sendToTab(tabId: number, message: Message): Promise<MessageResponse | undefined> {
  return chrome.tabs.sendMessage(tabId, message).catch(() => undefined)
}

export async function sendToActiveTab(message: Message): Promise<MessageResponse | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return undefined
  return sendToTab(tab.id, message)
}

export async function askBackground(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    return (await chrome.runtime.sendMessage(request)) as WorkerResponse
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
