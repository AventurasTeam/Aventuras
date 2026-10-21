import type { ClassifierStatus } from '@/lib/db'

// classifier.md -> Auto-retry policy: one attempt, three retries, each at a later turn's commit.
export const CLASSIFIER_MAX_RETRIES = 3

export function idleStatus(): ClassifierStatus {
  return {
    state: 'idle',
    lastSuccessAt: null,
    lastError: null,
    retryCount: 0,
    processedThrough: null,
  }
}

/**
 * Seed document for the key-scoped `json_set` writers. They patch individual
 * keys, so a `COALESCE(classifier_status, '{}')` on a never-written branch
 * persists an object missing whichever keys that writer does not own — the
 * column then type-lies about ClassifierStatus. Seeding a complete idle status
 * keeps every write total without making any writer touch a key it doesn't own.
 */
export const IDLE_STATUS_JSON = JSON.stringify(idleStatus())

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
): ClassifierStatus {
  return {
    ...status,
    state: status.retryCount >= CLASSIFIER_MAX_RETRIES ? 'failed-persistent' : 'retrying',
    lastError: failure.error,
    retryCount: Math.min(status.retryCount + 1, CLASSIFIER_MAX_RETRIES),
  }
}

/**
 * The most entries a cadence-fired run can trail by. The trigger is checked only after a
 * completed turn, which writes two entries, and a prose reversal can leave the unprocessed count
 * at either parity — so the count can step past the cadence by one, even or odd.
 */
export function worstCaseCadenceEntries(cadence: number): number {
  return Math.max(1, cadence) + 1
}

/**
 * Entry-counted cadence (canon ships no token trigger in v1). Suspended in failed-persistent so a
 * broken provider is not called on every turn: Run now is the only way out. A `running` status
 * seen at a turn's commit is a pass left unfinished: by a crash, or in session by an interrupt
 * whose reversal couldn't commit or a status write that failed its retry. It holds the cadence
 * until boot resets it, which boot skips while the branch still holds unreversed orphans.
 */
export function shouldCadenceFire(args: {
  status: ClassifierStatus
  unprocessedEntries: number
  cadence: number
}): boolean {
  const { status, unprocessedEntries, cadence } = args
  if (status.state === 'failed-persistent' || status.state === 'running') return false
  return unprocessedEntries >= Math.max(1, cadence)
}
