import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  entities,
  happeningInvolvements,
  happenings,
  stories,
  type Delta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import type { PipelineAction } from '../types'
import { applyDeltaAction, applyDeltaActionGroup, lockKeysFor } from './apply-delta-action'
import { __resetRegistrationGuard, registerAllDomains } from './registrations'
import { __resetRegistry, register, type HandlerOutcome } from './registry'
import { deltaLockKeys } from './row-locks'

const LINKS = 'happening_links:b1'

describe('lock keys', () => {
  it('puts every happening link writer and the happening delete on one per-branch key', () => {
    const keys = [
      lockKeysFor({
        kind: 'createHappeningInvolvement',
        source: 'user_edit',
        payload: {
          entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_1' },
        },
      }),
      lockKeysFor({
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hinv_1', patch: { role: 'witness' } },
      }),
      lockKeysFor({
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hinv_1' },
      }),
      lockKeysFor({
        kind: 'upsertHappeningAwareness',
        source: 'periodic_classifier',
        payload: { branchId: 'b1', characterId: 'char_1', happeningId: 'hap_1' },
      }),
      lockKeysFor({
        kind: 'deleteHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'haw_1' },
      }),
      lockKeysFor({
        kind: 'bumpAwarenessRetrieval',
        source: 'ai_classifier',
        payload: { branchId: 'b1', id: 'haw_1', priorCount: 0 },
      }),
      lockKeysFor({
        kind: 'deleteHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1' },
      }),
    ]
    for (const set of keys) expect(set).toEqual([LINKS])
  })

  it('makes an entity delete hold its row, the relationships and the happening links', () => {
    expect(
      [
        ...lockKeysFor({
          kind: 'deleteEntity',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'char_1' },
        }),
      ].sort(),
    ).toEqual(['character_relationships:b1', 'entities:b1:char_1', LINKS])
  })

  it('makes a reversal of an entity delta hold both link families too', () => {
    const delta = { branchId: 'b1', targetTable: 'entities', targetId: 'char_1' } as Delta
    expect([...deltaLockKeys([delta])].sort()).toEqual([
      'character_relationships:b1',
      'entities:b1:char_1',
      LINKS,
    ])
    expect(deltaLockKeys([{ ...delta, targetTable: 'happenings', targetId: 'hap_1' }])).toEqual([
      LINKS,
    ])
  })

  it('makes a reversal of a happening link delta hold the happening links', () => {
    for (const targetTable of ['happening_involvements', 'happening_awareness']) {
      const delta = { branchId: 'b1', targetTable, targetId: 'link_1' } as Delta
      expect(deltaLockKeys([delta])).toEqual([LINKS])
    }
  })
})

const probeRows = sqliteTable('lock_probe_rows', { id: text('id').notNull() })

const NOOP: HandlerOutcome = { status: 'rejected', reason: 'probe only', code: 'noop' }

// Stands in for each kind's real handler, so only the runner's lock acquisition is under test.
function registerProbes(started: string[], gate: Promise<void>) {
  __resetRegistry()
  const record = (kind: string) => () => {
    started.push(kind)
    return NOOP
  }
  register({
    table: 'lock_probe_rows',
    descriptor: { table: probeRows, idCol: probeRows.id },
    columnSchemas: {},
    handlers: {
      deleteEntity: async () => {
        started.push('deleteEntity')
        await gate
        return NOOP
      },
      deleteCharacterRelationship: record('deleteCharacterRelationship'),
      upsertHappeningAwareness: record('upsertHappeningAwareness'),
      deleteHappeningInvolvement: record('deleteHappeningInvolvement'),
      createHappeningInvolvement: record('createHappeningInvolvement'),
    },
  })
}

// The lock chains on promises; a macrotask hop runs every queued continuation.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const run = (action: PipelineAction, ctx: Awaited<ReturnType<typeof createTestDb>>) =>
  applyDeltaAction({ action, actionId: `act_${action.kind}`, branchId: 'b1' }, ctx)

describe('runner lock acquisition', () => {
  // registerProbes swaps in fakes; later tests need the real handlers restored.
  afterEach(() => {
    __resetRegistry()
    __resetRegistrationGuard()
    registerAllDomains()
  })

  it('holds relationship and happening-link writers off while an entity delete runs', async () => {
    const ctx = await createTestDb()
    const started: string[] = []
    let release!: () => void
    registerProbes(started, new Promise<void>((resolve) => (release = resolve)))

    const deleting = run(
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: 'b1', id: 'c1' } },
      ctx,
    )
    await flush()
    const writes = [
      run(
        {
          kind: 'deleteCharacterRelationship',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'rel_1' },
        },
        ctx,
      ),
      run(
        {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: { branchId: 'b1', characterId: 'c2', happeningId: 'hap_1' },
        },
        ctx,
      ),
    ]
    await flush()
    // Snapshot, then release before asserting: a stranded holder would block every later test.
    const whileDeleting = [...started]
    release()
    await Promise.all([deleting, ...writes])

    expect(whileDeleting).toEqual(['deleteEntity'])
    expect(started.slice(1).sort()).toEqual([
      'deleteCharacterRelationship',
      'upsertHappeningAwareness',
    ])
  })

  it('completes a group whose actions share a key', async () => {
    const ctx = await createTestDb()
    const started: string[] = []
    registerProbes(started, Promise.resolve())

    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'createHappeningInvolvement',
          source: 'user_edit',
          payload: {
            entry: { id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'c1' },
          },
        },
        {
          kind: 'upsertHappeningAwareness',
          source: 'user_edit',
          payload: { branchId: 'b1', characterId: 'c1', happeningId: 'hap_1' },
        },
        {
          kind: 'deleteHappeningInvolvement',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'hinv_1' },
        },
      ],
      { actionId: 'act_1', branchId: 'b1' },
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect(started).toEqual([
      'createHappeningInvolvement',
      'upsertHappeningAwareness',
      'deleteHappeningInvolvement',
    ])
  })
})

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++)
    await new Promise((resolve) => setTimeout(resolve, 0))
  expect(condition()).toBe(true)
}

describe("a happening's delete and a link write can't interleave", () => {
  it('parks the link write until the delete commits, then drops it', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(entities).values({
      id: 'char_a',
      branchId: 'b1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(happenings)
      .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
    await db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_a' })

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let parked = false
    const gatedCtx = {
      db,
      runInTransaction: async (ops: Parameters<typeof runInTransaction>[0]) => {
        if (!parked) {
          parked = true
          await gate
        }
        return runInTransaction(ops)
      },
    }

    const deleting = applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'hap_1' },
        },
        actionId: 'act_1',
        branchId: 'b1',
      },
      gatedCtx,
    )
    await until(() => parked)
    const linking = applyDeltaAction(
      {
        action: {
          kind: 'createHappeningInvolvement',
          source: 'user_edit',
          payload: {
            entry: { id: 'hinv_2', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_a' },
          },
        },
        actionId: 'act_2',
        branchId: 'b1',
      },
      gatedCtx,
    )
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await db.select().from(happeningInvolvements)).toHaveLength(1)

    release()
    const [deleted, linked] = await Promise.all([deleting, linking])
    expect(deleted).toMatchObject({ status: 'ok' })
    expect(linked).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await db.select().from(happeningInvolvements)).toEqual([])
  })
})
