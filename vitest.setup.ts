// Import the concrete module, not the `@/lib/actions` barrel: the barrel
// re-exports turns/pipeline.ts, which statically imports `@/lib/ai`, and
// loading that here — before each test file's own vi.mock() hoists — caches
// the real, unmocked modules and silently defeats those mocks.
import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { registerAllDomains } from '@/lib/actions/delta/registrations'
import { DeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { configureDeltaActionPort } from '@/lib/pipeline/runtime/action-port'

registerAllDomains()
configureDeltaActionPort({
  applyDeltaAction,
  reverseReplayDeltas,
  describeReplayError: (e) => (e instanceof DeltaReplayError ? String(e.cause) : undefined),
})
