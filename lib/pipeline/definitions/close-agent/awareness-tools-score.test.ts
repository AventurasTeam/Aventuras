import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  chapters,
  ensureVecTablesSql,
  packFloat32,
  sourceHash,
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  upsertVecOps,
  type ProbeCapturePayload,
} from '@/lib/db'
import { buildCapturePayload } from '@/lib/probe'
import { RANKER_DEFAULTS, runRetrieval } from '@/lib/retrieval'

import { setPinTool } from './awareness-tools'
import { runDispatchCalls } from '../__tests__/close-dispatch'
import { openCloseFixture, queryAllOn, type CloseFixture } from '../__tests__/close-fixture'
import {
  uuid,
  putCharacter,
  putHappening,
  putAwareness,
  startPinned,
} from './__tests__/awareness-tools-fixture'

// 59 closed chapters, a row learned in chapter 3 at 0.3, read at chapter 60, the open one. The pin
// reaches the score only through the decay exponent.
describe('a pin moves a score', () => {
  const DIM = 4
  const MODEL = 'pin-score-embed'
  const AXIS = Float32Array.from([1, 0, 0, 0])
  const HERO = `char_${uuid(31)}`
  const OATH = `hap_${uuid(32)}`
  const OATH_KNOWN = `haw_${uuid(33)}`
  const OATH_TITLE = 'The oath at the ford'
  const OATH_DESCRIPTION = 'Aria swore to carry the letter to Low Ashby.'
  let fx: CloseFixture

  const chapterId = (k: number): string => `chap_${uuid(1000 + k)}`

  // Chapter k holds entries[k - 1] alone, so chapter 3 is the first reply; the last two entries
  // stay open.
  async function closeFiftyNineChapters(): Promise<void> {
    for (let k = 1; k <= 59; k++) {
      const entryId = fx.entries[k - 1]!.id
      await fx.ctx.db.insert(chapters).values({
        id: chapterId(k),
        branchId: fx.branchId,
        sequenceNumber: k,
        title: `Chapter ${k}`,
        summary: 'The road goes on.',
        theme: 'the road',
        keywords: [],
        startEntryId: entryId,
        endEntryId: entryId,
        tokenCount: 1,
        closedAt: 1,
        embeddingStale: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      await fx.ctx.db
        .update(storyEntries)
        .set({ chapterId: chapterId(k) })
        .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId)))
    }
  }

  beforeEach(async () => {
    fx = await openCloseFixture({ turns: 30 })
    await closeFiftyNineChapters()
    await putCharacter(fx, HERO, 'Aria')
    await putHappening(fx, {
      id: OATH,
      title: OATH_TITLE,
      description: OATH_DESCRIPTION,
      occurredAtEntryId: fx.entries[2]!.id,
    })
    await putAwareness(fx, {
      id: OATH_KNOWN,
      characterId: HERO,
      happeningId: OATH,
      learnedAtEntryId: fx.entries[2]!.id,
      decayResistance: 0.3,
      retrievalCount: 2,
      source: 'swore it herself',
    })
    for (const ddl of ensureVecTablesSql(DIM)) await fx.ctx.db.run(sql.raw(ddl))
    await fx.ctx.runInTransaction(
      upsertVecOps(
        {
          kind: 'happening',
          id: OATH,
          branchId: fx.branchId,
          modelId: MODEL,
          dim: DIM,
          sourceHash: sourceHash(OATH_TITLE),
          vector: packFloat32(AXIS),
        },
        { fields: [OATH_TITLE, OATH_DESCRIPTION] },
      ),
    )
  }, 30_000)

  // A real pass over the fixture's rows, Aria in the scene and every query on the oath's axis;
  // the probe's capture of the oath's row.
  async function capturedOath(): Promise<ProbeCapturePayload['pools']['happenings'][number]> {
    const outcome = await runRetrieval(
      {
        queryAll: queryAllOn(fx.ctx.db),
        embedTexts: async (texts) => ({ vectors: texts.map(() => AXIS), dim: DIM }),
        loadStaleRows: async () => [],
        revalidateRows: async (rows) => ({ staleRows: rows, freshOps: [] }),
        embedRows: async () => [],
        runInTransaction: fx.ctx.runInTransaction,
      },
      {
        branchId: fx.branchId,
        modelId: MODEL,
        dim: DIM,
        budgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
        query: { userAction: 'I ask Aria about the oath.', eraName: null, piggybackSummary: null },
        sceneCharacterIds: [HERO],
        sceneEntityIds: [],
        currentLocationId: null,
        storeEntities: [],
        recentProse: '',
        scanText: '',
        keywordRetrieval: STORY_SETTINGS_DEFAULTS.keywordRetrieval,
      },
    )
    if (!outcome.ok) throw new Error(`the pass failed: ${JSON.stringify(outcome)}`)
    const capture = buildCapturePayload({
      branchId: fx.branchId,
      targetEntryId: fx.entries[60]!.id,
      chapterId: null,
      capturedAt: 1,
      embeddingModelId: MODEL,
      mode: 'light',
      params: RANKER_DEFAULTS,
      settings: {
        retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
        fullChapterInBuffer: false,
        partialChapterBuffer: 2,
        protectedBuffer: 1,
      },
      promptBufferTokens: 0,
      scanText: '',
      outcome,
    })
    const oath = capture.pools.happenings.find((row) => row.target_id === OATH)
    if (oath === undefined) throw new Error('the oath never reached the happenings pool')
    return oath
  }

  it("raises the next pass's captured recency_factor through the real action", async () => {
    const before = await capturedOath()
    expect(before).toMatchObject({ chapters_old: 57, pin_signal: 0.3 })
    expect(Math.abs(before.recency_factor - Math.exp(-0.07 * 57 * 0.7))).toBeLessThan(0.001)

    // Chapter 59's close: E is its one entry, and the oath's row is a frequent one.
    const endEntryId = fx.entries[58]!.id
    const { answers } = await runDispatchCalls(fx, {
      task: 'awareness',
      tools: { set_pin: setPinTool },
      shown: await startPinned(fx, [{ table: 'happening_awareness', id: OATH_KNOWN, name: '' }]),
      calls: [
        {
          toolName: 'set_pin',
          input: { id: 'aw1', value: 0.5, turns: ['t1'], why: 'The oath still binds her.' },
        },
      ],
      turns: { endEntryId, taskEntryIds: [endEntryId], part: 0 },
    })
    expect(answers).toEqual([{ result: 'ok' }])

    const after = await capturedOath()
    expect(after).toMatchObject({ chapters_old: 57, pin_signal: 0.5 })
    expect(Math.abs(after.recency_factor - Math.exp(-0.07 * 57 * 0.5))).toBeLessThan(0.001)
  }, 30_000)
})
