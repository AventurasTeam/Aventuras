import { describe, it, expect, vi, beforeEach } from 'vitest'

// Statement builders return a tag naming the call, so the transaction can be read back.
const { tag } = vi.hoisted(() => ({
  tag:
    (name: string) =>
    (...args: unknown[]) => ({ sql: name, params: args }),
}))

vi.mock('./database', () => ({
  database: {
    transaction: vi.fn(),
    deleteWorldStateSnapshotsAfter: vi.fn(),
    cleanupNoopOverrides: vi.fn().mockResolvedValue(0),
    saveTimeTrackerStatement: tag('saveTimeTracker'),
    clearTimeTrackerStatement: tag('clearTimeTracker'),
    deleteCharacterStatement: tag('deleteCharacter'),
    deleteLocationStatement: tag('deleteLocation'),
    deleteItemStatement: tag('deleteItem'),
    deleteStoryBeatStatement: tag('deleteStoryBeat'),
    deleteEntryStatement: tag('deleteEntry'),
    markCharacterDeletedStatement: tag('markCharacterDeleted'),
    markLocationDeletedStatement: tag('markLocationDeleted'),
    markItemDeletedStatement: tag('markItemDeleted'),
    markStoryBeatDeletedStatement: tag('markStoryBeatDeleted'),
    markEntryDeletedStatement: tag('markEntryDeleted'),
    updateCharacterStatement: tag('updateCharacter'),
    updateLocationStatement: tag('updateLocation'),
    updateItemStatement: tag('updateItem'),
    updateStoryBeatStatement: tag('updateStoryBeat'),
    updateEntryStatement: tag('updateEntry'),
    addCharacterStatement: tag('addCharacter'),
    addLocationStatement: tag('addLocation'),
    addItemStatement: tag('addItem'),
    addStoryBeatStatement: tag('addStoryBeat'),
    addEntryStatement: tag('addEntry'),
    clearTombstoneStatement: tag('clearTombstone'),
    worldStateRecordStatement: tag('record'),
    deleteWorldStateRecordsStatements: (ids: string[]) => [{ sql: 'deleteRecords', params: [ids] }],
    deleteWorldStateSnapshotsStatements: (ids: string[]) => [
      { sql: 'deleteSnapshots', params: [ids] },
    ],
  },
}))

import { chapterLoreStatements, rollbackService, type RollbackInput } from './rollbackService'
import { database } from './database'
import { fromWorldStateDelta, planChapterLoreRevert } from './stateTracking'
import type { StoryEntry, WorldStateDelta, WorldStateRecord } from '#lib/types/index.ts'

function statements(): { sql: string; params: unknown[] }[] {
  return vi.mocked(database.transaction).mock.calls[0][0] as never
}

const state = {
  characters: [
    { id: 'c-old', name: 'Aria', status: 'active', relationship: 'rival', traits: [] },
    { id: 'c-new', name: 'New' },
  ],
  locations: [
    { id: 'loc-1', current: false },
    { id: 'loc-2', current: true },
  ],
  items: [],
  storyBeats: [],
  lorebookEntries: [{ id: 'lore', description: 'later' }],
  timeTracker: { years: 0, days: 3, hours: 0, minutes: 0 },
} as unknown as RollbackInput['state']

const legacyEntry = {
  id: 'e5',
  storyId: 'story-1',
  branchId: null,
  position: 5,
  type: 'narration',
  content: 'Entry 5',
  createdAt: 5,
} as unknown as StoryEntry

// Entry 5's history as migration 041 stores an old delta that moved the scene to loc-2.
const legacyRecords = fromWorldStateDelta(legacyEntry, {
  classificationResult: {},
  createdEntities: { characterIds: ['c-new'], locationIds: [], itemIds: [], storyBeatIds: [] },
  previousState: {
    characters: [
      {
        id: 'c-old',
        name: 'Aria',
        status: 'active',
        relationship: 'ally',
        traits: ['brave'],
        visualDescriptors: {},
      },
    ],
    locations: [{ id: 'loc-2', name: 'Docks', visited: true, current: false, description: null }],
    items: [],
    storyBeats: [],
    currentLocationId: 'loc-1',
    timeTracker: null,
  },
} as WorldStateDelta)

