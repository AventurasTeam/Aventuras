import type { StorySettings } from '@/lib/db'

import { providerHasEmbeddingEndpoint, providerTypeSupportsEmbedding } from './provider-support'
import { resolveEmbedderConfig } from './resolve-config'
import type { EmbedderConfig } from './types'

// Consumer notes for UI copy (wizard entry, settings surfaces):
// - 'no-model' is backend-dependent: local means no model selected, provider
//   means no model name entered. The blocked arm carries `backend` so callers
//   can route to the surface that can actually fix it.
// - 'no-provider' covers both never-selected and selected-but-instance-deleted
//   (the providerId points at an entry no longer in app.providers).
// - 'unknown-model' is local-only. Provider model ids are never
//   catalog-validated (a provider config carries a null dim until the first
//   embed probes it), so a bad provider model id still resolves usable here and
//   only fails later at embed time.
// - 'provider-missing-endpoint' is the one blocked reason whose fix lives on the
//   providers tab rather than the memory tab — the provider is selected and can
//   embed, it just has no base URL to embed against.
export type EmbedderGateResult =
  | { usable: true; config: EmbedderConfig }
  | {
      usable: false
      backend: 'local' | 'provider'
      reason:
        | 'no-model'
        | 'unknown-model'
        | 'model-not-installed'
        | 'no-provider'
        | 'provider-cannot-embed'
        | 'provider-missing-endpoint'
    }

// Config-presence only, no init/smoke-test: the gate answers "is a backend
// selected and (for local) installed", not "does it actually work". Real
// init failures surface lazily at Finish — see docs/memory/model-management.md
// -> Embedder failures.
export function resolveEmbedderGate(
  app: {
    embeddingModelId: string | null
    embeddingProviderId: string | null
    defaultStorySettings: Partial<StorySettings>
    providers: readonly { id: string; type: string; endpoint?: string }[]
  },
  installedLocalIds: readonly string[],
): EmbedderGateResult {
  const backend = app.defaultStorySettings.embeddingBackend ?? 'local'
  const resolution = resolveEmbedderConfig(null, {
    embeddingModelId: app.embeddingModelId,
    embeddingProviderId: app.embeddingProviderId,
    defaultStorySettings: { embeddingBackend: app.defaultStorySettings.embeddingBackend },
  })

  if (!resolution.ok) {
    // v1 is catalog-only: an id the catalog doesn't recognize can't produce a
    // usable config regardless of installed-ness, so it gets its own reason
    // rather than being folded into "no-model" (which would mislead UI copy).
    if (resolution.reason === 'unknown-local-model') {
      return { usable: false, backend, reason: 'unknown-model' }
    }
    return { usable: false, backend, reason: resolution.reason }
  }

  const config = resolution.config
  if (config.backend === 'local') {
    if (!installedLocalIds.includes(config.modelId)) {
      return { usable: false, backend, reason: 'model-not-installed' }
    }
    return { usable: true, config }
  }

  const provider = app.providers.find((entry) => entry.id === config.providerId)
  if (!provider) {
    return { usable: false, backend, reason: 'no-provider' }
  }
  // A provider that can't embed passes every other check and then fails at
  // commit time, so the gate has to reject it here rather than promise usable.
  if (!providerTypeSupportsEmbedding(provider.type)) {
    return { usable: false, backend, reason: 'provider-cannot-embed' }
  }
  if (!providerHasEmbeddingEndpoint(provider)) {
    return { usable: false, backend, reason: 'provider-missing-endpoint' }
  }
  return { usable: true, config }
}
