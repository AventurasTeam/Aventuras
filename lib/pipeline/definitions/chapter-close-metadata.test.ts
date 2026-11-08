import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionOutcome, GroupOutcome, PipelineAction } from '@/lib/actions/types'
import type { OpenRegionRow, StoryEntry } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'

import { createPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { closeMetadataPhase, closeSeriesThrough } from './chapter-close-metadata'
import type { MetadataCallOutcome, requestChapterMetadata } from './chapter-close-metadata-call'
import { normalizeChapterMetadata } from './chapter-metadata-schema'
import { setCloseRange } from './close-intermediates'
import type { CloseRange } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PipelineError } from '../types'

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<typeof requestChapterMetadata>(),
}))

// The call has its own tests; here it only hands the phase an outcome.
vi.mock('./chapter-close-metadata-call', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestChapterMetadata: requestMock,
}))

const NOW = 1_767_225_605_000

const METADATA = normalizeChapterMetadata({
  title: 'The Crossing at Harrow',
  summary: 'Wren talks the ferryman into a night crossing and lands under the Syndicate toll.',
  theme: 'a guarded passage',
  keywords: ['harrow', 'ferry', 'syndicate'],
})

const RANGE: CloseRange = { chapterId: 'chap_new', startEntryId: 'e1', endEntryId: 'e7' }

type Row = {
  id: string
  position: number
  kind: StoryEntry['kind']
  tokens: number | null
  chapterId?: string
}

// e1 to e7 are the range; e8 and e9 sit past its end.
const ROWS: readonly Row[] = [
  { id: 'e1', position: 1, kind: 'opening', tokens: 40 },
  { id: 'e2', position: 2, kind: 'user_action', tokens: 8 },
  { id: 'e3', position: 3, kind: 'ai_reply', tokens: 30 },
  { id: 'e4', position: 4, kind: 'user_action', tokens: 9 },
  { id: 'e5', position: 5, kind: 'ai_reply', tokens: 31 },
  { id: 'e6', position: 6, kind: 'user_action', tokens: 7 },
  { id: 'e7', position: 7, kind: 'ai_reply', tokens: 29 },
  { id: 'e8', position: 8, kind: 'user_action', tokens: 6 },
  { id: 'e9', position: 9, kind: 'ai_reply', tokens: 33 },
]
// 40 + 8 + 30 + 9 + 31 + 7 + 29: positions 1 through 7 only.
const RANGE_TOKENS = 154

let phaseDb: PhaseDb

