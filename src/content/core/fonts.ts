import { askBackground, type FontMeta } from '@/shared/messages'

/**
 * Fonts arrive from the background worker as bytes and are registered with the
 * FontFace constructor's binary form. Nothing is fetched from page context and
 * no <link> is injected, so a site with `font-src 'self'` cannot stop us.
 *
 * Two namespaces are kept apart on purpose:
 *  - `CWP <family>` holds the *preview* face, subset to the family name's own
 *    glyphs. Cheap enough to load one per visible row of the picker.
 *  - `<family>` holds real faces, loaded only once a family is actually chosen.
 * Mixing them would render applied text with a font containing ~10 glyphs.
 */
export const previewFamily = (family: string): string => `CWP ${family}`

const decode = (base64: string): ArrayBuffer => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

const loading = new Map<string, Promise<boolean>>()

async function register(
  faceFamily: string,
  source: { family: string; weight: number; preview?: boolean },
): Promise<boolean> {
  const response = await askBackground({ type: 'fonts:face', ...source })
  if (!('ok' in response) || !response.ok || !('data' in response)) return false
  try {
    const face = new FontFace(faceFamily, decode(response.data), {
      weight: String(source.weight),
      display: 'swap',
    })
    await face.load()
    document.fonts.add(face)
    return true
  } catch {
    return false
  }
}

/**
 * De-duplicates in-flight loads but never caches a failure: a rate-limited or
 * dropped request must not make a family permanently unloadable for the rest of
 * the session.
 */
function once(key: string, run: () => Promise<boolean>): Promise<boolean> {
  const pending = loading.get(key)
  if (pending) return pending
  const started = run().then((ok) => {
    if (!ok) loading.delete(key)
    return ok
  })
  loading.set(key, started)
  return started
}

/** Name-only subset, for drawing one row of the family list in its own face. */
export function loadPreview(meta: FontMeta): Promise<boolean> {
  const weight = meta.weights.includes(400) ? 400 : (meta.weights[0] ?? 400)
  return once(`p:${meta.family}`, () =>
    register(previewFamily(meta.family), { family: meta.family, weight, preview: true }),
  )
}

/** The real face, under its real name, so applying it renders actual text. */
export function loadFamily(family: string, weight: number): Promise<boolean> {
  return once(`f:${family}:${weight}`, () => register(family, { family, weight }))
}

let catalogue: Promise<FontMeta[]> | null = null

/** The full Google Fonts directory, cached for a week by the worker. */
export function loadCatalogue(): Promise<FontMeta[]> {
  catalogue ??= askBackground({ type: 'fonts:list' }).then((response) =>
    'ok' in response && response.ok && 'fonts' in response ? response.fonts : [],
  )
  return catalogue
}
