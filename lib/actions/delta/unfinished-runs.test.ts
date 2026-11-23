import { describe, expect, it } from 'vitest'

import { branches, pipelineRuns, stories, type NewPipelineRun } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readUnfinishedRuns } from './unfinished-runs'

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

async function twoBranches(): Promise<Db> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_a', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'br_b', storyId: 's1', name: 'fork', parentBranchId: 'br_a', createdAt: 2 },
  ])
  return db
}

const run = (
  row: Pick<NewPipelineRun, 'runId' | 'actionId'> & Partial<NewPipelineRun>,
): NewPipelineRun => ({ kind: 'per-turn', storyId: 's1', startedAt: 10, ...row })

describe('readUnfinishedRuns', () => {
  it('returns the branch’s unfinished runs with their kind, action and re-run chapter', async () => {
    const db = await twoBranches()
    await db.insert(pipelineRuns).values([
      run({
        runId: 'run_rerun',
        actionId: 'act_rerun',
        branchId: 'br_a',
        kind: 'chapter-close',
        rerunChapterId: 'chap_1',
        startedAt: 11,
      }),
      run({ runId: 'run_turn', actionId: 'act_turn', branchId: 'br_a', startedAt: 10 }),
    ])

    expect(await readUnfinishedRuns('br_a', { db })).toEqual([
      { runId: 'run_turn', kind: 'per-turn', actionId: 'act_turn', rerunChapterId: null },
      {
        runId: 'run_rerun',
        kind: 'chapter-close',
        actionId: 'act_rerun',
        rerunChapterId: 'chap_1',
      },
    ])
  })

  it('leaves out the branch’s finished runs', async () => {
    const db = await twoBranches()
    await db.insert(pipelineRuns).values([
      run({ runId: 'run_open', actionId: 'act_open', branchId: 'br_a' }),
      run({
        runId: 'run_done',
        actionId: 'act_done',
        branchId: 'br_a',
        finishedAt: 20,
        outcome: 'completed',
      }),
      run({
        runId: 'run_recovered',
        actionId: 'act_recovered',
        branchId: 'br_a',
        finishedAt: 21,
        outcome: 'recovered',
      }),
    ])

    expect((await readUnfinishedRuns('br_a', { db })).map((r) => r.runId)).toEqual(['run_open'])
  })

  it('leaves out another branch’s runs and a run that records no branch', async () => {
    const db = await twoBranches()
    await db
      .insert(pipelineRuns)
      .values([
        run({ runId: 'run_a', actionId: 'act_a', branchId: 'br_a' }),
        run({ runId: 'run_b', actionId: 'act_b', branchId: 'br_b' }),
        run({ runId: 'run_none', actionId: 'act_none' }),
      ])

    expect((await readUnfinishedRuns('br_a', { db })).map((r) => r.runId)).toEqual(['run_a'])
    expect((await readUnfinishedRuns('br_b', { db })).map((r) => r.runId)).toEqual(['run_b'])
  })
})
