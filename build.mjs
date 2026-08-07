import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = dirname(fileURLToPath(import.meta.url))

export async function buildSdk({ root = ROOT, outdir = join(root, 'dist') } = {}) {
  const source = await readFile(join(root, 'src/index.js'))
  const sourceSha256 = createHash('sha256').update(source).digest('hex')
  const banner = { js: `/* w2a-src-sha256:${sourceSha256} */` }

  await mkdir(outdir, { recursive: true })
  const variants = [
    { format: 'esm', outfile: 'w2a-sdk.esm.js' },
    { format: 'iife', globalName: 'W2ANS', outfile: 'w2a-sdk.iife.js' },
    { format: 'iife', globalName: 'W2ANS', minify: true, outfile: 'w2a-sdk.min.js' },
  ]

  for (const variant of variants) {
    await build({
      absWorkingDir: root,
      entryPoints: ['src/index.js'],
      bundle: true,
      banner,
      format: variant.format,
      globalName: variant.globalName,
      minify: variant.minify,
      outfile: join(outdir, variant.outfile),
      logLevel: 'silent',
    })
  }

  return { sourceSha256, outdir }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedUrl) await buildSdk()
