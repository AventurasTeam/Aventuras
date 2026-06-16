import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deltas, pipelineRuns } from '@/lib/db'
import {
  definePipeline,
  pipelineEventBus,
  runPipeline,
  type PhaseFn,
  type PipelineEvent,
} from '@/lib/pipeline'
import { hydrateAppSettings } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

const WIRED_CONFIG = {
  providers: [
    {
      id: 'prov-1',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://x/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'np',
      kind: 'narrative',
      name: 'Narrative',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
    },
  ],
  assignments: {},
  defaultProviderId: 'prov-1',
}

describe('runPipeline config pre-flight', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('halts before phase 0 when a declared resolver is broken', async () => {
    const { db, ctx } = await makeHarness()
    await hydrateAppSettings(async () => ({ ...WIRED_CONFIG, profiles: [] })) // no narrative profile

    let phaseStarted = false
    const phase: PhaseFn = async function* () {
      phaseStarted = true
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'pf-turn',
      phases: [{ name: 'narrative', run: phase, resolves: [{ target: 'narrative' }] }],
      ...base,
    })

    let complete: Extract<PipelineEvent, { type: 'run_complete' }> | undefined
    const off = pipelineEventBus.subscribe('run_complete', (e) => {
      complete = e as Extract<PipelineEvent, { type: 'run_complete' }>
    })
    const result = expectRan(await runPipeline('pf-turn', ctx))
    off()

    expect(phaseStarted).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(result.error).toMatchObject({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'narrative',
    })
    expect(complete?.outcome).toBe('failed')
    expect(complete?.error).toMatchObject({ kind: 'config-resolver', target: 'narrative' })

    // No deltas; the only side effect is the normal failed pipeline_runs marker.
    expect((await db.select().from(deltas)).length).toBe(0)
    const [pr] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, result.runId))
    expect(pr.outcome).toBe('failed')
    expect(pr.finishedAt).not.toBeNull()
  })

  it('proceeds into phase 0 when config is valid', async () => {
    const { ctx } = await makeHarness()
    await hydrateAppSettings(async () => WIRED_CONFIG)

    let phaseStarted = false
    const phase: PhaseFn = async function* () {
      phaseStarted = true
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'pf-turn-ok',
      phases: [{ name: 'narrative', run: phase, resolves: [{ target: 'narrative' }] }],
      ...base,
    })

    const result = expectRan(await runPipeline('pf-turn-ok', ctx))
    expect(phaseStarted).toBe(true)
    expect(result.outcome).toBe('completed')
  })
})
