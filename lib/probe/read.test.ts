import { afterEach, describe, expect, it, vi } from 'vitest'

import { CAPTURE_VERSION, type ProbeCapturePayload } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { RANKER_DEFAULTS } from '@/lib/retrieval'
import { retrievalFailure } from '@/lib/retrieval/__tests__/outcome'
import { queryAllOf } from '@/lib/retrieval/__tests__/query-all'

import { captureInput, seededDb } from './__tests__/fixtures'
import { compressPayload } from './compress'
import { buildCapturePayload } from './payload'
import {
  capturesForStoryQuery,
  clearCapturesForStoryOp,
  decodeCapture,
  decodeCaptures,
  deleteCaptureOp,
} from './read'
import { writeProbeCapture } from './writer'

describe('capturesForStoryQuery', () => {
  it('reads captures for a story newest-first, across its branches', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_1', branchId: 'br_a', capturedAt: 1000 }),
    )
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_2', branchId: 'br_b', capturedAt: 2000 }),
    )

    const q = capturesForStoryQuery('st_1')
    const rows = (await queryAllOf(sqlite)(q.sql, q.params)).map((r) => decodeCapture(r))

    expect(rows.map((c) => c.id)).toEqual(['pc_2', 'pc_1'])
  })

  it('keeps existing captures readable after a gate flips off', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture({ runInTransaction }, captureInput())

    // Only new writes stop; removal is always explicit (probe.md → Scope).
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_2', storyGateOn: false }))

    const q = capturesForStoryQuery('st_1')
    expect(await queryAllOf(sqlite)(q.sql, q.params)).toHaveLength(1)
  })

  it('does not read across into a second story', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_1', branchId: 'br_a' }))
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_2', branchId: 'br_c' }))

    const q = capturesForStoryQuery('st_1')
    const rows = (await queryAllOf(sqlite)(q.sql, q.params)).map((r) => decodeCapture(r))

    expect(rows.map((c) => c.id)).toEqual(['pc_1'])
  })
})

describe('decodeCapture', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps every field distinctly, with no positional transposition', async () => {
    const { sqlite, runInTransaction } = await seededDb()
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
    const [row] = await queryAllOf(sqlite)(q.sql, q.params)
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
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ params: { ...RANKER_DEFAULTS, lambdaDiv: 0 } }),
    )

    const q = capturesForStoryQuery('st_1')
    const [row] = await queryAllOf(sqlite)(q.sql, q.params)

    expect(() => decodeCapture(row)).toThrow(/ranker param/i)
  })

  it("decodes each row's own payload, not a neighboring row's", async () => {
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_1', branchId: 'br_a', targetEntryId: 'ent_a' }),
    )
    await writeProbeCapture(
      { runInTransaction },
      captureInput({ id: 'pc_2', branchId: 'br_b', targetEntryId: 'ent_b' }),
    )

    const q = capturesForStoryQuery('st_1')
    const rows = (await queryAllOf(sqlite)(q.sql, q.params)).map((r) => decodeCapture(r))

    expect(rows.find((c) => c.id === 'pc_1')?.payload.target_entry_id).toBe('ent_a')
    expect(rows.find((c) => c.id === 'pc_2')?.payload.target_entry_id).toBe('ent_b')
  })

  // Each container a consumer indexes into, dropped one at a time: a payload
  // that decodes but cannot be read is a corrupt row, and only a guard at this
  // boundary can classify it as one — replayType's `pools[type]` throws a raw
  // TypeError from inside the simulator instead.
  it.each<[string, (payload: Record<string, unknown>) => void, RegExp]>([
    ['params', (p) => delete p.params, /params/i],
    ['pools', (p) => delete p.pools, /pools/i],
    [
      'one pool',
      (p) => {
        delete (p.pools as Record<string, unknown>).happenings
      },
      /pools\.happenings/i,
    ],
    ['queries', (p) => delete p.queries, /queries/i],
    [
      'a query',
      (p) => {
        ;(p.queries as unknown[]).pop()
      },
      /queries/i,
    ],
  ])('rejects a payload missing %s, not a raw TypeError', (_field, corrupt, message) => {
    const corrupted = { ...buildCapturePayload(captureInput()) } as unknown as Record<
      string,
      unknown
    >
    corrupt(corrupted)
    const { bytes } = compressPayload(corrupted as unknown as ProbeCapturePayload)

    expect(() => decodeCapture(['pc_1', 'br_a', 1000, 'light', null, 100, bytes])).toThrow(message)
  })

  it('rejects a payload that decodes to something other than an object', () => {
    const { bytes } = compressPayload('not a capture' as unknown as ProbeCapturePayload)

    expect(() => decodeCapture(['pc_1', 'br_a', 1000, 'light', null, 100, bytes])).toThrow(
      /must be an object/i,
    )
  })

  // One capture format: a payload from an older one has fields the current type
  // claims are present, so it is refused rather than decoded into a shape that
  // lies. decodeCaptures routes the throw to `corrupt`, keeping the row listed
  // and deletable — which is the only reason refusing here is safe.
  it('refuses a capture written by an older format version', () => {
    const { bytes } = compressPayload({
      ...buildCapturePayload(captureInput()),
      capture_version: CAPTURE_VERSION - 1,
    })

    expect(() => decodeCapture(['pc_1', 'br_a', 1000, 'light', null, 100, bytes])).toThrow(
      /format version/i,
    )
  })

  // Tokenizer identity is not the capture format: it changes what
  // tokens_estimated counted, which only a re-price would notice.
  it('warns on tokenizer drift and still returns the capture', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { bytes } = compressPayload({
      ...buildCapturePayload(captureInput()),
      tokenizer: { encoding: 'cl100k_base', version: '1' },
    })

    const decoded = decodeCapture(['pc_1', 'br_a', 1000, 'light', null, 100, bytes])

    expect(decoded.id).toBe('pc_1')
    expect(warn).toHaveBeenCalledWith(
      'memory.probe_capture_tokenizer_drift',
      expect.objectContaining({ id: 'pc_1' }),
    )
    warn.mockRestore()
  })
})

describe('decodeCaptures', () => {
  it('isolates a corrupt row instead of failing the whole list', async () => {
    const { sqlite, runInTransaction } = await seededDb()
    await writeProbeCapture({ runInTransaction }, captureInput({ id: 'pc_good', branchId: 'br_a' }))

    const q = capturesForStoryQuery('st_1')
    const [goodRow] = await queryAllOf(sqlite)(q.sql, q.params)
    const corrupted = { ...buildCapturePayload(captureInput()) } as Record<string, unknown>
    delete corrupted.params
    const { bytes } = compressPayload(corrupted as unknown as ProbeCapturePayload)
    const badRow = ['pc_bad', 'br_b', 999, 'light', null, 10, bytes]

    const result = decodeCaptures([goodRow, badRow])

    expect(result.ok.map((c) => c.id)).toEqual(['pc_good'])
    expect(result.corrupt).toEqual([{ id: 'pc_bad', branchId: 'br_b', error: expect.any(Error) }])
  })
})

describe('deleteCaptureOp / clearCapturesForStoryOp', () => {
  it('deletes one capture and clears a story without touching another story', async () => {
    const { sqlite, runInTransaction } = await seededDb()
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
    const { sqlite, runInTransaction } = await seededDb()
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
