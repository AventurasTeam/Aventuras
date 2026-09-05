import { describe, expect, it } from 'vitest'

import { selectUndoTarget, type UndoCandidateDelta } from './index'

function delta(overrides: Partial<UndoCandidateDelta>): UndoCandidateDelta {
  return {
    actionId: 'act_1',
    source: 'user_edit',
    targetTable: 'entities',
    targetId: 'ent_1',
    op: 'update',
    ...overrides,
  }
}

describe('selectUndoTarget', () => {
  it('returns null for an empty log', () => {
    expect(selectUndoTarget([])).toBeNull()
  })

  it('skips periodic_classifier deltas to find the true most-recent group', () => {
    const rows = [
      delta({ actionId: 'act_classifier', source: 'periodic_classifier', targetTable: 'lore' }),
      delta({
        actionId: 'act_turn',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_9',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({
      actionId: 'act_turn',
      kind: 'turn',
      entryId: 'entry_9',
    })
  })

  it('classifies a turn group (has a story_entries create) with its entryId', () => {
    const rows = [
      delta({
        actionId: 'act_turn',
        source: 'user_edit',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_5',
      }),
      delta({
        actionId: 'act_turn',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'update',
        targetId: 'entry_5',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({
      actionId: 'act_turn',
      kind: 'turn',
      entryId: 'entry_5',
    })
  })

  it('anchors at the earliest story_entries create when a turn group has two (user_action + ai_reply)', () => {
    // DESC-ordered (newest first): the ai_reply's create appears before the
    // user_action's create in the array, but the user_action has the lower
    // log_position and must be the anchor so the reversal window sweeps both.
    const rows = [
      delta({
        actionId: 'act_turn',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_ai_reply',
      }),
      delta({
        actionId: 'act_turn',
        source: 'user_edit',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_user_action',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({
      actionId: 'act_turn',
      kind: 'turn',
      entryId: 'entry_user_action',
    })
  })

  it('classifies a content edit as a group, not the turn beneath it', () => {
    // The reported defect: with no delta of its own the edit was invisible here and
    // the head became the turn, so CTRL-Z deleted it.
    const rows = [
      delta({
        actionId: 'act_edit',
        source: 'user_edit',
        targetTable: 'story_entries',
        op: 'update',
        targetId: 'entry_5',
      }),
      delta({
        actionId: 'act_turn',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_5',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({ actionId: 'act_edit', kind: 'group' })
  })

  it('steps over classifier facts sitting on top of a content edit', () => {
    const rows = [
      delta({ actionId: 'act_c', source: 'periodic_classifier', targetTable: 'happenings' }),
      delta({
        actionId: 'act_edit',
        source: 'user_edit',
        targetTable: 'story_entries',
        op: 'update',
        targetId: 'entry_5',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({ actionId: 'act_edit', kind: 'group' })
  })

  it('classifies a non-turn group (no story_entries create) as a plain group', () => {
    const rows = [
      delta({
        actionId: 'act_flip',
        source: 'user_edit',
        targetTable: 'branch_era_flips',
        op: 'create',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({ actionId: 'act_flip', kind: 'group' })
  })

  it('never returns a periodic_classifier-only group', () => {
    const rows = [delta({ actionId: 'act_c', source: 'periodic_classifier', targetTable: 'lore' })]
    expect(selectUndoTarget(rows)).toBeNull()
  })

  it('targets only the most recent of consecutive prose turns', () => {
    // Two turns, two action_ids. The earliest-create anchor is group-scoped, so
    // the turn beneath must not pull the window down to its own entry.
    const rows = [
      delta({
        actionId: 'act_t2',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_t2',
      }),
      delta({
        actionId: 'act_t1',
        source: 'ai_classifier',
        targetTable: 'story_entries',
        op: 'create',
        targetId: 'entry_t1',
      }),
    ]
    expect(selectUndoTarget(rows)).toEqual({
      actionId: 'act_t2',
      kind: 'turn',
      entryId: 'entry_t2',
    })
  })
})
