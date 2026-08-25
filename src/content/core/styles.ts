import { EDITED_ATTR } from '@/shared/constants'

/**
 * Every write goes through here. Host pages routinely ship utility CSS with
 * high specificity, so all of our writes are inline + !important (PRD §2).
 *
 * What we remember per element is its *entire* original style attribute, not a
 * per-property map. That makes reset and undo the same operation — put a string
 * back — and it cannot drift out of sync with a property we forgot to track.
 */
const pristine = new WeakMap<HTMLElement, string | null>()
const edited = new Set<HTMLElement>()

const remember = (el: HTMLElement): void => {
  if (!pristine.has(el)) pristine.set(el, el.getAttribute('style'))
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  remember(el)
  el.style.setProperty(prop, value, 'important')
  el.setAttribute(EDITED_ATTR, '')
  edited.add(el)
}

export function setStyles(el: HTMLElement, decls: Record<string, string>): void {
  for (const [prop, value] of Object.entries(decls)) setStyle(el, prop, value)
}

export const px = (n: number): string => `${Math.round(n)}px`

/** The style attribute this element had before DOMinator ever touched it. */
export const pristineStyle = (el: HTMLElement): string | null | undefined => pristine.get(el)

const applyAttr = (el: HTMLElement, value: string | null): void => {
  if (value === null) el.removeAttribute('style')
  else el.setAttribute('style', value)
}

export function revert(el: HTMLElement): void {
  if (!pristine.has(el)) return
  applyAttr(el, pristine.get(el) ?? null)
  forget(el)
}

/** Stops tracking an element entirely — used when its changes are reverted. */
export function forget(el: HTMLElement): void {
  pristine.delete(el)
  unedit(el)
}

/**
 * Drops an element from the edited set while *keeping* what it originally
 * looked like. Undo goes here rather than to forget(): a redo puts the change
 * back, and without the pristine value it would have nothing to diff against —
 * the element would go on carrying our styles without counting as edited, so
 * Reset would leave it behind.
 */
function unedit(el: HTMLElement): void {
  edited.delete(el)
  el.removeAttribute(EDITED_ATTR)
}

/**
 * Restores a captured style attribute (undo or redo). If the element is back to
 * how the page shipped it, it stops counting as edited — otherwise the Reset
 * badge would keep counting elements that no longer carry any of our changes.
 */
export function restoreStyle(el: HTMLElement, value: string | null): void {
  const original = pristine.get(el)
  applyAttr(el, value)
  if (original === undefined || value === (original ?? null)) unedit(el)
  else {
    el.setAttribute(EDITED_ATTR, '')
    edited.add(el)
  }
}

/**
 * Drops one property, letting the page's own value show through again. If that
 * leaves the element as it shipped, it stops counting as edited.
 */
export function clearStyle(el: HTMLElement, prop: string): void {
  el.style.removeProperty(prop)
  const original = pristine.get(el)
  if (original !== undefined && el.getAttribute('style') === (original ?? null)) forget(el)
  if (!el.getAttribute('style')) el.removeAttribute('style')
}

export function revertAll(): void {
  for (const el of [...edited]) revert(el)
}

export function editedCount(): number {
  return edited.size
}
