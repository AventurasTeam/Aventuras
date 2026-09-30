import { afterEach, describe, expect, it } from 'vitest'

import { i18n } from '@/lib/i18n'

import { deleteUndoHint } from './delete-confirm-copy'

const UNDO_KEY = 'actions.undo'
const shippedUndo = i18n.getResource('en', 'reader', UNDO_KEY) as string

describe('deleteUndoHint', () => {
  afterEach(() => {
    i18n.addResource('en', 'reader', UNDO_KEY, shippedUndo)
  })

  it("names whatever the reader's undo label reads, so a relabel can't desync the hint", () => {
    i18n.addResource('en', 'reader', UNDO_KEY, 'SENTINEL-UNDO')
    expect(deleteUndoHint()).toContain('SENTINEL-UNDO')
  })

  it('reads as this exact sentence today', () => {
    expect(deleteUndoHint()).toBe(
      'You can undo this from the reader: Undo last action in its menu, or Cmd/Ctrl-Z.',
    )
  })
})
