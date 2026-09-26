import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  stories,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { resetAllStores } from '@/lib/stores'

import type { PipelineAction } from '../types'
import { applyDeltaAction, applyDeltaActionGroup } from './apply-delta-action'

type Db = Awaited<ReturnType<typeof createTestDb>>['db']
type Ctx = {
  db: Db
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
}

const BRANCH = 'b1'

async function setup(): Promise<Ctx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 's1', name: 'm', createdAt: 1 })
  return { db, runInTransaction }
}

function character(id: string, status: NewEntity['status'], keywords: string[]): NewEntity {
  return {
    id,
    branchId: BRANCH,
    kind: 'character',
    name: id,
    description: '',
    status,
    injectionMode: 'auto',
    keywords,
    state: {
      visual: {},
      traits: [],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

async function writeProse(ctx: Ctx, id: string, position: number): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: { id, branchId: BRANCH, position, kind: 'ai_reply', content: id, createdAt: 1 },
        },
      },
      actionId: `act_${id}`,
      branchId: BRANCH,
    },
    ctx,
  )
  expect(result.status).toBe('ok')
}

const classify = (action: PipelineAction, actionId: string, ctx: Ctx) =>
  applyDeltaAction({ action, actionId, branchId: BRANCH }, ctx)

// World's Save commits through the group path (commitRowSave).
const save = (action: PipelineAction, actionId: string, ctx: Ctx) =>
  applyDeltaActionGroup([action], { actionId, branchId: BRANCH }, ctx)

async function deltaOf(db: Db, actionId: string): Promise<Delta | undefined> {
  const rows = (await db.select().from(deltas).where(eq(deltas.actionId, actionId))) as Delta[]
  expect(rows.length).toBeLessThanOrEqual(1)
  return rows[0]
}

async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await Promise.resolve()
}

type Round = { classifier: () => Promise<unknown>; user: () => Promise<unknown> }

/**
 * Starts one writer, then the other `delay` microtasks later, for each delay until the
 * second starts only after the first has settled, with each writer leading in turn. Every
 * interleaving of the two writers' awaits is covered, on real handlers and a real log.
 */
async function sweep(
  prepare: (round: number) => Promise<Round>,
  check: (round: number, label: string) => Promise<void>,
): Promise<void> {
  let round = 0
  for (const lead of ['classifier', 'user'] as const) {
    for (let delay = 0; ; delay++) {
      round++
      const writers = await prepare(round)
      const [first, second] =
        lead === 'classifier'
          ? [writers.classifier, writers.user]
          : [writers.user, writers.classifier]
      let firstSettled = false
      const firstDone = first().then(() => {
        firstSettled = true
      })
      const secondDone = ticks(delay).then(async () => {
        const serial = firstSettled
        await second()
        return serial
      })
      const [, serial] = await Promise.all([firstDone, secondDone])
      await check(round, `${lead} leads by ${delay}`)
      if (serial) break
      if (delay > 5000) throw new Error('the second writer never started after the first settled')
    }
  }
}