beforeEach(async () => {
  requestMock.mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  phaseDb = await createPhaseDb()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function insertEntries(rows: readonly Row[]): void {
  const stmt = phaseDb.sqlite.prepare(
    `INSERT INTO story_entries
       (id, branch_id, position, kind, content, content_tokens, chapter_id, metadata, created_at)
     VALUES (?, 'b1', ?, ?, ?, ?, ?, NULL, ?)`,
  )
  for (const row of rows)
    stmt.run(
      row.id,
      row.position,
      row.kind,
      `Entry ${row.position}: the ferry waits below the town in the rain.`,
      row.tokens,
      row.chapterId ?? null,
      row.position,
    )
}

function insertChapter(id: string, branchId: string, sequenceNumber: number): void {
  phaseDb.sqlite
    .prepare(
      `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme,
         start_entry_id, end_entry_id, token_count, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Before', 'An earlier stretch of road.', 'prologue', 'x1', 'x2', 10, 1, 1, 1)`,
    )
    .run(id, branchId, sequenceNumber)
}

function phaseCtx(opts: { range?: CloseRange | null; signal?: AbortSignal } = {}): PhaseContext {
  const range = opts.range === undefined ? RANGE : opts.range
  const intermediates: Record<string, unknown> = {}
  if (range) setCloseRange(intermediates, range)
  return {
    actionId: 'act_close',
    abortSignal: opts.signal ?? new AbortController().signal,
    intermediates,
    log: makeLogger('act_close'),
    db: phaseDb.db,
    runInTransaction: phaseDb.runInTransaction,
    storyId: 's1',
    branchId: 'b1',
  }
}

function callReturns(
  outcome: MetadataCallOutcome,
  opts: { events?: readonly PhaseEmittedEvent[]; beforeReturn?: () => void } = {},
): void {
  requestMock.mockImplementation(async function* () {
    for (const event of opts.events ?? []) yield event
    opts.beforeReturn?.()
    return outcome
  })
}

type GroupEvent = Extract<PhaseEmittedEvent, { type: 'delta_group_emitted' }>

const allLanded = (event: GroupEvent): GroupOutcome => ({
  status: 'ok',
  outcomes: event.actions.map((): ActionOutcome => ({ status: 'landed' })),
})

// Answers each group as the orchestrator would; by default every action lands.
async function drain(ctx: PhaseContext, answer: (event: GroupEvent) => GroupOutcome = allLanded) {
  const gen = closeMetadataPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
    reply = next.value.type === 'delta_group_emitted' ? answer(next.value) : undefined
  }
}

const groupOf = (events: readonly PhaseEmittedEvent[]): GroupEvent | undefined =>
  events.find((e): e is GroupEvent => e.type === 'delta_group_emitted')

const stampedIds = (events: readonly PhaseEmittedEvent[]): string[] =>
  (groupOf(events)?.actions ?? []).flatMap((a) =>
    a.kind === 'stampEntryChapter' ? [a.payload.id] : [],
  )

function createdChapter(events: readonly PhaseEmittedEvent[]) {
  for (const a of groupOf(events)?.actions ?? [])
    if (a.kind === 'createChapter') return a.payload.entry
  return undefined
}

const stampOf = (id: string): PipelineAction => ({
  kind: 'stampEntryChapter',
  source: 'chapter_close',
  payload: { branchId: 'b1', id, chapterId: 'chap_new' },
})

describe('closeSeriesThrough', () => {
  const series: OpenRegionRow[] = [
    { id: 'a', kind: 'opening', position: 1, tokens: 5 },
    { id: 'b', kind: 'user_action', position: 2, tokens: 3 },
    { id: 'c', kind: 'ai_reply', position: 3, tokens: 4 },
  ]

  it('cuts the series after the end entry', () => {
    expect(closeSeriesThrough(series, 'b')).toEqual([series[0], series[1]])
  })

  it('keeps the whole series when the end is its last row', () => {
    expect(closeSeriesThrough(series, 'c')).toEqual(series)
  })

  it('returns null for an end the series lacks', () => {
    expect(closeSeriesThrough(series, 'z')).toBeNull()
  })
})

describe('closeMetadataPhase', () => {
  it('writes the row, then a stamp per entry through the end, as one group on the end', async () => {
    insertEntries(ROWS)
    callReturns({ status: 'ok', metadata: METADATA })

    const ctx = phaseCtx()
    const { events, result } = await drain(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(requestMock).toHaveBeenCalledWith(ctx, RANGE)
    expect(events).toEqual([
      {
        type: 'delta_group_emitted',
        entryId: 'e7',
        actions: [
          {
            kind: 'createChapter',
            source: 'chapter_close',
            payload: {
              entry: {
                id: 'chap_new',
                branchId: 'b1',
                sequenceNumber: 1,
                title: METADATA.title,
                summary: METADATA.summary,
                theme: METADATA.theme,
                keywords: METADATA.keywords,
                startEntryId: 'e1',
                endEntryId: 'e7',
                tokenCount: RANGE_TOKENS,
                closedAt: NOW,
                createdAt: NOW,
                updatedAt: NOW,
              },
            },
          },
          ...['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'].map(stampOf),
        ],
      },
    ])
  })

  it("numbers the chapter one past the branch's highest, not another branch's", async () => {
    insertEntries(ROWS)
    insertChapter('chap_a', 'b1', 3)
    insertChapter('chap_b', 'b2', 9)
    callReturns({ status: 'ok', metadata: METADATA })

    const { events } = await drain(phaseCtx())

    expect(createdChapter(events)).toMatchObject({ sequenceNumber: 4 })
  })

  it('stamps no system row and counts none, as the open region holds none', async () => {
    insertEntries(
      ROWS.map((row): Row => (row.id === 'e4' ? { ...row, kind: 'system', tokens: null } : row)),
    )
    callReturns({ status: 'ok', metadata: METADATA })

    const { events } = await drain(phaseCtx())

    expect(stampedIds(events)).toEqual(['e1', 'e2', 'e3', 'e5', 'e6', 'e7'])
    expect(createdChapter(events)).toMatchObject({ tokenCount: RANGE_TOKENS - 9 })
  })

  it("hands the call's own events on ahead of the group", async () => {
    insertEntries(ROWS)
    const retried: PhaseEmittedEvent = {
      type: 'recoverable_error',
      error: { kind: 'phase-logic', detail: 'the reply held no JSON object' },
    }
    callReturns({ status: 'ok', metadata: METADATA }, { events: [retried] })

    const { events } = await drain(phaseCtx())

    expect(events[0]).toEqual(retried)
    expect(events.slice(1).map((e) => e.type)).toEqual(['delta_group_emitted'])
    expect(groupOf(events)?.actions.map((a) => a.kind)).toEqual([
      'createChapter',
      ...Array.from({ length: 7 }, () => 'stampEntryChapter'),
    ])
  })

  const CALL_FAILURE: PipelineError = {
    kind: 'provider',
    reason: 'network',
    detail: 'connect ECONNREFUSED',
  }

  it.each([
    ['fails', { status: 'failed', error: CALL_FAILURE }, { status: 'failed', error: CALL_FAILURE }],
    ['is cancelled', { status: 'aborted' }, { status: 'aborted' }],
  ] as const)('writes nothing when the call %s', async (_label, outcome, expected) => {
    insertEntries(ROWS)
    callReturns(outcome)

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual(expected)
    expect(events).toEqual([])
  })

  it('writes nothing when cancelled after the call returns, before the group', async () => {
    insertEntries(ROWS)
    const controller = new AbortController()
    callReturns({ status: 'ok', metadata: METADATA }, { beforeReturn: () => controller.abort() })

    const { events, result } = await drain(phaseCtx({ signal: controller.signal }))

    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
  })

  // The group commits whole; the orchestrator reverses it at the next phase boundary.
  it('completes when cancelled once the group is out', async () => {
    insertEntries(ROWS)
    callReturns({ status: 'ok', metadata: METADATA })
    const controller = new AbortController()

    const { events, result } = await drain(phaseCtx({ signal: controller.signal }), (event) => {
      controller.abort()
      return allLanded(event)
    })

    expect(result).toEqual({ status: 'completed' })
    expect(events.map((e) => e.type)).toEqual(['delta_group_emitted'])
  })

  it('fails as action-layer, naming the group, when the group is refused whole', async () => {
    insertEntries(ROWS)
    callReturns({ status: 'ok', metadata: METADATA })

    const { events, result } = await drain(phaseCtx(), () => ({
      status: 'rejected',
      reason: 'group writes story_entries:e3 twice on one column',
    }))

    expect(events.map((e) => e.type)).toEqual(['delta_group_emitted'])
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail:
          'chapter-close: group not applied: group writes story_entries:e3 twice on one column',
      },
    })
  })

  // A row over a partly stamped range is never left standing, whatever the noop.
  it.each([
    ['the create', 0, 'createChapter'],
    ['a stamp', 3, 'stampEntryChapter'],
  ] as const)('fails as action-layer when %s noops', async (_label, index, kind) => {
    insertEntries(ROWS)
    callReturns({ status: 'ok', metadata: METADATA })

    const { result } = await drain(phaseCtx(), (event) => ({
      status: 'ok',
      outcomes: event.actions.map(
        (_action, i): ActionOutcome =>
          i === index
            ? { status: 'noop', reason: 'already stamped', mark: 'restated' }
            : { status: 'landed' },
      ),
    }))

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail: `chapter-close: ${kind} not applied: already stamped`,
      },
    })
  })

  it('fails as action-layer when the group answers fewer outcomes than actions', async () => {
    insertEntries(ROWS)
    callReturns({ status: 'ok', metadata: METADATA })

    const { result } = await drain(phaseCtx(), (event) => ({
      status: 'ok',
      outcomes: event.actions.slice(0, -1).map((): ActionOutcome => ({ status: 'landed' })),
    }))

    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail: 'chapter-close: group not applied: 7 outcomes for 8 actions',
      },
    })
  })

  it('fails without a range and makes no call', async () => {
    insertEntries(ROWS)

    const { events, result } = await drain(phaseCtx({ range: null }))

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    })
    expect(events).toEqual([])
    expect(requestMock).not.toHaveBeenCalled()
  })

  it.each([
    ['is gone', ROWS, 'e_gone'],
    [
      'is already stamped',
      ROWS.map((row): Row => (row.id === 'e7' ? { ...row, chapterId: 'chap_old' } : row)),
      'e7',
    ],
  ] as const)(
    'fails as phase-logic, writing nothing, when the end %s',
    async (_label, rows, endEntryId) => {
      insertEntries(rows)
      callReturns({ status: 'ok', metadata: METADATA })

      const { events, result } = await drain(phaseCtx({ range: { ...RANGE, endEntryId } }))

      expect(result).toEqual({
        status: 'failed',
        error: {
          kind: 'phase-logic',
          phaseName: 'metadata',
          detail: `chapter-close: end entry ${endEntryId} is not in the open region`,
        },
      })
      expect(events).toEqual([])
    },
  )
})
