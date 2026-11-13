import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome } from '@/lib/actions/types'
import {
  generateToolStep,
  type ResolveModelConfig,
  type ToolStepCall,
  type ToolStepResult,
} from '@/lib/ai'
import {
  branches,
  chapters,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happenings,
} from '@/lib/db'
import { logger, makeLogger } from '@/lib/diagnostics'
import { loadHistoryChunk } from '@/lib/history'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { resetAllStores } from '@/lib/stores'

import { setPinTool } from './awareness-tools'
import { AWARENESS_TOP_N, awarenessTask, resetRetrievalStep } from './close-awareness'
import { mergeHappeningsTool } from './happening-tools'
import { CloseIds } from './ids'
import { __setCloseAgentSlots, type CloseAgentSlots, type CodeStepContext } from './slots'
import type { TaskPromptContext } from './task'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../../types'
import { runDispatchCalls } from '../__tests__/close-dispatch'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeLedgerOf, setCloseParts, setCloseRange } from '../close-intermediates'
import type { CloseRange } from '../intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

// Real `prefix_<uuid>` ids: CloseIds hands handles for those only.
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ARIA = `char_${uuid(1)}`
const JORIN = `char_${uuid(2)}`
const MARA = `char_${uuid(3)}`
const FIGHT = `hap_${uuid(11)}`
const TOLL = `hap_${uuid(12)}`
const RUMOUR = `hap_${uuid(13)}`
const A_CHAPTER = `haw_${uuid(41)}`
const A_BOTH = `haw_${uuid(42)}`
const A_FREQUENT = `haw_${uuid(43)}`
const A_IDLE = `haw_${uuid(44)}`
const A_COMMON = `haw_${uuid(45)}`
const CHAPTER = `chap_${uuid(50)}`
const SUMMARY = 'Wren crosses at night and Jorin fights the toll men on the landing.'
// Counts no other text in the prompt holds, so finding one means a count leaked (3d).
const COUNTS = { both: 4409, frequent: 7919, common: 6271 } as const

/** The chapter: the second turn to the third reply, t1…t4 by position; E is that reply. */
const chapterOf = (fx: CloseFixture): string[] => fx.entries.slice(3, 7).map(({ id }) => id)
const endOf = (fx: CloseFixture): string => fx.entries[6]!.id
const rangeOf = (fx: CloseFixture): CloseRange => ({
  chapterId: CHAPTER,
  startEntryId: fx.entries[3]!.id,
  endEntryId: endOf(fx),
})

// Written with no delta, as an import leaves a row: a start reads rows, not history.
async function putCharacter(fx: CloseFixture, id: string, name: string): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id,
    branchId: fx.branchId,
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    state: emptyEntityState('character'),
    keywords: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

async function putHappening(
  fx: CloseFixture,
  row: { id: string; title: string; occurredAtEntryId: string; commonKnowledge?: 0 | 1 },
): Promise<void> {
  await fx.ctx.db.insert(happenings).values({
    id: row.id,
    branchId: fx.branchId,
    title: row.title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: row.occurredAtEntryId,
    commonKnowledge: row.commonKnowledge ?? 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

async function putAwareness(
  fx: CloseFixture,
  row: {
    id: string
    characterId: string
    happeningId: string
    learnedAtEntryId: string | null
    decayResistance: number | null
    retrievalCount?: number
    source?: string
  },
): Promise<void> {
  await fx.ctx.db.insert(happeningAwareness).values({
    id: row.id,
    branchId: fx.branchId,
    happeningId: row.happeningId,
    characterId: row.characterId,
    learnedAtEntryId: row.learnedAtEntryId,
    decayResistance: row.decayResistance,
    retrievalCount: row.retrievalCount ?? 0,
    source: row.source ?? null,
  })
}

// The chapter being closed, as the metadata phase writes it before the agent runs.
async function putChapter(fx: CloseFixture): Promise<void> {
  await fx.ctx.db.insert(chapters).values({
    id: CHAPTER,
    branchId: fx.branchId,
    sequenceNumber: 2,
    title: 'The crossing',
    summary: SUMMARY,
    theme: 'a guarded passage',
    keywords: [],
    startEntryId: fx.entries[3]!.id,
    endEntryId: endOf(fx),
    tokenCount: 1,
    closedAt: 1,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  })
}

/**
 * Aria learned of the fight at t2 and Jorin at t3, his row also among the most retrieved; Jorin's
 * row of the toll is from before the chapter, retrieved most and unpinned; Mara's was never
 * retrieved; Aria's of a rumour everyone knows is retrieved and learned at t2, but common knowledge.
 */
async function seedAwarenessWorld(fx: CloseFixture): Promise<void> {
  await putChapter(fx)
  await putCharacter(fx, ARIA, 'Aria')
  await putCharacter(fx, JORIN, 'Jorin')
  await putCharacter(fx, MARA, 'Mara')
  await putHappening(fx, {
    id: FIGHT,
    title: 'A fight at the ferry',
    occurredAtEntryId: fx.entries[4]!.id,
  })
  await putHappening(fx, { id: TOLL, title: 'The new toll', occurredAtEntryId: fx.entries[1]!.id })
  await putHappening(fx, {
    id: RUMOUR,
    title: 'Word of the toll',
    occurredAtEntryId: fx.entries[2]!.id,
    commonKnowledge: 1,
  })
  await putAwareness(fx, {
    id: A_CHAPTER,
    characterId: ARIA,
    happeningId: FIGHT,
    learnedAtEntryId: fx.entries[4]!.id,
    decayResistance: 0.6,
    source: 'saw it',
  })
  await putAwareness(fx, {
    id: A_BOTH,
    characterId: JORIN,
    happeningId: FIGHT,
    learnedAtEntryId: fx.entries[5]!.id,
    decayResistance: 0,
    retrievalCount: COUNTS.both,
    source: 'fought in it',
  })
  await putAwareness(fx, {
    id: A_FREQUENT,
    characterId: JORIN,
    happeningId: TOLL,
    learnedAtEntryId: fx.entries[1]!.id,
    decayResistance: null,
    retrievalCount: COUNTS.frequent,
    source: 'paid it twice',
  })
  await putAwareness(fx, {
    id: A_IDLE,
    characterId: MARA,
    happeningId: TOLL,
    learnedAtEntryId: fx.entries[1]!.id,
    decayResistance: 0.2,
  })
  await putAwareness(fx, {
    id: A_COMMON,
    characterId: ARIA,
    happeningId: RUMOUR,
    learnedAtEntryId: fx.entries[4]!.id,
    decayResistance: 0.9,
    retrievalCount: COUNTS.common,
  })
}

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

/** As the agent phase leaves the ids before any task: the chapter's turns, t1…t4. */
function chapterIds(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(chapterOf(fx))
  return ids
}

function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds = chapterIds(fx),
  abortSignal: AbortSignal = new AbortController().signal,
): TaskPromptContext {
  const actionId = 'act_awareness_start'
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, rangeOf(fx))
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: endOf(fx),
    task: 'awareness',
    part: 0,
    ids,
    readFields: {},
    survivorOf: () => undefined,
    landedCalls: () => 0,
    clusterOf: () => undefined,
    phase: {
      actionId,
      abortSignal,
      intermediates,
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    taskEntryIds: chapterOf(fx),
    config: START_CONFIG,
  }
}

const USAGE = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 105,
}

