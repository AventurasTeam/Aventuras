import type { CloseLedger, CloseRange } from './intermediates'
import type { PhaseContext, PhaseFailure } from '../types'

// The close's own keys, read and written only through the accessors below.
const RANGE_KEY = 'closeRange'
const LEDGER_KEY = 'closeLedger'

export function setCloseRange(intermediates: Record<string, unknown>, range: CloseRange): void {
  intermediates[RANGE_KEY] = range
}

export function closeRangeOf(
  intermediates: Readonly<Record<string, unknown>>,
): CloseRange | undefined {
  return intermediates[RANGE_KEY] as CloseRange | undefined
}

/** The range, or the failure a close phase returns without one. */
export function requireCloseRange(
  ctx: Pick<PhaseContext, 'intermediates'>,
): CloseRange | PhaseFailure {
  return (
    closeRangeOf(ctx.intermediates) ?? {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    }
  )
}

/** The agent's ledger, which `report` writes as `close_report`; absent until the agent seeds it. */
export function closeLedgerOf(
  intermediates: Readonly<Record<string, unknown>>,
): CloseLedger | undefined {
  return intermediates[LEDGER_KEY] as CloseLedger | undefined
}

/** The live ledger, seeded `{ calls: [], stopped: [], noToolCalls: true }` on first call. */
export function seedCloseLedger(intermediates: Record<string, unknown>): CloseLedger {
  const seeded = closeLedgerOf(intermediates)
  if (seeded) return seeded
  const ledger: CloseLedger = { calls: [], stopped: [], noToolCalls: true }
  intermediates[LEDGER_KEY] = ledger
  return ledger
}
