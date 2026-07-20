import type { StorySettings } from '@/lib/db'

import { resolveEmbedderConfig } from './resolve-config'
import type { EmbedderConfig } from './types'

export type EmbedderGateResult =
  | { usable: true; config: EmbedderConfig }
  | { usable: false; reason: 'no-model' | 'unknown-model' | 'model-not-installed' | 'no-provider' }

// Config-presence only, no init/smoke-test: the gate answers "is a backend
// selected and (for local) installed", not "does it actually work". Real
// init failures surface lazily at Finish — see docs/memory/model-management.md
// -> Embedder failures.
export function resolveEmbedderGate(
  app: {
    embeddingModelId: string | null
    embeddingProviderId: string | null
    defaultStorySettings: Partial<StorySettings>
    providers: readonly { id: string }[]
  },
  installedLocalIds: readonly string[],
): EmbedderGateResult {
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
      return { usable: false, reason: 'unknown-model' }
    }
    return { usable: false, reason: resolution.reason }
  }

  const config = resolution.config
  if (config.backend === 'local') {
    if (!installedLocalIds.includes(config.modelId)) {
      return { usable: false, reason: 'model-not-installed' }
    }
    return { usable: true, config }
  }

  if (!app.providers.some((provider) => provider.id === config.providerId)) {
    return { usable: false, reason: 'no-provider' }
  }
  return { usable: true, config }
}
