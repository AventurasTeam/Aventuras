import { describe, expect, it } from 'vitest'

import type { Thread } from '@/lib/db'

import { ThreadImportSchema, threadExport } from './thread'

const EXPORTED_AT = new Date(Date.UTC(2026, 9, 7, 9, 30))

const HEIR: Thread = {
  id: 'thr_51b0',
  branchId: 'br_hero',
  title: 'Find the Heir',
  description: 'The old king’s child is hidden somewhere in the north.',
  category: 'quest',
  icon: 'crown',
  status: 'active',
  injectionMode: 'always',
  triggeredAtEntryId: 'ent_3',
  resolvedAtEntryId: 'ent_40',
  embeddingStale: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
}

const MINIMAL = { title: 'Hold the Pass', status: 'pending', injectionMode: 'auto' } as const

function payloadOf(row: Thread) {
  return JSON.parse(threadExport(row, EXPORTED_AT).contents).thread
}

function issuesOf(value: unknown) {
  const result = ThreadImportSchema.safeParse(value)
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
}

describe('threadExport', () => {
  it('writes an aventuras-thread envelope without entry refs or server-owned keys', () => {
    const file = threadExport(HEIR, EXPORTED_AT)
    const parsed = JSON.parse(file.contents)
    expect(parsed).toMatchObject({ format: 'aventuras-thread', formatVersion: '1.0' })
    expect(parsed.thread).toEqual({
      title: 'Find the Heir',
      description: 'The old king’s child is hidden somewhere in the north.',
      category: 'quest',
      icon: 'crown',
      status: 'active',
      injectionMode: 'always',
    })
    expect(file.fileName).toBe('thread-find-the-heir.avts')
  })

  it('writes absent optional text as null', () => {
    expect(payloadOf({ ...HEIR, description: null, category: null, icon: null })).toEqual({
      title: 'Find the Heir',
      description: null,
      category: null,
      icon: null,
      status: 'active',
      injectionMode: 'always',
    })
  })

  it('re-imports its export unchanged', () => {
    const payload = payloadOf(HEIR)
    expect(ThreadImportSchema.parse(payload)).toEqual(payload)
  })
})

describe('ThreadImportSchema', () => {
  it('reads a minimal file with blank optional text as null', () => {
    const blank = { description: ' ', category: '  ', icon: '' }
    expect(ThreadImportSchema.parse({ ...MINIMAL, ...blank })).toEqual({
      ...MINIMAL,
      description: null,
      category: null,
      icon: null,
    })
  })

  it('drops hand-authored entry refs and server-owned keys', () => {
    const thread = ThreadImportSchema.parse({
      ...MINIMAL,
      triggeredAtEntryId: 'ent_3',
      resolvedAtEntryId: 'ent_40',
      id: 'thr_x',
      branchId: 'br_x',
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(thread).toEqual({ ...MINIMAL, description: null, category: null, icon: null })
  })

  it.each([{ status: undefined }, { status: 'abandoned' }])(
    'refuses %j with one issue at status',
    (patch) => {
      expect(issuesOf({ ...MINIMAL, ...patch }).map((issue) => issue.path)).toEqual([['status']])
    },
  )

  it('refuses a blank title with the title copy', () => {
    expect(issuesOf({ ...MINIMAL, title: '\t' })).toEqual([
      { path: ['title'], message: 'A title is required.' },
    ])
  })

  it('refuses a missing injectionMode', () => {
    expect(issuesOf({ ...MINIMAL, injectionMode: undefined }).map((issue) => issue.path)).toEqual([
      ['injectionMode'],
    ])
  })
})
