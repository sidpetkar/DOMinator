import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Static server for the local harness (test/fixture.html), which loads the
 * built content script directly so interactions can be exercised without
 * reloading the unpacked extension.
 */
const root = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.env.PORT ?? 5177)

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  // Chrome refuses to use an image served as octet-stream for mask-image.
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
}

/**
 * Stand-in for the background worker's font proxy. The harness runs in page
 * context, where fonts.google.com is off-limits by CORS; in the real extension
 * these same two calls are made by the service worker under host permissions.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const WOFF2 = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('woff2'\)/

async function googleFonts(url) {
  if (url.pathname === '/gf/list') {
    const text = await fetch('https://fonts.google.com/metadata/fonts').then((r) => r.text())
    const data = JSON.parse(text.replace(/^\)]}'\s*/, ''))
    return {
      ok: true,
      fonts: (data.familyMetadataList ?? []).map((raw) => ({
        family: raw.family,
        weights: [...new Set(Object.keys(raw.fonts ?? {}).map((k) => Number.parseInt(k, 10)))]
          .filter(Number.isFinite)
          .sort((a, b) => a - b),
        category: raw.category ?? 'sans-serif',
      })),
    }
  }
  const family = url.searchParams.get('family')
  const weight = url.searchParams.get('weight') ?? '400'
  const css2 = new URL('https://fonts.googleapis.com/css2')
  css2.searchParams.set('family', `${family}:wght@${weight}`)
  css2.searchParams.set('display', 'swap')
  if (url.searchParams.get('preview')) css2.searchParams.set('text', family)
  const css = await fetch(css2, { headers: { 'User-Agent': UA } }).then((r) => r.text())
  const match = WOFF2.exec(css)
  if (!match) return { ok: false, error: 'no woff2' }
  const buffer = await fetch(match[1]).then((r) => r.arrayBuffer())
  return { ok: true, data: Buffer.from(buffer).toString('base64') }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/gf/')) {
    const body = await googleFonts(url).catch((error) => ({ ok: false, error: String(error) }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')).replace(
    /^[\\/]+/,
    '',
  )
  try {
    const body = await readFile(join(root, path || 'test/fixture.html'))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, () => console.log(`harness → http://localhost:${port}/test/fixture.html`))
