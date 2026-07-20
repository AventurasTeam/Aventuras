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
import { createHash } from 'react-native-quick-crypto'

import type { DialogDriver } from '@/components/compounds/embedder-download-dialog-machine'
import type { EmbedderAttestation } from '@/types/embedder-bridge'

import { buildDownloadPlan, findPlanRow } from './catalog-files'
import { fetchModelCard, resolveHfModel } from './model-card'
import type { CatalogModelEntry } from '../catalog'
import { modelDir } from '../local/paths.native'
import { smokeTestLocal } from '../local/runtime.native'

const HASH_CHUNK_BYTES = 1024 * 1024

// Reads the file in fixed-size chunks so a large model.onnx never has to sit
// fully in memory at once, per the task's streaming-hash requirement.
function hashFile(file: File): string {
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

function sha256HexSync(text: string): string {
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
      const destination = new File(dir, row.fileName)

      const resumable = createDownloadResumable(
        row.url,
        destination.uri,
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
    },

    // Native has no separate stream-time verification (unlike desktop, which
    // hashes inline in the main process while writing) — this does the real
    // work of reading the just-downloaded file back and hashing it. The
    // dialog's 'verifying' effect compares the result against its own
    // expectedSha256 map and dispatches verify-progress/verify-failed itself.
    async computeSha256(filePath) {
      const row = findPlanRow(plan, { url: filePath, targetPath: filePath })
      const dir = modelDir(entry.id)
      return hashFile(new File(dir, row.fileName))
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
        licenseSha256: sha256HexSync(licenseText),
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
