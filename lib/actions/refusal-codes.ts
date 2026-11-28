import type { BlockedBy } from '@/lib/pipeline'

/** Why an action that runs on the open story refused a branch it isn't showing. */
export const BRANCH_NOT_OPEN = 'branch-not-open' satisfies BlockedBy

/** Why a turn refused: the story needs a lead and this branch has none. */
export const LEAD_MISSING = 'lead-missing' satisfies BlockedBy
