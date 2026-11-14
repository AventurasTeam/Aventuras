import type { DeltaActionPort } from '@/lib/pipeline'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
  settleUserWrites,
} from './apply-delta-action'
import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from './branch-write-lock'
import { describeDeltaReplayError, reverseReplayDeltas } from './reverse-replay'
import { readRowGuard } from './row-guard'
import { userDeletedHappeningLink } from './user-precedence'

/**
 * The action layer as lib/pipeline reaches it: boot, the unit setup and the pipeline harness wire
 * this one port (lib/pipeline can't import the action layer: a require cycle through submit-turn).
 */
export function deltaActionPort(): DeltaActionPort {
  return {
    applyDeltaAction,
    applyDeltaActionGroupWithOutcomes,
    readRowGuard,
    userDeletedHappeningLink,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdBranchWriteExclusive,
    releaseBranchWriteExclusive,
  }
}
