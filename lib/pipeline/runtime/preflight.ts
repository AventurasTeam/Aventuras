import { modelConfigOf, resolveModel, resolveModelCapabilities } from '@/lib/ai'
import type { StorySettings } from '@/lib/db'
import { appSettingsStore } from '@/lib/stores'

import type { ConfigResolverError, Pipeline, PreflightSnapshot } from '../types'

// One snapshot for a run's pre-flight and a click's, so the two agree.
export function preflightSnapshot(storySettings: StorySettings | undefined): PreflightSnapshot {
  return { appSettings: appSettingsStore.getAppSettings(), storySettings }
}

// Validates every resolver input against the snapshot, in phase order (declared order within a
// parallel node). A `requires` input also fails when its model is flagged off for it; unknown
// passes. Returns the first failure or null.
export function runPreflight(
  pipeline: Pipeline,
  snapshot: PreflightSnapshot,
): ConfigResolverError | null {
  // Without the story's overrides, pre-flight would take the assignments path while the phase
  // takes the override path, clearing runs that fail in-phase and rejecting ones that resolve.
  const config = modelConfigOf(snapshot.appSettings, snapshot.storySettings)

  for (const node of pipeline.phases) {
    const branches = 'parallel' in node ? node.parallel : [node]
    for (const branch of branches) {
      for (const input of branch.resolves ?? []) {
        if (input.when && !input.when(snapshot)) continue
        const result = resolveModel(input.target, config)
        if (!result.ok) {
          return {
            kind: 'config-resolver',
            failure: result.kind,
            target: input.target,
            phaseName: branch.name,
          }
        }
        if (input.requires === undefined) continue
        const capabilities = resolveModelCapabilities(
          result.providerId,
          result.modelId,
          config.providers,
        )
        if (capabilities?.[input.requires] === false) {
          return {
            kind: 'config-resolver',
            failure: 'tool-calling-off',
            target: input.target,
            phaseName: branch.name,
            modelId: result.modelId,
          }
        }
      }
    }
  }
  return null
}
