import { describe, expect, it } from 'vitest'

import { closeReportSchema } from '@/lib/db/story-entries/close-report'
import { makeLogger } from '@/lib/diagnostics'

import { closeReportOf, closeReportPhase } from './chapter-close-report'
import {
  CLOSE_LEDGER_INTERMEDIATE_KEY,
  CLOSE_RANGE_INTERMEDIATE_KEY,
  type CloseLedger,
  type CloseRange,
} from './intermediates'
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
})

describe('closeReportPhase', () => {
  // chapter-close.md → Logs and anchors: anchored on the end entry, like every write of the close.
  it('writes the report as one updateChapter on the end entry', async () => {
    const { events, result } = await drain(phaseCtx({ [CLOSE_RANGE_INTERMEDIATE_KEY]: RANGE }))

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
    const { events } = await drain(
      phaseCtx({ [CLOSE_RANGE_INTERMEDIATE_KEY]: RANGE, [CLOSE_LEDGER_INTERMEDIATE_KEY]: LEDGER }),
    )
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
    const { events, result } = await drain(
      phaseCtx({ [CLOSE_RANGE_INTERMEDIATE_KEY]: RANGE }, controller.signal),
    )
    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
  })
})
