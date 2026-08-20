import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const dist = new URL('./dist/', root)

await mkdir(dist, { recursive: true })
await cp(new URL('./manifest.json', root), new URL('./manifest.json', dist))

for (const dir of ['icons', 'fonts']) {
  const from = new URL(`./public/${dir}/`, root)
  if (existsSync(from)) {
    await cp(from, new URL(`./${dir}/`, dist), { recursive: true })
  }
}

console.log('static assets → dist/')
