import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  branches,
  deltas,
  entities,
  happeningInvolvements,
  happenings,
  stories,
  type Delta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { registerAllDomains } from './registrations'
import { selectReversalSet } from './row-closure'

// The setup file already loaded row-closure against the real chunk size; a fresh graph sees the mock.
vi.hoisted(() => {
  vi.resetModules()
})

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BIND_CHUNK: 2,
}))

const CHARS = ['a', 'b', 'c']

const delta = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: 'act_run',
  op: 'create',
  entryId: null,
  source: 'periodic_classifier',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

/** The length of every `IN (...)` list on `column`, in statement order. */
function inListSizes(statements: readonly string[], column: string): number[] {
  return statements.flatMap((sql) =>
    [...sql.matchAll(/("\w+"\."\w+") in \(([?, ]*)\)/g)]
      .filter(([, named]) => named === column)
      .map(([, , binds]) => binds.split(',').length),
  )
}

beforeAll(() => {
  registerAllDomains()
})

// Three created characters, each a later pass linked and the user then renamed.
async function seed() {
  const { db, sqlite, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(entities).values(
    CHARS.map((c) => ({
      id: `char_${c}`,
      branchId: 'b1',
      kind: 'character' as const,
      name: c,
      status: 'active' as const,
      injectionMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
    })),
  )
  await db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
  await db.insert(happeningInvolvements).values(
    CHARS.map((c) => ({
      id: `hinv_${c}`,
      branchId: 'b1',
      happeningId: 'hap_1',
      entityId: `char_${c}`,
    })),
  )
  const creates = CHARS.map((c, i) =>
    delta(`d_c${c}`, 1 + i, { targetTable: 'entities', targetId: `char_${c}` }),
  )
  await db.insert(deltas).values([
    ...creates,
    ...CHARS.map((c, i) =>
      delta(`d_i${c}`, 4 + i, {
        actionId: 'act_pass',
        targetTable: 'happening_involvements',
        targetId: `hinv_${c}`,
      }),
    ),
    ...CHARS.map((c, i) =>
      delta(`d_u${c}`, 7 + i, {
        actionId: 'act_user',
        source: 'user_edit',
        op: 'update',
        targetTable: 'entities',
        targetId: `char_${c}`,
        undoPayload: { name: 'x' },
      }),
    ),
  ])
  return { sqlite, ctx: { db, runInTransaction }, creates }
}

describe('the reversal closure across bind chunks', () => {
  it('finds every write and referrer when each id list spans several chunks', async () => {
    const { sqlite, ctx, creates } = await seed()
    const prepare = vi.spyOn(sqlite, 'prepare')

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: creates })

    expect(set.rows.map((d) => d.id)).toEqual([
      'd_uc',
      'd_ub',
      'd_ua',
      'd_ic',
      'd_ib',
      'd_ia',
      'd_cc',
      'd_cb',
      'd_ca',
    ])
    const statements = prepare.mock.calls.map(([sql]) => sql)
    expect(inListSizes(statements, '"deltas"."target_id"')).toEqual([2, 1, 2, 1])
    expect(inListSizes(statements, '"happening_involvements"."entity_id"')).toEqual([2, 1])
  })
})