function input(overrides: Partial<RollbackInput>): RollbackInput {
  return {
    storyId: 'story-1',
    branchId: null,
    fromPosition: 5,
    entries: [legacyEntry],
    state,
    records: legacyRecords,
    keep: { manual: false, tidy: false },
    ...overrides,
  }
}

describe('RollbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes nothing when no entry is at or after the position', async () => {
    const summary = await rollbackService.rollbackFromPosition(input({ fromPosition: 9 }))
    expect(summary.entriesProcessed).toBe(0)
    expect(statements()).toEqual([])
  })

  it('undoes history converted from an old delta in one transaction', async () => {
    const summary = await rollbackService.rollbackFromPosition(input({}))

    expect(summary.entriesWithRecords).toBe(1)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    const sql = statements()
    expect(sql).toContainEqual({ sql: 'deleteCharacter', params: ['c-new'] })
    expect(sql).toContainEqual({
      sql: 'updateCharacter',
      params: ['c-old', expect.objectContaining({ relationship: 'ally' })],
    })
    expect(sql).toContainEqual({ sql: 'updateLocation', params: ['loc-1', { current: true }] })
    expect(sql).toContainEqual({
      sql: 'updateLocation',
      params: ['loc-2', expect.objectContaining({ current: false })],
    })
    expect(sql).toContainEqual({ sql: 'clearTimeTracker', params: ['story-1'] })
  })

  it('undoes change records, the lorebook included', async () => {
    const records: WorldStateRecord[] = [
      {
        id: 'r1',
        storyId: 'story-1',
        branchId: null,
        entryId: 'e6',
        seq: 1,
        createdAt: 6,
        kind: 'change',
        origin: 'classifier',
        entityType: 'lorebook_entry',
        entityId: 'lore',
        op: 'update',
        before: { description: 'earlier' },
        after: null,
      },
    ]
    const day = (days: number) => ({ years: 0, days, hours: 0, minutes: 0 })
    const before = { ...legacyEntry, metadata: { timeEnd: day(2) } }
    const entry = { ...legacyEntry, id: 'e6', position: 6 }
    await rollbackService.rollbackFromPosition(
      input({ entries: [before, entry], records, fromPosition: 6 }),
    )
    expect(statements()).toEqual([
      { sql: 'updateEntry', params: ['lore', { description: 'earlier' }] },
      { sql: 'saveTimeTracker', params: ['story-1', day(2)] },
    ])
  })

  it('records the kept changes again on the entry that now ends the branch', async () => {
    const before = { ...legacyEntry, id: 'e4', position: 4 }
    const edit: WorldStateRecord = {
      id: 'm1',
      storyId: 'story-1',
      branchId: null,
      entryId: 'e5',
      seq: 9,
      createdAt: 9,
      kind: 'change',
      origin: 'manual',
      entityType: 'lorebook_entry',
      entityId: 'lore',
      op: 'update',
      before: { description: 'earlier' },
      after: { description: 'later' },
    }
    await rollbackService.rollbackFromPosition(
      input({
        entries: [before, legacyEntry],
        records: [edit],
        keep: { manual: true, tidy: false },
      }),
    )
    const recorded = statements().filter((s) => s.sql === 'record')
    expect(recorded).toEqual([
      {
        sql: 'record',
        params: [expect.objectContaining({ entryId: 'e4', origin: 'manual', entityId: 'lore' })],
      },
    ])
    expect((recorded[0].params[0] as WorldStateRecord).id).not.toBe('m1')
    // A new write: it takes the revert's time, so no older full state counts it as included.
    expect((recorded[0].params[0] as WorldStateRecord).createdAt).toBeGreaterThan(9)
  })

  it('writes nothing and cleans nothing up when the transaction fails', async () => {
    vi.mocked(database.transaction).mockRejectedValueOnce(new Error('disk full'))
    await expect(rollbackService.rollbackFromPosition(input({}))).rejects.toThrow('disk full')
    expect(database.deleteWorldStateSnapshotsAfter).not.toHaveBeenCalled()
  })
})

