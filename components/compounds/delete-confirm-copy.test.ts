import { describe, expect, it } from 'vitest'

import { deleteUndoHint } from './delete-confirm-copy'

describe('deleteUndoHint', () => {
  // world.md → Delete: the reader's Undo names its target, so the hint quotes no label of it.
  it('points at the reader without quoting its Undo label', () => {
    expect(deleteUndoHint()).toBe("You can undo this from the reader's menu, or with Cmd/Ctrl-Z.")
  })
})
