import { describe, expect, it } from 'vitest'

import { deleteUndoHint } from '@/components/compounds/delete-confirm-copy'
import { ROW_DELETE_REJECTION } from '@/lib/actions'
import type { Lore } from '@/lib/db'

import { deleteRejectionText, loreDeleteCopy } from './delete-copy'

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
