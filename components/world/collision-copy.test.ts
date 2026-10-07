import { describe, expect, it } from 'vitest'

import { COLLISION_REJECTION } from '@/lib/actions'

import { collisionRejectionText } from './collision-copy'

describe('collisionRejectionText', () => {
  it('names each refusal the user can act on', () => {
    expect(collisionRejectionText(COLLISION_REJECTION.inFlight)).toBe(
      "Couldn't resolve while generation is in flight.",
    )
    expect(collisionRejectionText(COLLISION_REJECTION.notFound)).toBe(
      'These rows changed or no longer collide. Close this and check the list again.',
    )
    expect(collisionRejectionText(COLLISION_REJECTION.leadEntity)).toBe(
      "The story's lead can't be the row a merge removes. Pick it as the row that survives, or use Set as lead on another character first.",
    )
    expect(collisionRejectionText(COLLISION_REJECTION.parentCycle)).toBe(
      'Merging these would make a location part of itself. Pick the other row to survive.',
    )
    expect(collisionRejectionText(COLLISION_REJECTION.parentChainBroken)).toBe(
      'A parent chain this merge touches loops back or runs too deep. Fix that chain first.',
    )
    expect(collisionRejectionText(COLLISION_REJECTION.invalidRename)).toBe(
      'Both rows need a name, and the names must differ by more than letter case or spaces at either end.',
    )
  })

  it('gives an unexplained refusal the generic failure', () => {
    expect(collisionRejectionText(COLLISION_REJECTION.failed)).toBe(
      "Couldn't resolve the collision.",
    )
  })
})
