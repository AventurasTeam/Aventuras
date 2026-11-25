import { describe, expect, it } from 'vitest'

import { deleteUndoHint } from '@/components/compounds/delete-confirm-copy'
import { ROW_DELETE_REJECTION } from '@/lib/actions'
import { emptyEntityState, type Entity, type Lore } from '@/lib/db'

import { deleteRejectionText, entityDeleteCopy, loreDeleteCopy } from './delete-copy'
import type { EntityDeleteImpact } from './delete-impact'

const kael = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  isLead: 0,
  state: emptyEntityState('character'),
} as Entity
const kaelLead: Entity = { ...kael, isLead: 1 }

const NO_IMPACT: EntityDeleteImpact = {
  awareness: 0,
  involvements: 0,
  relationships: 0,
  references: 0,
  unplacedItems: 0,
  unplacedPlaces: 0,
  tailScene: false,
}

describe('entityDeleteCopy — the lead line', () => {
  it("leads with the needs-a-lead line for the branch's lead when the story needs one", () => {
    expect(entityDeleteCopy(kaelLead, { ...NO_IMPACT, awareness: 2 }, true).impacts).toEqual([
      "Kael is this branch's lead. The story can't continue here until you set another.",
      '2 awareness records',
    ])
  })

  it("says the branch will have no lead when the story doesn't need one", () => {
    expect(entityDeleteCopy(kaelLead, NO_IMPACT, false).impacts).toEqual([
      'This branch will have no lead.',
    ])
  })

  it.each([true, false])('adds no lead line for an unflagged row (needsLead %s)', (needsLead) => {
    expect(entityDeleteCopy(kael, NO_IMPACT, needsLead).impacts).toEqual([])
  })
})

describe('deleteRejectionText', () => {
  it('names the in-flight refusal, and gives every other code the generic failure', () => {
    expect(deleteRejectionText(ROW_DELETE_REJECTION.inFlight)).toBe(
      "Couldn't delete while generation is in flight.",
    )
    expect(deleteRejectionText(ROW_DELETE_REJECTION.notFound)).toBe("Couldn't delete that.")
    expect(deleteRejectionText(ROW_DELETE_REJECTION.failed)).toBe("Couldn't delete that.")
  })
})

describe('loreDeleteCopy', () => {
  it('names the row with no impact lines and a lore-shaped confirm label', () => {
    const veil = { id: 'lore_veil', branchId: 'b1', title: 'The Veil' } as Lore
    expect(loreDeleteCopy(veil)).toEqual({
      title: 'Delete The Veil?',
      description: deleteUndoHint(),
      impacts: [],
      confirmLabel: 'Delete lore',
    })
  })
})
