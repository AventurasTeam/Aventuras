import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { createTestDb } from '@/lib/db/__tests__/test-db'
import { RANKER_DEFAULTS } from '@/lib/retrieval'
import { retrievalFailure } from '@/lib/retrieval/__tests__/outcome'

import { captureInput, seed } from './__tests__/fixtures'
import { compressPayload } from './compress'
import { buildCapturePayload } from './payload'
import {
  capturesForStoryQuery,
  clearCapturesForStoryOp,
  decodeCapture,
  deleteCaptureOp,
} from './read'
import { writeProbeCapture } from './writer'

function rowsOf(db: DatabaseSync, sql: string, params: unknown[]): unknown[][] {
  return (db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[]).map(
    (row) => Object.values(row),
  )
}

describe('capturesForStoryQuery', () => {
  it('reads captures for a story newest-first, across its branches', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_1', branchId: 'br_a', capturedAt: 1000 }),
    )
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_2', branchId: 'br_b', capturedAt: 2000 }),
    )

    const q = capturesForStoryQuery('st_1')
    const rows = rowsOf(sqlite, q.sql, q.params).map((r) => decodeCapture(r))

    expect(rows.map((c) => c.id)).toEqual(['pc_2', 'pc_1'])
  })

  it('keeps existing captures readable after a gate flips off', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture({ runInTransaction }, captureInput())

    // Only new writes stop; removal is always explicit (probe.md → Scope).
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_2', storyGateOn: false }))

    const q = capturesForStoryQuery('st_1')
    expect(rowsOf(sqlite, q.sql, q.params)).toHaveLength(1)
  })

  it('does not read across into a second story', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_1', branchId: 'br_a' }))
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_2', branchId: 'br_c' }))

    const q = capturesForStoryQuery('st_1')
    const rows = rowsOf(sqlite, q.sql, q.params).map((r) => decodeCapture(r))

    expect(rows.map((c) => c.id)).toEqual(['pc_1'])
  })
})

describe('decodeCapture', () => {
  it('maps every field distinctly, with no positional transposition', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    const testInput = captureInput({
      id: 'pc_distinct',
      branchId: 'br_a',
      capturedAt: 4242,
      mode: 'deep',
      outcome: retrievalFailure({
        reason: 'call',
        detail: 'provider unreachable',
        staleCount: null,
      }),
    })
    await writeProbeCapture({ runInTransaction }, testInput)

    const q = capturesForStoryQuery('st_1')
    const [row] = rowsOf(sqlite, q.sql, q.params)
    const decoded = decodeCapture(row)

    expect(decoded.id).toBe('pc_distinct')
    expect(decoded.branchId).toBe('br_a')
    expect(decoded.capturedAt).toBe(4242)
    expect(decoded.captureMode).toBe('deep')
    expect(decoded.failureReason).toBe('call')
    expect(decoded.payloadSize).toBe(
      compressPayload(buildCapturePayload(testInput)).uncompressedSize,
    )
    expect(decoded.payload).toEqual(buildCapturePayload(testInput))
  })

  it('rejects a capture whose stored ranker params are out of range', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ params: { ...RANKER_DEFAULTS, lambdaDiv: 0 } }),
    )

    const q = capturesForStoryQuery('st_1')
    const [row] = rowsOf(sqlite, q.sql, q.params)

    expect(() => decodeCapture(row)).toThrow(/ranker param/i)
  })

  it("decodes each row's own payload, not a neighboring row's", async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_1', branchId: 'br_a', targetEntryId: 'ent_a' }),
    )
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_2', branchId: 'br_b', targetEntryId: 'ent_b' }),
    )

    const q = capturesForStoryQuery('st_1')
    const rows = rowsOf(sqlite, q.sql, q.params).map((r) => decodeCapture(r))

    expect(rows.find((c) => c.id === 'pc_1')?.payload.target_entry_id).toBe('ent_a')
    expect(rows.find((c) => c.id === 'pc_2')?.payload.target_entry_id).toBe('ent_b')
  })
})

describe('deleteCaptureOp / clearCapturesForStoryOp', () => {
  it('deletes one capture and clears a story without touching another story', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_1' }))
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_2' }))
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_3', branchId: 'br_c' }))

    await runInTransaction([deleteCaptureOp('br_a', 'pc_1')])
    expect(sqlite.prepare('SELECT count(*) AS n FROM probe_captures').get()).toMatchObject({ n: 2 })

    await runInTransaction([clearCapturesForStoryOp('st_1')])
    const left = sqlite.prepare('SELECT branch_id FROM probe_captures').all() as {
      branch_id: string
    }[]
    // The other story survives — a bare DELETE with no story predicate would not.
    expect(left.map((r) => r.branch_id)).toEqual(['br_c'])
  })

  it('scopes the delete to the given branch, not just the given id', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    // The PK is composite (branch_id, id): two branches may legitimately hold
    // the same capture id.
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_dup', branchId: 'br_a' }))
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_dup', branchId: 'br_b' }))

    await runInTransaction([deleteCaptureOp('br_a', 'pc_dup')])

    const left = sqlite.prepare('SELECT branch_id FROM probe_captures').all() as {
      branch_id: string
    }[]
    expect(left.map((r) => r.branch_id)).toEqual(['br_b'])
  })
})
