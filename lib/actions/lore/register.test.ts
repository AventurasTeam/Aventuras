import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, lore, stories, type NewLore } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { loreStore } from '@/lib/stores'

import { registerLore } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  // Registration is process-global; reset so only lore is live for this test.
  __resetRegistry()
  registerLore()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  loreStore.__reset()
  loreStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const LORE: NewLore = {
  id: 'lore_1',
  branchId: 'br_1',
  title: 'Aether',
  body: 'The magic that binds.',
  category: 'magic',
  tags: ['magic', 'core'],
  keywords: ['aether', 'mana'],
  injectionMode: 'auto',
  priority: 10,
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(lore).where(eq(lore.id, id))
  return r
}

describe('lore CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether')
    expect(loreStore.getById('lore_1')?.keywords).toEqual(['aether', 'mana'])
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    loreStore.hydrate('br_2', []) // store now holds br_2, not br_1
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether') // DB written
    expect(loreStore.getById('lore_1')).toBeUndefined() // store no-op
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  it('rejects an out-of-range priority on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad: NewLore = { ...LORE, priority: 200 }
    const result = await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'lore_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('update on a whole-array column + scalar produces whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'lore_1',
            patch: {
              tags: ['magic', 'core', 'arcane'], // whole-array change
              keywords: ['aether'], // whole-array change (shrink)
              priority: 50, // scalar change
            },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    // forward applied to DB + store
    expect((await rowFor(db, 'lore_1')).priority).toBe(50)
    expect(loreStore.getById('lore_1')?.tags).toEqual(['magic', 'core', 'arcane'])

    // reverse-replay restores the whole prior arrays + scalar
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'lore_1')
    expect(back.priority).toBe(10)
    expect(back.tags).toEqual(['magic', 'core'])
    expect(back.keywords).toEqual(['aether', 'mana'])
    expect(loreStore.getById('lore_1')?.tags).toEqual(['magic', 'core'])
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createLore', source: 'lore_agent', payload: { entry: LORE } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteLore',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'lore_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'lore_1')).toBeUndefined()
    expect(loreStore.getById('lore_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'lore_1')).title).toBe('Aether')
    expect(loreStore.getById('lore_1')?.title).toBe('Aether')
  })
})
