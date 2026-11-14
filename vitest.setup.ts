// Import the concrete module, not the `@/lib/actions` barrel: the barrel
// re-exports turns/pipeline.ts, which statically imports `@/lib/ai`, and
// loading that here — before each test file's own vi.mock() hoists — caches
// the real, unmocked modules and silently defeats those mocks.
import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
  settleUserWrites,
} from '@/lib/actions/delta/apply-delta-action'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { registerAllDomains } from '@/lib/actions/delta/registrations'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import { userDeletedHappeningLink } from '@/lib/actions/delta/user-precedence'
import { configureDeltaActionPort } from '@/lib/pipeline/runtime/action-port'

// Node and jsdom lack this global; a no-op also keeps tests from building the encoder unasked.
globalThis.requestIdleCallback ??= () => 0

registerAllDomains()
configureDeltaActionPort({
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
  readRowGuard,
  userDeletedHappeningLink,
  reverseReplayDeltas,
  describeReplayError: describeDeltaReplayError,
  settleUserWrites,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
})
