import { execFile } from 'node:child_process'
import { readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/**
 * Zips dist/ into dominator.zip, ready to drop on chrome://extensions or upload
 * to the Web Store.
 *
 * The archive holds the *contents* of dist/, not the folder itself: Chrome wants
 * manifest.json at the root of the zip, and a wrapping directory is the single
 * most common reason a packed extension is rejected.
 *
 * PowerShell's Compress-Archive does the work rather than a bundled zip library,
 * since this project already assumes a Windows shell and it saves a dependency.
 */
const run = promisify(execFile)

const root = new URL('../', import.meta.url)
const dist = fileURLToPath(new URL('./dist/', root))
const zip = fileURLToPath(new URL('./dominator.zip', root))

if (!existsSync(dist)) {
  console.error('dist/ is missing — run `npm run build` first')
  process.exit(1)
}

// Guards against shipping a half-built dist: without the manifest Chrome refuses
// the archive outright, and without content.js the extension loads and does
// nothing, which is much harder to notice.
for (const required of ['manifest.json', 'content.js', 'background.js']) {
  if (!existsSync(fileURLToPath(new URL(`./dist/${required}`, root)))) {
    console.error(`dist/${required} is missing — run \`npm run build\` first`)
    process.exit(1)
  }
}

// Compress-Archive appends to an existing archive rather than replacing it, so
// a stale file would keep files that no longer exist in dist/.
await rm(zip, { force: true })

await run('powershell', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -Path '${dist}*' -DestinationPath '${zip}' -CompressionLevel Optimal`,
])

const { version } = JSON.parse(await readFile(new URL('./manifest.json', root), 'utf8'))
const { size } = await stat(zip)
console.log(`dominator.zip → v${version}, ${(size / 1024).toFixed(0)} KB`)
