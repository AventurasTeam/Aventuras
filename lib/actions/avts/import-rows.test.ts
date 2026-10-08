import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AVTS_FORMATS,
  entityExport,
  EntityImportSchema,
  happeningExport,
  HappeningImportSchema,
  loreExport,
  LoreImportSchema,
  threadExport,
  ThreadImportSchema,
  type AvtsFile,
  type AvtsKind,
  type EntityImport,
  type HappeningImport,
  type LoreImport,
  type ThreadImport,
} from '@/lib/avts'
import type {
  Delta,
  Entity,
  EntityKind,
  Happening,
  Lore,
  NewEntity,
  NewHappening,
  NewLore,
  NewThread,
  Thread,
} from '@/lib/db'
import {
  branches,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  threads,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { ID_PATTERN } from '@/lib/ids'
import { entitiesStore, generationStore, resetAllStores } from '@/lib/stores'

import {
  importEntity,
  importHappening,
  importLore,
  importThread,
  type ImportRowResult,
} from './import-rows'
import { __resetRegistry } from '../delta/registry'
import { registerEntities } from '../entities/register'
import { registerHappeningAwareness } from '../happenings/register-awareness'
import { registerHappenings } from '../happenings/register-happenings'
import { registerHappeningInvolvements } from '../happenings/register-involvements'
import { registerLore } from '../lore/register'
import { registerCharacterRelationships } from '../relationships/register'
import { registerThreads } from '../threads/register'

// br_1 is the exporting story's branch, br_2 a different story's: per-row files cross stories.
async function setup() {
  __resetRegistry()
  registerEntities()
  registerCharacterRelationships()
  registerLore()
  registerThreads()
  registerHappenings()
  registerHappeningInvolvements()
  registerHappeningAwareness()
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values([
    { id: 'story_1', title: 'Source', createdAt: 1, updatedAt: 1 },
    { id: 'story_2', title: 'Target', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_2', name: 'main', createdAt: 1 },
  ])
  return { db, ctx: { db, runInTransaction } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']
type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

const EXPORTED_AT = new Date('2026-10-07T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

function okId(result: ImportRowResult): string {
  if (result.status !== 'ok') throw new Error(`import refused: ${result.code}`)
  return result.id
}

async function deltaRows(db: Db, branchId: string): Promise<Delta[]> {
  return (await db.select().from(deltas).where(eq(deltas.branchId, branchId))) as Delta[]
}

async function entityRow(db: Db, id: string): Promise<Entity> {
  const [row] = (await db.select().from(entities).where(eq(entities.id, id))) as Entity[]
  return row
}

async function loreRow(db: Db, id: string): Promise<Lore> {
  const [row] = (await db.select().from(lore).where(eq(lore.id, id))) as Lore[]
  return row
}

async function threadRow(db: Db, id: string): Promise<Thread> {
  const [row] = (await db.select().from(threads).where(eq(threads.id, id))) as Thread[]
  return row
}

async function happeningRow(db: Db, id: string): Promise<Happening> {
  const [row] = (await db.select().from(happenings).where(eq(happenings.id, id))) as Happening[]
  return row
}

function payloadOf(file: AvtsFile, kind: AvtsKind): unknown {
  const envelope = JSON.parse(file.contents) as Record<string, unknown>
  return envelope[AVTS_FORMATS[kind].payloadKey]
}

function pick<T, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<T, K>
}

function entityBase(name: string) {
  return {
    name,
    description: null,
    status: 'active' as const,
    retiredReason: null,
    injectionMode: 'auto' as const,
    tags: [] as string[],
    keywords: [] as string[],
    priority: 0,
  }
}

function entityPayload(kind: EntityKind, name: string): EntityImport {
  switch (kind) {
    case 'character':
      return { ...entityBase(name), kind, state: { visual: {}, traits: [], drives: [] } }
    case 'location':
      return { ...entityBase(name), kind, state: {} }
    case 'item':
      return { ...entityBase(name), kind, state: {} }
    case 'faction':
      return { ...entityBase(name), kind, state: {} }
  }
}

const LORE: LoreImport = {
  title: 'The Aetherium',
  body: 'A sea of light.',
  category: null,
  tags: [],
  keywords: [],
  injectionMode: 'auto',
  priority: 0,
}

const THREAD: ThreadImport = {
  title: 'Find the heir',
  description: null,
  category: null,
  icon: null,
  status: 'pending',
  injectionMode: 'auto',
}

const HAPPENING: HappeningImport = {
  title: 'The bridge fell',
  description: null,
  category: null,
  icon: null,
  temporal: 'the winter of 1204',
  commonKnowledge: 1,
}

describe('importEntity', () => {
  it.each([
    ['character', 'Kael', 'char_'],
    ['location', 'Harbor', 'loc_'],
    ['item', 'Lantern', 'item_'],
    ['faction', 'Wardens', 'fact_'],
  ] as const)(
    'creates a stale %s named %s with a fresh %s id under one create delta',
    async (kind, name, prefix) => {
      const { db, ctx } = await setup()
      const id = okId(await importEntity('br_2', entityPayload(kind, name), ctx))
      expect(id.startsWith(prefix)).toBe(true)
      expect(id).toMatch(ID_PATTERN)
      expect(await entityRow(db, id)).toMatchObject({
        branchId: 'br_2',
        kind,
        name,
        embeddingStale: 1,
        nameCollisionFlag: 0,
      })
      const logged = await deltaRows(db, 'br_2')
      expect(logged).toHaveLength(1)
      expect(logged[0]).toMatchObject({
        op: 'create',
        targetTable: 'entities',
        targetId: id,
        source: 'user_edit',
      })
    },
  )

  it('creates a character with its portable state and every reference empty', async () => {
    const { db, ctx } = await setup()
    const payload: EntityImport = {
      ...entityBase('Kael'),
      kind: 'character',
      state: {
        visual: {
          physique: 'lean',
          face: 'scarred',
          hair: 'dark',
          eyes: 'grey',
          attire: 'a salt-stained coat',
          distinguishing: 'a missing finger',
        },
        traits: ['wry'],
        drives: ['find her sister'],
        voice: 'Clipped.',
        stackables: { coin: 3 },
      },
    }
    const id = okId(await importEntity('br_2', payload, ctx))
    expect((await entityRow(db, id)).state).toEqual({
      visual: {
        physique: 'lean',
        face: 'scarred',
        hair: 'dark',
        eyes: 'grey',
        attire: 'a salt-stained coat',
        distinguishing: 'a missing finger',
      },
      traits: ['wry'],
      drives: ['find her sister'],
      voice: 'Clipped.',
      stackables: { coin: 3 },
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    })
  })

  it('normalizes keywords through the C12 dedupe on entity and lore imports', async () => {
    const { db, ctx } = await setup()
    const entityId = okId(
      await importEntity(
        'br_2',
        { ...entityBase('Harbor'), keywords: ['Kael', 'kael '], kind: 'location', state: {} },
        ctx,
      ),
    )
    const loreId = okId(await importLore('br_2', { ...LORE, keywords: ['Kael', 'kael '] }, ctx))
    expect((await entityRow(db, entityId)).keywords).toEqual(['Kael'])
    expect((await loreRow(db, loreId)).keywords).toEqual(['Kael'])
  })
})

describe('importLore / importThread / importHappening', () => {
  it('creates a stale lore row with a fresh lore_ id under one create delta', async () => {
    const { db, ctx } = await setup()
    const id = okId(await importLore('br_2', LORE, ctx))
    expect(id).toMatch(/^lore_/)
    expect(id).toMatch(ID_PATTERN)
    expect(await loreRow(db, id)).toMatchObject({
      branchId: 'br_2',
      title: 'The Aetherium',
      body: 'A sea of light.',
      embeddingStale: 1,
    })
    const logged = await deltaRows(db, 'br_2')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      op: 'create',
      targetTable: 'lore',
      targetId: id,
      source: 'user_edit',
    })
  })

  it('creates a stale thread with a fresh thr_ id and no entry refs', async () => {
    const { db, ctx } = await setup()
    const id = okId(await importThread('br_2', THREAD, ctx))
    expect(id).toMatch(/^thr_/)
    expect(id).toMatch(ID_PATTERN)
    expect(await threadRow(db, id)).toMatchObject({
      branchId: 'br_2',
      title: 'Find the heir',
      status: 'pending',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
      embeddingStale: 1,
    })
    const logged = await deltaRows(db, 'br_2')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      op: 'create',
      targetTable: 'threads',
      targetId: id,
      source: 'user_edit',
    })
  })

  it('creates a stale happening with temporal kept, no entry anchor and no link rows', async () => {
    const { db, ctx } = await setup()
    const id = okId(await importHappening('br_2', HAPPENING, ctx))
    expect(id).toMatch(/^hap_/)
    expect(id).toMatch(ID_PATTERN)
    expect(await happeningRow(db, id)).toMatchObject({
      branchId: 'br_2',
      title: 'The bridge fell',
      temporal: 'the winter of 1204',
      occurredAtEntryId: null,
      commonKnowledge: 1,
      embeddingStale: 1,
    })
    const logged = await deltaRows(db, 'br_2')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      op: 'create',
      targetTable: 'happenings',
      targetId: id,
      source: 'user_edit',
    })
  })

  it('imports a hand-authored happening as the row alone: its entry anchor and link keys drop', async () => {
    const { db, ctx } = await setup()
    const payload = HappeningImportSchema.parse({
      title: 'The bridge fell',
      occurredAtEntryId: 'entry_123',
      involvements: [{ entityId: 'char_kael', role: 'witness' }],
      awareness: [{ characterId: 'char_kael', source: 'saw it' }],
    })
    const id = okId(await importHappening('br_2', payload, ctx))
    expect(await happeningRow(db, id)).toMatchObject({
      occurredAtEntryId: null,
      temporal: null,
      commonKnowledge: 0,
    })
    expect(
      await db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'br_2')),
    ).toEqual([])
    expect(
      await db.select().from(happeningAwareness).where(eq(happeningAwareness.branchId, 'br_2')),
    ).toEqual([])
    expect(await deltaRows(db, 'br_2')).toHaveLength(1)
  })
})

