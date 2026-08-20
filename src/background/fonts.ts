import type { FontMeta, WorkerRequest, WorkerResponse } from '@/shared/messages'

/**
 * The Google Fonts *directory* metadata — the same feed fonts.google.com uses
 * for its own listing. No API key, the whole library, and it carries the weight
 * list per family, which is what lets the picker offer a family's real weights
 * instead of a hardcoded 300/400/700.
 */
const LIST_URL = 'https://fonts.google.com/metadata/fonts'
const CACHE_KEY = 'dominator:fonts'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

interface RawFamily {
  family: string
  category?: string
  fonts?: Record<string, unknown>
}

interface CachedList {
  at: number
  fonts: FontMeta[]
}

/** The response is guarded with an anti-JSON-hijacking prefix. */
const parseGuarded = (text: string): unknown => JSON.parse(text.replace(/^\)]}'\s*/, ''))

function toMeta(raw: RawFamily): FontMeta {
  const weights = [
    ...new Set(
      Object.keys(raw.fonts ?? { 400: 0 }).map((key) => Number.parseInt(key, 10)),
    ),
  ]
    .filter((weight) => Number.isFinite(weight))
    .sort((a, b) => a - b)
  return {
    family: raw.family,
    weights: weights.length ? weights : [400],
    category: raw.category ?? 'sans-serif',
  }
}

let inflight: Promise<FontMeta[]> | null = null

async function fetchList(): Promise<FontMeta[]> {
  const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as CachedList | undefined
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.fonts

  const res = await fetch(LIST_URL)
  if (!res.ok) throw new Error(`font list ${res.status}`)
  const data = parseGuarded(await res.text()) as { familyMetadataList?: RawFamily[] }
  const fonts = (data.familyMetadataList ?? []).map(toMeta)
  if (!fonts.length) throw new Error('font list empty')
  await chrome.storage.local.set({ [CACHE_KEY]: { at: Date.now(), fonts } satisfies CachedList })
  return fonts
}

export function listFonts(): Promise<FontMeta[]> {
  inflight ??= fetchList().finally(() => {
    inflight = null
  })
  return inflight
}

const faceCache = new Map<string, string>()

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * css2 hands back a stylesheet, not a font, so we resolve the woff2 URL it
 * points at and fetch the bytes ourselves. The content script turns those bytes
 * straight into a FontFace, which means no <link> in the host page and nothing
 * for its CSP to refuse.
 */
async function fetchFace(family: string, weight: number, preview?: boolean): Promise<string> {
  const key = `${family}:${weight}:${preview ? 'p' : 'f'}`
  const hit = faceCache.get(key)
  if (hit) return hit

  const url = new URL('https://fonts.googleapis.com/css2')
  url.searchParams.set('family', `${family}:wght@${weight}`)
  url.searchParams.set('display', 'swap')
  // Subset to just the glyphs the list row needs to draw.
  if (preview) url.searchParams.set('text', family)

  const css = await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`css2 ${res.status}`)
    return res.text()
  })
  // Subset URLs come back as /l/font?kit=… with no extension, so key off the
  // format() declaration rather than the filename.
  const woff2 = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('woff2'\)/.exec(css)?.[1]
  if (!woff2) throw new Error('no woff2 in css2 response')

  const buffer = await fetch(woff2).then((res) => {
    if (!res.ok) throw new Error(`woff2 ${res.status}`)
    return res.arrayBuffer()
  })
  const data = toBase64(buffer)
  // Previews are small and long-lived; full faces are big, so keep the cache
  // honest rather than letting the worker balloon.
  if (faceCache.size > 240) faceCache.clear()
  faceCache.set(key, data)
  return data
}

export async function handleFontRequest(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (request.type === 'fonts:list') return { ok: true, fonts: await listFonts() }
    if (request.type !== 'fonts:face') return { ok: false, error: 'unhandled' }
    return { ok: true, data: await fetchFace(request.family, request.weight, request.preview) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
