import { and, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateToolStep } from '@/lib/ai'
import {
  branches,
  chapters,
  emptyEntityState,
  entities,
  happeningAwareness,
  happenings,
  storyEntries,
} from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { resetAllStores } from '@/lib/stores'

import { setPinTool } from './awareness-tools'
import { AWARENESS_TOP_N, awarenessTask } from './close-awareness'
import { mergeHappeningsTool } from './happening-tools'
import { __setCloseAgentSlots, type CloseAgentSlots } from './slots'
import { runDispatchCalls } from '../__tests__/close-dispatch'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeLedgerOf } from '../close-intermediates'
import {
  uuid,
  ARIA,
  JORIN,
  MARA,
  FIGHT,
  TOLL,
  RUMOUR,
  A_CHAPTER,
  A_BOTH,
  A_FREQUENT,
  A_IDLE,
  A_COMMON,
  CHAPTER,
  SUMMARY,
  COUNTS,
  chapterOf,
  endOf,
  putCharacter,
  putHappening,
  putAwareness,
  putChapter,
  seedAwarenessWorld,
  chapterIds,
  promptContextFor,
  stepWith,
  closePhaseFor,
  drainApplying,
} from './__tests__/close-awareness-fixture'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

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
            input: { id: 'aw3', value: 0.2, turns: ['t2'], why: 'Jorin still pays the toll.' },
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
        values: { decayResistance: '0.2' },
      }),
    ])
    const [row] = await fx.ctx.db
      .select({ pin: happeningAwareness.decayResistance })
      .from(happeningAwareness)
      .where(
        and(eq(happeningAwareness.branchId, fx.branchId), eq(happeningAwareness.id, A_FREQUENT)),
      )
    expect(row?.pin).toBe(0.2)
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

  it("keeps each listed row's pin as the baseline set_pin holds the close to, no pin as 0", async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)

    await awarenessTask.start(ctx)

    expect([A_CHAPTER, A_BOTH, A_FREQUENT].map((id) => ctx.ids.startPinOf(id))).toEqual([0.6, 0, 0])
    expect(ctx.ids.startPinOf(A_COMMON)).toBeUndefined()
  })

  it('keeps the first start pin when a start runs again in the same close', async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    await awarenessTask.start(ctx)
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ decayResistance: 0.9 })
      .where(eq(happeningAwareness.id, A_CHAPTER))

    await awarenessTask.start(ctx)

    expect(ctx.ids.startPinOf(A_CHAPTER)).toBe(0.6)
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
      shown: [
        { table: 'happening_awareness', id: A_CHAPTER, name: '', startPin: 0.6 },
        { table: 'happening_awareness', id: A_FREQUENT, name: '', startPin: 0.8 },
      ],
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
    // E sits near the start on the sibling, and an earlier entry of this branch far past it: a
    // read of E's position or of the entries after it that crosses branches excludes A_FREQUENT.
    for (const [id, position] of [
      [endOf(fx), 1],
      [fx.entries[1]!.id, 1000],
    ] as const) {
      const [entry] = await sibling
        .select()
        .from(storyEntries)
        .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, id)))
      await sibling.insert(storyEntries).values({ ...entry!, branchId: OTHER_BRANCH, position })
    }
    // Ahead of this branch's rows in a table scan, so an unscoped lookup of E finds the sibling's.
    await sibling.run(
      sql`UPDATE story_entries SET rowid = -1 WHERE branch_id = ${OTHER_BRANCH} AND id = ${endOf(fx)}`,
    )
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

  it('tells the model a raise is at most 0.2 above the shown pin a close, never straight to 1', async () => {
    await seedAwarenessWorld(fx)
    const ctx = promptContextFor(fx)
    const start = await awarenessTask.start(ctx)
    if (start === null) throw new Error('the start listed nothing')

    const { user } = awarenessTask.render(start, { ...ctx, writesSoFar: '' })

    expect(user).toContain(
      'Raise a pin by at most 0.2 above the pin shown, in one close, never straight to 1: a bigger raise is refused, and a row that stays load-bearing climbs again at a later close.',
    )
  })

  // Twenty rows counted 2…21 fill the set; a later turn's row and one learned at E come with
  // the highest counts, and rumour 1 has no anchor at all.
  describe('the high-frequency set and the turns after the chapter', () => {
    const rumourRows = async (anchorOf: (n: number) => string | null): Promise<void> => {
      await putChapter(fx)
      await putCharacter(fx, ARIA, 'Aria')
      for (let n = 1; n <= 20; n++) {
        await putHappening(fx, {
          id: `hap_${uuid(100 + n)}`,
          title: `Rumour ${String(n).padStart(2, '0')}`,
          occurredAtEntryId: fx.entries[1]!.id,
        })
        await putAwareness(fx, {
          id: `haw_${uuid(200 + n)}`,
          characterId: ARIA,
          happeningId: `hap_${uuid(100 + n)}`,
          learnedAtEntryId: anchorOf(n),
          decayResistance: 0.3,
          retrievalCount: n + 1,
        })
      }
    }
    const lateRow = async (anchor: string): Promise<void> => {
      await putHappening(fx, {
        id: `hap_${uuid(150)}`,
        title: 'Late rumour',
        occurredAtEntryId: anchor,
      })
      await putAwareness(fx, {
        id: `haw_${uuid(250)}`,
        characterId: ARIA,
        happeningId: `hap_${uuid(150)}`,
        learnedAtEntryId: anchor,
        decayResistance: 0.3,
        retrievalCount: 9999,
      })
    }

    it('leaves out a row a later turn created, which takes no place, and keeps a row with no anchor', async () => {
      await rumourRows((n) => (n === 1 ? null : fx.entries[1]!.id))
      await lateRow(fx.replyIds[4]!)

      const start = await awarenessTask.start(promptContextFor(fx))

      const listed = start?.seeds.map(({ id }) => id) ?? []
      expect(listed).toHaveLength(20)
      expect(listed).not.toContain(`haw_${uuid(250)}`)
      expect(listed).toContain(`haw_${uuid(201)}`)
      expect(listed).toContain(`haw_${uuid(202)}`)
    })

    it("lists a row learned at the chapter's last turn, and it takes a place", async () => {
      await rumourRows(() => fx.entries[1]!.id)
      await lateRow(endOf(fx))

      const start = await awarenessTask.start(promptContextFor(fx))

      const listed = start?.seeds.map(({ id }) => id) ?? []
      expect(listed).toHaveLength(20)
      expect(listed).toContain(`haw_${uuid(250)}`)
      expect(listed).not.toContain(`haw_${uuid(201)}`)
    })
  })

  it("keeps a retired character's rows listed", async () => {
    await seedAwarenessWorld(fx)
    await fx.ctx.db
      .update(entities)
      .set({ status: 'retired', retiredReason: 'died' })
      .where(eq(entities.id, ARIA))

    const start = await awarenessTask.start(promptContextFor(fx))

    expect(start?.seeds.map(({ id }) => id)).toContain(A_CHAPTER)
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
