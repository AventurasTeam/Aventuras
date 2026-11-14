import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import {
  generateToolStep,
  type ResolveModelConfig,
  type ToolStepCall,
  type ToolStepResult,
} from '@/lib/ai'
import {
  branches,
  emptyEntityState,
  entities,
  happenings,
  stories,
  storyEntries,
  type Entity,
  type EntityState,
  type StoryMode,
} from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import { readRowTool } from './read-tools'
import { __setCloseAgentSlots, type CloseAgentSlots } from './slots'
import type { TaskPromptContext } from './task'
import { UPKEEP_READ_FIELDS, upkeepTask } from './upkeep'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeLedgerOf, setCloseParts, setCloseRange } from '../close-intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const ROWS = {
  harrow: 'loc_00000000-0000-4000-8000-00000000d001',
  river: 'loc_00000000-0000-4000-8000-00000000d002',
  landing: 'loc_00000000-0000-4000-8000-00000000d003',
  inn: 'loc_00000000-0000-4000-8000-00000000d004',
  satchel: 'item_00000000-0000-4000-8000-00000000d005',
  seal: 'item_00000000-0000-4000-8000-00000000d006',
  tobin: 'char_00000000-0000-4000-8000-00000000d007',
  letter: 'item_00000000-0000-4000-8000-00000000d008',
  ferry: 'loc_00000000-0000-4000-8000-00000000d009',
  mara: 'char_00000000-0000-4000-8000-00000000d00a',
} as const

const HAPS = {
  fight: 'hap_00000000-0000-4000-8000-00000000d101',
  toll: 'hap_00000000-0000-4000-8000-00000000d102',
  crossing: 'hap_00000000-0000-4000-8000-00000000d103',
  talk: 'hap_00000000-0000-4000-8000-00000000d104',
  brawl: 'hap_00000000-0000-4000-8000-00000000d105',
} as const

/** The part: the opening to the third reply, t1…t7. */
const partEntryIds = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map(({ id }) => id)

type EntityRowSeed = {
  id: string
  kind: Entity['kind']
  name: string
  status?: Entity['status']
  description?: string | null
  keywords?: string[]
  state: Readonly<Record<string, unknown>>
}

// Written with no delta, as an import or a hand edit leaves a row: a start reads rows, not history.
async function putEntityRow(fx: CloseFixture, row: EntityRowSeed): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id: row.id,
    branchId: fx.branchId,
    kind: row.kind,
    name: row.name,
    description: row.description ?? null,
    status: row.status ?? 'active',
    retiredReason: row.status === 'retired' ? 'Lost to the river.' : null,
    injectionMode: 'auto',
    state: row.state as EntityState,
    keywords: row.keywords ?? [],
    createdAt: 1,
    updatedAt: 1,
  })
}

