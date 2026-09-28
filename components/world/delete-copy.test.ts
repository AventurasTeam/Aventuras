import { describe, expect, it } from 'vitest'

import { ENTITY_DELETE_CODES } from '@/lib/actions'
import { emptyEntityState, type Entity, type Lore } from '@/lib/db'

import { deleteDisabledReason, deleteRejectionText, loreDeleteCopy } from './delete-copy'

const kael = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  state: emptyEntityState('character'),
} as Entity

describe('deleteDisabledReason', () => {
  it('returns the blocked reason for a blocked row, whether or not it is also the lead', () => {
    expect(deleteDisabledReason(kael, null, true, 'blocked')).toBe('blocked')
    expect(deleteDisabledReason(kael, 'char_kael', true, 'blocked')).toBe('blocked')
  })

  it('falls back to the generation-gate text when blocked with no reason given', () => {
    expect(deleteDisabledReason(kael, null, true)).toBe('Generation is in flight. Cancel to edit.')
  })

  it("names the lead reason for the story's lead when not blocked", () => {
    expect(deleteDisabledReason(kael, 'char_kael', false)).toBe(
      "The story's lead can't be deleted — set another character as lead first.",
    )
  })

  it('is available for a row that is neither blocked nor the lead', () => {
    expect(deleteDisabledReason(kael, null, false)).toBeUndefined()
    expect(deleteDisabledReason(kael, 'char_other', false)).toBeUndefined()
  })
})

describe('deleteRejectionText', () => {
  it('names the in-flight and lead refusals, and falls back to the generic failure otherwise', () => {
    expect(deleteRejectionText(ENTITY_DELETE_CODES.inFlight)).toBe(
      "Couldn't delete while generation is in flight.",
    )
    expect(deleteRejectionText(ENTITY_DELETE_CODES.leadEntity)).toBe(
      "The story's lead can't be deleted — set another character as lead first.",
    )
    expect(deleteRejectionText('not-found')).toBe("Couldn't delete that.")
    expect(deleteRejectionText('group-conflict')).toBe("Couldn't delete that.")
    expect(deleteRejectionText(undefined)).toBe("Couldn't delete that.")
  })
})

describe('loreDeleteCopy', () => {
  it('names the row with no impact lines and a lore-shaped confirm label', () => {
    const veil = { id: 'lore_veil', branchId: 'b1', title: 'The Veil' } as Lore
    expect(loreDeleteCopy(veil)).toEqual({
      title: 'Delete The Veil?',
      description:
        'You can undo this from the reader: Undo last action in its menu, or Cmd/Ctrl-Z.',
      impacts: [],
      confirmLabel: 'Delete lore',
    })
  })
})
