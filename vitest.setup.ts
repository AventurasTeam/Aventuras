// Import the concrete module, not the `@/lib/actions` barrel: the barrel
// re-exports turns/pipeline.ts, which statically imports `@/lib/ai`, and
// loading that here — before each test file's own vi.mock() hoists — caches
// the real, unmocked modules and silently defeats those mocks.
import { applyDeltaAction, settleUserWrites } from '@/lib/actions/delta/apply-delta-action'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { registerAllDomains } from '@/lib/actions/delta/registrations'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { configureDeltaActionPort } from '@/lib/pipeline/runtime/action-port'

registerAllDomains()
configureDeltaActionPort({
  applyDeltaAction,
  reverseReplayDeltas,
  describeReplayError: describeDeltaReplayError,
  settleUserWrites,
  holdWritePhase: holdBranchWriteExclusive,
  releaseWritePhase: releaseBranchWriteExclusive,
})