describe('a classifier write racing a user Save on one row', () => {
  beforeEach(() => resetAllStores())
  afterEach(() => resetAllStores())

  it('keeps the keyword list consistent with the order the two deltas logged', async () => {
    const ctx = await setup()
    await sweep(
      async (round) => {
        const id = `char_${round}`
        await ctx.db.insert(entities).values(character(id, 'active', ['a', 'b']))
        await writeProse(ctx, `e_${round}`, round)
        return {
          classifier: () =>
            classify(
              {
                kind: 'appendEntityKeywords',
                source: 'periodic_classifier',
                payload: { branchId: BRANCH, id, keywords: ['c'], proseEntryId: `e_${round}` },
              },
              `k_${round}`,
              ctx,
            ),
          user: () =>
            save(
              {
                kind: 'updateEntity',
                source: 'user_edit',
                payload: { branchId: BRANCH, id, patch: { keywords: ['a'] } },
              },
              `u_${round}`,
              ctx,
            ),
        }
      },
      async (round, label) => {
        const machine = await deltaOf(ctx.db, `k_${round}`)
        const user = await deltaOf(ctx.db, `u_${round}`)
        const [row] = await ctx.db
          .select()
          .from(entities)
          .where(eq(entities.id, `char_${round}`))
        expect(machine, label).toBeDefined()
        expect(user, label).toBeDefined()
        if (machine!.logPosition < user!.logPosition) {
          expect(machine!.undoPayload, label).toEqual({ keywords: ['a', 'b'] })
          expect(user!.undoPayload, label).toEqual({ keywords: ['a', 'b', 'c'] })
          expect(row.keywords, label).toEqual(['a'])
        } else {
          // The user removed `b` after the prose, so the append must not bring it back.
          expect(user!.undoPayload, label).toEqual({ keywords: ['a', 'b'] })
          expect(machine!.undoPayload, label).toEqual({ keywords: ['a'] })
          expect(row.keywords, label).toEqual(['a', 'c'])
        }
      },
    )
  })

  it("keeps the user's status against a retire, whichever logged first", async () => {
    const ctx = await setup()
    await sweep(
      async (round) => {
        const id = `char_${round}`
        await ctx.db.insert(entities).values(character(id, 'active', []))
        await writeProse(ctx, `e_${round}`, round)
        return {
          classifier: () =>
            classify(
              {
                kind: 'retireEntity',
                source: 'periodic_classifier',
                payload: {
                  branchId: BRANCH,
                  id,
                  retiredReason: 'fell at the ford',
                  proseEntryId: `e_${round}`,
                },
              },
              `k_${round}`,
              ctx,
            ),
          user: () =>
            save(
              {
                kind: 'updateEntity',
                source: 'user_edit',
                payload: { branchId: BRANCH, id, patch: { status: 'staged' } },
              },
              `u_${round}`,
              ctx,
            ),
        }
      },
      async (round, label) => {
        const machine = await deltaOf(ctx.db, `k_${round}`)
        const user = await deltaOf(ctx.db, `u_${round}`)
        const [row] = await ctx.db
          .select()
          .from(entities)
          .where(eq(entities.id, `char_${round}`))
        expect(user, label).toBeDefined()
        expect(row.status, label).toBe('staged')
        if (machine) {
          // A retire logged after the user's status edit should have no-opped.
          expect(machine.logPosition, label).toBeLessThan(user!.logPosition)
          expect(machine.undoPayload, label).toEqual({ status: 'active', retiredReason: null })
          expect(user!.undoPayload, label).toEqual({ status: 'retired' })
        } else {
          expect(user!.undoPayload, label).toEqual({ status: 'active' })
        }
      },
    )
  })

  it("keeps the user's views against a single-view upsert on a pair the classifier created", async () => {
    const ctx = await setup()
    const pairOf = (round: number) => ({ subjectId: `x_${round}`, objectId: `y_${round}` })
    await sweep(
      async (round) => {
        const created = await classify(
          {
            kind: 'upsertCharacterRelationship',
            source: 'periodic_classifier',
            payload: { branchId: BRANCH, ...pairOf(round), kind: 'friend' },
          },
          `k0_${round}`,
          ctx,
        )
        expect(created.status).toBe('ok')
        await writeProse(ctx, `e_${round}`, round)
        return {
          classifier: () =>
            classify(
              {
                kind: 'upsertCharacterRelationship',
                source: 'periodic_classifier',
                payload: {
                  branchId: BRANCH,
                  ...pairOf(round),
                  kind: 'rival',
                  proseEntryId: `e_${round}`,
                },
              },
              `k_${round}`,
              ctx,
            ),
          user: () =>
            save(
              {
                kind: 'upsertCharacterRelationship',
                source: 'user_edit',
                payload: {
                  branchId: BRANCH,
                  ...pairOf(round),
                  kind: 'ally',
                  inverseKind: 'mentor',
                },
              },
              `u_${round}`,
              ctx,
            ),
        }
      },
      async (round, label) => {
        const machine = await deltaOf(ctx.db, `k_${round}`)
        const user = await deltaOf(ctx.db, `u_${round}`)
        const [row] = await ctx.db
          .select()
          .from(characterRelationships)
          .where(
            and(
              eq(characterRelationships.aId, `x_${round}`),
              eq(characterRelationships.bId, `y_${round}`),
            ),
          )
        expect(user, label).toBeDefined()
        expect(row, label).toMatchObject({ kind: 'ally', inverseKind: 'mentor' })
        if (machine) {
          // An upsert logged after the user's view should have no-opped.
          expect(machine.logPosition, label).toBeLessThan(user!.logPosition)
          expect(machine.undoPayload, label).toEqual({ kind: 'friend' })
          expect(user!.undoPayload, label).toEqual({ kind: 'rival', inverseKind: null })
        } else {
          expect(user!.undoPayload, label).toEqual({ kind: 'friend', inverseKind: null })
        }
      },
    )
  })

  // Promote and append now share one row key; a group re-taking it would wait on itself.
  it('takes a row key once for a group writing that row through two kinds', async () => {
    const ctx = await setup()
    await ctx.db.insert(entities).values(character('char_1', 'staged', ['a']))
    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'promoteStagedEntity',
          source: 'user_edit',
          payload: { branchId: BRANCH, id: 'char_1' },
        },
        {
          kind: 'appendEntityKeywords',
          source: 'user_edit',
          payload: { branchId: BRANCH, id: 'char_1', keywords: ['b'] },
        },
      ],
      { actionId: 'act_1', branchId: BRANCH },
      ctx,
    )
    expect(result).toEqual({ status: 'ok' })
    const logged = await ctx.db.select().from(deltas).where(eq(deltas.actionId, 'act_1'))
    expect(logged).toHaveLength(2)
  })
})
