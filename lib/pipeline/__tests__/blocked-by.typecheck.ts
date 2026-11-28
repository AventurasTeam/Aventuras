// Not a runtime test (no .test.ts): `pnpm typecheck` validates it. A refusal code is a closed set,
// so a misspelled one fails to compile where a start is refused, a policy is set or a code compared.
import type { ConcurrencyPolicy, RejectedStart } from '@/lib/pipeline'

export const _refused: RejectedStart = { outcome: 'rejected', blockedBy: 'lead-missing' }
// @ts-expect-error a misspelled refusal code
export const _misspelled: RejectedStart = { outcome: 'rejected', blockedBy: 'lead-mising' }

export const _policy: ConcurrencyPolicy = { blockedBy: ['per-turn', 'chapter-close'] }
// @ts-expect-error a policy names a pipeline kind, never a gate's refusal
export const _gatePolicy: ConcurrencyPolicy = { blockedBy: ['classifier-held'] }

export function _isLeadMissing(start: RejectedStart): boolean {
  // @ts-expect-error a misspelled code shares no value with the set
  return start.blockedBy === 'lead-mising'
}
