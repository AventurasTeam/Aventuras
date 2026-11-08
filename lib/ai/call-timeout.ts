import type { ResolveTarget } from './agents'
import { profileTimeoutMs } from './generate'
import { resolveModel, type ResolveModelConfig } from './resolve-model'

/** classifier.md → Failure policy, M5 milestone → C2: the bound when a profile sets no timeout. */
export const CALL_TIMEOUT_DEFAULT_MS = 600_000

/** An expired call's error detail, one shape for every agent and the narrative. */
export function providerTimeoutDetail(target: string, timeoutMs: number | undefined): string {
  return `${target}: timeout after ${timeoutMs}ms`
}

/** The agent's profile `timeout` over a whole structured call, retries included. */
export function callTimeoutMs(target: ResolveTarget, config: ResolveModelConfig): number {
  const resolved = resolveModel(target, config)
  // A story override resolves to no profile params.
  return (
    profileTimeoutMs(resolved.ok ? resolved.params.timeout : undefined) ?? CALL_TIMEOUT_DEFAULT_MS
  )
}
