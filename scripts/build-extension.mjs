import { build } from 'vite'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMP_DIR = resolve(ROOT, '.tmp/vite-extension')
const OUT_DIR = resolve(ROOT, 'build/extension')

async function ensureCopy(source, destination, options = {}) {
  await cp(source, destination, { recursive: true, force: true, errorOnExist: false, ...options })
}

async function main() {
  await build({
    configFile: resolve(ROOT, 'vite.config.ts'),
    root: ROOT,
    build: {
      outDir: TEMP_DIR,
      emptyOutDir: true,
      copyPublicDir: false,
    },
    logLevel: 'info',
  })

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  const manifestPath = resolve(ROOT, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
  if (manifest.background?.service_worker) {
    manifest.background.service_worker = 'assets/background.js'
  }
  await writeFile(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  await Promise.all([
    ensureCopy(resolve(ROOT, 'icon'), resolve(OUT_DIR, 'icon')).catch(() => {}),
    ensureCopy(resolve(ROOT, 'src'), resolve(OUT_DIR, 'src')),
  ])

  await ensureCopy(resolve(TEMP_DIR, 'assets'), resolve(OUT_DIR, 'assets'))

  const popupHtml = resolve(TEMP_DIR, 'src/popup/popup.html')
  const fullHtml = resolve(TEMP_DIR, 'src/popup/full.html')

  await mkdir(resolve(OUT_DIR, 'src/popup'), { recursive: true })
  await ensureCopy(popupHtml, resolve(OUT_DIR, 'src/popup/popup.html'))
  if (await exists(fullHtml)) {
    await ensureCopy(fullHtml, resolve(OUT_DIR, 'src/popup/full.html'))
  }

  await rm(TEMP_DIR, { recursive: true, force: true })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error('[build-extension]', error)
  process.exitCode = 1
})
