import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { retrievalFailure } from '@/lib/retrieval/__tests__/outcome'

import { captureInput, seededDb } from './__tests__/fixtures'
import { compressPayload, decompressPayload } from './compress'
import { buildCapturePayload } from './payload'
import { writeProbeCapture, type CaptureWriteInput } from './writer'

describe('writeProbeCapture', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes one row when both gates are on', async () => {
    const { sqlite, runInTransaction } = await seededDb()

    const result = await writeProbeCapture({ runInTransaction }, captureInput())

    expect(result).toBe('written')
    expect(sqlite.prepare('SELECT count(*) AS n FROM probe_captures').get()).toMatchObject({
      n: 1,
    })
  })

  it.each([
    ['app gate off', { appGateOn: false, storyGateOn: true }],
    ['story gate off', { appGateOn: true, storyGateOn: false }],
  ])('writes nothing when the %s', async (_label, gates) => {
    const { sqlite, runInTransaction } = await seededDb()

    const result = await writeProbeCapture({ runInTransaction }, captureInput(gates))

    expect(result).toBe('gated')
    expect(sqlite.prepare('SELECT count(*) AS n FROM probe_captures').get()).toMatchObject({
      n: 0,
    })
  })

  it('writes the row read back from the db, matching the input identity and true payload size', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    const testInput = captureInput()

    await writeProbeCapture({ runInTransaction }, testInput)

    // Pins payload_size to the pre-compression byte count, not the compressed length.
    const expectedPayload = buildCapturePayload(testInput)
    const expected = compressPayload(expectedPayload)
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
    // fflate stamps the current second into the gzip header, so two independently
    // compressed copies of identical JSON differ whenever a second boundary falls
    // between them. Decoding proves the stored blob round-trips without depending
    // on gzip being deterministic in time.
    expect(decompressPayload(row.payload as Uint8Array)).toEqual(expectedPayload)
    expect(row.payload_size).toBe(expected.uncompressedSize)
  })

  it('derives failure_reason from a failed outcome instead of a caller-supplied field', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    const failedOutcome = retrievalFailure({
      reason: 'call',
      detail: 'provider unreachable',
      staleCount: null,
    })

    await writeProbeCapture({ runInTransaction }, captureInput({ outcome: failedOutcome }))

    const row = sqlite.prepare('SELECT failure_reason FROM probe_captures WHERE id = ?').get('pc_1')
    expect(row).toMatchObject({ failure_reason: 'call' })
  })

  it('evicts the oldest across branches at the 101st capture for the story, without touching another story', async () => {
    const { sqlite, runInTransaction } = await seededDb()

    // st_2's captures predate every st_1 capture below — the rows a story-
    // unscoped evict would reach for first, since it would sort globally
    // rather than within st_1 alone.
    for (let i = 0; i < 3; i++) {
      await writeProbeCapture(
        { runInTransaction },
        captureInput({ id: `pc_other_${i}`, branchId: 'br_c', capturedAt: i }),
      )
    }

    for (let i = 0; i < 100; i++) {
      await writeProbeCapture(
        { runInTransaction },
        captureInput({
          id: `pc_${i}`,
          branchId: i % 2 === 0 ? 'br_a' : 'br_b',
          capturedAt: 1000 + i,
        }),
      )
    }
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_100', branchId: 'br_b', capturedAt: 2000 }),
    )

    const rows = sqlite
      .prepare('SELECT id, branch_id FROM probe_captures ORDER BY captured_at')
      .all() as { id: string; branch_id: string }[]
    const st1Rows = rows.filter((r) => r.branch_id !== 'br_c')
    const st2Rows = rows.filter((r) => r.branch_id === 'br_c')

    expect(st1Rows).toHaveLength(100)
    // pc_0 was written on br_a; a br_b write evicting it is what makes the trim
    // per story rather than per branch.
    expect(st1Rows.map((r) => r.id)).not.toContain('pc_0')
    expect(st1Rows.map((r) => r.id)).toContain('pc_100')
    expect(st2Rows.map((r) => r.id)).toEqual(['pc_other_0', 'pc_other_1', 'pc_other_2'])
  })

  it('does not fail the turn when the write fails, and logs why', async () => {
    const runInTransaction = vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    const result = await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_9' }))

    expect(result).toBe('failed')
    // The message the failure banner in Story Settings counts, and the error
    // text without which a swallowed write is undiagnosable.
    expect(warn).toHaveBeenCalledWith(
      'memory.probe_capture_write_failed',
      expect.objectContaining({
        branchId: 'br_a',
        id: 'pc_9',
        error: 'UNIQUE constraint failed',
      }),
    )
  })

  it('does not fail the turn when the payload cannot be encoded', async () => {
    const { runInTransaction } = await createTestDb()
    // Reaches payload.params.ranker, where JSON.stringify throws inside
    // compressPayload (probe.md → Capture write failure names gzip/encode
    // errors explicitly, not just DB errors).
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const result = await writeProbeCapture(
      { runInTransaction },
      captureInput({ params: circular as unknown as CaptureWriteInput['params'] }),
    )

    expect(result).toBe('failed')
  })
})
