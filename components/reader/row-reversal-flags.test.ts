import { describe, expect, it } from 'vitest'

import {
  editGateOf,
  headTurnIdsOf,
  inlineEditSaveGate,
  rowGateReason,
  rowReversalFlags,
} from './row-reversal-flags'

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

  // A window short of the live edge describes another turn; the action layer would refuse it.
  it('is empty when the window ends on a turn the host did not name as the tail', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply')]
    expect(headTurnIdsOf(rows, 'e9').size).toBe(0)
  })

  it('is empty when the host names no tail', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply')]
    expect(headTurnIdsOf(rows, null).size).toBe(0)
  })
})

describe('editGateOf', () => {
  it('is open while nothing blocks', () => {
    expect(editGateOf({ editBlocked: false, headReversalBlocked: false })).toBe('open')
  })

  it('is interruptible while only a pass or a close holds the gate', () => {
    expect(editGateOf({ editBlocked: true, headReversalBlocked: false })).toBe('interruptible')
  })

  it('is closed while the head reversals are blocked too', () => {
    expect(editGateOf({ editBlocked: true, headReversalBlocked: true })).toBe('closed')
  })

  // The store's gates never disagree this way; the stricter one wins if they do.
  it('is closed when only the head reversals are blocked', () => {
    expect(editGateOf({ editBlocked: false, headReversalBlocked: true })).toBe('closed')
  })
})

describe('rowReversalFlags', () => {
  const headTurnIds = new Set(['e4', 'e5'])

  it('keeps the head turn editable and its reversals live through an interruptible gate', () => {
    for (const rowId of ['e4', 'e5'])
      expect(rowReversalFlags({ rowId, headTurnIds, editGate: 'interruptible' })).toEqual({
        editDisabled: false,
        reversalDisabled: false,
      })
  })

  // principles.md → Edit restrictions during in-flight generation.
  it("keeps an older entry's edit on the whole gate while its reversals stay live", () => {
    expect(rowReversalFlags({ rowId: 'e2', headTurnIds, editGate: 'interruptible' })).toEqual({
      editDisabled: true,
      reversalDisabled: false,
    })
  })

  it('gates every row while the gate is closed', () => {
    for (const rowId of ['e2', 'e5'])
      expect(rowReversalFlags({ rowId, headTurnIds, editGate: 'closed' })).toEqual({
        editDisabled: true,
        reversalDisabled: true,
      })
  })

  it('gates nothing while the gate is open', () => {
    for (const rowId of ['e2', 'e5'])
      expect(rowReversalFlags({ rowId, headTurnIds, editGate: 'open' })).toEqual({
        editDisabled: false,
        reversalDisabled: false,
      })
  })
})

describe('rowGateReason', () => {
  const reasons = { gate: 'pass reason', headReversal: 'refresh reason' }

  it("names the pill's run while only a pass or a close holds the gate", () => {
    expect(rowGateReason('interruptible', reasons)).toBe('pass reason')
  })

  it("names the head reversals' blocker once the gate is closed", () => {
    expect(rowGateReason('closed', reasons)).toBe('refresh reason')
  })

  it('names nothing while the gate is open', () => {
    expect(rowGateReason('open', reasons)).toBeUndefined()
  })
})

describe('inlineEditSaveGate', () => {
  const reasons = { gate: 'Updating memory…', headReversal: 'Waiting on the turn…' }
  const head = new Set(['e4', 'e5'])

  it('leaves Save open with no editor', () => {
    expect(
      inlineEditSaveGate({ entryId: null, headTurnIds: head, editGate: 'closed', reasons }),
    ).toEqual({ disabled: false, reason: undefined })
  })

  it('keeps a head-turn edit savable through a pass', () => {
    expect(
      inlineEditSaveGate({ entryId: 'e5', headTurnIds: head, editGate: 'interruptible', reasons }),
    ).toEqual({ disabled: false, reason: undefined })
  })

  it('holds an older edit through a pass, with the run as its reason', () => {
    expect(
      inlineEditSaveGate({ entryId: 'e2', headTurnIds: head, editGate: 'interruptible', reasons }),
    ).toEqual({ disabled: true, reason: reasons.gate })
  })

  it("holds the head turn's edit too once the gate is closed", () => {
    expect(
      inlineEditSaveGate({ entryId: 'e5', headTurnIds: head, editGate: 'closed', reasons }),
    ).toEqual({ disabled: true, reason: reasons.headReversal })
  })

  it('leaves every edit savable with the gate open', () => {
    expect(
      inlineEditSaveGate({ entryId: 'e2', headTurnIds: head, editGate: 'open', reasons }),
    ).toEqual({ disabled: false, reason: undefined })
  })
})