// A step as the SDK returns it; no call ends the task.
function stepWith(calls: readonly ToolStepCall[]): ToolStepResult {
  const text = calls.length === 0 ? 'Nothing to change.' : ''
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [
        {
          role: 'assistant',
          content:
            calls.length === 0
              ? [{ type: 'text', text }]
              : calls.map(({ toolCallId, toolName, input }) => ({
                  type: 'tool-call' as const,
                  toolCallId,
                  toolName,
                  input,
                })),
        },
      ],
      text,
      finishReason: calls.length === 0 ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

/** A close over the chapter as one part; its chapter row is putChapter's. */
function closePhaseFor(
  fx: CloseFixture,
  abortSignal: AbortSignal = new AbortController().signal,
): PhaseContext {
  const actionId = 'act_awareness_close'
  const intermediates: Record<string, unknown> = {}
  const range = rangeOf(fx)
  setCloseRange(intermediates, range)
  setCloseParts(intermediates, [
    { part: 1, startEntryId: range.startEntryId, endEntryId: range.endEntryId, tokens: 0 },
  ])
  return {
    actionId,
    abortSignal,
    intermediates,
    log: makeLogger(actionId),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

// Stands in for the orchestrator: each group lands in the fixture and its outcome goes back.
async function drainApplying(
  ctx: PhaseContext,
  fx: CloseFixture,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { events, result: next.value }
    const event = next.value
    events.push(event)
    reply =
      event.type === 'delta_group_emitted'
        ? await applyDeltaActionGroupWithOutcomes(
            event.actions,
            { actionId: ctx.actionId, branchId: ctx.branchId, entryId: event.entryId },
            fx.ctx,
          )
        : undefined
  }
}

const AWARENESS_ONLY: CloseAgentSlots = {
  before: [],
  perPart: [],
  after: [{ kind: 'task', def: awarenessTask }],
}

describe('the Awareness start', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it("lists the chapter's rows, then the frequent ones, under their happening by title, a row in both as the chapter's", async () => {
    await seedAwarenessWorld(fx)
    const ids = chapterIds(fx)

    const start = await awarenessTask.start(promptContextFor(fx, ids))

    expect(start).toEqual({
      show: {
        groups: [
          {
            happening: { id: 'hp1', title: 'A fight at the ferry' },
            rows: [
              {
                id: 'aw1',
                character: { id: 'c1', name: 'Aria' },
                decayResistance: 0.6,
                source: 'saw it',
                learnedAt: 't2',
                list: 'chapter',
              },
              {
                id: 'aw2',
                character: { id: 'c2', name: 'Jorin' },
                decayResistance: 0,
                source: 'fought in it',
                learnedAt: 't3',
                list: 'chapter',
              },
            ],
          },
          {
            happening: { id: 'hp2', title: 'The new toll' },
            rows: [
              {
                id: 'aw3',
                character: { id: 'c2', name: 'Jorin' },
                decayResistance: null,
                source: 'paid it twice',
                learnedAt: 't5',
                list: 'frequent',
              },
            ],
          },
        ],
        summary: SUMMARY,
        mode: 'creative',
      },
      seeds: [
        { table: 'happening_awareness', id: A_CHAPTER },
        { table: 'happening_awareness', id: A_BOTH },
        { table: 'happening_awareness', id: A_FREQUENT },
      ],
    })
    // A frequent row's turn before the chapter takes the next t handle, for read_turns.
    expect(ids.idOf('t5')).toBe(fx.entries[1]!.id)
  })

  it('renders no retrieval count anywhere in the prompt, and the rows, pins and chapter it does show', async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    const start = await awarenessTask.start(ctx)
    if (start === null) throw new Error('the start listed nothing')

    const { system, user } = awarenessTask.render(start, { ...ctx, writesSoFar: '' })

    for (const count of Object.values(COUNTS)) {
      expect(JSON.stringify(start)).not.toContain(String(count))
      expect(system).not.toContain(String(count))
      expect(user).not.toContain(String(count))
    }
    expect(user).toContain('- aw1: Aria (c1), pin 0.6, learned this chapter, at t2, how: "saw it"')
    expect(user).toContain(
      '- aw2: Jorin (c2), pin 0, learned this chapter, at t3, how: "fought in it"',
    )
    expect(user).toContain(
      '- aw3: Jorin (c2), pin 0 (unset), keeps coming up, at t5, how: "paid it twice"',
    )
    expect(user).toContain(`# This chapter\n${SUMMARY}`)
    expect(user).toContain("this chapter's turns, t1 to t4")
  })

  it("holds the shared instructions alone in its system half, a prefix of a prose task's", async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    const start = await awarenessTask.start(ctx)
    if (start === null) throw new Error('the start listed nothing')

    const { system } = awarenessTask.render(start, { ...ctx, writesSoFar: '' })

    const lore = renderTemplate(TEMPLATE_IDS.closeLore, {
      mode: 'creative',
      closeTurns: [{ handle: 't1', kind: 'opening', content: 'Rain.' }],
      closeLore: [],
      closeLoreLimits: { creates: 3, left: 3, bodyChars: 1200 },
      closeWritesSoFar: '',
    })
    expect(system).toContain('This is an automated system.')
    expect(system).not.toContain('# The turns')
    expect(lore.system.startsWith(`${system}\n\n# The turns`)).toBe(true)
  })

  it('keeps the twenty rows retrieved most, highest first, a tie at the cut going to the smaller id', async () => {
    expect(AWARENESS_TOP_N).toBe(20)
    await putChapter(fx)
    await putCharacter(fx, ARIA, 'Aria')
    // Rumours 1 and 2 tie at 2, 3…21 count 3…21: ordered by id alone, 1…20 would be kept.
    const rumours = Array.from({ length: 21 }, (_, i) => ({ n: i + 1, count: i < 2 ? 2 : i + 1 }))
    for (const { n, count } of rumours) {
      await putHappening(fx, {
        id: `hap_${uuid(100 + n)}`,
        title: `Rumour ${String(n).padStart(2, '0')}`,
        occurredAtEntryId: fx.entries[1]!.id,
      })
      await putAwareness(fx, {
        id: `haw_${uuid(200 + n)}`,
        characterId: ARIA,
        happeningId: `hap_${uuid(100 + n)}`,
        learnedAtEntryId: fx.entries[1]!.id,
        decayResistance: 0.3,
        retrievalCount: count,
      })
    }

    const start = await awarenessTask.start(promptContextFor(fx))

    const listed = start?.seeds.map(({ id }) => id) ?? []
    expect(listed).toHaveLength(20)
    expect(listed).toContain(`haw_${uuid(221)}`)
    expect(listed).toContain(`haw_${uuid(201)}`)
    expect(listed).not.toContain(`haw_${uuid(202)}`)
    expect(new Set(start?.show.groups.flatMap(({ rows }) => rows.map(({ list }) => list)))).toEqual(
      new Set(['frequent']),
    )
  })

  // Twenty of Aria's rows, counted 2…21, hold the set; Jorin's row of the kept crossing (1) is
  // outside it and his row of the absorbed one (5) inside, until a merge sums them onto the kept.
  it('lifts a kept row into the set with the count a landed merge folded into it', async () => {
    const KEEP = `hap_${uuid(301)}`
    const ABSORBED = `hap_${uuid(302)}`
    const KEPT_ROW = `haw_${uuid(311)}`
    const ABSORBED_ROW = `haw_${uuid(312)}`
    await putChapter(fx)
    await putCharacter(fx, ARIA, 'Aria')
    await putCharacter(fx, JORIN, 'Jorin')
    for (let n = 1; n <= 20; n++) {
      await putHappening(fx, {
        id: `hap_${uuid(400 + n)}`,
        title: `Errand ${String(n).padStart(2, '0')}`,
        occurredAtEntryId: fx.entries[1]!.id,
      })
      await putAwareness(fx, {
        id: `haw_${uuid(500 + n)}`,
        characterId: ARIA,
        happeningId: `hap_${uuid(400 + n)}`,
        learnedAtEntryId: fx.entries[1]!.id,
        decayResistance: 0.3,
        retrievalCount: n + 1,
      })
    }
    await putHappening(fx, {
      id: KEEP,
      title: 'The night crossing',
      occurredAtEntryId: fx.entries[4]!.id,
    })
    await putHappening(fx, {
      id: ABSORBED,
      title: 'Crossing the river',
      occurredAtEntryId: fx.entries[5]!.id,
    })
    await putAwareness(fx, {
      id: KEPT_ROW,
      characterId: JORIN,
      happeningId: KEEP,
      learnedAtEntryId: fx.entries[1]!.id,
      decayResistance: 0.3,
      retrievalCount: 1,
    })
    await putAwareness(fx, {
      id: ABSORBED_ROW,
      characterId: JORIN,
      happeningId: ABSORBED,
      learnedAtEntryId: fx.entries[1]!.id,
      decayResistance: 0.4,
      retrievalCount: 5,
    })
    const before = (await awarenessTask.start(promptContextFor(fx)))?.seeds.map(({ id }) => id)
    expect(before).toContain(ABSORBED_ROW)
    expect(before).not.toContain(KEPT_ROW)

    const { answers } = await runDispatchCalls(fx, {
      task: 'happenings',
      tools: { merge_happenings: mergeHappeningsTool },
      shown: [
        { table: 'happenings', id: KEEP, name: 'The night crossing' },
        { table: 'happenings', id: ABSORBED, name: 'Crossing the river' },
      ],
      calls: [
        {
          toolName: 'merge_happenings',
          input: { keep: 'hp1', absorb: ['hp2'], turns: ['t2'], why: 'One crossing, told twice.' },
        },
      ],
      turns: { endEntryId: endOf(fx), taskEntryIds: chapterOf(fx), part: 0 },
      clusters: [[KEEP, ABSORBED]],
    })
    expect(answers[0]).toMatchObject({ result: 'ok' })

    const after = (await awarenessTask.start(promptContextFor(fx)))?.seeds.map(({ id }) => id)
    expect(after).toContain(KEPT_ROW)
    expect(after).not.toContain(ABSORBED_ROW)
    expect(after).toHaveLength(20)
  })

  it("starts nothing when no row is the chapter's or retrieved since the last close", async () => {
    await putChapter(fx)
    await putCharacter(fx, ARIA, 'Aria')
    await putCharacter(fx, MARA, 'Mara')
    await putHappening(fx, {
      id: TOLL,
      title: 'The new toll',
      occurredAtEntryId: fx.entries[1]!.id,
    })
    await putHappening(fx, {
      id: RUMOUR,
      title: 'Word of the toll',
      occurredAtEntryId: fx.entries[2]!.id,
      commonKnowledge: 1,
    })
    await putAwareness(fx, {
      id: A_IDLE,
      characterId: MARA,
      happeningId: TOLL,
      learnedAtEntryId: fx.entries[1]!.id,
      decayResistance: 0.2,
    })
    // Learned in the chapter and retrieved, but common knowledge: a pin there reaches nothing.
    await putAwareness(fx, {
      id: A_COMMON,
      characterId: ARIA,
      happeningId: RUMOUR,
      learnedAtEntryId: fx.entries[4]!.id,
      decayResistance: 0.9,
      retrievalCount: COUNTS.common,
    })

    expect(await awarenessTask.start(promptContextFor(fx))).toBeNull()
  })

  it('runs after the parts with read_turns and set_pin, a pin on a listed row landing at part 0', async () => {
    await seedAwarenessWorld(fx)
    __setCloseAgentSlots(AWARENESS_ONLY)
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(
        stepWith([
          {
            toolCallId: 'p1',
            toolName: 'set_pin',
            input: { id: 'aw3', value: 0.5, turns: ['t2'], why: 'Jorin still pays the toll.' },
          },
        ]),
      )
      .mockResolvedValueOnce(stepWith([]))
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'awareness', part: 0, index: 7, total: 7 },
    ])
    const [, request] = vi.mocked(generateToolStep).mock.calls[0]!
    expect(Object.keys(request.tools)).toEqual(['read_turns', 'set_pin'])
    for (const count of Object.values(COUNTS))
      expect(`${request.prompt.system}\n${request.prompt.user}`).not.toContain(String(count))
    expect(closeLedgerOf(ctx.intermediates)?.calls).toEqual([
      expect.objectContaining({
        task: 'awareness',
        part: 0,
        tool: 'set_pin',
        result: 'ok',
        values: { decayResistance: '0.5' },
      }),
    ])
    const [row] = await fx.ctx.db
      .select({ pin: happeningAwareness.decayResistance })
      .from(happeningAwareness)
      .where(
        and(eq(happeningAwareness.branchId, fx.branchId), eq(happeningAwareness.id, A_FREQUENT)),
      )
    expect(row?.pin).toBe(0.5)
  })

  // Ids run against every order: Alpha has the highest id, the two Sams' rows sort against their
  // characters' ids, and a Beta's row falls in the index order by character.
  it('orders groups by title then id, chapter rows before frequent by name then id, and hands handles in that order', async () => {
    await putChapter(fx)
    const ALPHA = `hap_${uuid(63)}`
    const BETA_LOW = `hap_${uuid(61)}`
    const BETA_HIGH = `hap_${uuid(62)}`
    const SAM_LOW = `char_${uuid(71)}`
    const SAM_HIGH = `char_${uuid(72)}`
    const MIA = `char_${uuid(73)}`
    const ABE = `char_${uuid(74)}`
    for (const [id, name] of [
      [MIA, 'Mia'],
      [SAM_HIGH, 'Sam'],
      [SAM_LOW, 'Sam'],
      [ABE, 'Abe'],
    ] as const)
      await putCharacter(fx, id, name)
    const at = fx.entries[4]!.id
    await putHappening(fx, { id: BETA_HIGH, title: 'Beta', occurredAtEntryId: at })
    await putHappening(fx, { id: BETA_LOW, title: 'Beta', occurredAtEntryId: at })
    await putHappening(fx, { id: ALPHA, title: 'Alpha', occurredAtEntryId: at })
    const rows = [
      { id: `haw_${uuid(81)}`, characterId: ABE, happeningId: ALPHA, learned: 1, count: 5 },
      { id: `haw_${uuid(82)}`, characterId: SAM_HIGH, happeningId: ALPHA, learned: 4, count: 0 },
      { id: `haw_${uuid(83)}`, characterId: SAM_LOW, happeningId: ALPHA, learned: 4, count: 0 },
      { id: `haw_${uuid(84)}`, characterId: MIA, happeningId: ALPHA, learned: 4, count: 0 },
      { id: `haw_${uuid(85)}`, characterId: MIA, happeningId: BETA_HIGH, learned: 4, count: 0 },
      { id: `haw_${uuid(86)}`, characterId: ABE, happeningId: BETA_LOW, learned: 4, count: 0 },
    ]
    for (const row of rows)
      await putAwareness(fx, {
        id: row.id,
        characterId: row.characterId,
        happeningId: row.happeningId,
        learnedAtEntryId: fx.entries[row.learned]!.id,
        decayResistance: 0.5,
        retrievalCount: row.count,
      })
    const ids = chapterIds(fx)

    const start = await awarenessTask.start(promptContextFor(fx, ids))

    const shown = start?.show.groups.map((group) => [
      group.happening.id,
      group.happening.title,
      group.rows.map((row) => [row.id, row.character.id, row.character.name, row.list]),
    ])
    expect(shown).toEqual([
      [
        'hp1',
        'Alpha',
        [
          ['aw1', 'c1', 'Mia', 'chapter'],
          ['aw2', 'c2', 'Sam', 'chapter'],
          ['aw3', 'c3', 'Sam', 'chapter'],
          ['aw4', 'c4', 'Abe', 'frequent'],
        ],
      ],
      ['hp2', 'Beta', [['aw5', 'c4', 'Abe', 'chapter']]],
      ['hp3', 'Beta', [['aw6', 'c1', 'Mia', 'chapter']]],
    ])
    expect(start?.seeds.map(({ id }) => id)).toEqual([
      `haw_${uuid(84)}`,
      `haw_${uuid(82)}`,
      `haw_${uuid(83)}`,
      `haw_${uuid(81)}`,
      `haw_${uuid(86)}`,
      `haw_${uuid(85)}`,
    ])
    expect([ids.idOf('hp2'), ids.idOf('hp3'), ids.idOf('c2'), ids.idOf('c3')]).toEqual([
      BETA_LOW,
      BETA_HIGH,
      SAM_HIGH,
      SAM_LOW,
    ])
  })

  it('takes no place for a row whose character is gone, and one for a chapter row also in the set', async () => {
    await putChapter(fx)
    await putCharacter(fx, ARIA, 'Aria')
    // Rumours 1…21 count 1…21; 21 is the chapter's own, so it takes a place and rumour 1 is cut.
    for (let n = 1; n <= 21; n++) {
      await putHappening(fx, {
        id: `hap_${uuid(100 + n)}`,
        title: `Rumour ${String(n).padStart(2, '0')}`,
        occurredAtEntryId: fx.entries[1]!.id,
      })
      await putAwareness(fx, {
        id: `haw_${uuid(200 + n)}`,
        characterId: ARIA,
        happeningId: `hap_${uuid(100 + n)}`,
        learnedAtEntryId: fx.entries[n === 21 ? 4 : 1]!.id,
        decayResistance: 0.3,
        retrievalCount: n,
      })
    }
    // The most retrieved and a chapter row, but nobody to know it.
    await putHappening(fx, {
      id: TOLL,
      title: 'The new toll',
      occurredAtEntryId: fx.entries[1]!.id,
    })
    await putAwareness(fx, {
      id: A_IDLE,
      characterId: MARA,
      happeningId: TOLL,
      learnedAtEntryId: fx.entries[4]!.id,
      decayResistance: 0.3,
      retrievalCount: 9999,
    })

    const start = await awarenessTask.start(promptContextFor(fx))

    const listed = start?.seeds.map(({ id }) => id) ?? []
    expect(listed).toHaveLength(20)
    expect(listed).not.toContain(A_IDLE)
    expect(listed).toContain(`haw_${uuid(221)}`)
    expect(listed).toContain(`haw_${uuid(202)}`)
    expect(listed).not.toContain(`haw_${uuid(201)}`)
    const chapterRow = start?.show.groups.find(({ happening }) => happening.title === 'Rumour 21')
    expect(chapterRow?.rows.map(({ list }) => list)).toEqual(['chapter'])
  })

  it('names a row a shown text cites, so a write copying it stores the name', async () => {
    await seedAwarenessWorld(fx)
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ source: `told by ${MARA}` })
      .where(eq(happeningAwareness.id, A_CHAPTER))
    const ids = chapterIds(fx)

    const start = await awarenessTask.start(promptContextFor(fx, ids))

    // The listed rows took their handles first: the cited Mara came after Aria and Jorin.
    expect(start?.show.groups[0]?.rows[0]?.character.id).toBe('c1')
    expect(ids.idOf('c3')).toBe(MARA)
    const source = start?.show.groups[0]?.rows[0]?.source ?? ''
    expect(source).toBe('told by c3')
    expect(ids.nameOf('c3')).toBe('Mara')
  })

  it("reads the chapter's summary as empty when its row is gone, and throws without a range", async () => {
    await seedAwarenessWorld(fx)
    await fx.ctx.db.delete(chapters).where(eq(chapters.id, CHAPTER))
    const ctx = promptContextFor(fx)

    expect((await awarenessTask.start(ctx))?.show.summary).toBe('')

    const intermediates: Record<string, unknown> = {}
    await expect(
      awarenessTask.start({ ...ctx, phase: { ...ctx.phase, intermediates } }),
    ).rejects.toThrow('awareness: the close holds no range')
  })

  // The start lists the chapter's rows by the same entries set_pin's one-way rule tests.
  it("lists a row as the chapter's exactly when set_pin lets its pin fall", async () => {
    await seedAwarenessWorld(fx)
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ decayResistance: 0.8 })
      .where(eq(happeningAwareness.id, A_FREQUENT))
    const start = await awarenessTask.start(promptContextFor(fx))
    const rows = start?.show.groups.flatMap(({ rows: listed }) => listed) ?? []
    expect(rows.map(({ list }) => list)).toEqual(['chapter', 'chapter', 'frequent'])

    const { answers } = await runDispatchCalls(fx, {
      task: 'awareness',
      tools: { set_pin: setPinTool },
      shown: [A_CHAPTER, A_FREQUENT].map((id) => ({
        table: 'happening_awareness' as const,
        id,
        name: '',
      })),
      calls: [
        {
          toolName: 'set_pin',
          input: { id: 'aw1', value: 0.1, turns: ['t2'], why: 'Incidental.' },
        },
        {
          toolName: 'set_pin',
          input: { id: 'aw2', value: 0.1, turns: ['t2'], why: 'Incidental.' },
        },
      ],
      turns: { endEntryId: endOf(fx), taskEntryIds: chapterOf(fx), part: 0 },
    })

    expect(answers[0]).toEqual({ result: 'ok' })
    expect(answers[1]).toMatchObject({ result: 'rejected', reason: 'frequent-pin-lowered' })
  })

  // A sibling branch of the story holds rows under the same ids, with counts that would crowd
  // this branch's out of the set; none of them may list, name a row or write the summary.
  it("lists only this branch's rows when a sibling branch holds rows under the same ids", async () => {
    const OTHER_BRANCH = 'br_other'
    const sibling = fx.ctx.db
    await sibling
      .insert(branches)
      .values({ id: OTHER_BRANCH, storyId: fx.storyId, name: 'other', createdAt: 1 })
    await sibling.insert(chapters).values({
      id: CHAPTER,
      branchId: OTHER_BRANCH,
      sequenceNumber: 2,
      title: 'The other crossing',
      summary: 'The sibling summary.',
      theme: 'x',
      keywords: [],
      startEntryId: fx.entries[3]!.id,
      endEntryId: endOf(fx),
      tokenCount: 1,
      closedAt: 1,
      embeddingStale: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const characters = [ARIA, JORIN, MARA]
    for (const id of characters)
      await sibling.insert(entities).values({
        id,
        branchId: OTHER_BRANCH,
        kind: 'character',
        name: `Sibling ${id}`,
        status: 'active',
        injectionMode: 'auto',
        state: emptyEntityState('character'),
        keywords: [],
        createdAt: 1,
        updatedAt: 1,
      })
    const sharedRows = [
      { id: A_CHAPTER, characterId: ARIA, happeningId: FIGHT, at: 4 },
      { id: A_BOTH, characterId: JORIN, happeningId: FIGHT, at: 5 },
      { id: A_FREQUENT, characterId: JORIN, happeningId: TOLL, at: 1 },
      { id: A_IDLE, characterId: MARA, happeningId: TOLL, at: 1 },
    ]
    for (const [id, title] of [
      [FIGHT, 'Sibling fight'],
      [TOLL, 'Sibling toll'],
    ] as const)
      await sibling.insert(happenings).values({
        id,
        branchId: OTHER_BRANCH,
        title,
        occurredAtEntryId: fx.entries[1]!.id,
        commonKnowledge: 0,
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    for (const [i, row] of sharedRows.entries())
      await sibling.insert(happeningAwareness).values({
        id: row.id,
        branchId: OTHER_BRANCH,
        happeningId: row.happeningId,
        characterId: row.characterId,
        learnedAtEntryId: fx.entries[row.at]!.id,
        decayResistance: 0.9,
        retrievalCount: 9000 + i,
        source: 'sibling',
      })
    for (let n = 1; n <= AWARENESS_TOP_N; n++) {
      await sibling.insert(happenings).values({
        id: `hap_${uuid(600 + n)}`,
        branchId: OTHER_BRANCH,
        title: `Sibling rumour ${n}`,
        occurredAtEntryId: fx.entries[1]!.id,
        commonKnowledge: 0,
        embeddingStale: 0,
        createdAt: 1,
        updatedAt: 1,
      })
      await sibling.insert(happeningAwareness).values({
        id: `haw_${uuid(700 + n)}`,
        branchId: OTHER_BRANCH,
        happeningId: `hap_${uuid(600 + n)}`,
        characterId: ARIA,
        learnedAtEntryId: fx.entries[1]!.id,
        decayResistance: 0.9,
        retrievalCount: 9100 + n,
        source: 'sibling',
      })
    }
    await seedAwarenessWorld(fx)

    const start = await awarenessTask.start(promptContextFor(fx))

    expect(start?.seeds.map(({ id }) => id)).toEqual([A_CHAPTER, A_BOTH, A_FREQUENT])
    expect(
      start?.show.groups.map((group) => [
        group.happening.title,
        group.rows.map((row) => [row.character.name, row.source]),
      ]),
    ).toEqual([
      [
        'A fight at the ferry',
        [
          ['Aria', 'saw it'],
          ['Jorin', 'fought in it'],
        ],
      ],
      ['The new toll', [['Jorin', 'paid it twice']]],
    ])
    expect(start?.show.summary).toBe(SUMMARY)
  })

  it('says a turn outside the chapter is from an earlier chapter, to read and not cite', async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    const start = await awarenessTask.start(ctx)
    if (start === null) throw new Error('the start listed nothing')

    const { user } = awarenessTask.render(start, { ...ctx, writesSoFar: '' })

    expect(user).toContain(
      'A row\'s "at" turn outside that range is from an earlier chapter: read it with read_turns, never cite it.',
    )
  })

  it('renders the writes so far after the rows, and the section only when there are some', async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    const start = await awarenessTask.start(ctx)
    if (start === null) throw new Error('the start listed nothing')
    const writes = '- merge_happenings The siege (hp1): kept hp1'

    const written = awarenessTask.render(start, { ...ctx, writesSoFar: writes })
    const empty = awarenessTask.render(start, { ...ctx, writesSoFar: '' })

    expect(
      written.user.endsWith(
        `# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`,
      ),
    ).toBe(true)
    expect(empty.user).not.toContain('# Writes so far')
  })
})

