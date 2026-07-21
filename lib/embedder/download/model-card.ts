// Platform-free HuggingFace model-card fetch shared by both drivers. Fetches
// live at the catalog entry's pinned revision — no cached-license
// substitution, per docs/memory/model-management.md → License attestation.
import type {
  CatalogEntry,
  LicenseKind,
  ModelMeta,
} from '@/components/compounds/embedder-download-dialog-machine'

const HF_ORIGIN = 'https://huggingface.co'
const FETCH_TIMEOUT_MS = 15_000

// HF-staff mirror of choosealicense.com; standard HF license tags map 1:1 to
// markdown/<tag>.md. Pinned like model revisions — attested license text must
// not drift under us. Proprietary tags (e.g. `gemma`) are absent → 404 →
// model-card fallback.
const LICENSE_DATASET_PATH = 'datasets/choosealicense/licenses'
const LICENSE_DATASET_REVISION = '20edaed2b9e7dccd366d0654d4536fb377850680'

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

type CardLicense = { id: string; displayName: string; link?: string }

async function fetchCardLicense(id: string, revision: string): Promise<CardLicense> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${HF_ORIGIN}/api/models/${id}/revision/${revision}`)
  } catch (error) {
    throw new Error(`Couldn't reach the model source: ${messageOf(error)}`)
  }
  if (!res.ok) {
    throw new Error(`Model-card metadata fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as {
    cardData?: { license?: string; license_name?: string; license_link?: string }
  }
  const card = json.cardData ?? {}
  const licenseId = card.license ?? ''
  return {
    // `license: other` is HF's escape hatch: the real name/link live in
    // license_name / license_link on the card itself.
    displayName: licenseId === 'other' && card.license_name ? card.license_name : licenseId,
    id: licenseId,
    link: card.license_link,
  }
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown.trim()
  const closingIndex = markdown.indexOf('\n---', 3)
  if (closingIndex === -1) return markdown.trim()
  const bodyStart = markdown.indexOf('\n', closingIndex + 4)
  return (bodyStart === -1 ? '' : markdown.slice(bodyStart + 1)).trim()
}

function parseFrontmatterTitle(markdown: string): string | null {
  if (!markdown.startsWith('---')) return null
  const closingIndex = markdown.indexOf('\n---', 3)
  if (closingIndex === -1) return null
  const match = markdown.slice(0, closingIndex).match(/^title:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

// Returns null when the tag has no standard text (proprietary tags 404 here —
// the model-card fallback path). Network failures and non-404 errors throw:
// silently swapping the model card in for a license that does have standard
// text would corrupt the attestation.
async function fetchStandardLicenseText(
  licenseId: string,
): Promise<{ title: string; text: string } | null> {
  if (!licenseId || licenseId === 'other') return null
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${HF_ORIGIN}/${LICENSE_DATASET_PATH}/raw/${LICENSE_DATASET_REVISION}/markdown/${licenseId}.md`,
    )
  } catch (error) {
    throw new Error(`Couldn't reach the license source: ${messageOf(error)}`)
  }
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`License text fetch failed: ${res.status} ${res.statusText}`)
  }
  const raw = await res.text()
  return { title: parseFrontmatterTitle(raw) ?? licenseId, text: stripFrontmatter(raw) }
}

async function fetchModelCardText(id: string, revision: string): Promise<string> {
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
): Promise<{
  meta: ModelMeta
  licenseText: string
  licenseName: string
  licenseKind: LicenseKind
  licenseLink?: string
}> {
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

  const [cardLicense, modelCardText] = await Promise.all([
    fetchCardLicense(entry.id, entry.revision),
    fetchModelCardText(entry.id, entry.revision),
  ])

  const standard = await fetchStandardLicenseText(cardLicense.id)
  if (standard) {
    return {
      meta,
      licenseKind: 'license',
      licenseName: standard.title,
      licenseText: standard.text,
    }
  }
  return {
    meta,
    licenseKind: 'model-card',
    licenseName: cardLicense.displayName,
    licenseText: modelCardText,
    ...(cardLicense.link ? { licenseLink: cardLicense.link } : {}),
  }
}

export function resolveHfModel(): Promise<{ meta: ModelMeta; files: string[] }> {
  return Promise.reject(new Error('HF-id path lands in M7.1'))
}
