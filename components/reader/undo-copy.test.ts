import { afterEach, describe, expect, it } from 'vitest'

import type { Delta } from '@/lib/db'
import { entriesStore } from '@/lib/stores'
import type { UndoDescription } from '@/lib/undo'

import {
  deletedRowsOf,
  firstRowOf,
  snapshotRowsOf,
  undoConfirmRows,
  undoConfirmTitle,
  undoNames,
  undoTargetText,
  type UndoNames,
  type UndoRowSource,
} from './undo-copy'

afterEach(() => entriesStore.__reset())

const NAMES: UndoNames = {
  entryRef: (id) => (id === 'e4' ? 'entry #4' : null),
  chapterNumber: (id) => (id === 'ch3' ? 3 : null),
  rowName: ({ id }) => ({ ent: 'Tobin', lore1: 'The toll' })[id] ?? null,
}

describe('undoTargetText', () => {
  it.each<[UndoDescription, string]>([
    [{ kind: 'turn', seen: true, entryId: 'e4' }, 'Undo the turn at entry #4'],
    [
      { kind: 'tagged', seen: true, undoKind: 'entryText', entryId: 'e4' },
      'Undo your edit to entry #4',
    ],
    [
      { kind: 'tagged', seen: true, undoKind: 'entryScene', entryId: 'e4' },
      "Undo entry #4's scene",
    ],
    [{ kind: 'tagged', seen: true, undoKind: 'entryTime', entryId: 'e4' }, "Undo entry #4's time"],
    [
      { kind: 'tagged', seen: true, undoKind: 'suggestionRefresh', entryId: 'e4' },
      'Undo the suggestion refresh at entry #4',
    ],
    [{ kind: 'close', seen: false, chapterId: 'ch3' }, "Undo chapter 3's close…"],
    [{ kind: 'rerun', seen: false, chapterId: 'ch3' }, "Undo chapter 3's re-run…"],
    [{ kind: 'keptClose', seen: false, entryId: 'e4' }, 'Undo the kept close work at entry #4…'],
    [
      { kind: 'row', seen: false, op: 'create', row: { table: 'entities', id: 'ent' } },
      'Undo adding Tobin…',
    ],
    [
      { kind: 'row', seen: false, op: 'delete', row: { table: 'entities', id: 'ent' } },
      'Undo deleting Tobin…',
    ],
    [
      { kind: 'row', seen: false, op: 'update', row: { table: 'lore', id: 'lore1' } },
      'Undo your edit to The toll…',
    ],
    [
      { kind: 'rows', seen: false, first: { table: 'entities', id: 'ent' }, more: 2 },
      'Undo your changes to Tobin and 2 more…',
    ],
    [{ kind: 'latest', seen: false }, 'Undo the latest change…'],
  ])('labels %o in the menu', (description, label) => {
    expect(undoTargetText(description, NAMES, 'menu')).toBe(label)
  })

  it('says what landed in the notice, and what comes back in redo, with no ellipsis', () => {
    const close: UndoDescription = { kind: 'close', seen: false, chapterId: 'ch3' }
    expect(undoTargetText(close, NAMES, 'notice')).toBe("Undid chapter 3's close")
    expect(undoTargetText(close, NAMES, 'redoMenu')).toBe("Redo chapter 3's close")
    expect(undoTargetText(close, NAMES, 'redoNotice')).toBe("Redid chapter 3's close")
    const turn: UndoDescription = { kind: 'turn', seen: true, entryId: 'e4' }
    expect(undoTargetText(turn, NAMES, 'notice')).toBe('Undid the turn at entry #4')
    expect(undoTargetText(turn, NAMES, 'redoMenu')).toBe('Redo the turn at entry #4')
  })

  it.each<UndoDescription>([
    { kind: 'turn', seen: true, entryId: 'e_unknown' },
    { kind: 'close', seen: false, chapterId: 'ch_unknown' },
    { kind: 'row', seen: false, op: 'update', row: { table: 'lore', id: 'unnamed' } },
    { kind: 'keptClose', seen: false, entryId: null },
  ])('falls to the latest change when %o names nothing it can read', (description) => {
    expect(undoTargetText(description, NAMES, 'menu')).toBe('Undo the latest change…')
    expect(undoTargetText(description, NAMES, 'notice')).toBe('Undid the latest change')
  })
})

describe('undoConfirmTitle', () => {
  it('asks the undo as a question', () => {
    expect(undoConfirmTitle({ kind: 'close', seen: false, chapterId: 'ch3' }, NAMES)).toBe(
      "Undo chapter 3's close?",
    )
    expect(
      undoConfirmTitle(
        { kind: 'rows', seen: false, first: { table: 'entities', id: 'ent' }, more: 1 },
        NAMES,
      ),
    ).toBe('Undo your changes to Tobin and 1 more?')
    expect(undoConfirmTitle({ kind: 'latest', seen: false }, NAMES)).toBe('Undo the latest change?')
  })
})

const ROWS: Record<string, Record<string, unknown>> = {
  'entities:ent': { id: 'ent', name: 'Tobin' },
  'entities:ent_b': { id: 'ent_b', name: 'Mira' },
  'lore:lore1': { id: 'lore1', title: 'The toll' },
  'chapters:ch3': { id: 'ch3', sequenceNumber: 3 },
  'happenings:hap': { id: 'hap', title: 'The night crossing' },
  'happening_awareness:aw': { id: 'aw', characterId: 'ent', happeningId: 'hap' },
  'character_relationships:rel': { id: 'rel', aId: 'ent_b', bId: 'ent' },
  // A field that reads like a name, so only the table rule keeps it unnamed.
  'branch_era_flips:flip': { id: 'flip', title: 'Flip' },
}
const rows: UndoRowSource = ({ table, id }) => ROWS[`${table}:${id}`]

