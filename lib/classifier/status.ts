import type { ClassifierStatus } from '@/lib/db'

export function idleStatus(): ClassifierStatus {
  return {
    state: 'idle',
    lastSuccessAt: null,
    lastError: null,
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
    // A pass never un-processes prose: a clamp is the only way back.
    processedThrough: Math.max(status.processedThrough ?? 0, pass.coversThrough),
  }
}

export function nextStatusOnFailure(
  status: ClassifierStatus,
  failure: { error: string; at: number },
): ClassifierStatus {
  return { ...status, state: 'failed', lastError: failure.error }
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
 * Entry-counted (no token trigger in v1). Off only in `running`, a pass left unfinished (crash, or
 * an interrupt's failed reversal or status write), until a boot reset, which unreversed orphans
 * block. A `failed` status fires: nothing suspends the pass (classifier.md → Failure policy).
 */
export function shouldCadenceFire(args: {
  status: ClassifierStatus
  unprocessedEntries: number
  cadence: number
}): boolean {
  const { status, unprocessedEntries, cadence } = args
  if (status.state === 'running') return false
  return unprocessedEntries >= Math.max(1, cadence)
}
