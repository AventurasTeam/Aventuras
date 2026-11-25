import { describe, expect, it } from 'vitest'

import { describeRedoTarget, describeUndoGroup, type UndoGroupDelta } from './describe'
import { UNDO_KIND_KEY } from './kinds'

// Built oldest first, as a reader thinks of a group; the describe step reads newest first.
function group(...writes: Partial<UndoGroupDelta>[]): UndoGroupDelta[] {
  return writes
    .map((w, i) => ({
      actionId: 'act_1',
      source: 'user_edit',
      targetTable: 'entities',
      targetId: `row_${i}`,
      op: 'update' as const,
      entryId: null,
      undoPayload: null,
      ...w,
    }))
    .reverse()
}

const entryWrite = (over: Partial<UndoGroupDelta> = {}): Partial<UndoGroupDelta> => ({
  targetTable: 'story_entries',
  targetId: 'e_tail',
  entryId: 'e_tail',
  ...over,
})

describe('describeUndoGroup', () => {
  it("names a turn by its earliest created entry, and it's seen", () => {
    const turn = group(
      entryWrite({ op: 'create', targetId: 'e_action', source: 'user_edit' }),
      entryWrite({ op: 'create', targetId: 'e_reply', source: 'ai_classifier' }),
      { source: 'per_turn_classifier', targetTable: 'entities', op: 'update' },
    )
    expect(describeUndoGroup(turn)).toEqual({ kind: 'turn', seen: true, entryId: 'e_action' })
  })

  it('reads a regenerate as the turn it wrote', () => {
    const regen = group(entryWrite({ op: 'create', targetId: 'e_reply', source: 'ai_classifier' }))
    expect(describeUndoGroup(regen)).toMatchObject({ kind: 'turn', entryId: 'e_reply' })
  })

  it.each(['entryText', 'entryScene', 'entryTime', 'suggestionRefresh'] as const)(
    'reads a group tagged %s as seen, at its entry',
    (undoKind) => {
      const tagged = group(
        { targetTable: 'entities', op: 'update' },
        entryWrite({ targetId: 'e7', undoPayload: { metadata: {}, [UNDO_KIND_KEY]: undoKind } }),
      )
      expect(describeUndoGroup(tagged)).toEqual({
        kind: 'tagged',
        seen: true,
        undoKind,
        entryId: 'e7',
      })
    },
  )

  it('ignores a tag off the entry delta, and an unknown one', () => {
    const offEntry = group({ undoPayload: { [UNDO_KIND_KEY]: 'entryText' } })
    const unknown = group(entryWrite({ undoPayload: { [UNDO_KIND_KEY]: 'somethingElse' } }))
    expect(describeUndoGroup(offEntry).seen).toBe(false)
    expect(describeUndoGroup(unknown)).toEqual({ kind: 'latest', seen: false })
  })

  it("names a close by the chapter it created, even with the report's update after", () => {
    const close = group(
      { source: 'chapter_close', targetTable: 'chapters', targetId: 'ch_3', op: 'create' },
      entryWrite({ source: 'chapter_close', undoPayload: { chapterId: null } }),
      { source: 'chapter_close', targetTable: 'lore', op: 'create' },
      { source: 'chapter_close', targetTable: 'chapters', targetId: 'ch_3', op: 'update' },
    )
    expect(describeUndoGroup(close)).toEqual({ kind: 'close', seen: false, chapterId: 'ch_3' })
  })

  it('names a re-run by the chapter it updated with no create', () => {
    const rerun = group(
      { source: 'chapter_close', targetTable: 'lore', op: 'update', entryId: 'e_end' },
      { source: 'chapter_close', targetTable: 'chapters', targetId: 'ch_5', op: 'update' },
    )
    expect(describeUndoGroup(rerun)).toEqual({ kind: 'rerun', seen: false, chapterId: 'ch_5' })
  })

  it("names a divider-only removal's kept work by the end entry its deltas anchor on", () => {
    const kept = group(
      { source: 'chapter_close', targetTable: 'lore', op: 'create', entryId: 'e_end' },
      { source: 'chapter_close', targetTable: 'entities', op: 'update', entryId: 'e_end' },
    )
    expect(describeUndoGroup(kept)).toEqual({ kind: 'keptClose', seen: false, entryId: 'e_end' })
  })

  it.each(['create', 'update', 'delete'] as const)(
    'names a user group on one row besides entries by its op: %s',
    (op) => {
      const one = group({ targetTable: 'lore', targetId: 'lore_1', op })
      expect(describeUndoGroup(one)).toEqual({
        kind: 'row',
        seen: false,
        op,
        row: { table: 'lore', id: 'lore_1' },
      })
    },
  )

  it('names a one-row group by the op that made or removed the row, over its updates', () => {
    const created = group(
      { targetTable: 'threads', targetId: 't1', op: 'create' },
      { targetTable: 'threads', targetId: 't1', op: 'update' },
    )
    expect(describeUndoGroup(created)).toMatchObject({ kind: 'row', op: 'create' })
  })

  it('names a several-row user group by the first row it wrote, and counts the rest', () => {
    const save = group(
      { targetTable: 'happenings', targetId: 'h1', op: 'update' },
      { targetTable: 'happening_involvements', targetId: 'inv1', op: 'create' },
      { targetTable: 'happening_awareness', targetId: 'aw1', op: 'create' },
      { targetTable: 'happenings', targetId: 'h1', op: 'update' },
    )
    expect(describeUndoGroup(save)).toEqual({
      kind: 'rows',
      seen: false,
      first: { table: 'happenings', id: 'h1' },
      more: 2,
    })
  })

  it('prefers a row of its own over a link row it wrote first', () => {
    const merge = group(
      { targetTable: 'happening_awareness', targetId: 'aw1', op: 'create' },
      { targetTable: 'entities', targetId: 'ent_keep', op: 'update' },
    )
    expect(describeUndoGroup(merge)).toMatchObject({
      kind: 'rows',
      first: { table: 'entities', id: 'ent_keep' },
      more: 1,
    })
  })

  it('names a group of only link rows by its first link', () => {
    const links = group(
      { targetTable: 'character_relationships', targetId: 'rel1', op: 'create' },
      { targetTable: 'character_relationships', targetId: 'rel2', op: 'create' },
    )
    expect(describeUndoGroup(links)).toMatchObject({
      first: { table: 'character_relationships', id: 'rel1' },
      more: 1,
    })
  })

  // The tail scene write inside a World delete or a merge carries no tag: both stay unseen.
  it('reads a World delete that rewrites the tail scene as unseen, named by its row', () => {
    const del = group(
      { targetTable: 'entities', targetId: 'ent_other', op: 'update' },
      entryWrite({ undoPayload: { metadata: { sceneEntities: ['ent_gone'] } } }),
      { targetTable: 'entities', targetId: 'ent_gone', op: 'delete' },
    )
    expect(describeUndoGroup(del)).toEqual({
      kind: 'rows',
      seen: false,
      first: { table: 'entities', id: 'ent_other' },
      more: 1,
    })
  })

  it('reads a merge that rewrites the tail scene as unseen', () => {
    const merge = group(
      { targetTable: 'happening_awareness', targetId: 'aw1', op: 'create' },
      entryWrite({ undoPayload: { metadata: { sceneEntities: ['ent_dup'] } } }),
      { targetTable: 'entities', targetId: 'ent_dup', op: 'delete' },
    )
    expect(describeUndoGroup(merge)).toMatchObject({ seen: false, kind: 'rows' })
  })

  it('reads a single entity delete beside an untagged scene write as one row', () => {
    const del = group(entryWrite({ undoPayload: { metadata: {} } }), {
      targetTable: 'entities',
      targetId: 'ent_gone',
      op: 'delete',
    })
    expect(describeUndoGroup(del)).toEqual({
      kind: 'row',
      seen: false,
      op: 'delete',
      row: { table: 'entities', id: 'ent_gone' },
    })
  })

  it('names a Timeline chapter edit as a row of its own', () => {
    const edit = group({ targetTable: 'chapters', targetId: 'ch_2', op: 'update' })
    expect(describeUndoGroup(edit)).toMatchObject({ kind: 'row', row: { table: 'chapters' } })
  })

  it('counts a row it has no name for, but never names it', () => {
    const mixed = group(
      { targetTable: 'branch_era_flips', targetId: 'flip1', op: 'create' },
      { targetTable: 'lore', targetId: 'lore_1', op: 'update' },
    )
    expect(describeUndoGroup(mixed)).toMatchObject({
      kind: 'rows',
      first: { table: 'lore', id: 'lore_1' },
      more: 1,
    })
  })

  it.each([
    [
      'a group of rows it has no name for',
      group({ targetTable: 'branch_era_flips', op: 'create' }),
    ],
    ['an untagged entry write alone', group(entryWrite({ undoPayload: { metadata: {} } }))],
    ['a non-user group', group({ source: 'ai_classifier', targetTable: 'entities' })],
    ['an empty group', []],
  ])('falls to the latest change for %s', (_, deltas) => {
    expect(describeUndoGroup(deltas)).toEqual({ kind: 'latest', seen: false })
  })
})

