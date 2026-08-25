import { OWN_NODE_ATTR } from '@/shared/constants'
import { askBackground } from '@/shared/messages'

export interface Media {
  url: string
  filename: string
  kind: 'image' | 'video' | 'audio' | 'svg' | 'canvas' | 'background' | 'mask'
}

const EXTENSION: Record<Media['kind'], string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  svg: 'svg',
  canvas: 'png',
  background: 'png',
  mask: 'svg',
}

/** `data:image/svg+xml;...` → `svg`. Falls back to the kind's usual extension. */
function extensionOf(url: string, kind: Media['kind']): string {
  const mime = /^data:([a-z]+)\/([a-z0-9.+-]+)/i.exec(url)?.[2]
  if (!mime) return EXTENSION[kind]
  return mime.replace(/^svg\+xml$/, 'svg').replace(/^jpeg$/, 'jpg').split('+')[0] ?? EXTENSION[kind]
}

/** Last path segment of a URL or a bare path, decoded. */
function basename(value: string): string {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? (() => {
        try {
          return new URL(value).pathname
        } catch {
          return value
        }
      })()
    : value.split('?')[0] ?? value
  try {
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
  } catch {
    return path.split('/').filter(Boolean).pop() ?? ''
  }
}

const named = (base: string): boolean => Boolean(base) && /\.[a-z0-9]{2,5}$/i.test(base)

/**
 * Query keys that image proxies put the *real* URL in.
 *
 * A resizing CDN serves everything from one path — `/_next/image`, `/cdn-cgi/…`,
 * a bare `/` — and carries the source as a parameter. Reading only the path
 * there gives every image on the site the same name, which is precisely the
 * moment a filename stops being worth anything: five downloads called
 * `image.png`, `image (1).png`, `image (2).png`. The name the project actually
 * uses for the asset is sitting in the query string.
 */
const PROXY_KEYS = ['url', 'src', 'image', 'img', 'file', 'path', 'source', 'uri']

function proxiedName(search: URLSearchParams): string | null {
  for (const key of PROXY_KEYS) {
    const value = search.get(key)
    const base = value ? basename(value) : ''
    if (named(base)) return base
  }
  return null
}

function nameFor(url: string, kind: Media['kind']): string {
  // A data: or blob: URL has no path — its "last segment" is base64 payload, so
  // parsing one for a filename produces garbage rather than a name.
  if (/^(data|blob):/i.test(url)) return `dominator-${kind}.${extensionOf(url, kind)}`
  try {
    const parsed = new URL(url, location.href)
    const base = basename(parsed.pathname)
    // A real filename on the path wins outright; only when the path has none is
    // it worth going looking in the query, or we would rename `photo.jpg?url=…`
    // after somebody else's thumbnail.
    if (named(base)) return base
    const proxied = proxiedName(parsed.searchParams)
    if (proxied) return proxied
    if (base) return `${base}.${EXTENSION[kind]}`
  } catch {
    /* not a parseable URL */
  }
  return `dominator-${kind}.${EXTENSION[kind]}`
}

const firstSourceSrc = (el: HTMLElement): string =>
  el.querySelector<HTMLSourceElement>('source[src]')?.src ?? ''

/**
 * The downloadable file behind an element, if there is one.
 *
 * `currentSrc` is preferred over `src` throughout: with srcset or <source>, it
 * is the variant the browser actually chose to paint, which is the one the user
 * is looking at and therefore the one they mean.
 */
export function mediaOf(el: HTMLElement): Media | null {
  const make = (url: string, kind: Media['kind']): Media | null =>
    url ? { url, filename: nameFor(url, kind), kind } : null

  if (el instanceof HTMLImageElement) return make(el.currentSrc || el.src, 'image')
  if (el instanceof HTMLVideoElement) {
    return make(el.currentSrc || el.src || firstSourceSrc(el), 'video')
  }
  if (el instanceof HTMLAudioElement) {
    return make(el.currentSrc || el.src || firstSourceSrc(el), 'audio')
  }
  if (el instanceof HTMLPictureElement) {
    const img = el.querySelector('img')
    return img ? make(img.currentSrc || img.src, 'image') : null
  }
  if (el instanceof HTMLCanvasElement) {
    try {
      return make(el.toDataURL('image/png'), 'canvas')
    } catch {
      return null // tainted by cross-origin content
    }
  }
  if (el instanceof SVGSVGElement) {
    const markup = new XMLSerializer().serializeToString(el)
    return make(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, 'svg')
  }

  // Nothing is an <img>: the file may be applied through any of several CSS
  // properties. `mask-image` matters most in practice — icon strips are built as
  // a flat background colour punched out by an SVG mask, so the element paints a
  // picture while `background-image` reads `none`.
  const style = window.getComputedStyle(el)
  for (const prop of IMAGE_PROPS) {
    const url = firstUrl(style.getPropertyValue(prop))
    if (url) return make(absolute(url), prop.includes('mask') ? 'mask' : 'background')
  }

  // Last resort: the URL may only exist in a custom property that a shorthand
  // or a stylesheet rule consumes (`mask-image: var(--logo)`). Leaves only —
  // a container defining `--logo` for its children isn't itself the asset.
  if (!el.firstElementChild) {
    const custom = customPropertyUrl(el, style)
    if (custom) return make(absolute(custom), 'mask')
  }
  return null
}

const IMAGE_PROPS = [
  'background-image',
  'mask-image',
  '-webkit-mask-image',
  'border-image-source',
  'list-style-image',
] as const

/** First `url()` in a layered / image-set() value; null for gradients. */
function firstUrl(value: string): string | null {
  if (!value || value === 'none') return null
  return /url\((['"]?)([^'")]+)\1\)/.exec(value)?.[2] ?? null
}

function absolute(url: string): string {
  try {
    return new URL(url, location.href).href
  } catch {
    return url // data: and blob: URLs are already absolute
  }
}

/**
 * Chrome enumerates declared custom properties on computed style, so this finds
 * one wherever it was declared. It is ~450 property reads, so the answer is
 * cached per element — mediaOf runs on every overlay frame.
 */
const customUrls = new WeakMap<HTMLElement, string | null>()

function customPropertyUrl(el: HTMLElement, style: CSSStyleDeclaration): string | null {
  const cached = customUrls.get(el)
  if (cached !== undefined) return cached
  let found: string | null = null
  for (const prop of style) {
    if (!prop.startsWith('--')) continue
    found = firstUrl(style.getPropertyValue(prop))
    if (found) break
  }
  customUrls.set(el, found)
  return found
}

export const isMedia = (el: HTMLElement): boolean => mediaOf(el) !== null

/**
 * Saves the file. The worker's chrome.downloads call is the real path — it
 * bypasses the host page's CSP and CORS and writes to the Downloads folder. The
 * anchor fallback exists for contexts without the API (the local harness), where
 * it still works for same-origin and data: URLs.
 */
export async function download(media: Media): Promise<boolean> {
  const response = await askBackground({
    type: 'media:download',
    url: media.url,
    filename: media.filename,
  })
  if ('ok' in response && response.ok) return true

  try {
    const link = document.createElement('a')
    // Ours, not the page's — otherwise the editor swallows the link's own click,
    // which cancels the download, and selects whatever sits at (0, 0).
    link.setAttribute(OWN_NODE_ATTR, '')
    link.href = media.url
    link.download = media.filename
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    return true
  } catch {
    return false
  }
}
