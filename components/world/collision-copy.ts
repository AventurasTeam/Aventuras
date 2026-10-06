import { COLLISION_REJECTION, type CollisionRejectionCode } from '@/lib/actions'
import { t } from '@/lib/i18n'

// Exhaustive: a new CollisionRejectionCode fails typecheck until it has text here.
const COLLISION_REJECTION_TEXT: Record<CollisionRejectionCode, () => string> = {
  [COLLISION_REJECTION.inFlight]: () => t('world:collision.rejection.inFlight'),
  [COLLISION_REJECTION.notFound]: () => t('world:collision.rejection.notFound'),
  [COLLISION_REJECTION.leadEntity]: () => t('world:collision.rejection.leadEntity'),
  [COLLISION_REJECTION.parentCycle]: () => t('world:collision.rejection.parentCycle'),
  [COLLISION_REJECTION.parentChainBroken]: () => t('world:collision.rejection.parentChainBroken'),
  [COLLISION_REJECTION.invalidRename]: () => t('world:collision.rejection.invalidRename'),
  [COLLISION_REJECTION.failed]: () => t('world:collision.failed'),
}

/** A refused resolve's user-facing text; the action's own reasons are developer strings. */
export function collisionRejectionText(code: CollisionRejectionCode): string {
  return COLLISION_REJECTION_TEXT[code]()
}