describe('describeUndoGroup → a lead change', () => {
  // An update's undo payload holds the flag as it was before the write.
  const flag = (id: string, prior: 0 | 1): Partial<UndoGroupDelta> => ({
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload: { isLead: prior },
  })

  it('names a switch by the row it flags, not the row it clears first', () => {
    expect(describeUndoGroup(group(flag('char_kael', 1), flag('char_mira', 0)))).toEqual({
      kind: 'leadSet',
      seen: false,
      row: { table: 'entities', id: 'char_mira' },
    })
  })

  it('names a set on a branch with no lead by its one row, as a set', () => {
    expect(describeUndoGroup(group(flag('char_mira', 0)))).toEqual({
      kind: 'leadSet',
      seen: false,
      row: { table: 'entities', id: 'char_mira' },
    })
  })

  it('names a set that only clears, its target already flagged, by the row it clears', () => {
    expect(describeUndoGroup(group(flag('char_kael', 1)))).toEqual({
      kind: 'leadUnset',
      seen: false,
      row: { table: 'entities', id: 'char_kael' },
    })
  })

  it('names an unset of a double by the oldest row it cleared', () => {
    expect(describeUndoGroup(group(flag('char_kael', 1), flag('char_mira', 1)))).toEqual({
      kind: 'leadUnset',
      seen: false,
      row: { table: 'entities', id: 'char_kael' },
    })
  })

  it('reads an entity edit whose payload holds no flag as before', () => {
    const edit = group({
      targetTable: 'entities',
      targetId: 'char_kael',
      op: 'update',
      undoPayload: { description: 'A wanderer.' },
    })
    expect(describeUndoGroup(edit)).toEqual({
      kind: 'row',
      seen: false,
      op: 'update',
      row: { table: 'entities', id: 'char_kael' },
    })
  })

  it("keeps a delete of the lead as a delete, its payload's flag included", () => {
    const del = group({
      targetTable: 'entities',
      targetId: 'char_kael',
      op: 'delete',
      undoPayload: { id: 'char_kael', name: 'Kael', isLead: 1 },
    })
    expect(describeUndoGroup(del)).toEqual({
      kind: 'row',
      seen: false,
      op: 'delete',
      row: { table: 'entities', id: 'char_kael' },
    })
  })

  it("keeps a merge's description", () => {
    const merge = group(
      { targetTable: 'happening_awareness', targetId: 'aw1', op: 'create' },
      {
        targetTable: 'entities',
        targetId: 'char_keep',
        op: 'update',
        undoPayload: { description: 'Older.' },
      },
      {
        targetTable: 'entities',
        targetId: 'char_dup',
        op: 'delete',
        undoPayload: { id: 'char_dup', isLead: 0 },
      },
    )
    expect(describeUndoGroup(merge)).toEqual({
      kind: 'rows',
      seen: false,
      first: { table: 'entities', id: 'char_keep' },
      more: 2,
    })
  })

  it('keeps the description of a group that deletes a row beside a flag write', () => {
    const mixed = group(flag('char_mira', 0), {
      targetTable: 'entities',
      targetId: 'char_gone',
      op: 'delete',
      undoPayload: { id: 'char_gone', isLead: 0 },
    })
    expect(describeUndoGroup(mixed)).toEqual({
      kind: 'rows',
      seen: false,
      first: { table: 'entities', id: 'char_mira' },
      more: 1,
    })
  })
})

