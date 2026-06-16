import { resolveModel, type ResolveModelConfig } from '@/lib/ai'

import type { Pipeline, PipelineError, PreflightSnapshot } from '../types'

type ConfigResolverError = Extract<PipelineError, { kind: 'config-resolver' }>

// Validates every declared resolver input against the snapshot, in phase order
// (and, within a parallel node, declared branch order). Returns the first
// failure or null. Pure — no DB, no network; story overrides are intentionally
// omitted from the config (they don't enter provider validation).
export function runPreflight(
  pipeline: Pipeline,
  snapshot: PreflightSnapshot,
): ConfigResolverError | null {
  const { providers, profiles, assignments, defaultProviderId } = snapshot.appSettings
  const config: ResolveModelConfig = { providers, profiles, assignments, defaultProviderId }

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
      }
    }
  }
  return null
}