type GroupEvent = Extract<PhaseEmittedEvent, { type: 'delta_group_emitted' }>

/** A code step's context over the chapter, as the agent phase builds it: no task, no ledger. */
function stepContextFor(fx: CloseFixture, abortSignal?: AbortSignal): CodeStepContext {
  const {
    task: _task,
    readFields: _readFields,
    ...step
  } = promptContextFor(fx, chapterIds(fx), abortSignal)
  return step
}

// The step alone, each group answered by `reply`.
async function runReset(
  ctx: CodeStepContext,
  reply: (event: GroupEvent) => Promise<GroupOutcome>,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = resetRetrievalStep.run(ctx)
  const events: PhaseEmittedEvent[] = []
  let answer: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(answer)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
    answer = next.value.type === 'delta_group_emitted' ? await reply(next.value) : undefined
  }
}

async function countsOf(fx: CloseFixture): Promise<Record<string, number>> {
  const rows = await fx.ctx.db
    .select({ id: happeningAwareness.id, count: happeningAwareness.retrievalCount })
    .from(happeningAwareness)
    .where(eq(happeningAwareness.branchId, fx.branchId))
  return Object.fromEntries(rows.map(({ id, count }) => [id, count]))
}

const ALL_RESET = { [A_CHAPTER]: 0, [A_BOTH]: 0, [A_FREQUENT]: 0, [A_IDLE]: 0, [A_COMMON]: 0 }

