import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import type { PipelineAction } from '@/lib/actions/types'
import type { ResolveModelConfig } from '@/lib/ai'
import { happeningInvolvements, storyEntries } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { resetAllStores } from '@/lib/stores'

import { HAPPENINGS_READ_FIELDS, happeningsTask } from './happenings'
import { CloseIds } from './ids'
import { readRowTool } from './read-tools'
import type { TaskPromptContext } from './task'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { setCloseClusters } from '../close-intermediates'

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const WREN = 'char_00000000-0000-4000-8000-00000000e001'
const TOBIN = 'char_00000000-0000-4000-8000-00000000e002'
const MARA = 'char_00000000-0000-4000-8000-00000000e003'
const LIGHT = 'hap_00000000-0000-4000-8000-00000000e101'
const CROSSING = 'hap_00000000-0000-4000-8000-00000000e102'
const TOLL = 'hap_00000000-0000-4000-8000-00000000e103'
const SASH = 'hap_00000000-0000-4000-8000-00000000e104'
const WREN_TWIN = 'char_00000000-0000-4000-8000-00000000e004'
const FORD = 'loc_00000000-0000-4000-8000-00000000e005'
const GONE = 'char_00000000-0000-4000-8000-00000000e0ff'

// As the range embed stores them: each cluster in anchor order.
const CLUSTERS: readonly (readonly string[])[] = [
  [LIGHT, CROSSING],
  [TOLL, SASH],
]

async function apply(fx: CloseFixture, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: 'act_seed_world', branchId: fx.branchId, entryId: null },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

async function seedCharacter(
  fx: CloseFixture,
  id: string,
  name: string,
  kind: 'character' | 'location' = 'character',
): Promise<void> {
  await apply(fx, {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id,
        branchId: fx.branchId,
        kind,
        name,
        description: null,
        status: 'active',
        injectionMode: 'auto',
        createdAt: 1,
        updatedAt: 1,
      },
    },
  })
}

async function seedHappening(
  fx: CloseFixture,
  row: {
    id: string
    title: string
    description?: string
    at: number
    commonKnowledge?: 0 | 1
    cast: readonly string[]
    /** Ids for the cast's links, in cast order; random when absent. */
    linkIds?: readonly string[]
  },
): Promise<void> {
  await apply(fx, {
    kind: 'createHappening',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id: row.id,
        branchId: fx.branchId,
        title: row.title,
        ...(row.description === undefined ? {} : { description: row.description }),
        occurredAtEntryId: fx.entries[row.at]!.id,
        commonKnowledge: row.commonKnowledge ?? 0,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  })
  for (const [index, entityId] of row.cast.entries())
    await apply(fx, {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: row.linkIds?.[index] ?? generateId('hinv'),
          branchId: fx.branchId,
          happeningId: row.id,
          entityId,
          role: null,
        },
      },
    })
}

async function seedClusters(fx: CloseFixture): Promise<void> {
  await seedCharacter(fx, WREN, 'Wren')
  await seedCharacter(fx, TOBIN, 'Tobin')
  await seedCharacter(fx, MARA, 'Mara')
  await seedHappening(fx, {
    id: LIGHT,
    title: 'A light on the far bank',
    description: 'Halfway across, a light moves on the far bank and goes out.',
    at: 2,
    cast: [WREN, MARA],
  })
  await seedHappening(fx, {
    id: CROSSING,
    title: 'Tobin poles Wren across',
    description: 'Tobin takes Wren over the river at night.',
    at: 4,
    cast: [WREN, TOBIN],
  })
  await seedHappening(fx, {
    id: TOLL,
    title: 'The Syndicate taxes the ferry',
    description: 'The Syndicate taxes the ferry, the road and the bread.',
    at: 6,
    commonKnowledge: 1,
    cast: [TOBIN],
  })
  await seedHappening(fx, { id: SASH, title: 'A guard in a Syndicate sash', at: 6, cast: [TOBIN] })
}

// As the agent phase does before any task: every fixture entry a turn, t1 the first.
function idsWithTurns(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(fx.entries.map((entry) => entry.id))
  return ids
}

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds,
  intermediates: Record<string, unknown>,
): TaskPromptContext {
  const actionId = 'act_happenings_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries[6]!.id,
    task: 'happenings',
    part: 0,
    ids,
    readFields: HAPPENINGS_READ_FIELDS,
    survivorOf: () => undefined,
    landedCalls: () => 0,
    clusterOf: () => undefined,
    phase: {
      actionId,
      abortSignal: new AbortController().signal,
      intermediates,
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    taskEntryIds: fx.entries.slice(0, 7).map(({ id }) => id),
    config: START_CONFIG,
  }
}

