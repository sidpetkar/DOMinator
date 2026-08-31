import { OWN_NODE_ATTR } from '@/shared/constants'
import * as frames from './frames'
import { depths } from './history'
import { build, suggestedName } from './snapshot'
import { store } from './store'
import { editedCount } from './styles'

/**
 * Getting the file onto disk, and keeping it there.
 *
 * Two routes, because they answer two different questions.
 *
 * **Download** is the share button. It asks nothing and remembers nothing: a
 * copy lands in Downloads and you send it to somebody. It works everywhere,
 * including in browsers that have never heard of the API below.
 *
 * **Save** is the document button. The first Ctrl+S opens the system's own save
 * dialogue and, crucially, keeps the handle it gets back — so every save after
 * that writes to the file you chose, in place, with no dialogue and no second
 * copy in Downloads. That is the whole difference between a tool that exports
 * and a tool you can work in.
 *
 * The handle lives in IndexedDB because it survives a reload — `FileSystemFileHandle`
 * is one of the few objects the structured clone algorithm can persist — so
 * closing the tab and coming back to the same page finds the same file waiting.
 * Chrome still asks for permission once per session before the first write,
 * which is the browser's rule and not one worth fighting: it is a single click,
 * and it is what stops a page from silently rewriting your disk.
 *
 * All of it works offline. Nothing here touches the network — the file is built
 * from the DOM in front of you and written to a local disk.
 */

interface FilePicker {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>
}

const picker = (): FilePicker['showSaveFilePicker'] | undefined =>
  (window as unknown as FilePicker).showSaveFilePicker

export const canSaveInPlace = (): boolean => typeof picker() === 'function'

// — remembering where it went ——————————————————————————————————

const DB = 'dominator'
const STORE = 'handles'

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Keyed by page, not by session.
 *
 * The question a returning user is asking is "where does *this* board save to",
 * and the board is identified by the page it was made from. A saved canvas
 * reopened from disk keys on its own `file://` URL, so it finds itself.
 */
const key = (): string => location.href.split('#')[0] ?? location.href

async function remember(handle: FileSystemFileHandle): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, key())
  } catch {
    /* Private browsing, or a browser that refuses to clone the handle. */
  }
}

