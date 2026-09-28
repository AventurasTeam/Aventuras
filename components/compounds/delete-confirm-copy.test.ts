import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'

import { deleteUndoHint } from './delete-confirm-copy'

describe('deleteUndoHint', () => {
  it("composes the reader's own undo label, so a label change can't silently desync", () => {
    expect(deleteUndoHint()).toBe(t('common:deleteUndoHint', { action: t('reader:actions.undo') }))
  })

  it('reads as this exact sentence today', () => {
    expect(deleteUndoHint()).toBe(
      'You can undo this from the reader: Undo last action in its menu, or Cmd/Ctrl-Z.',
    )
  })
})
