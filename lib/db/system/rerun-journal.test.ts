import { describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, reversalJournals, stories } from '../schema'
import { parseRerunJournal, type RerunJournal } from './rerun-journal'

const EARLIER: RerunJournal = {
  version: 1,
  chapterId: 'chapter_2',
  chapterNumber: 2,
  floor: 30,
  rows: [],
  deltas: [],
  journals: [],
}

// Every arm filled: an absent and a present before-image, a delta row, an earlier journal held.
const JOURNAL: RerunJournal = {
  version: 1,
  chapterId: 'chapter_2',
  chapterNumber: 2,
  floor: 41,
  rows: [
    { table: 'lore', id: 'lore_vael', before: null },
    {
      table: 'entities',
      id: 'char_tobin',
      before: {
        id: 'char_tobin',
        branchId: 'b1',
        name: 'Tobin',
        description: 'The ferryman at Harrow.',
        state: { traits: ['taciturn'], current_location_id: null },
        embeddingStale: 0,
        retiredReason: null,
      },
    },
  ],
  deltas: [
    {
      id: 'delta_38',
      branchId: 'b1',
      entryId: 'e_40',
      actionId: 'act_close_2',
      logPosition: 38,
      source: 'chapter_close',
      targetTable: 'entities',
      targetId: 'char_tobin',
      op: 'update',
      undoPayload: { description: 'A ferryman.' },
      encodingVersion: 1,
      createdAt: 1_767_225_900_000,
    },
  ],
  journals: [{ actionId: 'act_rerun_1', journal: EARLIER, createdAt: 1_767_225_950_000 }],
}

async function seededDb() {
  const t = await createTestDb()
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
  return t
}

describe('reversal_journals', () => {
  it('round-trips a journal through Drizzle and parses it back deep-equal', async () => {
    const { db } = await seededDb()
    await db
      .insert(reversalJournals)
      .values({ actionId: 'act_rerun_2', branchId: 'b1', journal: JOURNAL, createdAt: 7 })

    const rows = await db.select().from(reversalJournals)

    expect(rows).toEqual([
      { actionId: 'act_rerun_2', branchId: 'b1', journal: JOURNAL, createdAt: 7 },
    ])
    expect(parseRerunJournal(rows[0]!.journal)).toEqual(JOURNAL)
  })

  it('keeps one journal per branch and action, on a branch that exists', async () => {
    const { db, runInTransaction } = await seededDb()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 2 })
    const insert = (branchId: string) =>
      db
        .insert(reversalJournals)
        .values({ actionId: 'act_rerun_2', branchId, journal: JOURNAL, createdAt: 7 })
        .toSQL()

    await runInTransaction([insert('b1'), insert('b2')])

    await expect(runInTransaction([insert('b1')])).rejects.toThrow(/UNIQUE constraint failed/)
    await expect(runInTransaction([insert('b_missing')])).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })
})

describe('parseRerunJournal', () => {
  it('refuses an unknown version', () => {
    expect(() => parseRerunJournal({ ...JOURNAL, version: 2 })).toThrow(/version/)
  })

  it('refuses a journal missing its floor', () => {
    const { floor: _floor, ...withoutFloor } = JOURNAL
    expect(() => parseRerunJournal(withoutFloor)).toThrow(/floor/)
  })

  it('refuses a key v1 does not define', () => {
    expect(() => parseRerunJournal({ ...JOURNAL, extra: true })).toThrow(/extra/)
  })

  it('refuses a delta row with a key the deltas table does not define', () => {
    const [delta] = JOURNAL.deltas
    const deltas = [{ ...delta, extra: true }]

    expect(() => parseRerunJournal({ ...JOURNAL, deltas })).toThrow(/extra/)
  })

  it('refuses a delta row missing a column', () => {
    const { logPosition: _logPosition, ...withoutPosition } = JOURNAL.deltas[0]!

    expect(() => parseRerunJournal({ ...JOURNAL, deltas: [withoutPosition] })).toThrow(
      /logPosition/,
    )
  })

  it('refuses a held journal that is not a whole journal', () => {
    const held = { actionId: 'act_rerun_1', journal: { chapterId: 'chapter_2', floor: 30 } }

    expect(() => parseRerunJournal({ ...JOURNAL, journals: [{ ...held, createdAt: 3 }] })).toThrow(
      /version/,
    )
  })

  it('takes a dropped journal row whole and keeps no branch_id from it', () => {
    const held = { actionId: 'act_rerun_1', branchId: 'b1', journal: EARLIER, createdAt: 3 }

    expect(parseRerunJournal({ ...JOURNAL, journals: [held] }).journals).toEqual([
      { actionId: 'act_rerun_1', journal: EARLIER, createdAt: 3 },
    ])
  })
})
