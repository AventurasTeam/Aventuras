import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// A model is "installed" purely as on-disk state: model.onnx + meta.json (read
// by listInstalled) plus the config/tokenizer files transformers.js loads
// (electron/embedder/service.ts). The harness provisions the default catalog
// model into a cache once, then copies it into each run's userData/embedders —
// no product change, and the real embed path runs. See docs/testing.md →
// Embedder in E2E.

const REPO_ROOT = join(__dirname, '..', '..')

type CatalogFile = { repoPath: string; sha256: string }
type CatalogModel = {
  id: string
  huggingfaceRevision: string
  dim: number
  files: Record<string, CatalogFile>
  tags: string[]
}

function defaultModel(): CatalogModel {
  const catalog = JSON.parse(
    readFileSync(join(REPO_ROOT, 'lib', 'embedder', 'catalog-data.json'), 'utf8'),
  ) as { models: CatalogModel[] }
  const model = catalog.models.find((m) => m.tags.includes('default'))
  if (!model) throw new Error('catalog has no default model')
  return model
}

// Mirrors sanitizeModelDirName (electron/embedder/paths.ts).
function sanitizeModelDirName(id: string): string {
  return id.toLowerCase().replaceAll('/', '--')
}

// Persistent, CI-cacheable cache outside any single run's userData.
function cacheRoot(): string {
  return join(homedir(), '.cache', 'aventuras-e2e', 'embedders')
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// The marker holds the catalog revision, written last (after every file is
// hash-verified). A cache is trustworthy only if the marker records the current
// revision AND every expected file is still present — otherwise a catalog bump
// or a partial/corrupted cache could be reused, passing the test against a stale
// model. Anything else is a miss.
const MARKER = '.e2e-complete'

function cacheIsValid(dir: string, model: CatalogModel): boolean {
  const marker = join(dir, MARKER)
  if (!existsSync(marker)) return false
  if (readFileSync(marker, 'utf8').trim() !== model.huggingfaceRevision) return false
  return Object.keys(model.files).every((name) => existsSync(join(dir, name)))
}

// Per-file cap so a stalled Hugging Face connection fails cleanly instead of
// hanging the run to its outer timeout.
const DOWNLOAD_TIMEOUT_MS = 60_000

/** Idempotently download + verify the default model into the cache. */
export async function ensureEmbedderModel(): Promise<{ modelId: string; dim: number }> {
  const model = defaultModel()
  const dir = join(cacheRoot(), sanitizeModelDirName(model.id))

  if (cacheIsValid(dir, model)) return { modelId: model.id, dim: model.dim }

  // Rebuild from scratch: a stale-revision or partial cache must not survive.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const base = `https://huggingface.co/${model.id}/resolve/${model.huggingfaceRevision}`
  for (const [onDiskName, file] of Object.entries(model.files)) {
    const dest = join(dir, onDiskName)
    const res = await fetch(`${base}/${file.repoPath}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`download ${file.repoPath}: HTTP ${res.status}`)
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    const actual = sha256(dest)
    if (actual !== file.sha256) {
      throw new Error(`sha256 mismatch for ${onDiskName}: expected ${file.sha256}, got ${actual}`)
    }
  }
  // listInstalled requires meta.json alongside model.onnx.
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: model.id, installedAt: 0 }))
  // Marker last, stamped with the revision the cache now holds.
  writeFileSync(join(dir, MARKER), model.huggingfaceRevision)
  return { modelId: model.id, dim: model.dim }
}

/** Copy the provisioned model into a run's userData so the app sees it installed. */
export async function installEmbedderModel(
  userDataDir: string,
): Promise<{ modelId: string; dim: number }> {
  const info = await ensureEmbedderModel()
  const dirName = sanitizeModelDirName(info.modelId)
  cpSync(join(cacheRoot(), dirName), join(userDataDir, 'embedders', dirName), { recursive: true })
  return info
}
