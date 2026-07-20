// Platform-free HuggingFace model-card fetch shared by both drivers. Fetches
// live at the catalog entry's pinned revision — no cached-license
// substitution, per docs/memory/model-management.md → License attestation.
import type {
  CatalogEntry,
  ModelMeta,
} from '@/components/compounds/embedder-download-dialog-machine'

const HF_ORIGIN = 'https://huggingface.co'
const FETCH_TIMEOUT_MS = 15_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// AbortSignal.timeout is a static Hermes has historically lacked; build the
// same behavior from AbortController + setTimeout so this (shared,
// first-call-in-flow) module doesn't depend on it.
function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function fetchLicenseName(id: string, revision: string): Promise<string> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${HF_ORIGIN}/api/models/${id}/revision/${revision}`)
  } catch (error) {
    throw new Error(`Couldn't reach the model source: ${messageOf(error)}`)
  }
  if (!res.ok) {
    throw new Error(`Model-card metadata fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { cardData?: { license?: string } }
  return json.cardData?.license ?? ''
}

// The dialog renders the README body verbatim as the "license text" (per
// docs/ui/patterns/embedder-download.md — "License text is not paraphrased").
// Strip the leading YAML frontmatter block HF model cards use for metadata;
// keep everything after it.
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown.trim()
  const closingIndex = markdown.indexOf('\n---', 3)
  if (closingIndex === -1) return markdown.trim()
  const bodyStart = markdown.indexOf('\n', closingIndex + 4)
  return (bodyStart === -1 ? '' : markdown.slice(bodyStart + 1)).trim()
}

async function fetchLicenseText(id: string, revision: string): Promise<string> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${HF_ORIGIN}/${id}/raw/${revision}/README.md`)
  } catch (error) {
    throw new Error(`Couldn't reach the model source: ${messageOf(error)}`)
  }
  if (!res.ok) {
    throw new Error(`Model card README fetch failed: ${res.status} ${res.statusText}`)
  }
  return stripFrontmatter(await res.text())
}

export async function fetchModelCard(
  source: { kind: 'catalog'; entry: CatalogEntry } | { kind: 'hf-id'; id: string },
): Promise<{ meta: ModelMeta; licenseText: string; licenseName: string }> {
  if (source.kind === 'hf-id') {
    // The dialog only receives catalog inits this slice — the power-user HF-id
    // path (live file-listing resolution + validation) lands in M7.1.
    throw new Error('HF-id path lands in M7.1')
  }

  const { entry } = source
  const meta: ModelMeta = {
    displayName: entry.displayName,
    source: entry.source,
    revision: entry.revision,
    sizeBytes: entry.sizeBytes,
    fileCount: entry.files.length,
  }

  const [licenseName, licenseText] = await Promise.all([
    fetchLicenseName(entry.id, entry.revision),
    fetchLicenseText(entry.id, entry.revision),
  ])

  return { meta, licenseText, licenseName }
}

export function resolveHfModel(): Promise<{ meta: ModelMeta; files: string[] }> {
  return Promise.reject(new Error('HF-id path lands in M7.1'))
}
