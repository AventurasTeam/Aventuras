import { describe, expect, it } from 'vitest'

import { headTurnIdsOf, rowReversalFlags } from './row-reversal-flags'

function entry(id: string, kind: string) {
  return { id, kind, position: 0 }
}

describe('headTurnIdsOf', () => {
  it('holds the tail reply and the user action it answers', () => {
    const rows = [entry('e1', 'opening'), entry('e2', 'user_action'), entry('e3', 'ai_reply')]
    expect([...headTurnIdsOf(rows, 'e3')].sort()).toEqual(['e2', 'e3'])
  })

  // The failure banner sits at MAX(position) + 1 and is no turn of its own.
  it('reads past a trailing system entry to the turn beneath it', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply'), entry('e3', 'system')]
    expect([...headTurnIdsOf(rows, 'e2')].sort()).toEqual(['e1', 'e2'])
  })

  it('holds only the tail when the tail answers no user action', () => {
    expect([...headTurnIdsOf([entry('e1', 'ai_reply'), entry('e2', 'user_action')], 'e2')]).toEqual(
      ['e2'],
    )
    expect([...headTurnIdsOf([entry('e1', 'opening'), entry('e2', 'ai_reply')], 'e2')]).toEqual([
      'e2',
    ])
  })

  it('is empty on an empty branch', () => {
    expect(headTurnIdsOf([], 'e1').size).toBe(0)
  })

  // A window that stops short of the branch's live edge describes a different turn, which the
  // action layer would refuse (the same check resolveSaveAndRegenTurn makes).
  it('is empty when the window ends on a turn the host did not name as the tail', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply')]
    expect(headTurnIdsOf(rows, 'e9').size).toBe(0)
  })

  it('is empty when the host names no tail', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply')]
    expect(headTurnIdsOf(rows, null).size).toBe(0)
  })
})

describe('rowReversalFlags', () => {
  const headTurnIds = new Set(['e4', 'e5'])

  it('keeps the head turn editable and its reversals live while only a pass holds the gate', () => {
    for (const rowId of ['e4', 'e5'])
      expect(
        rowReversalFlags({ rowId, headTurnIds, editBlocked: true, headReversalBlocked: false }),
      ).toEqual({ editDisabled: false, reversalDisabled: false })
  })

  // An edit off the head turn can't interrupt a pass (Decision "Which reader controls
  // interrupt a pass"), but its row's ↻ and × can.
  it("keeps an older entry's edit on the whole gate while its reversals stay live", () => {
    expect(
      rowReversalFlags({ rowId: 'e2', headTurnIds, editBlocked: true, headReversalBlocked: false }),
    ).toEqual({ editDisabled: true, reversalDisabled: false })
  })

  it('gates every row when the head reversals are blocked too', () => {
    for (const rowId of ['e2', 'e5'])
      expect(
        rowReversalFlags({ rowId, headTurnIds, editBlocked: true, headReversalBlocked: true }),
      ).toEqual({ editDisabled: true, reversalDisabled: true })
  })

  it('gates nothing while neither gate is held', () => {
    for (const rowId of ['e2', 'e5'])
      expect(
        rowReversalFlags({ rowId, headTurnIds, editBlocked: false, headReversalBlocked: false }),
      ).toEqual({ editDisabled: false, reversalDisabled: false })
  })
})
