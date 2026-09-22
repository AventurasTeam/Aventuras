import { describe, expect, it } from 'vitest'

import type { Thread } from '@/lib/db'

import { threadActions, threadDraftFrom, threadDraftSchema } from './thread-draft'

const ROW: Thread = {
  id: 'thread_1',
  branchId: 'br_1',
  title: 'Amulet',
  description: 'It hums.',
  category: 'mystery',
  icon: 'sparkles',
  status: 'active',
  injectionMode: 'always',
  triggeredAtEntryId: 'e_5',
  resolvedAtEntryId: null,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

describe('threadDraftSchema', () => {
  it('requires a non-blank title', () => {
    const result = threadDraftSchema.safeParse({ ...threadDraftFrom(ROW), title: '   ' })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]).toMatchObject({ path: ['title'], message: 'titleRequired' })
  })
})

describe('threadActions', () => {
  it('emits one create in create mode with blanks as null', () => {
    const draft = { ...threadDraftFrom(null), title: ' New ', status: 'pending' as const }
    const actions = threadActions({ branchId: 'br_1', row: null, draft, id: 'thread_new', now: 42 })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: 'createThread',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'thread_new',
          title: 'New',
          description: null,
          category: null,
          status: 'pending',
          createdAt: 42,
        },
      },
    })
  })

  it('emits one update carrying only the changed columns', () => {
    const draft = { ...threadDraftFrom(ROW), status: 'resolved' as const, description: '' }
    expect(threadActions({ branchId: 'br_1', row: ROW, draft, id: ROW.id, now: 1 })).toEqual([
      {
        kind: 'updateThread',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'thread_1',
          patch: { status: 'resolved', description: null },
        },
      },
    ])
  })

  it('emits nothing when the draft equals the row', () => {
    expect(
      threadActions({
        branchId: 'br_1',
        row: ROW,
        draft: threadDraftFrom(ROW),
        id: ROW.id,
        now: 1,
      }),
    ).toEqual([])
  })

  it('emits nothing when the committed title and description carry whitespace the draft trims away', () => {
    const untrimmedRow: Thread = { ...ROW, title: '  Amulet  ', description: '  It hums.  \n' }
    expect(
      threadActions({
        branchId: 'br_1',
        row: untrimmedRow,
        draft: threadDraftFrom(untrimmedRow),
        id: untrimmedRow.id,
        now: 1,
      }),
    ).toEqual([])
  })
})
