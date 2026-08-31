import { sendToTab, type WorkerRequest, type WorkerResponse } from '@/shared/messages'
import { handleFontRequest } from './fonts'

/**
 * The service worker does three things: route the keyboard command, act as the
 * font proxy (the only context whose fetches answer to our host permissions
 * rather than the host page's CSP), and perform downloads.
 */
/**
 * There is no popup: clicking the icon toggles the editor on the spot, which is
 * the only thing the popup did that the in-page bar doesn't already do better.
 *
 * If the content script isn't there — a tab that was already open when the
 * extension was installed or reloaded — it is injected first, so the icon never
 * appears to do nothing.
 */
async function toggleOnTab(tabId: number): Promise<void> {
  const response = await sendToTab(tabId, { type: 'editor:toggle' })
  if (response) return
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await sendToTab(tabId, { type: 'editor:toggle' })
  } catch {
    /* chrome:// and Web Store pages refuse injection; nothing to do. */
  }
}

/**
 * The cross-tab clipboard lives in `chrome.storage.session`, which is closed to
 * content scripts by default — and every one of ours is a content script. This
 * opens it to them.
 *
 * "Untrusted" here means the isolated world our code runs in, not the page: a
 * site's own scripts have no `chrome.storage` to reach for, so the shelf is
 * readable by DOMinator in any tab and by nothing else.
 *
 * Called on install *and* on startup, because the access level resets with the
 * browser session — exactly as the storage it governs does.
 */
function openShelfToTabs(): void {
  void chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => {
      /* Older Chrome without setAccessLevel: paste stays per-tab. */
    })
}

chrome.runtime.onInstalled.addListener(openShelfToTabs)
chrome.runtime.onStartup.addListener(openShelfToTabs)
openShelfToTabs()

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void toggleOnTab(tab.id)
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-editor') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) await toggleOnTab(tab.id)
})

async function download(url: string, filename: string): Promise<WorkerResponse> {
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false })
    return { ok: true, id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Chrome rate-limits captureVisibleTab to roughly two calls a second per tab and
 * throws once you exceed it. A long screenshot needs one call per viewport of
 * height, so the calls are spaced here rather than in the content script, and a
 * quota error is retried once after a full window.
 */
const MIN_GAP_MS = 550
let lastCapture = 0

async function captureViewport(windowId: number | undefined): Promise<WorkerResponse> {
  const wait = MIN_GAP_MS - (Date.now() - lastCapture)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastCapture = Date.now()
      const data = await chrome.tabs.captureVisibleTab(windowId as number, {
        format: 'png',
      })
      return { ok: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 0 && message.includes('MAX_CAPTURE')) {
        await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS))
        continue
      }
      return { ok: false, error: message }
    }
  }
  return { ok: false, error: 'capture failed' }
}

/**
 * One asset, as a data: URI (or as text, for a stylesheet we need to read).
 *
 * Capped, because a saved canvas is a file someone is going to email: a single
 * hero image at 8MB would make the whole thing unsendable, and the URL is kept
 * in the markup regardless, so anything skipped still loads for a reader who is
 * online. Better a 3MB file that is perfect offline for everything reasonable
 * than a 40MB one that is perfect for everything.
 */
const MAX_ASSET_BYTES = 2_500_000

async function fetchAsset(url: string, asText = false): Promise<WorkerResponse> {
  try {
    const response = await fetch(url, { credentials: 'omit' })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    if (asText) {
      const text = await response.text()
      return { ok: true, asset: text, bytes: text.length }
    }
    const blob = await response.blob()
    if (blob.size > MAX_ASSET_BYTES) return { ok: false, error: 'too large' }
    const buffer = new Uint8Array(await blob.arrayBuffer())
    // Chunked, because `String.fromCharCode(...bytes)` on a megabyte of image
    // blows the argument limit and throws.
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < buffer.length; i += CHUNK) {
      binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK))
    }
    const type = blob.type || 'application/octet-stream'
    return { ok: true, asset: `data:${type};base64,${btoa(binary)}`, bytes: blob.size }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, sender, respond) => {
  if (message?.type === 'asset:fetch') {
    void fetchAsset(message.url, message.asText).then(respond)
    return true
  }
  if (message?.type === 'zoom:get') {
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      respond({ ok: false, error: 'no tab' })
      return false
    }
    void chrome.tabs
      .getZoom(tabId)
      .then((zoom) => respond({ ok: true, zoom }))
      .catch((error) => respond({ ok: false, error: String(error) }))
    return true
  }
  if (message?.type === 'capture:viewport') {
    void captureViewport(sender.tab?.windowId).then(respond)
    return true
  }
  if (message?.type === 'media:download') {
    void download(message.url, message.filename).then(respond)
    return true
  }
  if (!message?.type?.startsWith('fonts:')) return false
  void handleFontRequest(message).then(respond)
  return true
})
