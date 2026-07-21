// Bridges the real catalog shape (lib/embedder/catalog.ts's CatalogModelEntry —
// files keyed by canonical name → HF repo-relative path) to the download
// machinery: an ordered per-file download plan, and the dialog machine's own
// CatalogEntry shape (components/compounds/embedder-download-dialog-machine.ts)
// for hosts building a DialogInit.
import type {
  CatalogEntry as DialogCatalogEntry,
  ModelMeta,
} from '@/components/compounds/embedder-download-dialog-machine'

import type { CatalogModelEntry } from '../catalog'

const HF_ORIGIN = 'https://huggingface.co'

export type DownloadPlanRow = {
  /** Full resolve URL at the catalog's pinned revision. */
  url: string
  /** Canonical on-disk file name (the catalog's files-map key), e.g. "model.onnx". */
  fileName: string
  /** HF repo-relative path (the catalog's files-map value), e.g. "onnx/model_quantized.onnx". */
  repoPath: string
  expectedSha256: string
}

// Order follows the catalog's `files` map insertion order (JS preserves
// string-key order), which the dialog's downloading effect iterates too.
export function buildDownloadPlan(entry: CatalogModelEntry): DownloadPlanRow[] {
  return Object.entries(entry.files).map(([fileName, { repoPath, sha256 }]) => ({
    url: `${HF_ORIGIN}/${entry.id}/resolve/${entry.huggingfaceRevision}/${repoPath}`,
    fileName,
    repoPath,
    expectedSha256: sha256,
  }))
}

// The dialog machine's CatalogEntry.source is rendered as-is in the license
// screen AND concatenated by the shipped container into a download URL
// (`${entry.source}/resolve/${entry.revision}/${file}` — see
// embedder-download-dialog.tsx's downloading effect). It must therefore be a
// full origin+id URL, not just a display label, for that self-built URL to
// land on the same address buildDownloadPlan computes.
export function toDialogCatalogEntry(entry: CatalogModelEntry): DialogCatalogEntry {
  const plan = buildDownloadPlan(entry)
  return {
    id: entry.id,
    displayName: entry.displayName,
    source: `${HF_ORIGIN}/${entry.id}`,
    revision: entry.huggingfaceRevision,
    sizeBytes: entry.size_bytes,
    files: plan.map((row) => row.repoPath),
    expectedSha256: Object.fromEntries(plan.map((row) => [row.repoPath, row.expectedSha256])),
  }
}

export function modelMetaFromCatalogEntry(entry: DialogCatalogEntry): ModelMeta {
  return {
    displayName: entry.displayName,
    source: entry.source,
    revision: entry.revision,
    sizeBytes: entry.sizeBytes,
    fileCount: entry.files.length,
  }
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

// The container builds `url` itself from the machine CatalogEntry's `source` +
// `revision` + file segment, so matching on `url` alone is only reliable once
// every caller populates `source` the way toDialogCatalogEntry does above.
// `targetPath` is the raw file identifier from CatalogEntry.files (a repoPath
// in this module's convention) and is always trustworthy, so it's the primary
// fallback; basename matching is a last resort for callers that pass a
// differently-shaped path.
export function findPlanRow(
  plan: readonly DownloadPlanRow[],
  args: { url: string; targetPath: string },
): DownloadPlanRow {
  const byUrl = plan.find((row) => row.url === args.url)
  if (byUrl) return byUrl

  const byRepoPath = plan.find((row) => row.repoPath === args.targetPath)
  if (byRepoPath) return byRepoPath

  const targetBasename = basename(args.targetPath)
  const byBasename = plan.find(
    (row) => row.fileName === targetBasename || basename(row.repoPath) === targetBasename,
  )
  if (byBasename) return byBasename

  throw new Error(`No download-plan entry for "${args.targetPath}" (url: ${args.url})`)
}