async function putHappening(
  fx: CloseFixture,
  row: {
    id: string
    title: string
    description?: string
    occurredAtEntryId: string | null
    commonKnowledge: 0 | 1
    branchId?: string
  },
): Promise<void> {
  await fx.ctx.db.insert(happenings).values({
    id: row.id,
    branchId: row.branchId ?? fx.branchId,
    title: row.title,
    description: row.description ?? null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: row.occurredAtEntryId,
    commonKnowledge: row.commonKnowledge,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

/** A happening a pass made from `entryId`: its create delta anchored there, set at no entry. */
async function madeFromEntry(
  fx: CloseFixture,
  row: { id: string; title: string },
  entryId: string,
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: row.id,
            branchId: fx.branchId,
            title: row.title,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_pass_made',
      branchId: fx.branchId,
      entryId,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${row.title} refused: ${result.reason}`)
}

async function setSceneOf(
  fx: CloseFixture,
  entryId: string,
  scene: { sceneEntities: string[]; currentLocationId: string | null },
): Promise<void> {
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`setSceneOf: entry ${entryId} has no metadata`)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, ...scene } })
    .where(where)
}

/**
 * The part names Harrow, the ferry, Tobin, the inn, the satchel, the landing and the letter; the
 * seal only past it, the River Country never. t3's scene holds the satchel at the inn, t7's the
 * landing. Mara (bare) and the retired letter are in t3's scene but not shown.
 */
async function seedUpkeepWorld(fx: CloseFixture): Promise<void> {
  await putEntityRow(fx, {
    id: ROWS.river,
    kind: 'location',
    name: 'The River Country',
    keywords: ['river country'],
    state: { parent_location_id: null },
  })
  await putEntityRow(fx, {
    id: ROWS.harrow,
    kind: 'location',
    name: 'Harrow',
    description: 'A ferry town on the river.',
    keywords: ['harrow town'],
    state: { parent_location_id: ROWS.river },
  })
  await putEntityRow(fx, {
    id: ROWS.ferry,
    kind: 'location',
    name: 'The ferry',
    description: 'The night crossing to the far bank.',
    state: { parent_location_id: null },
  })
  await putEntityRow(fx, {
    id: ROWS.landing,
    kind: 'location',
    name: 'The landing',
    description: 'Planks over black water.',
    keywords: ['the jetty'],
    state: { parent_location_id: null },
  })
  await putEntityRow(fx, {
    id: ROWS.inn,
    kind: 'location',
    name: 'The inn',
    description: '',
    keywords: ['the inn'],
    state: { parent_location_id: null, unplaced: true, condition: 'Loud with drovers' },
  })
  await putEntityRow(fx, {
    id: ROWS.satchel,
    kind: 'item',
    name: 'satchel',
    description: 'A courier satchel.',
    state: { at_location_id: null, condition: 'Wet through' },
  })
  await putEntityRow(fx, {
    id: ROWS.seal,
    kind: 'item',
    name: 'seal',
    description: 'Black wax.',
    state: { at_location_id: null },
  })
  await putEntityRow(fx, {
    id: ROWS.tobin,
    kind: 'character',
    name: 'Tobin',
    status: 'staged',
    description: 'The ferryman.',
    keywords: ['old tobin'],
    state: emptyEntityState('character'),
  })
  await putEntityRow(fx, {
    id: ROWS.letter,
    kind: 'item',
    name: 'letter',
    status: 'retired',
    description: 'Sealed.',
    state: { at_location_id: null },
  })
  await putEntityRow(fx, {
    id: ROWS.mara,
    kind: 'character',
    name: 'Mara',
    state: emptyEntityState('character'),
  })
  await setSceneOf(fx, fx.entries[2]!.id, {
    sceneEntities: [ROWS.satchel, ROWS.mara, ROWS.letter],
    currentLocationId: ROWS.inn,
  })
  await setSceneOf(fx, fx.entries[6]!.id, { sceneEntities: [], currentLocationId: ROWS.landing })
  await putHappening(fx, {
    id: HAPS.fight,
    title: 'A fight at the inn',
    description: 'Drovers came to blows.',
    occurredAtEntryId: fx.entries[2]!.id,
    commonKnowledge: 0,
  })
  await putHappening(fx, {
    id: HAPS.toll,
    title: 'The new toll',
    occurredAtEntryId: fx.entries[4]!.id,
    commonKnowledge: 1,
  })
  await putHappening(fx, {
    id: HAPS.crossing,
    title: 'The crossing',
    occurredAtEntryId: fx.entries[10]!.id,
    commonKnowledge: 0,
  })
  await madeFromEntry(fx, { id: HAPS.talk, title: 'Talk of the ferryman' }, fx.entries[6]!.id)
}

// As the agent phase does before any task: every chapter entry a turn, t1 the first.
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
  taskEntryIds: readonly string[] = partEntryIds(fx),
): TaskPromptContext {
  const actionId = 'act_upkeep_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries[6]!.id,
    task: 'upkeep',
    part: 1,
    ids,
    readFields: UPKEEP_READ_FIELDS,
    survivorOf: () => undefined,
    landedCalls: () => 0,
    phase: {
      actionId,
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    taskEntryIds,
    config: START_CONFIG,
  }
}

const WORLD_ROWS = [
  {
    id: 'l1',
    kind: 'location',
    name: 'Harrow',
    status: 'active',
    description: 'A ferry town on the river.',
    keywords: ['harrow town'],
    condition: '',
    placement: 'under The River Country (l4)',
    inScene: false,
  },
  {
    id: 'l2',
    kind: 'location',
    name: 'The ferry',
    status: 'active',
    description: 'The night crossing to the far bank.',
    keywords: [],
    condition: '',
    placement: 'top level',
    inScene: false,
  },
  {
    id: 'c1',
    kind: 'character',
    name: 'Tobin',
    status: 'staged',
    description: '',
    keywords: ['old tobin'],
    condition: '',
    placement: '',
    inScene: false,
  },
  {
    id: 'l3',
    kind: 'location',
    name: 'The inn',
    status: 'active',
    description: '',
    keywords: ['the inn'],
    condition: 'Loud with drovers',
    placement: 'unplaced',
    inScene: true,
  },
  {
    id: 'i1',
    kind: 'item',
    name: 'satchel',
    status: 'active',
    description: 'A courier satchel.',
    keywords: [],
    condition: 'Wet through',
    placement: '',
    inScene: true,
  },
]

describe('upkeepTask', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
  })

  afterEach(() => {
    resetAllStores()
  })

  async function startOf(taskEntryIds?: readonly string[]) {
    const ids = idsWithTurns(fx)
    const ctx = promptContextFor(fx, ids, taskEntryIds)
    return { ctx, ids, start: await upkeepTask.start(ctx) }
  }

  it("lists canon's tools in order and reads the fields its tools write", () => {
    expect(upkeepTask.task).toBe('upkeep')
    expect(upkeepTask.tools.map((tool) => tool.name)).toEqual([
      'search_world',
      'read_row',
      'update_place',
      'update_item',
      'set_keywords',
      'mark_common_knowledge',
    ])
    expect(UPKEEP_READ_FIELDS).toEqual({
      location: [
        'description',
        'keywords',
        'state.condition',
        'state.parent_location_id',
        'state.unplaced',
      ],
      item: ['description', 'keywords', 'state.condition'],
      character: ['keywords'],
      faction: ['keywords'],
      happening: ['title', 'description', 'commonKnowledge'],
    })
    expect(upkeepTask.readFields).toBe(UPKEEP_READ_FIELDS)
  })

  it('starts from the rows the part names off the scene, then the bare places and items in it', async () => {
    await seedUpkeepWorld(fx)

    const { ids, start } = await startOf()

    expect(start?.show.rows).toEqual(WORLD_ROWS)
    expect(ids.idOf('l4')).toBe(ROWS.river)
    expect(ids.nameOf('l4')).toBe('The River Country')
  })

  it('leaves out a place in the scene with keywords and a description, a row named past the part, and a retired one', async () => {
    await seedUpkeepWorld(fx)

    const { ids } = await startOf()

    expect(ids.handleOf(ROWS.landing)).toBeUndefined()
    expect(ids.handleOf(ROWS.seal)).toBeUndefined()
    expect(ids.handleOf(ROWS.letter)).toBeUndefined()
  })

  // A character in the scene with no keywords is no first-keywords case, nor a retired item in it.
  it('leaves out a character and a retired item in the scene, however bare', async () => {
    await seedUpkeepWorld(fx)

    const { ids } = await startOf()

    expect(ids.handleOf(ROWS.mara)).toBeUndefined()
    expect(ids.handleOf(ROWS.letter)).toBeUndefined()
  })

  // A shown text may hold another row's full id: it names that row, so a copied handle stores a name.
  it('names a row a shown description cites, in its handle', async () => {
    await seedUpkeepWorld(fx)
    await fx.ctx.db
      .update(entities)
      .set({ description: `A ferry town; the seal ${ROWS.seal} hangs here.` })
      .where(eq(entities.id, ROWS.harrow))

    const { ids, start } = await startOf()

    expect(start?.show.rows[0]?.description).toBe('A ferry town; the seal i2 hangs here.')
    expect(ids.nameOf('i2')).toBe('seal')
  })

  // A character shows only its keywords: an id its description cites reaches no prompt.
  it('gives no handle to a row only a character description cites', async () => {
    await seedUpkeepWorld(fx)
    await fx.ctx.db
      .update(entities)
      .set({ description: `The ferryman; he keeps ${ROWS.seal} for the reeve.` })
      .where(eq(entities.id, ROWS.tobin))

    const { ids, start } = await startOf()

    expect(start?.show.rows.map((row) => row.id)).toContain('c1')
    expect(ids.handleOf(ROWS.seal)).toBeUndefined()
  })

  it("starts from the part's happenings not yet common knowledge, set at its turns or made from one", async () => {
    await seedUpkeepWorld(fx)

    const { ids, start } = await startOf()

    expect(start?.show.happenings).toEqual([
      { id: 'hp1', title: 'A fight at the inn' },
      { id: 'hp2', title: 'Talk of the ferryman' },
    ])
    expect(ids.handleOf(HAPS.toll)).toBeUndefined()
    expect(ids.handleOf(HAPS.crossing)).toBeUndefined()
  })

  // A fork's happenings name the entries it shares with the branch it forked from.
  it("leaves out another branch's happening set at the part's turns", async () => {
    await seedUpkeepWorld(fx)
    await fx.ctx.db.insert(branches).values({
      id: 'br_fork',
      storyId: fx.storyId,
      parentBranchId: fx.branchId,
      forkEntryId: fx.entries[6]!.id,
      name: 'fork',
      createdAt: 2,
    })
    await putHappening(fx, {
      id: HAPS.brawl,
      title: 'A brawl at the inn',
      occurredAtEntryId: fx.entries[2]!.id,
      commonKnowledge: 0,
      branchId: 'br_fork',
    })

    const { ids, start } = await startOf()

    expect(start?.show.happenings).toEqual([
      { id: 'hp1', title: 'A fight at the inn' },
      { id: 'hp2', title: 'Talk of the ferryman' },
    ])
    expect(ids.handleOf(HAPS.brawl)).toBeUndefined()
  })

  // C11: every shown row shows the fields its tools write; a placement's parent shows only a name.
  it('seeds every shown row and happening as read, and no parent', async () => {
    await seedUpkeepWorld(fx)

    const { start } = await startOf()

    expect(start?.seeds).toEqual([
      { table: 'entities', id: ROWS.harrow },
      { table: 'entities', id: ROWS.ferry },
      { table: 'entities', id: ROWS.tobin },
      { table: 'entities', id: ROWS.inn },
      { table: 'entities', id: ROWS.satchel },
      { table: 'happenings', id: HAPS.fight },
      { table: 'happenings', id: HAPS.talk },
    ])
  })

  it('returns null when nothing is named off the scene, nothing in it is bare and no happening is open', async () => {
    await putEntityRow(fx, {
      id: ROWS.landing,
      kind: 'location',
      name: 'The landing',
      description: 'Planks over black water.',
      keywords: ['the jetty'],
      state: { parent_location_id: null },
    })
    await putEntityRow(fx, {
      id: ROWS.letter,
      kind: 'item',
      name: 'letter',
      status: 'retired',
      state: { at_location_id: null },
    })
    await setSceneOf(fx, fx.entries[6]!.id, { sceneEntities: [], currentLocationId: ROWS.landing })
    await putHappening(fx, {
      id: HAPS.toll,
      title: 'The new toll',
      occurredAtEntryId: fx.entries[4]!.id,
      commonKnowledge: 1,
    })

    const { ids, start } = await startOf()

    expect(start).toBeNull()
    expect(ids.handleOf(ROWS.landing)).toBeUndefined()
  })

  it('returns null for a task with no turns', async () => {
    await seedUpkeepWorld(fx)

    expect((await startOf([])).start).toBeNull()
  })

  it("shows each row's writable fields in the user half, by kind, and the turns in the system half", async () => {
    await seedUpkeepWorld(fx)
    const { ctx, start } = await startOf()

    const { system, user } = upkeepTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain(
      '# Rows\n\n## l1: Harrow (place, off the scene)\n- description: "A ferry town on the river."\n- condition: ""\n- placement: under The River Country (l4)\n- keywords: ["harrow town"]',
    )
    expect(user).toContain(
      '## l2: The ferry (place, off the scene)\n- description: "The night crossing to the far bank."\n- condition: ""\n- placement: top level\n- keywords: []',
    )
    expect(user).toContain(
      '## c1: Tobin (character, staged, off the scene)\n- keywords: ["old tobin"]',
    )
    expect(user).toContain(
      '## l3: The inn (place, in the scene)\n- description: ""\n- condition: "Loud with drovers"\n- placement: unplaced\n- keywords: ["the inn"]',
    )
    expect(user).toContain(
      '## i1: satchel (item, in the scene)\n- description: "A courier satchel."\n- condition: "Wet through"\n- keywords: []',
    )
    expect(user).toContain(
      '# Happenings not yet common knowledge\n- hp1: A fight at the inn\n- hp2: Talk of the ferryman',
    )
    expect(user).not.toContain('The ferryman.')
    expect(system).toContain('## t3 (narration)\nThe inn is warm and loud with drovers.')
    expect(system).not.toContain('# Rows')
  })

  it('says so when a set is empty, and ends the user half with the writes so far', async () => {
    await putHappening(fx, {
      id: HAPS.fight,
      title: 'A fight at the inn',
      occurredAtEntryId: fx.entries[2]!.id,
      commonKnowledge: 0,
    })
    const { ctx, start } = await startOf()
    const writes = '- update_character Tobin (c1): state.traits'

    const { user } = upkeepTask.render(start!, { ...ctx, writesSoFar: writes })

    expect(user).toContain('# Rows\n\nNone.\n\n# Happenings not yet common knowledge\n- hp1:')
    expect(
      user.endsWith(`# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`),
    ).toBe(true)
  })

  // memory/chapter-close.md → 3f, and 3b's description bar.
  it.each([
    'Set a place\'s or an item\'s condition only when the chapter shows it changed while the scene was elsewhere ("news came that the capital burned").',
    "Rewrite a place's or an item's description only when the chapter materially changes what it is, never for detail its condition or placement already carries.",
    'A blank description may be filled when the cited turns show it.',
    "add the names and aliases the chapter uses for a row, and a bare place's or item's first keywords.",
    "Remove only a term that no longer fits. You can't see who added a term; removing a term the user added is refused.",
    'A row in the scene is shown because it has no keywords or a blank description: give it its first keywords, or fill the description, when the turns show them; leave its condition alone.',
    'or send top: true for an unplaced place that nothing on the map could contain.',
    'only when the turns show outright that word of it has spread to everyone. A wrong mark makes every character aware of it.',
    'Never write a turn id such as t3 into a condition, a description or a keyword: cite turns only in "turns".',
  ])('the Upkeep task states: %s', async (line) => {
    await seedUpkeepWorld(fx)
    const { ctx, start } = await startOf()

    expect(upkeepTask.render(start!, { ...ctx, writesSoFar: '' }).user).toContain(line)
  })

  // memory/chapter-close.md → Conversations: a part's tasks reuse the chapter's cached prefix.
  it("renders a system half byte-identical to Identity's for the same turns and mode", async () => {
    await seedUpkeepWorld(fx)
    const ctx = promptContextFor(fx, idsWithTurns(fx))
    const identityStart = await identityTask.start({
      ...ctx,
      task: 'identity',
      readFields: IDENTITY_READ_FIELDS,
    })
    const upkeepStart = await upkeepTask.start(ctx)

    const identityPrompt = identityTask.render(identityStart!, { ...ctx, writesSoFar: '' })
    const upkeepPrompt = upkeepTask.render(upkeepStart!, { ...ctx, writesSoFar: '' })

    expect(upkeepPrompt.system).toBe(identityPrompt.system)
    expect(upkeepPrompt.system).toContain(
      '## t3 (narration)\nThe inn is warm and loud with drovers.',
    )
    expect(upkeepPrompt.user).not.toBe(identityPrompt.user)
  })

  it("puts the story mode's rule in the system half, the same as Identity's", async () => {
    await seedUpkeepWorld(fx)
    const render = async (mode: StoryMode) => {
      const [story] = await fx.ctx.db
        .select({ definition: stories.definition })
        .from(stories)
        .where(eq(stories.id, fx.storyId))
      await fx.ctx.db
        .update(stories)
        .set({ definition: { ...story!.definition!, mode } })
        .where(eq(stories.id, fx.storyId))
      const ctx = promptContextFor(fx, idsWithTurns(fx))
      const identityStart = await identityTask.start({
        ...ctx,
        task: 'identity',
        readFields: IDENTITY_READ_FIELDS,
      })
      const upkeepStart = await upkeepTask.start(ctx)
      return {
        identity: identityTask.render(identityStart!, { ...ctx, writesSoFar: '' }).system,
        upkeep: upkeepTask.render(upkeepStart!, { ...ctx, writesSoFar: '' }).system,
      }
    }

    const creative = await render('creative')
    expect(creative.upkeep).toContain('Each is a direction or prose')
    expect(creative.upkeep).not.toContain('Each is what the lead does, says or attempts')
    expect(creative.upkeep).toBe(creative.identity)

    const adventure = await render('adventure')
    expect(adventure.upkeep).toContain('Each is what the lead does, says or attempts')
    expect(adventure.upkeep).not.toContain('Each is a direction or prose')
    expect(adventure.upkeep).toBe(adventure.identity)
  })

  it("lets read_row return a place's and a happening's upkeep fields", async () => {
    await seedUpkeepWorld(fx)
    const ctx = promptContextFor(fx, idsWithTurns(fx))

    const place = await readRowTool.read({ id: ROWS.harrow }, ctx)
    const happening = await readRowTool.read({ id: HAPS.fight }, ctx)

    expect(place.output).toEqual({
      id: 'l1',
      kind: 'location',
      name: 'Harrow',
      fields: {
        description: 'A ferry town on the river.',
        keywords: ['harrow town'],
        'state.condition': null,
        'state.parent_location_id': 'l2',
        'state.unplaced': null,
      },
      refs: { l2: 'The River Country' },
    })
    expect(place.read).toEqual([{ table: 'entities', id: ROWS.harrow }])
    expect(happening.output).toEqual({
      id: 'hp1',
      kind: 'happening',
      name: 'A fight at the inn',
      fields: {
        title: 'A fight at the inn',
        description: 'Drovers came to blows.',
        commonKnowledge: 0,
      },
    })
    expect(happening.read).toEqual([{ table: 'happenings', id: HAPS.fight }])
  })
})

