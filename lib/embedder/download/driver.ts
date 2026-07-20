// Desktop DialogDriver: bridges the shipped embedder-download-dialog to
// window.aventurasEmbedder (electron/embedder, exposed via preload). See
// docs/memory/model-management.md → Download flow for the on-disk contract.
import type { DialogDriver } from '@/components/compounds/embedder-download-dialog-machine'
import type { EmbedderAttestation, EmbedderBridge } from '@/types/embedder-bridge'

import { buildDownloadPlan, findPlanRow } from './catalog-files'
import { fetchModelCard, resolveHfModel } from './model-card'
import type { CatalogModelEntry } from '../catalog'

function resolveBridge(): EmbedderBridge {
  const bridge = globalThis.window?.aventurasEmbedder
  if (!bridge) {
    throw new Error('Embedder bridge unavailable — Electron preload not loaded.')
  }
  return bridge
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// createEmbedderDownloadDriver(entry) closes over the catalog entry it was
// opened for — hosts (settings tab, onboarding) create one driver instance
// per dialog open, matching the shipped dialog's memoized-init contract.
export function createEmbedderDownloadDriver(entry: CatalogModelEntry): DialogDriver {
  const plan = buildDownloadPlan(entry)

  // Files whose bridge-side download reported a sha256 mismatch. Desktop's
  // main-process downloader (electron/embedder/downloads.ts) hashes the
  // stream while writing it to disk and compares against expectedSha256
  // before the .part → final rename, so by the time downloadFile below
  // resolves, a file's bytes are already known-good or known-bad — there's
  // no separate re-read+rehash to do from the renderer. computeSha256 just
  // replays that verdict for the dialog's 'verifying' state.
  const mismatchedRepoPaths = new Set<string>()

  return {
    fetchModelCard,

    resolveHfModel,

    async downloadFile({ url, targetPath, onProgress }) {
      const row = findPlanRow(plan, { url, targetPath })
      const result = await resolveBridge().downloadFile({
        url: row.url,
        modelId: entry.id,
        fileName: row.fileName,
        expectedSha256: row.expectedSha256,
      })
      if (result.ok) {
        onProgress(1, 1)
        return
      }
      if (result.reason === 'hash-mismatch') {
        // Resolve rather than throw: throwing here would route the failure
        // through the 'downloading' state's generic download-failed action
        // (network/disk framing, per the machine's reducer). The pattern doc
        // wants sha256 mismatches to surface as their own 'hash-mismatch'
        // failure, which only the 'verifying' state's computeSha256 path
        // produces — so let this file "complete" and let computeSha256 below
        // report the mismatch when the dialog gets there.
        mismatchedRepoPaths.add(row.repoPath)
        onProgress(1, 1)
        return
      }
      // Network/disk failures are genuine download failures — no verification
      // step to defer to, so surface them immediately via the normal
      // download-failed path.
      throw new Error(result.message)
    },

    async computeSha256(filePath) {
      const row = findPlanRow(plan, { url: filePath, targetPath: filePath })
      if (mismatchedRepoPaths.has(row.repoPath)) {
        throw new Error(`sha256 mismatch for ${row.fileName} (detected during download)`)
      }
      // Already verified inline during the download above — echo the
      // known-good expected hash rather than re-reading the file over IPC.
      return row.expectedSha256
    },

    async smokeTestEmbed({ modelDir }) {
      // `ep` isn't threaded to the bridge: desktop's catalog default_ep is
      // always 'cpu' (transformers.js picks its own WASM/CPU backend) — there's
      // no EP choice to forward at this layer, unlike mobile's ORT-RN EPs.
      const result = await resolveBridge().smokeTest({ modelDir })
      if (!result.ok) throw new Error(result.error.message)
    },

    async persistInstall({ meta, licenseText }) {
      const licenseSha256 = await sha256Hex(licenseText)
      const attestation: EmbedderAttestation = {
        timestamp: Date.now(),
        licenseSha256,
        sourceUrl: meta.source,
        revision: meta.revision,
      }
      await resolveBridge().persistInstall({ modelId: entry.id, licenseText, attestation })
    },

    async deletePartial() {
      await resolveBridge().deletePartial({ modelId: entry.id })
    },
  }
}