const AWARENESS_AND_RESET: CloseAgentSlots = {
  before: [],
  perPart: [],
  after: [
    { kind: 'task', def: awarenessTask },
    { kind: 'code', step: resetRetrievalStep },
  ],
}

describe('the retrieval reset', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(stepWith([]))
    fx = await openCloseFixture()
    await seedAwarenessWorld(fx)
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it('zeroes every count on the branch after Awareness, one chapter_close delta a row on E in one group, none in History', async () => {
    // A pass's source edit of Aria's row of the fight: the History control below.
    const edited = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: {
            branchId: fx.branchId,
            characterId: ARIA,
            happeningId: FIGHT,
            source: 'saw it from the bank',
            proseEntryId: null,
          },
        },
        actionId: 'act_source_edit',
        branchId: fx.branchId,
        entryId: null,
      },
      fx.ctx,
    )
    expect(edited.status).toBe('ok')
    const [sourceEdit] = await fx.ctx.db
      .select({ id: deltas.id })
      .from(deltas)
      .where(eq(deltas.actionId, 'act_source_edit'))
    __setCloseAgentSlots(AWARENESS_AND_RESET)
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(await countsOf(fx)).toEqual(ALL_RESET)
    const groups = events.flatMap((event) => (event.type === 'delta_group_emitted' ? [event] : []))
    expect(
      groups.map(({ entryId, actions }) => [entryId, actions.map(({ kind }) => kind)]),
    ).toEqual([
      [
        endOf(fx),
        ['resetAwarenessRetrieval', 'resetAwarenessRetrieval', 'resetAwarenessRetrieval'],
      ],
    ])
    const resets = await fx.ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, ctx.actionId))
      .orderBy(asc(deltas.logPosition))
    expect(
      resets.map((d) => [d.targetTable, d.targetId, d.op, d.source, d.entryId, d.undoPayload]),
    ).toEqual([
      [
        'happening_awareness',
        A_BOTH,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.both },
      ],
      [
        'happening_awareness',
        A_FREQUENT,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.frequent },
      ],
      [
        'happening_awareness',
        A_COMMON,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.common },
      ],
    ])
    const resetIds = new Set(resets.map(({ id }) => id))
    const historyOf = async (targetId: string): Promise<string[]> =>
      (
        await loadHistoryChunk(fx.ctx.db, {
          branchId: fx.branchId,
          targetTable: 'happenings',
          targetId,
          sort: 'newest',
          cursor: null,
        })
      ).rows.map(({ delta }) => delta.id)
    for (const happeningId of [FIGHT, TOLL, RUMOUR])
      expect(
        (await historyOf(happeningId)).filter((id) => resetIds.has(id)),
        happeningId,
      ).toEqual([])
    // Control: History does read the fight's awareness rows; only the counts stay out.
    expect(await historyOf(FIGHT)).toContain(sourceEdit!.id)
  })

  it('resets after an Awareness task stopped at its budget', async () => {
    let step = 0
    vi.mocked(generateToolStep).mockImplementation(async () => {
      step += 1
      return stepWith([
        { toolCallId: `r${step}`, toolName: 'read_turns', input: { turns: ['t2'] } },
      ])
    })
    __setCloseAgentSlots(AWARENESS_AND_RESET)
    const ctx = closePhaseFor(fx)

    const { result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(closeLedgerOf(ctx.intermediates)?.stopped).toEqual([
      { task: 'awareness', part: 0, reason: 'budget' },
    ])
    expect(await countsOf(fx)).toEqual(ALL_RESET)
  })

  it('emits no group when no count on the branch is above 0', async () => {
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ retrievalCount: 0 })
      .where(eq(happeningAwareness.branchId, fx.branchId))

    const { events, result } = await runReset(stepContextFor(fx), async () => {
      throw new Error('no group was owed')
    })

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
  })

  it('resets only this branch when a sibling branch holds a count above 0', async () => {
    const OTHER_BRANCH = 'br_other'
    await fx.ctx.db
      .insert(branches)
      .values({ id: OTHER_BRANCH, storyId: fx.storyId, name: 'other', createdAt: 1 })
    await fx.ctx.db.insert(entities).values({
      id: JORIN,
      branchId: OTHER_BRANCH,
      kind: 'character',
      name: 'Sibling Jorin',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      keywords: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happenings).values({
      id: FIGHT,
      branchId: OTHER_BRANCH,
      title: 'Sibling fight',
      description: null,
      category: null,
      icon: null,
      temporal: null,
      occurredAtEntryId: fx.entries[4]!.id,
      commonKnowledge: 0,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happeningAwareness).values({
      id: A_BOTH,
      branchId: OTHER_BRANCH,
      happeningId: FIGHT,
      characterId: JORIN,
      learnedAtEntryId: fx.entries[5]!.id,
      decayResistance: 0,
      retrievalCount: 9,
    })

    const { events, result } = await runReset(stepContextFor(fx), (event) =>
      applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: 'act_reset_step', branchId: fx.branchId, entryId: event.entryId },
        fx.ctx,
      ),
    )

    expect(result).toEqual({ status: 'completed' })
    const [group] = events.flatMap((event) => (event.type === 'delta_group_emitted' ? [event] : []))
    expect(
      group?.actions.flatMap((action) =>
        action.kind === 'resetAwarenessRetrieval' ? [action.payload.id] : [],
      ),
    ).toEqual([A_BOTH, A_FREQUENT, A_COMMON])
    const sibling = await fx.ctx.db
      .select({ count: happeningAwareness.retrievalCount })
      .from(happeningAwareness)
      .where(eq(happeningAwareness.branchId, OTHER_BRANCH))
    expect(sibling).toEqual([{ count: 9 }])
  })

  it('stops before emitting when the close is aborted', async () => {
    const abort = new AbortController()
    abort.abort()

    const { events, result } = await runReset(stepContextFor(fx, abort.signal), async () => {
      throw new Error('no group was owed')
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
    expect((await countsOf(fx))[A_FREQUENT]).toBe(COUNTS.frequent)
  })

  it('fails the close when its group is refused: a code step has no model to tell', async () => {
    const { events, result } = await runReset(stepContextFor(fx), async () => ({
      status: 'rejected',
      reason: 'scripted refusal',
    }))

    expect(events).toHaveLength(1)
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail: 'retrieval reset refused: scripted refusal',
        tableName: 'happening_awareness',
      },
    })
  })

  it('logs the group as memory.close_retrieval_reset with its rows, status and round trip', async () => {
    const debug = vi.spyOn(logger, 'debug')
    onTestFinished(() => debug.mockRestore())

    await runReset(stepContextFor(fx), (event) =>
      applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: 'act_reset_step', branchId: fx.branchId, entryId: event.entryId },
        fx.ctx,
      ),
    )

    expect(debug.mock.calls.filter(([kind]) => kind === 'memory.close_retrieval_reset')).toEqual([
      [
        'memory.close_retrieval_reset',
        { rows: 3, status: 'ok', ms: expect.any(Number) },
        { actionId: 'act_awareness_start' },
      ],
    ])
  })
})
