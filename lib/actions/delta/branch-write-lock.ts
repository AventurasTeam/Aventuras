// Per-branch write lock (generation-pipeline.md → No-gate write phase): delta writes hold it
// shared; a no-gate run holds it exclusive from its first emitted write until it settles. FIFO and
// writer-preferring, so edits can't starve a pass. Shared isn't reentrant: no applyDeltaAction
// nests, and a no-gate phase writes only through delta_emitted (its status writes take no lock).
// A queued request that release drops never settles, and the orchestrator drops a write that
// arrives once its run is ending, so a branch of an aborted run writes on or re-takes the hold
// only in the parallel-group gap named in triage.md (a cancel aborted first, then a branch threw).

type Waiter =
  | { readonly mode: 'shared'; readonly grant: () => void }
  | { readonly mode: 'exclusive'; readonly actionId: string; readonly grant: () => void }

type BranchLock = {
  shared: number
  exclusive: string | null
  queue: Waiter[]
  /** Each action's exclusive acquisition while it waits or holds. */
  acquisitions: Map<string, Promise<void>>
}

const locks = new Map<string, BranchLock>()

function lockFor(branchId: string): BranchLock {
  let lock = locks.get(branchId)
  if (!lock) {
    lock = { shared: 0, exclusive: null, queue: [], acquisitions: new Map() }
    locks.set(branchId, lock)
  }
  return lock
}

function drain(branchId: string, lock: BranchLock): void {
  while (lock.exclusive === null && lock.queue.length > 0) {
    const head = lock.queue[0]
    if (head.mode === 'exclusive') {
      if (lock.shared > 0) break
      lock.exclusive = head.actionId
    } else {
      lock.shared++
    }
    lock.queue.shift()
    head.grant()
  }
  // Identity-checked: a holder that outlives a test reset must not delete the next entry.
  if (
    locks.get(branchId) === lock &&
    lock.shared === 0 &&
    lock.exclusive === null &&
    lock.queue.length === 0 &&
    lock.acquisitions.size === 0
  )
    locks.delete(branchId)
}

async function holdingShared<T>(
  branchId: string,
  lock: BranchLock,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } finally {
    lock.shared--
    drain(branchId, lock)
  }
}

/** Runs `run` holding `branchId`'s write lock shared; passes straight through when `actionId` holds it exclusive. */
export function withBranchWriteShared<T>(
  branchId: string,
  actionId: string,
  run: () => Promise<T>,
): Promise<T> {
  const lock = lockFor(branchId)
  if (lock.exclusive === actionId) return run()
  if (lock.exclusive === null && lock.queue.length === 0) {
    lock.shared++
    return holdingShared(branchId, lock, run)
  }
  // Granting counts the holder, so the run only has to release.
  return new Promise<void>((grant) => lock.queue.push({ mode: 'shared', grant })).then(() =>
    holdingShared(branchId, lock, run),
  )
}

/**
 * Takes `branchId`'s write lock exclusive for `actionId` once every shared holder has settled.
 * Idempotent per actionId (a repeat call returns the same acquisition); never rejects, and stays
 * pending forever if `releaseBranchWriteExclusive` drops the request before its grant.
 */
export function holdBranchWriteExclusive(branchId: string, actionId: string): Promise<void> {
  const lock = lockFor(branchId)
  const existing = lock.acquisitions.get(actionId)
  if (existing) return existing
  let acquisition: Promise<void>
  if (lock.exclusive === null && lock.shared === 0 && lock.queue.length === 0) {
    lock.exclusive = actionId
    acquisition = Promise.resolve()
  } else {
    acquisition = new Promise<void>((grant) =>
      lock.queue.push({ mode: 'exclusive', actionId, grant }),
    )
  }
  lock.acquisitions.set(actionId, acquisition)
  return acquisition
}

/** Ends `actionId`'s exclusive hold on `branchId`, or drops its queued request; otherwise does nothing. */
export function releaseBranchWriteExclusive(branchId: string, actionId: string): void {
  const lock = locks.get(branchId)
  if (!lock?.acquisitions.delete(actionId)) return
  if (lock.exclusive === actionId) {
    lock.exclusive = null
  } else {
    const at = lock.queue.findIndex((w) => w.mode === 'exclusive' && w.actionId === actionId)
    // Never granted: a parallel branch awaiting it would otherwise write after its run's abort.
    if (at !== -1) lock.queue.splice(at, 1)
  }
  drain(branchId, lock)
}

// Test-only.
export function __resetBranchWriteLocks(): void {
  locks.clear()
}
