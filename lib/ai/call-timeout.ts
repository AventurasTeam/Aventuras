import type { ResolveTarget } from './agents'
import { profileTimeoutMs } from './generate'
import { resolveModel, type ResolveModelConfig } from './resolve-model'

/** classifier.md → Failure policy, M5 milestone → C2: the bound when the settings set no timeout. */
export const CALL_TIMEOUT_DEFAULT_MS = 600_000

/** An expired call's error detail, one shape for every agent and the narrative. */
export function providerTimeoutDetail(target: string, timeoutMs: number | undefined): string {
  return `${target}: timeout after ${timeoutMs}ms`
}

/** The agent's `timeout`, its override's or profile's, over a whole structured call with retries. */
export function callTimeoutMs(target: ResolveTarget, config: ResolveModelConfig): number {
  const resolved = resolveModel(target, config)
  return (
    profileTimeoutMs(resolved.ok ? resolved.params.timeout : undefined) ?? CALL_TIMEOUT_DEFAULT_MS
  )
}