describe('undoing a chapter lore', () => {
  const lore = (id: string, fields: Record<string, unknown> = {}) =>
    ({ id, name: id, description: `${id} now`, aliases: [], branchId: null, ...fields }) as never
  const loreState = (...entries: unknown[]) =>
    ({
      characters: [],
      locations: [],
      items: [],
      storyBeats: [],
      lorebookEntries: entries,
      timeTracker: null,
    }) as unknown as RollbackInput['state']
  let seq = 0
  const change = (
    origin: 'chapter' | 'manual' | 'tidy',
    entryId: string,
    entityId: string,
    op: 'create' | 'update',
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): WorldStateRecord => ({
    id: `r${++seq}`,
    storyId: 'story-1',
    branchId: null,
    entryId,
    seq,
    createdAt: 100 + seq,
    kind: 'change',
    origin,
    entityType: 'lorebook_entry',
    entityId,
    op,
    before,
    after,
  })
  const positions = new Map([
    ['e5', 5],
    ['e8', 8],
  ])
  const tracking = { on: true, enabledSince: 0 }

  function undo(records: WorldStateRecord[], state: RollbackInput['state']) {
    const revert = planChapterLoreRevert({
      endEntryId: 'e5',
      chapterSeq: -Infinity,
      records,
      entryPositions: positions,
      state,
      tracking,
      keep: { manual: false, tidy: false },
    })
    if (!revert.ok) throw new Error(revert.reason)
    const sql = chapterLoreStatements({
      storyId: 'story-1',
      plan: revert.plan,
      reverted: revert.reverted,
      snapshotIds: ['snap'],
    }) as never[]
    return { revert, sql }
  }

  it('removes an entry the chapter created and restores one it updated', () => {
    const records = [
      change('chapter', 'e5', 'made', 'create', null, lore('made')),
      change(
        'chapter',
        'e5',
        'kept',
        'update',
        { description: 'earlier' },
        { description: 'kept now' },
      ),
    ]
    const { sql } = undo(
      records,
      loreState(lore('made'), lore('kept', { description: 'kept now' })),
    )

    expect(sql).toContainEqual({ sql: 'deleteEntry', params: ['made'] })
    expect(sql).toContainEqual({ sql: 'updateEntry', params: ['kept', { description: 'earlier' }] })
    // The undone records leave the history, and the snapshots since that hold them go too.
    expect(sql.filter((x: { sql: string }) => x.sql === 'record')).toEqual([])
    expect(sql).toContainEqual({ sql: 'deleteRecords', params: [records.map((r) => r.id)] })
    expect(sql).toContainEqual({ sql: 'deleteSnapshots', params: [['snap']] })
  })

  it('takes a later hand edit out of the history with the chapter, so it is not listed again', () => {
    const records = [
      change(
        'chapter',
        'e5',
        'kept',
        'update',
        { description: 'earlier' },
        { description: 'kept now' },
      ),
      change(
        'manual',
        'e8',
        'kept',
        'update',
        { description: 'kept now' },
        { description: 'edited' },
      ),
    ]
    const { revert, sql } = undo(records, loreState(lore('kept', { description: 'edited' })))
    expect(revert.reverted.map((r) => r.id)).toEqual(records.map((r) => r.id))
    expect(sql).toContainEqual({ sql: 'deleteRecords', params: [records.map((r) => r.id)] })

    // A chapter cut again over the same entries: only its own lore is offered.
    const again = [
      change(
        'chapter',
        'e5',
        'kept',
        'update',
        { description: 'earlier' },
        { description: 'anew' },
      ),
    ]
    const second = planChapterLoreRevert({
      endEntryId: 'e5',
      chapterSeq: -Infinity,
      records: again,
      entryPositions: positions,
      state: loreState(lore('kept', { description: 'anew' })),
      tracking,
    })
    expect(second.ok && second.plan.manual).toEqual([])
  })

  it('undoes a later hand edit too when the reader does not keep it', () => {
    const records = [
      change(
        'chapter',
        'e5',
        'kept',
        'update',
        { description: 'earlier' },
        { description: 'kept now' },
      ),
      change(
        'manual',
        'e8',
        'kept',
        'update',
        { description: 'kept now' },
        { description: 'edited' },
      ),
    ]
    const revert = planChapterLoreRevert({
      endEntryId: 'e5',
      chapterSeq: -Infinity,
      records,
      entryPositions: positions,
      state: loreState(lore('kept', { description: 'edited' })),
      tracking,
      keep: { manual: false, tidy: false },
    })
    if (!revert.ok) throw new Error(revert.reason)
    expect(revert.plan.manual.map((r) => r.id)).toEqual([records[1].id])
    const row = revert.plan.state.lorebookEntries[0] as unknown as { description: string }
    expect(row.description).toBe('earlier')
  })

  it("names the later lore of a chapter since deleted apart from the reader's changes", () => {
    const own = change(
      'chapter',
      'e5',
      'kept',
      'update',
      { description: 'a' },
      { description: 'b' },
    )
    const orphan = change(
      'chapter',
      'e8',
      'kept',
      'update',
      { description: 'b' },
      { description: 'c' },
    )
    const revert = planChapterLoreRevert({
      endEntryId: 'e5',
      chapterSeq: -Infinity,
      records: [own, orphan],
      entryPositions: positions,
      state: loreState(lore('kept', { description: 'c' })),
      tracking,
    })
    if (!revert.ok) throw new Error(revert.reason)
    expect(revert.deletedChapters).toEqual([orphan])
    expect(revert.plan.manual).toEqual([])
    expect(revert.reverted).toEqual([own, orphan])
  })

  it('leaves out the lore of an earlier chapter that ended on the same entry', () => {
    const old = change('chapter', 'e5', 'made', 'create', null, lore('made'))
    const brk: WorldStateRecord = {
      id: 'b-old',
      storyId: 'story-1',
      branchId: null,
      entryId: 'e8',
      seq: ++seq,
      createdAt: 300,
      kind: 'break',
    }
    // The chapter is cut, and marked, after the break.
    const anew = change('chapter', 'e5', 'fresh', 'create', null, lore('fresh'))
    const query = (records: WorldStateRecord[]) =>
      planChapterLoreRevert({
        endEntryId: 'e5',
        chapterSeq: brk.seq,
        records,
        entryPositions: positions,
        state: loreState(lore('made'), lore('fresh')),
        tracking,
      })
    // Only the earlier chapter's lore: nothing of this chapter's to undo.
    expect(query([old, brk])).toEqual({ ok: false, reason: 'nothing' })
    // The break before this chapter was cut does not refuse its own lore.
    const revert = query([old, brk, anew])
    expect(revert.ok && revert.undone.map((r) => r.id)).toEqual([anew.id])
  })

  it('is refused when nothing was recorded, or recording broke since the chapter', () => {
    const query = (records: WorldStateRecord[], on = true) =>
      planChapterLoreRevert({
        endEntryId: 'e5',
        chapterSeq: -Infinity,
        records,
        entryPositions: positions,
        state: loreState(lore('made')),
        tracking: { on, enabledSince: 0 },
      })
    const made = change('chapter', 'e5', 'made', 'create', null, lore('made'))
    const brk: WorldStateRecord = {
      id: 'b',
      storyId: 'story-1',
      branchId: null,
      entryId: 'e8',
      seq: ++seq,
      createdAt: 900,
      kind: 'break',
    }
    expect(query([])).toEqual({ ok: false, reason: 'nothing' })
    expect(query([made], false)).toEqual({ ok: false, reason: 'untracked' })
    expect(query([made, brk])).toEqual({ ok: false, reason: 'interrupted' })
  })
})