describe('in-flight refusal', () => {
  const IMPORTS: readonly (readonly [string, (ctx: Ctx) => Promise<ImportRowResult>])[] = [
    ['importEntity', (ctx) => importEntity('br_2', entityPayload('character', 'Kael'), ctx)],
    ['importLore', (ctx) => importLore('br_2', LORE, ctx)],
    ['importThread', (ctx) => importThread('br_2', THREAD, ctx)],
    ['importHappening', (ctx) => importHappening('br_2', HAPPENING, ctx)],
  ]

  it.each(IMPORTS)(
    '%s refuses while generation is in flight and writes nothing',
    async (_, run) => {
      const { db, ctx } = await setup()
      vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
      vi.spyOn(logger, 'warn').mockImplementation(() => {})
      expect(await run(ctx)).toMatchObject({ status: 'rejected', code: 'in-flight' })
      expect(await deltaRows(db, 'br_2')).toEqual([])
      expect(await db.select().from(entities)).toEqual([])
      expect(await db.select().from(lore)).toEqual([])
      expect(await db.select().from(threads)).toEqual([])
      expect(await db.select().from(happenings)).toEqual([])
    },
  )
})

describe('export → parse → import round trip', () => {
  function seedBase(id: string, kind: EntityKind, name: string): Omit<NewEntity, 'state'> {
    return {
      id,
      branchId: 'br_1',
      kind,
      name,
      description: `About ${name}.`,
      status: 'retired',
      retiredReason: 'Lost at sea.',
      injectionMode: 'always',
      tags: ['harbor'],
      keywords: [name, `${name} of the coast`],
      priority: 40,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    }
  }

  const KAEL: NewEntity = {
    ...seedBase('char_kael', 'character', 'Kael'),
    state: {
      visual: {
        physique: 'lean',
        face: 'scarred',
        hair: 'dark',
        eyes: 'grey',
        attire: 'a salt-stained coat',
        distinguishing: 'a missing finger',
      },
      traits: ['wry'],
      drives: ['find her sister'],
      voice: 'Clipped.',
      current_location_id: 'loc_root',
      equipped_items: ['item_lantern'],
      inventory: ['item_rope'],
      stackables: { coin: 3 },
      faction_id: 'fact_wardens',
      lastSeenAt: { entryId: 'entry_9', locationId: 'loc_root', worldTime: 10 },
    },
  }

  const ENTITY_ROUND_TRIPS: readonly { seed: NewEntity; expected: object }[] = [
    {
      seed: KAEL,
      expected: {
        visual: {
          physique: 'lean',
          face: 'scarred',
          hair: 'dark',
          eyes: 'grey',
          attire: 'a salt-stained coat',
          distinguishing: 'a missing finger',
        },
        traits: ['wry'],
        drives: ['find her sister'],
        voice: 'Clipped.',
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        stackables: { coin: 3 },
        faction_id: null,
        lastSeenAt: null,
      },
    },
    {
      seed: {
        ...seedBase('loc_harbor', 'location', 'Harbor'),
        state: { parent_location_id: 'loc_root', condition: 'Flooded.' },
      },
      expected: { parent_location_id: null, condition: 'Flooded.' },
    },
    {
      seed: {
        ...seedBase('item_lantern', 'item', 'Lantern'),
        state: { at_location_id: 'loc_root', condition: 'Cracked.' },
      },
      expected: { at_location_id: null, condition: 'Cracked.' },
    },
    {
      seed: {
        ...seedBase('fact_wardens', 'faction', 'Wardens'),
        state: { standing: 'Feared.', agenda: ['Hold the harbor'] },
      },
      expected: { standing: 'Feared.', agenda: ['Hold the harbor'] },
    },
  ]

  const ENTITY_PORTABLE = [
    'kind',
    'name',
    'description',
    'status',
    'retiredReason',
    'injectionMode',
    'tags',
    'keywords',
    'priority',
  ] as const

  it.each(ENTITY_ROUND_TRIPS)(
    'a $seed.kind keeps its portable fields on another story and loses its references',
    async ({ seed, expected }) => {
      const { db, ctx } = await setup()
      await db.insert(entities).values(seed)
      const original = await entityRow(db, seed.id)
      const payload = EntityImportSchema.parse(
        payloadOf(entityExport(original, EXPORTED_AT), 'entity'),
      )
      const copy = await entityRow(db, okId(await importEntity('br_2', payload, ctx)))
      expect(copy.id).not.toBe(original.id)
      expect(pick(copy, ENTITY_PORTABLE)).toEqual(pick(original, ENTITY_PORTABLE))
      expect(copy.state).toEqual(expected)
      expect(copy.embeddingStale).toBe(1)
    },
  )

  // Per-row payloads carry no branch-local ids, so a same-story re-import must not move the
  // original's items (data-model.md → Aventuras file format).
  it('re-importing a character onto its own branch leaves the original holding its items', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([
        KAEL,
        { ...seedBase('item_lantern', 'item', 'Lantern'), state: { at_location_id: null } },
        { ...seedBase('item_rope', 'item', 'Rope'), state: { at_location_id: null } },
      ])
    entitiesStore.hydrate('br_1', (await db.select().from(entities)) as Entity[])
    const original = await entityRow(db, 'char_kael')
    const payload = EntityImportSchema.parse(
      payloadOf(entityExport(original, EXPORTED_AT), 'entity'),
    )
    okId(await importEntity('br_1', payload, ctx))
    expect((await entityRow(db, 'char_kael')).state).toEqual(original.state)
    expect(await deltaRows(db, 'br_1')).toHaveLength(1)
  })

  it('a lore row keeps its portable fields on another story', async () => {
    const { db, ctx } = await setup()
    const seed: NewLore = {
      id: 'lore_aether',
      branchId: 'br_1',
      title: 'The Aetherium',
      body: 'A sea of light.',
      category: 'cosmology',
      tags: ['sky'],
      keywords: ['Aetherium', 'sea of light'],
      injectionMode: 'always',
      priority: 40,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(lore).values(seed)
    const original = await loreRow(db, 'lore_aether')
    const payload = LoreImportSchema.parse(payloadOf(loreExport(original, EXPORTED_AT), 'lore'))
    const copy = await loreRow(db, okId(await importLore('br_2', payload, ctx)))
    const portable = [
      'title',
      'body',
      'category',
      'tags',
      'keywords',
      'injectionMode',
      'priority',
    ] as const
    expect(pick(copy, portable)).toEqual(pick(original, portable))
    expect(copy.embeddingStale).toBe(1)
  })

  it('a thread keeps its portable fields on another story and loses its entry refs', async () => {
    const { db, ctx } = await setup()
    const seed: NewThread = {
      id: 'thr_heir',
      branchId: 'br_1',
      title: 'Find the heir',
      description: 'Someone survived.',
      category: 'quest',
      icon: 'crown',
      status: 'resolved',
      injectionMode: 'always',
      triggeredAtEntryId: 'entry_2',
      resolvedAtEntryId: 'entry_9',
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(threads).values(seed)
    const original = await threadRow(db, 'thr_heir')
    const payload = ThreadImportSchema.parse(
      payloadOf(threadExport(original, EXPORTED_AT), 'thread'),
    )
    const copy = await threadRow(db, okId(await importThread('br_2', payload, ctx)))
    const portable = [
      'title',
      'description',
      'category',
      'icon',
      'status',
      'injectionMode',
    ] as const
    expect(pick(copy, portable)).toEqual(pick(original, portable))
    expect(copy).toMatchObject({ triggeredAtEntryId: null, resolvedAtEntryId: null })
  })

  it('a happening keeps its portable fields on another story without its anchor or links', async () => {
    const { db, ctx } = await setup()
    const seed: NewHappening = {
      id: 'hap_bridge',
      branchId: 'br_1',
      title: 'The bridge fell',
      description: 'At dawn.',
      category: 'disaster',
      icon: 'bridge',
      temporal: null,
      occurredAtEntryId: 'entry_4',
      commonKnowledge: 1,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(happenings).values(seed)
    await db.insert(happeningInvolvements).values({
      id: 'hinv_1',
      branchId: 'br_1',
      happeningId: 'hap_bridge',
      entityId: 'char_kael',
      role: 'witness',
    })
    const original = await happeningRow(db, 'hap_bridge')
    const payload = HappeningImportSchema.parse(
      payloadOf(happeningExport(original, EXPORTED_AT), 'happening'),
    )
    const copy = await happeningRow(db, okId(await importHappening('br_2', payload, ctx)))
    const portable = [
      'title',
      'description',
      'category',
      'icon',
      'temporal',
      'commonKnowledge',
    ] as const
    expect(pick(copy, portable)).toEqual(pick(original, portable))
    expect(copy.occurredAtEntryId).toBeNull()
    expect(
      await db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'br_2')),
    ).toEqual([])
  })
})
