// Native DialogDriver: expo-file-system downloads + react-native-quick-crypto
// streaming sha256 + direct fs persist/delete. See
// docs/memory/model-management.md → Download flow for the on-disk contract.
//
// expo-file-system's new File/Directory API (used elsewhere in this module,
// e.g. local/paths.native.ts) has no resumable-download entry point with a
// progress callback — File.downloadFileAsync is fire-and-forget. The legacy
// API's createDownloadResumable is the only one that gives both, so this file
// imports it explicitly from 'expo-file-system/legacy' alongside the new
// Directory/File classes for everything else.
import { File } from 'expo-file-system'
import { createDownloadResumable } from 'expo-file-system/legacy'

import type { DialogDriver } from '@/components/compounds/embedder-download-dialog-machine'
import type { EmbedderAttestation } from '@/types/embedder-bridge'

import { buildDownloadPlan, findPlanRow } from './catalog-files'
import { fetchModelCard, resolveHfModel } from './model-card'
import type { CatalogModelEntry } from '../catalog'
import { modelDir } from '../local/paths.native'
import { smokeTestLocal } from '../local/runtime.native'

const HASH_CHUNK_BYTES = 1024 * 1024

// The slice of react-native-quick-crypto this driver touches. A structural
// surface (rather than `typeof import(...)`, which the type-import lint
// forbids, or a banned namespace import) keeps the module off the top-level
// import graph entirely — mirrors local/runtime.native.ts's OrtRuntime. The
// package doesn't export its `Hash` class type, so this is hand-written
// rather than imported.
type QuickCryptoHash = {
  update(data: Uint8Array | string, inputEncoding?: string): unknown
  digest(encoding: 'hex'): string
}
type QuickCrypto = { createHash: (algorithm: 'sha256') => QuickCryptoHash }

// react-native-quick-crypto's module-eval performs a native JSI install, so it
// must never be imported at the top level — the lib/embedder barrel is
// reachable from config-presence checks that run before a model is installed
// (and before the dev-client is rebuilt). Load it lazily, only inside the
// hashing call sites.
let quickCryptoPromise: Promise<QuickCrypto> | undefined
function loadQuickCrypto(): Promise<QuickCrypto> {
  quickCryptoPromise ??= import('react-native-quick-crypto') as unknown as Promise<QuickCrypto>
  return quickCryptoPromise
}

// Reads the file in fixed-size chunks so a large model.onnx never has to sit
// fully in memory at once, per the task's streaming-hash requirement.
async function hashFile(file: File): Promise<string> {
  const { createHash } = await loadQuickCrypto()
  const hash = createHash('sha256')
  const handle = file.open()
  try {
    let remaining = file.size
    while (remaining > 0) {
      const bytes = handle.readBytes(Math.min(HASH_CHUNK_BYTES, remaining))
      if (bytes.length === 0) break
      hash.update(bytes)
      remaining -= bytes.length
    }
  } finally {
    handle.close()
  }
  return hash.digest('hex') as string
}

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await loadQuickCrypto()
  // update()'s two-arg overload (data + inputEncoding) returns a Buffer, not
  // the Hash instance, so it can't chain into digest() — call them separately.
  const hash = createHash('sha256')
  hash.update(text, 'utf8')
  return hash.digest('hex') as string
}

// createEmbedderDownloadDriver(entry) closes over the catalog entry it was
// opened for — hosts (settings tab, onboarding) create one driver instance
// per dialog open, matching the shipped dialog's memoized-init contract.
export function createEmbedderDownloadDriver(entry: CatalogModelEntry): DialogDriver {
  const plan = buildDownloadPlan(entry)

  return {
    fetchModelCard,

    resolveHfModel,

    async downloadFile({ url, targetPath, onProgress }) {
      const row = findPlanRow(plan, { url, targetPath })
      const dir = modelDir(entry.id)
      if (!dir.exists) dir.create({ intermediates: true })

      // Stage to `<fileName>.part` and rename into place only once the
      // transfer completes, so an interrupted download never leaves a
      // partial file sitting at the canonical install path. Cross-launch
      // resume is descoped for v1 — any leftover `.part` from a prior
      // attempt is discarded and this one starts clean rather than
      // resuming from it.
      const partFile = new File(dir, `${row.fileName}.part`)
      if (partFile.exists) partFile.delete()

      const resumable = createDownloadResumable(
        row.url,
        partFile.uri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          onProgress(totalBytesWritten, totalBytesExpectedToWrite)
        },
      )

      const result = await resumable.downloadAsync()
      if (!result) {
        throw new Error(`Download of ${row.fileName} did not complete`)
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Unexpected status ${result.status} downloading ${row.fileName}`)
      }

      partFile.rename(row.fileName)
    },

    // Native has no separate stream-time verification (unlike desktop, which
    // hashes inline in the main process while writing) — this does the real
    // work of reading the just-downloaded file back and hashing it. The
    // dialog's 'verifying' effect compares the result against its own
    // expectedSha256 map and dispatches verify-progress/verify-failed itself.
    async computeSha256(filePath) {
      const row = findPlanRow(plan, { url: filePath, targetPath: filePath })
      const dir = modelDir(entry.id)
      // Mirrors desktop's `expectedSha256.toLowerCase()` tolerance (electron/
      // embedder/downloads.ts) — the container compares this against the
      // catalog's expected hash with a strict `!==`.
      return (await hashFile(new File(dir, row.fileName))).toLowerCase()
    },

    // `ep` isn't forwarded: this driver is created for the catalog install
    // path, and the model being smoke-tested is always the entry the driver
    // was opened for — `args.modelDir` (if supplied) names the same
    // directory `modelDir(entry.id)` already resolves.
    async smokeTestEmbed() {
      await smokeTestLocal(entry.id)
    },

    async persistInstall({ meta, licenseText }) {
      const dir = modelDir(entry.id)
      if (!dir.exists) dir.create({ intermediates: true })
      const attestation: EmbedderAttestation = {
        timestamp: Date.now(),
        licenseSha256: await sha256Hex(licenseText),
        sourceUrl: meta.source,
        revision: meta.revision,
      }
      new File(dir, 'LICENSE.txt').write(licenseText)
      new File(dir, '.attestation').write(JSON.stringify(attestation, null, 2))
      new File(dir, 'meta.json').write(
        JSON.stringify({ id: entry.id, installedAt: attestation.timestamp }, null, 2),
      )
    },

    async deletePartial() {
      const dir = modelDir(entry.id)
      if (dir.exists) dir.delete()
    },
  }
}
