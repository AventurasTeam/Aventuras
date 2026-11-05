import { describe, expect, it } from 'vitest'

import { chapterWriteSchema } from './chapter-schema'
import { closeReportSchema, type CloseReport } from './close-report'

// Every optional field of a call present, on a landed merge and a partly landed write.
const FULL: CloseReport = {
  version: 1,
  actionId: 'act_close_1',
  calls: [
    {
      task: 'identity',
      part: 1,
      tool: 'update_entity',
      rows: [{ table: 'entities', id: 'char_1', name: 'Jim Hawkins' }],
      why: 'Jim takes the map from the captain’s chest.',
      turns: ['entry_12', 'entry_14'],
      result: 'ok',
      values: { description: 'A boy who keeps the map.', 'state.voice': 'quiet, careful' },
      skippedFields: [{ field: 'state.condition', reason: 'later-turn' }],
      survivor: { table: 'entities', id: 'char_1' },
    },
    {
      task: 'happenings',
      part: 0,
      tool: 'create_happening',
      rows: [{ table: 'happenings', id: 'hap_9', name: 'The blind man’s visit' }],
      why: 'Pew delivers the black spot.',
      turns: ['entry_20'],
      result: 'rejected',
      reason: 'USER_EDITED_SINCE_PROSE',
    },
  ],
  stopped: [{ task: 'threads', part: 2, reason: 'cut-off' }],
  noToolCalls: false,
}

const VALID_ROW = {
  sequenceNumber: 1,
  title: 'The Old Sea-dog',
  summary: 'A captain takes a room at the Admiral Benbow.',
  theme: 'arrival',
  startEntryId: 'se_1',
  endEntryId: 'se_40',
  tokenCount: 24000,
  closedAt: 100,
}

describe('closeReportSchema', () => {
  it('parses a full v1 report with every optional field', () => {
    expect(closeReportSchema.parse(FULL)).toEqual(FULL)
  })

  it('parses the empty report a task-less close writes', () => {
    const empty: CloseReport = {
      version: 1,
      actionId: 'act_close_2',
      calls: [],
      stopped: [],
      noToolCalls: true,
    }
    expect(closeReportSchema.safeParse(empty).success).toBe(true)
  })

  // C4: a later field may join v1; a reader built before it must still accept the report.
  it('accepts a field it does not know', () => {
    expect(closeReportSchema.safeParse({ ...FULL, closeMs: 1234 }).success).toBe(true)
  })

  it('refuses an unknown task', () => {
    const call = { ...FULL.calls[0], task: 'weather' }
    expect(closeReportSchema.safeParse({ ...FULL, calls: [call] }).success).toBe(false)
  })

  it('refuses an unknown result', () => {
    const call = { ...FULL.calls[0], result: 'partial' }
    expect(closeReportSchema.safeParse({ ...FULL, calls: [call] }).success).toBe(false)
  })

  it('refuses an unknown stop reason, and an unknown task on a stop', () => {
    expect(
      closeReportSchema.safeParse({
        ...FULL,
        stopped: [{ task: 'threads', part: 2, reason: 'timeout' }],
      }).success,
    ).toBe(false)
    expect(
      closeReportSchema.safeParse({
        ...FULL,
        stopped: [{ task: 'weather', part: 2, reason: 'budget' }],
      }).success,
    ).toBe(false)
  })

  it('refuses another version', () => {
    expect(closeReportSchema.safeParse({ ...FULL, version: 2 }).success).toBe(false)
  })

  // C4: parts count from 1, and 0 is the chapter-wide Happenings and Awareness.
  it.each([-1, 1.5])('refuses part %s', (part) => {
    const call = { ...FULL.calls[0], part }
    expect(closeReportSchema.safeParse({ ...FULL, calls: [call] }).success).toBe(false)
  })

  it('refuses a call missing its why', () => {
    const { why: _why, ...call } = FULL.calls[0]!
    expect(closeReportSchema.safeParse({ ...FULL, calls: [call] }).success).toBe(false)
  })
})

describe('chapterWriteSchema → closeReport', () => {
  it('accepts a report, null, and no key', () => {
    expect(chapterWriteSchema.safeParse({ ...VALID_ROW, closeReport: FULL }).success).toBe(true)
    expect(chapterWriteSchema.safeParse({ ...VALID_ROW, closeReport: null }).success).toBe(true)
    expect(chapterWriteSchema.safeParse(VALID_ROW).success).toBe(true)
  })

  it('refuses a malformed report, where the bare column would take any JSON', () => {
    expect(
      chapterWriteSchema.safeParse({ ...VALID_ROW, closeReport: { version: 1 } }).success,
    ).toBe(false)
    expect(chapterWriteSchema.safeParse({ ...VALID_ROW, closeReport: 'done' }).success).toBe(false)
  })

  it('refuses a malformed report in a partial patch', () => {
    expect(chapterWriteSchema.partial().safeParse({ closeReport: { calls: 1 } }).success).toBe(
      false,
    )
    expect(chapterWriteSchema.partial().safeParse({ closeReport: FULL }).success).toBe(true)
  })
})
