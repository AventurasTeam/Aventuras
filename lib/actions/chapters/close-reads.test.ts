import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { chapters, type DbCtx } from '@/lib/db'
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  METADATA_REPLY,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { readRecentEntryIds } from '@/lib/pipeline/definitions/entry-reads'
import { readPromptBuffer, type BufferSettings, type QueryAll } from '@/lib/retrieval'
import { loadChapterRanges } from '@/lib/retrieval/source-rows'

import { startManualClose } from './start-manual-close'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

beforeEach(() => {
  resetSingletons()
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue({
    status: 'ok',
    value: METADATA_REPLY,
    recoverable: [],
  })
})

afterEach(() => {
  resetSingletons()
  vi.restoreAllMocks()
})

const TURNS = 12
// The eighth reply: eight entries stay open after it.
const END_REPLY = 7

async function close(fx: CloseFixture): Promise<{ closed: string[]; current: string[] }> {
  const end = fx.replyIds[END_REPLY]
  expect(expectRan(await startManualClose(fx.branchId, end, fx.ctx)).outcome).toBe('completed')
  const ids = fx.entries.map((e) => e.id)
  const endIndex = ids.indexOf(end)
  const split = { closed: ids.slice(0, endIndex + 1), current: ids.slice(endIndex + 1) }
  expect(split.current).toHaveLength(8)
  return split
}

async function buffer(fx: CloseFixture, settings: BufferSettings): Promise<string[]> {
  return (await readPromptBuffer(fx.ctx.db, fx.branchId, settings)).map((row) => row.id)
}

// The app's positional query seam over the fixture's db, binding each `?` in order.
function queryAllOn(db: DbCtx['db']): QueryAll {
  return async (query, params) => {
    const [head, ...rest] = query.split('?')
    const statement = sql.join([
      sql.raw(head),
      ...rest.flatMap((piece, i) => [sql`${params[i]}`, sql.raw(piece)]),
    ])
    return db.all<unknown[]>(statement)
  }
}

describe('reads after a close', () => {
  it('readPromptBuffer follows the Composition rule from the new boundary', async () => {
    const fx = await openCloseFixture({ turns: TURNS })
    const partial = { fullChapterInBuffer: false, partialChapterBuffer: 10, protectedBuffer: 4 }
    // Before the close the whole branch is open, so this window runs back past the coming end.
    expect(await buffer(fx, partial)).toEqual(fx.entries.slice(-10).map((e) => e.id))

    const { closed, current } = await close(fx)

    // Partial: the window clamps to the 8 current entries; the floor of 4 is met.
    expect(await buffer(fx, partial)).toEqual(current)
    // Partial: the floor of 12 fills backwards from the boundary.
    expect(
      await buffer(fx, {
        fullChapterInBuffer: false,
        partialChapterBuffer: 4,
        protectedBuffer: 12,
      }),
    ).toEqual([...closed.slice(-4), ...current])
    // Full: the whole current chapter; the partial term would give 4, so this tells the modes apart.
    expect(
      await buffer(fx, { fullChapterInBuffer: true, partialChapterBuffer: 4, protectedBuffer: 4 }),
    ).toEqual(current)
  })

  it('readRecentEntryIds with no reach-back starts at the new open region', async () => {
    const fx = await openCloseFixture({ turns: TURNS })
    const tail = fx.entries[fx.entries.length - 1]
    const bounds = { firstPosition: tail.position, lastPosition: tail.position, protectedBuffer: 0 }
    expect(await readRecentEntryIds(fx.ctx.db, fx.branchId, bounds)).toEqual(
      new Set(fx.entries.map((e) => e.id)),
    )

    const { current } = await close(fx)

    expect(await readRecentEntryIds(fx.ctx.db, fx.branchId, bounds)).toEqual(new Set(current))
  })

  it('loadChapterRanges returns every stamped entry of the range', async () => {
    const fx = await openCloseFixture({ turns: TURNS })
    const { closed } = await close(fx)
    const [chapter] = await fx.ctx.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.branchId, fx.branchId))

    const ranges = await loadChapterRanges(queryAllOn(fx.ctx.db), fx.branchId)

    expect(ranges).toEqual(new Map([[chapter.id, new Set(closed)]]))
  })
})
