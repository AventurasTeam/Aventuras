// This app is local-first, single-process (no BaaS/backend serving concurrent
// writers — data-model.md), so an in-process per-branch queue is a complete
// fix, not a partial mitigation: it's the only place two turn dispatches for
// the same branch could ever interleave a MAX(position) read with an insert —
// the user_action's own read in submitTurn, or narrativePhase's read for the
// ai_reply (per-turn.ts), which runs inside the same queued turn.
const branchQueues = new Map<string, Promise<unknown>>()

// Test seam — a queue entry left pending by one test chains onto every later
// dispatch for that branch, so a single hang cascades into unrelated timeouts.
export function __resetBranchQueues(): void {
  branchQueues.clear()
}

export function withBranchQueue<T>(branchId: string, fn: () => Promise<T>): Promise<T> {
  const prior = branchQueues.get(branchId) ?? Promise.resolve()
  const result = prior.then(fn, fn)
  branchQueues.set(
    branchId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}
