import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { generateStructured, generateToolStep } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { pipelineRuns, reversalJournals, type Delta } from '@/lib/db'
import { CLOSE_PHASE, pipelineEventBus, type PipelineEvent } from '@/lib/pipeline'
import { generationStore, interruptMemoryRuns } from '@/lib/stores'

import {
  branchLog,
  closedChapterId,
  installCloseHarnessHooks,
  openHarness,
  STAND_IN_STEP,
  worldState,
  type CloseCase,
  type CloseHarness,
  type CloseMocks,
  type ScriptedStep,
} from './close-harness'
import { standInSlots } from './close-stand-in'
import { within } from './harness'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

const MOCKS: CloseMocks = {
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}

installCloseHarnessHooks(MOCKS)

// The close writes a lore row and Tobin's description; a re-run reverses them and writes them again.
const STAND_IN: CloseCase = { slots: standInSlots, steps: [STAND_IN_STEP], merge: false }

const NETWORK_FAILURE: ScriptedStep = {
  calls: [],
  failed: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
}

type Closed = { h: CloseHarness; chapterId: string; log: Delta[] }

async function closed(c: CloseCase = STAND_IN): Promise<Closed> {
  const h = await openHarness(c, MOCKS)
  await h.close()
  return { h, chapterId: closedChapterId(h), log: await branchLog(h.fx) }
}

// Armed after the close: a close runs the same phases.
function interruptOnce(phase: string, branchId: string): void {
  const off = pipelineEventBus.subscribe('phase_complete', (event) => {
    if (event.name !== phase) return
    off()
    void interruptMemoryRuns(branchId)
  })
}

function recordDeferred(): PipelineEvent[] {
  const seen: PipelineEvent[] = []
  pipelineEventBus.subscribe('run_deferred', (event) => seen.push(event))
  return seen
}

async function rerunMarker(h: CloseHarness) {
  const actionId = h.rerunActionId()
  expect(actionId, 'the re-run reserved').toEqual(expect.any(String))
  const [row] = await h.fx.ctx.db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.actionId, actionId!))
  return row
}

// AC 9: the close as it stood before the re-run, its log positions included.
async function expectCloseAsItWas({ h, log }: Closed): Promise<void> {
  expect(await worldState(h.fx)).toEqual(h.closed().state)
  expect(await branchLog(h.fx)).toEqual(log)
  expect(await h.fx.ctx.db.select().from(reversalJournals)).toEqual([])
  expect(generationStore.getTxState().pendingRerun.has(h.fx.branchId)).toBe(false)
  expect(generationStore.getTxState().deferred.has(h.fx.branchId)).toBe(false)
}

describe('a re-run that stops (AC 9)', () => {
  it('restores the close when aborted after its reversal, before any write of its own', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    interruptOnce(CLOSE_PHASE.reversal, c.h.fx.branchId)

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(end.result).not.toHaveProperty('closeUndone')
    await expectCloseAsItWas(c)
    // The reversal committed: its transaction wrote the marker's column.
    expect(await rerunMarker(c.h)).toMatchObject({
      outcome: 'aborted',
      rerunChapterId: c.chapterId,
    })
    expect(deferred).toEqual([])
  })

  it('restores the close when aborted after its first write', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    c.h.onNextToolGroup(() => {
      void interruptMemoryRuns(c.h.fx.branchId)
    })

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(c.h.actedOn()).toEqual({ kinds: ['createLore', 'updateEntity'], landed: true })
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(end.result).not.toHaveProperty('closeUndone')
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'aborted' })
    expect(deferred).toEqual([])
  })

  it('restores the close when a tool step fails after its first write, and reports the failure', async () => {
    const c = await closed({ ...STAND_IN, rerunSteps: [STAND_IN_STEP, NETWORK_FAILURE] })
    const deferred = recordDeferred()
    const rerunGroups: string[][] = []
    pipelineEventBus.subscribe('delta_group_emitted', (event) => {
      rerunGroups.push(event.actions.map((a) => a.kind))
    })

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(rerunGroups).toEqual([['createLore', 'updateEntity']])
    expect(end).toMatchObject({
      kind: CHAPTER_CLOSE_KIND,
      result: { outcome: 'failed', error: { kind: 'provider', reason: 'network' } },
    })
    expect(end.result).not.toHaveProperty('closeUndone')
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'failed' })
    expect(deferred).toEqual([])
  })

  it('writes nothing and finds no journal when aborted before its reversal', async () => {
    const c = await closed()
    const deferred = recordDeferred()
    interruptOnce(CLOSE_PHASE.metadata, c.h.fx.branchId)

    const end = await within(c.h.rerun(c.chapterId), 'the re-run')

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    await expectCloseAsItWas(c)
    expect(await rerunMarker(c.h)).toMatchObject({ outcome: 'aborted', rerunChapterId: null })
    expect(deferred).toEqual([])
  })
})