describe('undoNames', () => {
  it("names a row History's way, a chapter by number and a link by its entity end", () => {
    const names = undoNames(rows)
    expect(names.rowName({ table: 'entities', id: 'ent' })).toBe('Tobin')
    expect(names.rowName({ table: 'lore', id: 'lore1' })).toBe('The toll')
    expect(names.rowName({ table: 'chapters', id: 'ch3' })).toBe('chapter 3')
    expect(names.rowName({ table: 'happening_awareness', id: 'aw' })).toBe('Tobin')
    expect(names.rowName({ table: 'character_relationships', id: 'rel' })).toBe('Mira')
    expect(names.chapterNumber('ch3')).toBe(3)
  })

  it('never names a row on a table it has no name for, or a row it cannot read', () => {
    const names = undoNames(rows)
    expect(names.rowName({ table: 'branch_era_flips', id: 'flip' })).toBeNull()
    expect(names.rowName({ table: 'entities', id: 'gone' })).toBeNull()
  })

  it('reads an entry number from the read positions, then the loaded window, then the row', () => {
    entriesStore.hydrate('b1', [
      {
        id: 'e_loaded',
        branchId: 'b1',
        position: 7,
        kind: 'ai_reply',
        content: 'x',
        contentTokens: null,
        chapterId: null,
        metadata: null,
        createdAt: 1,
      },
    ])
    const names = undoNames(
      firstRowOf(rows, ({ table, id }) =>
        table === 'story_entries' && id === 'e_gone' ? { position: 9 } : undefined,
      ),
      { e_read: 4 },
    )
    expect(names.entryRef('e_read')).toBe('entry #4')
    expect(names.entryRef('e_loaded')).toBe('entry #7')
    expect(names.entryRef('e_gone')).toBe('entry #9')
    expect(names.entryRef('e_nowhere')).toBeNull()
  })

  it('reads a row a redo brings back, and its entry number, from the snapshot', () => {
    const snapshots = [
      {
        delta: { targetTable: 'entities', targetId: 'ent_new' },
        rowBeforeUndo: { id: 'ent_new', name: 'Wren' },
      },
      {
        delta: { targetTable: 'story_entries', targetId: 'e_gone' },
        rowBeforeUndo: { position: 12 },
      },
    ]
    const names = undoNames(firstRowOf(rows, snapshotRowsOf(snapshots)))
    expect(names.rowName({ table: 'entities', id: 'ent_new' })).toBe('Wren')
    expect(names.entryRef('e_gone')).toBe('entry #12')
  })

  it("reads a deleted row's name from its delete's payload", () => {
    const deleted = [
      delta({ op: 'delete', targetId: 'ent_gone', undoPayload: { name: 'Old Pell' } }),
    ]
    const names = undoNames(firstRowOf(rows, deletedRowsOf(deleted)))
    expect(names.rowName({ table: 'entities', id: 'ent_gone' })).toBe('Old Pell')
  })
})

let nextLog = 0
function delta(over: Partial<Delta>): Delta {
  nextLog += 1
  return {
    id: `d${nextLog}`,
    branchId: 'b1',
    actionId: 'act_1',
    op: 'update',
    targetTable: 'entities',
    targetId: 'ent',
    entryId: null,
    source: 'user_edit',
    undoPayload: null,
    logPosition: nextLog,
    encodingVersion: 1,
    createdAt: 1,
    ...over,
  }
}

describe('undoConfirmRows', () => {
  // Newest first, as the log reads a group.
  const newestFirst = (...oldestFirst: Delta[]) => [...oldestFirst].reverse()

  it('lists the rows as History names them, oldest first', () => {
    const lines = undoConfirmRows(
      newestFirst(
        delta({ targetTable: 'entities', targetId: 'ent', undoPayload: { description: 'old' } }),
        delta({ op: 'create', targetTable: 'lore', targetId: 'lore1' }),
        delta({ targetTable: 'chapters', targetId: 'ch3', undoPayload: { title: 'Old' } }),
        delta({ op: 'create', targetTable: 'happening_awareness', targetId: 'aw' }),
      ),
      undoNames(rows),
      rows,
    )
    expect(lines).toEqual([
      'Tobin: Modified Description',
      'The toll: Created',
      'chapter 3: Modified',
      'Tobin · Awareness · The night crossing: Created',
    ])
  })

  it('shows five, and counts the rest, entry writes and unnamed rows included', () => {
    const many = Array.from({ length: 6 }, () =>
      delta({ op: 'create', targetTable: 'lore', targetId: 'lore1' }),
    )
    const lines = undoConfirmRows(
      newestFirst(
        ...many,
        delta({ targetTable: 'story_entries', targetId: 'e4' }),
        delta({ op: 'create', targetTable: 'branch_era_flips', targetId: 'flip' }),
      ),
      undoNames(rows),
      rows,
    )
    expect(lines).toHaveLength(6)
    expect(lines.at(-1)).toBe('and 3 more')
  })

  it('adds no count when every row is listed', () => {
    const lines = undoConfirmRows(
      [delta({ op: 'create', targetTable: 'lore', targetId: 'lore1' })],
      undoNames(rows),
      rows,
    )
    expect(lines).toEqual(['The toll: Created'])
  })
})