const USAGE = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 105,
}

// A reply with no tool call: the task ends after one step.
function noCallStep(): ToolStepResult {
  return {
    status: 'ok',
    step: {
      calls: [],
      invalidCalls: [],
      responseMessages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Nothing to change.' }] },
      ],
      text: 'Nothing to change.',
      finishReason: 'stop',
      usage: USAGE,
    },
    recoverable: [],
  }
}

// A step as the SDK returns it: the assistant message holding the calls.
function callStep(calls: readonly ToolStepCall[]): ToolStepResult {
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [
        {
          role: 'assistant',
          content: calls.map(({ toolCallId, toolName, input }) => ({
            type: 'tool-call' as const,
            toolCallId,
            toolName,
            input,
          })),
        },
      ],
      text: '',
      finishReason: 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

// The opening through the third reply (positions 1-7), as one part.
function closePhaseFor(fx: CloseFixture): PhaseContext {
  const actionId = 'act_upkeep_close'
  const intermediates: Record<string, unknown> = {}
  const startEntryId = fx.entries[0]!.id
  const endEntryId = fx.replyIds[2]!
  setCloseRange(intermediates, { chapterId: 'chap_upkeep_close', startEntryId, endEntryId })
  setCloseParts(intermediates, [{ part: 1, startEntryId, endEntryId, tokens: 0 }])
  return {
    actionId,
    abortSignal: new AbortController().signal,
    intermediates,
    log: makeLogger(actionId),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

// No call here writes (a restated list and a read-gate refusal), so no group outcome is owed back.
async function drainAgent(
  ctx: PhaseContext,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next(undefined)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const UPKEEP_ONLY: CloseAgentSlots = {
  before: [],
  perPart: [{ kind: 'task', def: upkeepTask }],
  after: [],
}

describe('Upkeep in a close', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(noCallStep())
    __setCloseAgentSlots(UPKEEP_ONLY)
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  // C6: a task with nothing to start from makes no call and still counts, 5 of 7.
  it('makes no call when its start is empty, and still starts 5 of 7', async () => {
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainAgent(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'upkeep', part: 1, index: 5, total: 7 },
    ])
    expect(generateToolStep).not.toHaveBeenCalled()
    expect(closeLedgerOf(ctx.intermediates)?.calls).toEqual([])
  })

  // C11: Harrow's start showed its keywords, so the call passes the read gate unread; the River
  // Country is shown only as Harrow's parent, so the gate refuses it.
  it('lets a write to a row its start showed pass the read gate, and refuses a row it only named', async () => {
    await seedUpkeepWorld(fx)
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(
        callStep([
          {
            toolCallId: 'call_1',
            toolName: 'set_keywords',
            input: { id: 'l1', add: ['Harrow Town'], turns: ['t1'], why: 'The town is named.' },
          },
          {
            toolCallId: 'call_2',
            toolName: 'set_keywords',
            input: { id: 'l4', add: ['River Country'], turns: ['t1'], why: 'The river runs by.' },
          },
        ]),
      )
      .mockResolvedValueOnce(noCallStep())
    const ctx = closePhaseFor(fx)

    const { result } = await drainAgent(ctx)

    expect(result).toEqual({ status: 'completed' })
    const [, request] = vi.mocked(generateToolStep).mock.calls[0]!
    expect(Object.keys(request.tools)).toEqual([
      'search_world',
      'read_row',
      'update_place',
      'update_item',
      'set_keywords',
      'mark_common_knowledge',
    ])
    const calls = closeLedgerOf(ctx.intermediates)?.calls ?? []
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ task: 'upkeep', part: 1, tool: 'set_keywords', result: 'ok' })
    expect(calls[0]).not.toHaveProperty('reason')
    expect(calls[1]).toMatchObject({
      tool: 'set_keywords',
      result: 'rejected',
      reason: 'unread',
    })
  })
})
