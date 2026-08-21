import { describe, expect, it } from 'vitest'

import { createTestDb } from './test-db'
import { BIND_CHUNK } from '../bind-limit'

describe('BIND_CHUNK against the real driver', () => {
  // The only test that executes a chunk-sized bind; the rest inspect their ops.
  // A runtime with a lower SQLITE_MAX_VARIABLE_NUMBER breaks every chunked query.
  it('executes a statement binding a whole chunk plus a scalar', async () => {
    const { sqlite } = await createTestDb()
    const ids = Array.from({ length: BIND_CHUNK }, (_, i) => `id_${i}`)
    const placeholders = ids.map(() => '?').join(', ')

    const row = sqlite
      .prepare(`SELECT count(*) AS n FROM stories WHERE title = ? AND id IN (${placeholders})`)
      .get('unused', ...ids) as { n: number }

    // Hardcoded: an empty table binding 8193 variables must answer 0, not throw.
    expect(row.n).toBe(0)
  })

  // The headroom BIND_CHUNK claims: one chunk plus a second list must still fit.
  it('leaves room for a second bound list alongside one chunk', async () => {
    const { sqlite } = await createTestDb()
    const ids = Array.from({ length: BIND_CHUNK }, (_, i) => `id_${i}`)
    const others = Array.from({ length: 1024 }, (_, i) => `br_${i}`)

    const row = sqlite
      .prepare(
        `SELECT count(*) AS n FROM stories
           WHERE id IN (${ids.map(() => '?').join(', ')})
              OR id IN (${others.map(() => '?').join(', ')})`,
      )
      .get(...ids, ...others) as { n: number }

    expect(row.n).toBe(0)
  })
})
