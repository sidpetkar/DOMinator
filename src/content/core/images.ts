import * as history from './history'
import { isPasteContainer } from './clipboard'

/**
 * Putting a picture into a box — from the OS clipboard, or from a file.
 *
 * Everything lands as a data URL rather than an object URL. A `blob:` URL dies
 * with the document, so a page reloaded after a session of layout work would
 * come back with every added image broken; a data URL is self-contained, which
 * also means the element survives being copied to another tab through the
 * shared clipboard (see transfer.ts) instead of arriving as a dead reference.
 *
 * The cost is base64's third: an 8MB screenshot becomes about 11MB of markup.
 * Hence the cap — well above any real asset, well below the point where the
 * page starts to struggle with the string.
 */
const MAX_BYTES = 8 * 1024 * 1024

export const isImageFile = (file: File): boolean => file.type.startsWith('image/')

/** The first image among pasted or dropped files, if there is one. */
export function imageIn(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const file of data.files) if (isImageFile(file)) return file
  // A screenshot pasted from the OS often arrives as an item rather than a file
  // entry, with no name of its own.
  for (const item of data.items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

export const tooBig = (file: File): boolean => file.size > MAX_BYTES

export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('could not read the file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Drops an `<img>` into the target, or beside it when the target is not the kind
 * of thing that holds children — the same rule a pasted element follows, shared
 * with clipboard.ts rather than restated, so an image and a card land in the
 * same place when you paste them onto the same selection.
 *
 * The three style declarations are written straight onto the node instead of
 * through styles.ts. They are not edits to the page, they are what the element
 * *is*: an image with no `max-width` overflows any card you put it in, and
 * arriving broken is not a useful starting point. Going through styles.ts would
 * also count the new node in the Reset badge, and Reset would then strip the
 * constraint and leave a full-resolution screenshot bursting out of its box.
 */
export function insertImage(target: HTMLElement, src: string, alt = ''): HTMLImageElement {
  const img = document.createElement('img')
  img.src = src
  img.alt = alt
  img.style.setProperty('max-width', '100%')
  img.style.setProperty('height', 'auto')
  img.style.setProperty('display', 'block')

  if (isPasteContainer(target)) target.append(img)
  else target.after(img)

  history.recordInsert('image', [img])
  return img
}