function clustered(clusters: readonly (readonly string[])[]): Record<string, unknown> {
  const intermediates: Record<string, unknown> = {}
  setCloseClusters(intermediates, clusters)
  return intermediates
}

describe('happeningsTask', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
  })

  afterEach(() => {
    resetAllStores()
  })

  it("lists canon's tools in order and reads the fields its start shows", () => {
    expect(happeningsTask.task).toBe('happenings')
    expect(happeningsTask.tools.map((tool) => tool.name)).toEqual([
      'read_row',
      'read_turns',
      'merge_happenings',
    ])
    expect(HAPPENINGS_READ_FIELDS).toEqual({
      happening: ['title', 'description', 'commonKnowledge', 'occurredAtEntryId'],
    })
    expect(happeningsTask.readFields).toBe(HAPPENINGS_READ_FIELDS)
  })

  it('makes no call when the range embed found no cluster', async () => {
    await seedClusters(f)

    expect(await happeningsTask.start(promptContextFor(f, idsWithTurns(f), {}))).toBeNull()
    expect(
      await happeningsTask.start(promptContextFor(f, idsWithTurns(f), clustered([]))),
    ).toBeNull()
  })

  it("lists each cluster's happenings with their title, description, cast, turn and common knowledge, each seeded", async () => {
    await seedClusters(f)

    const start = await happeningsTask.start(
      promptContextFor(f, idsWithTurns(f), clustered(CLUSTERS)),
    )

    expect(start?.show).toEqual({
      mode: 'creative',
      clusters: [
        [
          {
            id: 'hp1',
            title: 'A light on the far bank',
            description: 'Halfway across, a light moves on the far bank and goes out.',
            cast: [
              { id: 'c1', name: 'Mara' },
              { id: 'c2', name: 'Wren' },
            ],
            turn: 't3',
            commonKnowledge: false,
          },
          {
            id: 'hp2',
            title: 'Tobin poles Wren across',
            description: 'Tobin takes Wren over the river at night.',
            cast: [
              { id: 'c3', name: 'Tobin' },
              { id: 'c2', name: 'Wren' },
            ],
            turn: 't5',
            commonKnowledge: false,
          },
        ],
        [
          {
            id: 'hp3',
            title: 'The Syndicate taxes the ferry',
            description: 'The Syndicate taxes the ferry, the road and the bread.',
            cast: [{ id: 'c3', name: 'Tobin' }],
            turn: 't7',
            commonKnowledge: true,
          },
          {
            id: 'hp4',
            title: 'A guard in a Syndicate sash',
            description: '',
            cast: [{ id: 'c3', name: 'Tobin' }],
            turn: 't7',
            commonKnowledge: false,
          },
        ],
      ],
    })
    expect(start?.seeds).toEqual(
      [LIGHT, CROSSING, TOLL, SASH].map((id) => ({ table: 'happenings', id })),
    )
  })

  it('drops a cluster a gone happening leaves with one row, and makes no call when none is left', async () => {
    await seedClusters(f)
    const deleted = await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'user_edit',
          payload: { branchId: f.branchId, id: LIGHT },
        },
        actionId: 'act_user_edit',
        branchId: f.branchId,
        entryId: null,
      },
      f.ctx,
    )
    expect(deleted.status).toBe('ok')

    const start = await happeningsTask.start(
      promptContextFor(f, idsWithTurns(f), clustered(CLUSTERS)),
    )
    expect(start?.show.clusters.map((cluster) => cluster.map((row) => row.title))).toEqual([
      ['The Syndicate taxes the ferry', 'A guard in a Syndicate sash'],
    ])
    expect(start?.seeds).toEqual([TOLL, SASH].map((id) => ({ table: 'happenings', id })))

    expect(
      await happeningsTask.start(
        promptContextFor(f, idsWithTurns(f), clustered([[LIGHT, CROSSING]])),
      ),
    ).toBeNull()
  })

  it('shows every entity an involvement names that still exists, once, by name then id', async () => {
    await seedCharacter(f, WREN, 'Wren')
    await seedCharacter(f, WREN_TWIN, 'Wren')
    await seedCharacter(f, FORD, 'Ford', 'location')
    await seedHappening(f, {
      id: LIGHT,
      title: 'A',
      at: 2,
      cast: [WREN_TWIN, FORD, WREN, WREN],
      // The scan returns links by id: the twin's comes before Wren's, against the sorted order.
      linkIds: [1, 2, 3, 4].map((n) => `hinv_00000000-0000-4000-8000-00000000f00${n}`),
    })
    await seedHappening(f, { id: CROSSING, title: 'B', at: 4, cast: [WREN] })
    // A link outlives its entity only when the entity's cascade missed it.
    await f.ctx.db.insert(happeningInvolvements).values({
      id: generateId('hinv'),
      branchId: f.branchId,
      happeningId: LIGHT,
      entityId: GONE,
      role: null,
    })

    const ids = idsWithTurns(f)

    const start = await happeningsTask.start(
      promptContextFor(f, ids, clustered([[LIGHT, CROSSING]])),
    )

    expect(ids.show(WREN, 'Wren')).toBe('c1')
    expect(ids.show(WREN_TWIN, 'Wren')).toBe('c2')
    expect(start?.show.clusters[0]?.[0]?.cast).toEqual([
      { id: 'l1', name: 'Ford' },
      { id: 'c1', name: 'Wren' },
      { id: 'c2', name: 'Wren' },
    ])
    expect(start?.show.clusters[0]?.[1]?.cast).toEqual([{ id: 'c1', name: 'Wren' }])
  })

  it('numbers the listed happenings and their cast in list order, before a text names one', async () => {
    await seedCharacter(f, WREN, 'Wren')
    await seedCharacter(f, TOBIN, 'Tobin')
    await seedCharacter(f, MARA, 'Mara')
    await seedHappening(f, {
      id: LIGHT,
      title: 'A light',
      description: `${SASH} watched ${TOBIN} and ${MARA}.`,
      at: 2,
      cast: [WREN],
    })
    await seedHappening(f, { id: CROSSING, title: 'A crossing', at: 4, cast: [WREN, TOBIN] })
    await seedHappening(f, { id: TOLL, title: 'A toll', at: 6, cast: [TOBIN] })
    await seedHappening(f, { id: SASH, title: 'A sash', at: 6, cast: [TOBIN] })

    const ids = idsWithTurns(f)

    const start = await happeningsTask.start(
      promptContextFor(
        f,
        ids,
        clustered([
          [LIGHT, CROSSING],
          [TOLL, SASH],
        ]),
      ),
    )

    const rows = start?.show.clusters.flat()
    expect(rows?.map((row) => row.id)).toEqual(['hp1', 'hp2', 'hp3', 'hp4'])
    expect(rows?.[0]?.description).toBe('hp4 watched c2 and c3.')
    expect(ids.nameOfId(MARA)).toBe('Mara')
    expect(rows?.[0]?.cast).toEqual([{ id: 'c1', name: 'Wren' }])
    expect(rows?.[1]?.cast).toEqual([
      { id: 'c2', name: 'Tobin' },
      { id: 'c1', name: 'Wren' },
    ])
  })

  it('renders the clusters and the writes so far in the user half, and no chapter text anywhere', async () => {
    await seedClusters(f)
    const ctx = promptContextFor(f, idsWithTurns(f), clustered(CLUSTERS))
    const start = await happeningsTask.start(ctx)
    const writes = '- update_thread Deliver the letter (th1): description'

    const prompt = happeningsTask.render(start!, { ...ctx, writesSoFar: writes })

    expect(prompt.system).toContain('This is an automated system.')
    expect(prompt.system).not.toContain('# The turns')
    expect(prompt.system).not.toContain('hp1')
    expect(prompt.user).toContain('### hp1: A light on the far bank')
    expect(prompt.user).toContain('- occurred at: t3')
    expect(prompt.user).toContain('- cast: Mara (c1), Wren (c2)')
    expect(prompt.user).toContain(
      '- description: "Halfway across, a light moves on the far bank and goes out."',
    )
    expect(prompt.user).toContain('### hp3: The Syndicate taxes the ferry (common knowledge)')
    expect(prompt.user).toContain('- description: ""')
    expect(prompt.user).toContain(
      `# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`,
    )
    const contents = await f.ctx.db
      .select({ content: storyEntries.content })
      .from(storyEntries)
      .where(eq(storyEntries.branchId, f.branchId))
    expect(contents.length).toBeGreaterThan(0)
    for (const { content } of contents) {
      expect(prompt.system).not.toContain(content)
      expect(prompt.user).not.toContain(content)
    }
  })

  it('lets read_row return the fields the start shows, and count the row as read', async () => {
    await seedClusters(f)
    const ctx = promptContextFor(f, idsWithTurns(f), {})

    const answer = await readRowTool.read({ id: LIGHT }, ctx)

    expect(answer.output).toEqual({
      id: 'hp1',
      kind: 'happening',
      name: 'A light on the far bank',
      fields: {
        title: 'A light on the far bank',
        description: 'Halfway across, a light moves on the far bank and goes out.',
        commonKnowledge: 0,
        occurredAtEntryId: 't3',
      },
    })
    expect(answer.read).toEqual([{ table: 'happenings', id: LIGHT }])
  })
})
