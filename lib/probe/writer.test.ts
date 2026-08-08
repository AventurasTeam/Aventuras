import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { createTestDb } from '@/lib/db/__tests__/test-db'
import { RANKER_DEFAULTS } from '@/lib/retrieval'

import { successOutcome } from './__tests__/fixtures'
import { compressPayload } from './compress'
import { buildCapturePayload } from './payload'
import { writeProbeCapture } from './writer'

// One story, two branches — the FIFO trim is per story, so it must be
// exercised across them or a per-branch trim would pass.
function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO stories (id, title, created_at, updated_at)
      VALUES ('st_1', 'Tidewater', 1000, 1000);
    INSERT INTO branches (id, story_id, name, created_at)
      VALUES ('br_a', 'st_1', 'main', 1000), ('br_b', 'st_1', 'fork', 1000);
  `)
}

// Both gates on, branch A, a successful pass. Every case overrides only what it
// is about.
const input = () => ({
  id: 'pc_1',
  branchId: 'br_a',
  targetEntryId: 'ent_1',
  chapterId: null,
  capturedAt: 1000,
  embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
  mode: 'light' as const,
  appGateOn: true,
  storyGateOn: true,
  failureReason: null,
  params: RANKER_DEFAULTS,
  settings: {
    retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
    fullChapterInBuffer: false,
    partialChapterBuffer: 2,
    protectedBuffer: 1,
  },
  outcome: successOutcome(),
})

describe('writeProbeCapture', () => {
  it('writes one row when both gates are on', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)

    const result = await writeProbeCapture({ runInTransaction }, input())

    expect(result).toBe('written')
    expect(sqlite.prepare('SELECT count(*) AS n FROM probe_captures').get()).toMatchObject({
      n: 1,
    })
  })

  it.each([
    ['app gate off', { appGateOn: false, storyGateOn: true }],
    ['story gate off', { appGateOn: true, storyGateOn: false }],
  ])('writes nothing when the %s', async (_label, gates) => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)

    const result = await writeProbeCapture({ runInTransaction }, { ...input(), ...gates })

    expect(result).toBe('gated')
    expect(sqlite.prepare('SELECT count(*) AS n FROM probe_captures').get()).toMatchObject({
      n: 0,
    })
  })

  it('writes the row read back from the db, matching the input identity and true payload size', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)
    const testInput = input()

    await writeProbeCapture({ runInTransaction }, testInput)

    // Recomputed independently from the same input rather than compared to a
    // literal: pins payload_size to the pre-compression byte count specifically,
    // distinguishing it from the compressed length also stored in the row.
    const expected = compressPayload(buildCapturePayload(testInput))
    const row = sqlite.prepare('SELECT * FROM probe_captures WHERE id = ?').get('pc_1') as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({
      branch_id: 'br_a',
      id: 'pc_1',
      target_entry_id: 'ent_1',
      captured_at: 1000,
      capture_mode: 'light',
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      failure_reason: null,
    })
    expect(row.payload).toEqual(expected.bytes)
    expect(row.payload_size).toBe(expected.uncompressedSize)
    expect(row.payload_size).not.toBe((expected.bytes as Uint8Array).length)
  })

  it('evicts the oldest across branches at the 101st capture for the story', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seed(sqlite)

    for (let i = 0; i < 100; i++) {
      await writeProbeCapture(
        { runInTransaction },
        {
          ...input(),
          id: `pc_${i}`,
          branchId: i % 2 === 0 ? 'br_a' : 'br_b',
          capturedAt: 1000 + i,
        },
      )
    }
    await writeProbeCapture(
      { runInTransaction },
      { ...input(), id: 'pc_100', branchId: 'br_b', capturedAt: 2000 },
    )

    const rows = sqlite.prepare('SELECT id FROM probe_captures ORDER BY captured_at').all() as {
      id: string
    }[]
    expect(rows).toHaveLength(100)
    // pc_0 was written on br_a; a br_b write evicting it is what makes the trim
    // per story rather than per branch.
    expect(rows.map((r) => r.id)).not.toContain('pc_0')
    expect(rows.map((r) => r.id)).toContain('pc_100')
  })

  it('does not fail the turn when the write fails', async () => {
    const runInTransaction = vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed'))

    const result = await writeProbeCapture({ runInTransaction }, input())

    expect(result).toBe('failed')
  })
})
