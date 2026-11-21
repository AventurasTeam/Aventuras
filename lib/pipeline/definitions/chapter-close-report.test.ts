import { describe, expect, it } from 'vitest'

import { closeReportSchema } from '@/lib/db/story-entries/close-report'
import { makeLogger } from '@/lib/diagnostics'

import { closeReportOf, closeReportPhase } from './chapter-close-report'
import { seedCloseLedger, setCloseFloor, setCloseRange } from './close-intermediates'
import type { CloseLedger, CloseRange } from './intermediates'
import type { PhaseContext } from '../types'

const RANGE: CloseRange = {
  chapterId: 'chap_11111111-1111-4111-8111-111111111111',
  startEntryId: 'e1',
  endEntryId: 'e5',
}

const LEDGER: CloseLedger = {
  calls: [
    {
      task: 'identity',
      part: 1,
      tool: 'update_character',
      rows: [{ table: 'entities', id: 'char_22222222-2222-4222-8222-222222222222', name: 'Kael' }],
      why: 'Kael lost the sigil at the ford.',
      turns: ['e3'],
      result: 'ok',
      values: { description: 'A courier who lost his sigil at the ford.' },
    },
  ],
  stopped: [{ task: 'lore', part: 1, reason: 'budget' }],
  noToolCalls: false,
}

// A run's record once the range is parked and, given a ledger, the agent has written it.
function parked(ledger?: CloseLedger): Record<string, unknown> {
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, RANGE)
  if (ledger) {
    const live = seedCloseLedger(intermediates)
    live.calls.push(...ledger.calls)
    live.stopped.push(...ledger.stopped)
    live.noToolCalls = ledger.noToolCalls
  }
  return intermediates
}

function phaseCtx(
  intermediates: Record<string, unknown>,
  abortSignal: AbortSignal = new AbortController().signal,
): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal,
    intermediates,
    log: makeLogger('act_close'),
    db: {} as PhaseContext['db'],
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
  }
}

async function drain(ctx: PhaseContext) {
  const gen = closeReportPhase(ctx)
  const events: unknown[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

describe('closeReportOf', () => {
  it('reads an absent ledger as a close that called no tool', () => {
    const report = closeReportOf(undefined, 'act_close')
    expect(report).toEqual({
      version: 1,
      actionId: 'act_close',
      calls: [],
      stopped: [],
      noToolCalls: true,
    })
    expect(closeReportSchema.safeParse(report).success).toBe(true)
  })

  it("carries a ledger's calls and stops, adding the version and the close's action", () => {
    const report = closeReportOf(LEDGER, 'act_close')
    expect(report).toEqual({ version: 1, actionId: 'act_close', ...LEDGER })
    expect(closeReportSchema.safeParse(report).success).toBe(true)
  })

  it("records a re-run's first log position, and the schema keeps it", () => {
    const report = closeReportOf(undefined, 'act_rerun', 41)
    expect(report).toEqual({
      version: 1,
      actionId: 'act_rerun',
      calls: [],
      stopped: [],
      noToolCalls: true,
      firstLogPosition: 41,
    })
    expect(closeReportSchema.parse(report).firstLogPosition).toBe(41)
  })
})

describe('closeReportPhase', () => {
  // chapter-close.md → Logs and anchors: anchored on the end entry, like every write of the close.
  it('writes the report as one updateChapter on the end entry', async () => {
    const { events, result } = await drain(phaseCtx(parked()))

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([
      {
        type: 'delta_emitted',
        action: {
          kind: 'updateChapter',
          source: 'chapter_close',
          payload: {
            branchId: 'b1',
            id: RANGE.chapterId,
            patch: {
              closeReport: {
                version: 1,
                actionId: 'act_close',
                calls: [],
                stopped: [],
                noToolCalls: true,
              },
            },
          },
        },
        entryId: 'e5',
      },
    ])
  })

  it('writes the ledger the agent parked', async () => {
    const { events } = await drain(phaseCtx(parked(LEDGER)))
    expect(events).toMatchObject([
      {
        action: {
          payload: { patch: { closeReport: { version: 1, actionId: 'act_close', ...LEDGER } } },
        },
      },
    ])
  })

  it('fails as an orchestrator fault when no range is parked', async () => {
    const { events, result } = await drain(phaseCtx({}))
    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    })
    expect(events).toEqual([])
  })

  it('writes nothing once the run is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { events, result } = await drain(phaseCtx(parked(), controller.signal))
    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
  })

  // C4: under the gate a re-run's own writes start right above the floor its reversal left.
  it.each([
    [40, 41],
    [0, 1],
  ])("records a re-run's floor %i as its first log position %i", async (floor, first) => {
    const intermediates = parked()
    setCloseFloor(intermediates, floor)
    const { events } = await drain(phaseCtx(intermediates))
    expect(events).toMatchObject([
      { action: { payload: { patch: { closeReport: { firstLogPosition: first } } } } },
    ])
  })

  it('records no first log position for a close', async () => {
    const { events } = await drain(phaseCtx(parked()))
    const [event] = events as { action: { payload: { patch: { closeReport: object } } } }[]
    expect(event?.action.payload.patch.closeReport).not.toHaveProperty('firstLogPosition')
  })
})
