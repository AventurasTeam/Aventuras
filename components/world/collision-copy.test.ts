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
    expect(collisionRejectionText(COLLISION_REJECTION.storyInside)).toBe(
      'The story is in one of these places, and the merge would retire it or move it into a disabled place. Change the status or mode the merge keeps.',
    )
    expect(collisionRejectionText(COLLISION_REJECTION.placesInside)).toBe(
      "A place inside one of these isn't retired, so the merged place can't be retired. Retire those places first, or keep the merged place active.",
    )
    expect(collisionRejectionText(COLLISION_REJECTION.retiredParent)).toBe(
      "The merged place's parent is retired, so the merged place can't be active or staged. Bring the parent back first, or keep it retired.",
    )
    expect(collisionRejectionText(COLLISION_REJECTION.invalidRename)).toBe(
      "Both rows need a name, at least one name must change, and the names must stop matching: neither the same name, nor one name's words inside the other's.",
    )
  })

  it('gives an unexplained refusal the generic failure', () => {
    expect(collisionRejectionText(COLLISION_REJECTION.failed)).toBe(
      "Couldn't resolve the collision.",
    )
  })
})
