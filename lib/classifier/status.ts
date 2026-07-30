import type { ClassifierStatus } from '@/lib/db'

// classifier.md -> Auto-retry policy. Three attempts, then failed-persistent.
export const BACKOFF_MS = [30_000, 120_000, 300_000] as const

export function idleStatus(): ClassifierStatus {
  return {
    state: 'idle',
    lastSuccessAt: null,
    lastError: null,
    retryCount: 0,
    processedThrough: null,
  }
}

export function nextStatusOnStart(status: ClassifierStatus): ClassifierStatus {
  return { ...status, state: 'running' }
}

export function nextStatusOnSuccess(
  status: ClassifierStatus,
  pass: { coversThrough: number; at: number },
): ClassifierStatus {
  return {
    state: 'idle',
    lastSuccessAt: pass.at,
    lastError: null,
    retryCount: 0,
    // A pass never un-processes prose: a clamp is the only way back.
    processedThrough: Math.max(status.processedThrough ?? 0, pass.coversThrough),
  }
}

export function nextStatusOnFailure(
  status: ClassifierStatus,
  failure: { error: string; at: number },
): { status: ClassifierStatus; retryDelayMs: number | null } {
  const attempt = status.retryCount
  const retryDelayMs = BACKOFF_MS[attempt] ?? null
  return {
    status: {
      ...status,
      state: retryDelayMs == null ? 'failed-persistent' : 'retrying',
      lastError: failure.error,
      retryCount: Math.min(attempt + 1, BACKOFF_MS.length),
    },
    retryDelayMs,
  }
}

/**
 * Entry-counted cadence (canon ships no token trigger in v1). Suspended in
 * failed-persistent so a broken provider is not spammed on every tick — the
 * manual run is the only way out.
 */
export function shouldCadenceFire(args: {
  status: ClassifierStatus
  headPosition: number
  cadence: number
}): boolean {
  const { status, headPosition, cadence } = args
  if (status.state === 'failed-persistent' || status.state === 'running') return false
  const unprocessed = headPosition - (status.processedThrough ?? 0)
  return unprocessed >= Math.max(1, cadence)
}
