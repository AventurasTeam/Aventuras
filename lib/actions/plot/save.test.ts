import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Delta, Thread } from '@/lib/db'
import {
  branches,
  deltas,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  threads,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { ID_PATTERN } from '@/lib/ids'
import { happeningDraftFrom, threadDraftFrom } from '@/lib/plot'
import { generationStore, resetAllStores } from '@/lib/stores'

import { saveHappening } from './save-happening'
import { saveThread } from './save-thread'
import { __resetRegistry } from '../delta/registry'
import { registerHappeningAwareness } from '../happenings/register-awareness'
import { registerHappenings } from '../happenings/register-happenings'
import { registerHappeningInvolvements } from '../happenings/register-involvements'
import { registerThreads } from '../threads/register'

async function setup() {
  __resetRegistry()
  registerThreads()
  registerHappenings()
  registerHappeningInvolvements()
  registerHappeningAwareness()
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, ctx: { db, runInTransaction } }
}

async function deltaRows(db: Awaited<ReturnType<typeof setup>>['db']): Promise<Delta[]> {
  return (await db.select().from(deltas).where(eq(deltas.branchId, 'br_1'))) as Delta[]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveThread', () => {
  it('creates a thread under one action_id and reports its id', async () => {
    const { db, ctx } = await setup()
    const result = await saveThread(
      {
        branchId: 'br_1',
        row: null,
        draft: { ...threadDraftFrom(null), title: 'E2E thread', status: 'pending' },
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.id).toMatch(ID_PATTERN)
    const [row] = await db.select().from(threads).where(eq(threads.id, result.id))
    expect(row).toMatchObject({ title: 'E2E thread', status: 'pending', injectionMode: 'auto' })
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'create', targetTable: 'threads', source: 'user_edit' })
  })

  it('updates two columns as one delta whose undo payload holds both prior values', async () => {
    const { db, ctx } = await setup()
    const created = await saveThread(
      { branchId: 'br_1', row: null, draft: { ...threadDraftFrom(null), title: 'Amulet' } },
      ctx,
    )
    if (created.status !== 'ok') throw new Error('create failed')
    const [row] = (await db.select().from(threads).where(eq(threads.id, created.id))) as Thread[]
    const result = await saveThread(
      {
        branchId: 'br_1',
        row,
        draft: { ...threadDraftFrom(row), description: 'It hums.', status: 'active' },
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(2)
    const update = rows.find((d) => d.op === 'update')
    expect(update?.undoPayload).toEqual({ description: null, status: 'pending' })
    expect(new Set(rows.map((d) => d.actionId)).size).toBe(2)
  })

  it('writes nothing for an unchanged draft and refuses while generation is in flight', async () => {
    const { db, ctx } = await setup()
    const created = await saveThread(
      { branchId: 'br_1', row: null, draft: { ...threadDraftFrom(null), title: 'Amulet' } },
      ctx,
    )
    if (created.status !== 'ok') throw new Error('create failed')
    const [row] = (await db.select().from(threads).where(eq(threads.id, created.id))) as Thread[]
    expect(await saveThread({ branchId: 'br_1', row, draft: threadDraftFrom(row) }, ctx)).toEqual({
      status: 'ok',
      id: row.id,
    })
    expect(await deltaRows(db)).toHaveLength(1)
    vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
    const refused = await saveThread(
      { branchId: 'br_1', row, draft: { ...threadDraftFrom(row), title: 'X' } },
      ctx,
    )
    expect(refused).toMatchObject({ status: 'rejected', code: 'in-flight' })
  })

  // The UI disables first, so the gate firing is a bug worth a record at the default level.
  it('logs the in-flight refusal at warn', async () => {
    const { ctx } = await setup()
    const warn = vi.spyOn(logger, 'warn')
    vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
    await saveThread(
      { branchId: 'br_1', row: null, draft: { ...threadDraftFrom(null), title: 'Amulet' } },
      ctx,
    )
    expect(warn).toHaveBeenCalledWith('action_layer.thread_save_rejected', {
      branchId: 'br_1',
      id: null,
      code: 'in-flight',
    })
  })

  it('logs a rejected write with the action kinds it carried', async () => {
    const { db, ctx } = await setup()
    const created = await saveThread(
      { branchId: 'br_1', row: null, draft: { ...threadDraftFrom(null), title: 'Amulet' } },
      ctx,
    )
    if (created.status !== 'ok') throw new Error('create failed')
    const [row] = (await db.select().from(threads).where(eq(threads.id, created.id))) as Thread[]
    await db.delete(threads).where(eq(threads.id, row.id))
    const warn = vi.spyOn(logger, 'warn')
    const result = await saveThread(
      { branchId: 'br_1', row, draft: { ...threadDraftFrom(row), title: 'Gone' } },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(warn).toHaveBeenCalledWith(
      'action_layer.thread_save_rejected',
      expect.objectContaining({ id: row.id, create: false, actions: ['updateThread'] }),
    )
  })
})

describe('saveHappening', () => {
  it('creates the row and its links under one action_id, then removes a link under another', async () => {
    const { db, ctx } = await setup()
    const empty = { involvements: [], awareness: [] }
    const created = await saveHappening(
      {
        branchId: 'br_1',
        row: null,
        links: empty,
        draft: {
          ...happeningDraftFrom(null, empty),
          title: 'The alley ambush',
          occurredAtEntryId: 'e_10',
          involvements: [{ id: null, entityId: 'char_kael', role: 'target' }],
          awareness: [
            {
              id: null,
              characterId: 'char_mira',
              learnedAtEntryId: 'e_11',
              decayResistance: 0.6,
              source: 'told',
            },
          ],
        },
      },
      ctx,
    )
    expect(created.status).toBe('ok')
    if (created.status !== 'ok') return
    expect(created.id).toMatch(ID_PATTERN)
    const first = await deltaRows(db)
    expect(first.map((d) => d.targetTable).sort()).toEqual([
      'happening_awareness',
      'happening_involvements',
      'happenings',
    ])
    expect(new Set(first.map((d) => d.actionId)).size).toBe(1)

    const [row] = await db.select().from(happenings).where(eq(happenings.id, created.id))
    const involvements = await db
      .select()
      .from(happeningInvolvements)
      .where(eq(happeningInvolvements.happeningId, created.id))
    const awareness = await db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.happeningId, created.id))
    const links = { involvements, awareness }
    const draft = happeningDraftFrom(row, links)
    const removed = await saveHappening(
      { branchId: 'br_1', row, links, draft: { ...draft, involvements: [] } },
      ctx,
    )
    expect(removed.status).toBe('ok')
    expect(
      await db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.happeningId, created.id)),
    ).toHaveLength(0)
    const second = await deltaRows(db)
    expect(second).toHaveLength(4)
    expect(second.filter((d) => d.op === 'delete')).toHaveLength(1)
  })

  it('logs a thrown write with its context and rethrows it', async () => {
    const { ctx } = await setup()
    const error = vi.spyOn(logger, 'error')
    const empty = { involvements: [], awareness: [] }
    const failing = {
      ...ctx,
      runInTransaction: () => Promise.reject(new Error('SQLITE_BUSY')),
    }
    await expect(
      saveHappening(
        {
          branchId: 'br_1',
          row: null,
          links: empty,
          draft: {
            ...happeningDraftFrom(null, empty),
            title: 'The alley ambush',
            involvements: [{ id: null, entityId: 'char_kael', role: '' }],
          },
        },
        failing,
      ),
    ).rejects.toThrow('SQLITE_BUSY')
    expect(error).toHaveBeenCalledWith(
      'action_layer.happening_save_failed',
      expect.objectContaining({
        branchId: 'br_1',
        create: true,
        actions: ['createHappening', 'createHappeningInvolvement'],
        error: 'SQLITE_BUSY',
      }),
    )
  })
})
