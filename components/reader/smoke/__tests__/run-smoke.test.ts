import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetTemporaryProvidersForTests } from '@/lib/ai/temporary-registry'
import { branches, deltas, pipelineRuns, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  __resetDiagnosticsGate,
  clearBuffers,
  clearCurrentActionId,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
} from '@/lib/diagnostics'
import { __resetBus, __resetRegistry, pipelineEventBus } from '@/lib/pipeline'
import { domain } from '@/lib/stores'
import { toastStore } from '@/lib/toast'

import { runSmoke } from '../run-smoke'
import { SMOKE_BRANCH_ID, SMOKE_STORY_ID } from '../smoke-pipeline'

beforeEach(() => {
  __resetRegistry()
  __resetBus()
  domain.__reset()
  clearCurrentActionId()
  clearBuffers()
  resetTemporaryProvidersForTests()
  toastStore.__reset()
  configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
})

afterEach(() => {
  __resetDiagnosticsGate()
  vi.unstubAllGlobals()
})

describe('runSmoke', () => {
  it('runs the smoke pipeline end-to-end against a fresh db', async () => {
    const { db, runInTransaction } = await createTestDb()

    const events: string[] = []
    let sizeDuring = 0
    pipelineEventBus.subscribeAll((e) => {
      events.push(e.type)
      if (e.type === 'run_start') sizeDuring = domain.getTxState().runs.size
    })

    const seen: { severity: string }[] = []
    toastStore.subscribe((list) => {
      if (list.length) seen.push(list[list.length - 1])
    })

    const result = await runSmoke({ db, runInTransaction })
    expect(result?.outcome).toBe('completed')

    const [story] = await db.select().from(stories).where(eq(stories.id, SMOKE_STORY_ID))
    expect(story?.title).toBe('Smoke test story')
    const [branch] = await db.select().from(branches).where(eq(branches.id, SMOKE_BRANCH_ID))
    expect(branch?.name).toBe('main')

    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, result!.runId))
    expect(run.outcome).toBe('completed')
    expect(run.finishedAt).not.toBeNull()

    const deltaRows = await db.select().from(deltas).where(eq(deltas.branchId, SMOKE_BRANCH_ID))
    expect(deltaRows).toHaveLength(1)
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, SMOKE_BRANCH_ID))
    expect(entryRows).toHaveLength(1)

    const snap = getDiagnosticsSnapshot()
    expect(snap.httpCalls.some((c) => c.actionId === result!.actionId)).toBe(true)
    expect(snap.logEntries.some((l) => l.level === 'warn')).toBe(true)
    expect(
      snap.turnCaptures.some((t) => t.actionId === result!.actionId && t.outcome === 'completed'),
    ).toBe(true)

    expect(sizeDuring).toBeGreaterThan(0)
    expect(domain.getTxState().runs.size).toBe(0)
    expect(events).toContain('run_start')
    expect(events).toContain('run_complete')

    expect(seen.some((t) => t.severity === 'success')).toBe(true)
  })

  it('no-ops in production builds', async () => {
    vi.stubGlobal('__DEV__', false)
    const { db, runInTransaction } = await createTestDb()

    const result = await runSmoke({ db, runInTransaction })

    expect(result).toBeNull()
    expect(await db.select().from(pipelineRuns)).toHaveLength(0)
    expect(await db.select().from(stories)).toHaveLength(0)
  })
})