describe('describeRedoTarget', () => {
  it('describes only the undone action, not the closure the snapshot reached', () => {
    const target = group({ actionId: 'act_save', targetTable: 'lore', targetId: 'lore_1' })
    const closure = group({
      actionId: 'act_pass',
      source: 'periodic_classifier',
      targetTable: 'entities',
      op: 'create',
    })
    const snapshots = [...closure, ...target].map((delta) => ({ delta }))
    expect(describeRedoTarget({ actionId: 'act_save', snapshots })).toEqual({
      kind: 'row',
      seen: false,
      op: 'update',
      row: { table: 'lore', id: 'lore_1' },
    })
  })

  it('describes a redone switch as the set, by the row it flags', () => {
    const target = group(
      {
        actionId: 'act_set',
        targetTable: 'entities',
        targetId: 'char_kael',
        undoPayload: { isLead: 1 },
      },
      {
        actionId: 'act_set',
        targetTable: 'entities',
        targetId: 'char_mira',
        undoPayload: { isLead: 0 },
      },
    )
    const snapshots = target.map((delta) => ({ delta }))
    expect(describeRedoTarget({ actionId: 'act_set', snapshots })).toEqual({
      kind: 'leadSet',
      seen: false,
      row: { table: 'entities', id: 'char_mira' },
    })
  })
})