async function recall(): Promise<FileSystemFileHandle | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key())
      request.onsuccess = () => resolve((request.result as FileSystemFileHandle) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

// — the file itself ————————————————————————————————————————————

let handle: FileSystemFileHandle | null = null
let loaded = false
let written = ''
let saving = false

/**
 * Whether the board has moved on since the file was last written.
 *
 * A fingerprint rather than a dirty flag set by every writer in the codebase.
 * The store fires on every tracked frame — sixty times a second, mostly saying
 * "the same element is still the same size" — so subscribing to it would make
 * the file permanently dirty and autosave would rebuild the whole page once a
 * minute forever. These three numbers only move when something actually
 * happened: an element was styled, a change was pushed onto the undo stack, or a
 * variation appeared. Cheap to read, and quiet when the board is quiet.
 */
const fingerprint = (): string => {
  const { undoDepth, redoDepth } = depths()
  return `${editedCount()}:${undoDepth}:${redoDepth}:${frames.count()}`
}

export const isDirty = (): boolean => fingerprint() !== written

/** Whether a target file is known, so the UI can say "Save" rather than "Save as". */
export const hasTarget = (): boolean => Boolean(handle)

async function target(): Promise<FileSystemFileHandle | null> {
  if (handle) return handle
  if (!loaded) {
    loaded = true
    handle = await recall()
  }
  return handle
}

/**
 * Permission is asked for, never assumed.
 *
 * A handle recovered from IndexedDB comes back without write permission — the
 * grant does not survive the session, by design. `requestPermission` needs a
 * user gesture, which is why autosave never calls this: it only ever writes
 * through a permission the user has already granted this session, and quietly
 * does nothing until they have.
 */
async function writable(candidate: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  const withPermissions = candidate as FileSystemFileHandle & {
    queryPermission?: (options: { mode: string }) => Promise<PermissionState>
    requestPermission?: (options: { mode: string }) => Promise<PermissionState>
  }
  try {
    const held = await withPermissions.queryPermission?.({ mode: 'readwrite' })
    if (held === 'granted') return true
    if (!ask) return false
    return (await withPermissions.requestPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

async function writeTo(candidate: FileSystemFileHandle, html: string): Promise<void> {
  const stream = await candidate.createWritable()
  await stream.write(html)
  await stream.close()
}

/**
 * Save as — pick a place, write, and remember it for next time.
 *
 * Must be called from a user gesture: the picker refuses otherwise, and there is
 * no way around that nor should there be.
 */
export async function saveAs(): Promise<boolean> {
  const show = picker()
  if (!show) {
    await download()
    return true
  }
  let chosen: FileSystemFileHandle
  try {
    chosen = await show({
      suggestedName: suggestedName(),
      types: [
        {
          description: 'DOMinator canvas',
          accept: { 'text/html': ['.dom.html', '.html'] },
        },
      ],
    })
  } catch {
    // The user closed the dialogue. Not an error, and not worth a toast.
    return false
  }
  handle = chosen
  await remember(chosen)
  return write('Saved')
}

/** Ctrl+S. Straight to disk if we know where; otherwise ask, once. */
export async function save(): Promise<boolean> {
  const known = await target()
  if (!known) return saveAs()
  if (!(await writable(known, true))) return saveAs()
  return write('Saved')
}

/**
 * The quiet one. Never asks for anything, never opens a dialogue, and gives up
 * silently if it cannot write — an autosave that interrupts is not an autosave.
 */
export async function autosave(): Promise<void> {
  if (!isDirty() || saving) return
  const known = await target()
  if (!known || !(await writable(known, false))) return
  await write(null)
}

async function write(toast: string | null): Promise<boolean> {
  const known = handle
  if (!known) return false
  saving = true
  const at = fingerprint()
  try {
    const { html } = await build()
    await writeTo(known, html)
    written = at
    store.set({ toast: toast ? `${toast} · ${known.name}` : null })
    if (toast) window.setTimeout(() => store.set({ toast: null }), 1800)
    return true
  } catch (error) {
    store.set({ toast: `Could not save — ${error instanceof Error ? error.message : 'unknown'}` })
    window.setTimeout(() => store.set({ toast: null }), 2600)
    return false
  } finally {
    saving = false
  }
}

/**
 * The share button: a copy in Downloads, no questions asked.
 *
 * A blob URL rather than the downloads API, because this file is built here and
 * has no URL to hand the worker — and an `<a download>` is the one path that
 * works identically whether the page is `https:` or a `file:` a user dragged in.
 */
export async function download(): Promise<void> {
  store.set({ toast: 'Packing the canvas…' })
  try {
    const { html, filename, bytes } = await build()
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    /**
     * Marked as ours, which is the whole reason downloads never happened.
     *
     * The editor swallows every click on the page in the capture phase — that is
     * how a link in the page can be selected instead of followed — and this link
     * is *in the page*, so `link.click()` was being intercepted and prevented by
     * our own handler a microtask after we dispatched it. No download, no error,
     * nothing in the console. The attribute is what `isOwnNode` looks for, and
     * it makes the handler step aside for our own chrome.
     */
    link.setAttribute(OWN_NODE_ATTR, '')
    document.body.append(link)
    link.click()
    link.remove()
    // Revoked on a timer: revoking synchronously can beat the download starting.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    store.set({ toast: `${filename} · ${Math.round(bytes / 1024)} KB` })
    window.setTimeout(() => store.set({ toast: null }), 2400)
  } catch (error) {
    store.set({ toast: `Could not pack it — ${error instanceof Error ? error.message : 'unknown'}` })
    window.setTimeout(() => store.set({ toast: null }), 2600)
  }
}

// — the timer ——————————————————————————————————————————————————

let timer = 0

/**
 * Once a minute, and only when there is something to write.
 *
 * A minute rather than on every change: building the file walks the whole page
 * and resolves the cascade, which is far too much work to do on a keystroke. The
 * dirty flag means an idle board costs nothing at all.
 */
export function startAutosave(): void {
  if (timer) return
  timer = window.setInterval(() => void autosave(), 60_000)
}

export function stopAutosave(): void {
  if (timer) window.clearInterval(timer)
  timer = 0
}

/** Forgets the file this tab was saving to — used when the editor closes. */
export function forgetTarget(): void {
  handle = null
  loaded = false
  written = ''
}
