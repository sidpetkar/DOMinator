import { askBackground } from '@/shared/messages'

/**
 * Turning a page's assets into bytes the file can carry.
 *
 * A saved canvas is meant to work on a plane. Everything that decides how it
 * looks therefore has to be *in* it — images, and above all fonts, which are the
 * thing every other "save this page" tool gets wrong. Open one of those offline
 * and the type comes back in Arial, which is the single most visible way a
 * design snapshot can be wrong.
 *
 * Every fetch goes through the service worker, because its requests answer to
 * our host permissions rather than to the page's content policy — a `fetch` from
 * the content script is subject to the site's CSP and to CORS, and would be
 * refused for most of what is worth embedding.
 *
 * The whole thing is best-effort and budgeted. Anything skipped keeps its
 * original URL, so a reader who is online still sees it; only the offline case
 * degrades, and it degrades to "one picture missing" rather than to a failure.
 */

/** How much a saved file may spend on embedded assets in total. */
const BUDGET = 12_000_000

/** Assets already fetched this session, so two `<img>` on one src cost one. */
const cache = new Map<string, string | null>()

export class Budget {
  private spent = 0
  constructor(private readonly limit = BUDGET) {}
  get remaining(): number {
    return Math.max(0, this.limit - this.spent)
  }
  take(bytes: number): boolean {
    if (this.spent + bytes > this.limit) return false
    this.spent += bytes
    return true
  }
}

const embeddable = (url: string): boolean =>
  Boolean(url) && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('#')

/** One URL as a data: URI, or null if it could not be had within budget. */
export async function asDataUri(url: string, budget: Budget): Promise<string | null> {
  if (!embeddable(url)) return url.startsWith('data:') ? url : null
  const held = cache.get(url)
  if (held !== undefined) return held

  const response = await askBackground({ type: 'asset:fetch', url })
  const value =
    'asset' in response && response.ok && budget.take(response.bytes) ? response.asset : null
  cache.set(url, value)
  return value
}

/** A stylesheet's text, for the ones we have to read rather than carry. */
export async function asText(url: string): Promise<string | null> {
  const response = await askBackground({ type: 'asset:fetch', url, asText: true })
  return 'asset' in response && response.ok ? response.asset : null
}

// — images ————————————————————————————————————————————————————

const URL_IN_CSS = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g

/**
 * Rewrites every picture in a subtree to carry its own bytes.
 *
 * Both halves of "picture" — the `src` of an `<img>` and the `url()` inside a
 * `background-image`, which by the time this runs is an absolute URL because
 * `getComputedStyle` resolved it when the cascade was inlined.
 *
 * `srcset` is dropped rather than embedded: it is a list of the same image at
 * several sizes, and carrying five copies of one photograph to save a browser a
 * decision it will never have to make offline is the wrong trade. The `src` it
 * falls back to is the one that gets the bytes.
 */
export async function embedImages(root: Element, budget: Budget): Promise<void> {
  const jobs: Promise<void>[] = []

  for (const img of [root, ...root.querySelectorAll('*')]) {
    if (!(img instanceof HTMLElement)) continue

    if (img instanceof HTMLImageElement && embeddable(img.getAttribute('src') ?? '')) {
      const src = img.src
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      jobs.push(
        asDataUri(src, budget).then((data) => {
          if (data) img.setAttribute('src', data)
        }),
      )
    }

    const background = img.style.getPropertyValue('background-image')
    if (background && background.includes('url(')) {
      jobs.push(
        rewriteCssUrls(background, budget).then((next) => {
          if (next) img.style.setProperty('background-image', next, 'important')
        }),
      )
    }
  }

  await Promise.all(jobs)
}

/** Every `url()` in one declaration, swapped for its bytes where affordable. */
async function rewriteCssUrls(value: string, budget: Budget): Promise<string | null> {
  const urls = [...value.matchAll(URL_IN_CSS)].map((match) => match[1] ?? '')
  if (!urls.length) return null
  const resolved = await Promise.all(urls.map((url) => asDataUri(url, budget)))
  let index = 0
  return value.replace(URL_IN_CSS, (whole: string) => {
    const data = resolved[index++]
    return data ? `url("${data}")` : whole
  })
}

// — fonts ——————————————————————————————————————————————————————

/**
 * Every `@font-face` the page actually uses, rewritten to carry its own file.
 *
 * Two sources, because a page has two ways of getting a webfont and they fail
 * differently:
 *
 *  - Rules in a stylesheet we can read — same-origin sheets and inline `<style>`
 *    blocks. `cssRules` throws on a cross-origin sheet, so those are caught and
 *    skipped rather than allowed to abort the save.
 *  - `<link>` tags pointing at Google Fonts, whose sheet is exactly the
 *    cross-origin case above. Its *text* is fetched through the worker instead —
 *    which is possible only because the manifest already asks for
 *    `fonts.googleapis.com`, for the font picker.
 *
 * Only the faces the document is actually using survive. A Google Fonts sheet
 * for one family still carries a dozen `@font-face` rules — one per writing
 * system — and embedding Cyrillic and Vietnamese subsets for a page of English
 * would triple the file for nothing.
 */
export async function collectFontFaces(budget: Budget): Promise<string> {
  const used = usedFamilies()
  const rules: string[] = []

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText)
      }
    } catch {
      /* Cross-origin sheet: unreadable by design. The <link> pass may catch it. */
    }
  }

  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')].filter(
    (link) => /fonts\.googleapis\.com/.test(link.href),
  )
  for (const link of links) {
    const css = await asText(link.href)
    if (!css) continue
    for (const match of css.matchAll(/@font-face\s*\{[^}]*\}/g)) rules.push(match[0])
  }

  const wanted = rules.filter((rule) => {
    const family = /font-family:\s*['"]?([^;'"]+)/i.exec(rule)?.[1]?.trim().toLowerCase()
    return family ? used.has(family) : false
  })

  const embedded = await Promise.all(wanted.map((rule) => embedFontRule(rule, budget)))
  return embedded.filter(Boolean).join('\n')
}

/** The families anything on the page is actually set in. */
function usedFamilies(): Set<string> {
  const families = new Set<string>()
  const add = (el: Element) => {
    for (const name of window.getComputedStyle(el).fontFamily.split(',')) {
      families.add(name.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    }
  }
  if (document.body) add(document.body)
  // Bounded: a page of ten thousand nodes does not have ten thousand fonts, and
  // the first few hundred elements have seen every family the design uses.
  for (const el of [...document.body.querySelectorAll('*')].slice(0, 600)) add(el)
  return families
}

async function embedFontRule(rule: string, budget: Budget): Promise<string> {
  const sources = [...rule.matchAll(URL_IN_CSS)].map((match) => match[1] ?? '')
  if (!sources.length) return rule
  let out = rule
  for (const source of sources) {
    if (!embeddable(source)) continue
    const data = await asDataUri(new URL(source, document.baseURI).href, budget)
    // A face we could not fetch is dropped whole: a `src` still pointing at a
    // CDN would make the file look fine online and wrong offline, which is the
    // one failure this is all here to prevent.
    if (!data) return ''
    out = out.replace(source, data)
  }
  return out
}
