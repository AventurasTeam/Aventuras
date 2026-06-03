import type { TxState } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'

// True while any in-flight run declares hard-gate. Read synchronously by the
// (future) user-mutation action-layer gate check + the UI edit-restriction
// selector. Dormant in M1 — no user-source content mutation exists yet.
export function isUserEditBlocked(txState: TxState): boolean {
  return [...txState.runs.values()].some((r) => getPipeline(r.kind).gateBehavior === 'hard-gate')
}
