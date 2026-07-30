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

/**
 * The wait before the next attempt, or null when the backoff is exhausted.
 * `retryCount` counts failures so far, so attempt N waits `BACKOFF_MS[N - 1]`.
 * Sole owner of that mapping: the scheduler re-derives the delay from persisted
 * status, and an independent second indexing is how the two drift by one.
 */
export function retryDelayForStatus(status: ClassifierStatus): number | null {
  if (status.state !== 'retrying') return null
  return BACKOFF_MS[status.retryCount - 1] ?? null
}

export function nextStatusOnFailure(
  status: ClassifierStatus,
  failure: { error: string; at: number },
): { status: ClassifierStatus; retryDelayMs: number | null } {
  const attempt = status.retryCount
  const exhausted = attempt >= BACKOFF_MS.length
  const next: ClassifierStatus = {
    ...status,
    state: exhausted ? 'failed-persistent' : 'retrying',
    lastError: failure.error,
    retryCount: Math.min(attempt + 1, BACKOFF_MS.length),
  }
  return { status: next, retryDelayMs: retryDelayForStatus(next) }
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
