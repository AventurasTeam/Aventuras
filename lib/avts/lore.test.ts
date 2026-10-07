import { describe, expect, it } from 'vitest'

import type { Lore } from '@/lib/db'

import { LoreImportSchema, loreExport } from './lore'

const EXPORTED_AT = new Date(Date.UTC(2026, 9, 7, 9, 30))

const AETHERIUM: Lore = {
  id: 'lore_7c21',
  branchId: 'br_hero',
  title: 'The Aetherium',
  body: 'A sea of light above the clouds.',
  category: 'cosmology',
  tags: ['core'],
  keywords: ['Aetherium', 'sea of light'],
  injectionMode: 'always',
  priority: 70,
  embeddingStale: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
}

const MINIMAL = { title: 'Vael', body: 'A city of bridges.', injectionMode: 'auto' } as const

function payloadOf(row: Lore) {
  return JSON.parse(loreExport(row, EXPORTED_AT).contents).lore
}

function issuesOf(value: unknown) {
  const result = LoreImportSchema.safeParse(value)
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
}

describe('loreExport', () => {
  it('writes an aventuras-lore envelope of the portable fields only', () => {
    const file = loreExport(AETHERIUM, EXPORTED_AT)
    const parsed = JSON.parse(file.contents)
    expect(parsed).toMatchObject({ format: 'aventuras-lore', formatVersion: '1.0' })
    expect(parsed.lore).toEqual({
      title: 'The Aetherium',
      body: 'A sea of light above the clouds.',
      category: 'cosmology',
      tags: ['core'],
      keywords: ['Aetherium', 'sea of light'],
      injectionMode: 'always',
      priority: 70,
    })
    expect(file.fileName).toBe('lore-the-aetherium.avts')
  })

  it('re-imports its export unchanged', () => {
    const payload = payloadOf(AETHERIUM)
    expect(LoreImportSchema.parse(payload)).toEqual(payload)
  })

  it('writes a row stored without a body as an empty body, which import refuses', () => {
    const payload = payloadOf({ ...AETHERIUM, body: null })
    expect(payload.body).toBe('')
    expect(issuesOf(payload).map((issue) => issue.path)).toEqual([['body']])
  })
})

describe('LoreImportSchema', () => {
  it('reads a minimal file with every default', () => {
    expect(LoreImportSchema.parse(MINIMAL)).toEqual({
      ...MINIMAL,
      category: null,
      tags: [],
      keywords: [],
      priority: 0,
    })
  })

  it('drops server-owned keys and trims text', () => {
    const lore = LoreImportSchema.parse({
      ...MINIMAL,
      title: ' Vael ',
      body: '  A city of bridges. ',
      category: '   ',
      id: 'lore_x',
      branchId: 'br_x',
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(lore).toEqual({
      ...MINIMAL,
      category: null,
      tags: [],
      keywords: [],
      priority: 0,
    })
  })

  it.each(['', '   \n ', undefined])('refuses body %j with one issue at body', (body) => {
    expect(issuesOf({ ...MINIMAL, body })).toEqual([
      { path: ['body'], message: 'Lore needs a body.' },
    ])
  })

  it.each([
    [{ title: '  ' }, ['title'], 'A title is required.'],
    [{ priority: -5 }, ['priority'], 'Enter a whole number from 0 to 100.'],
  ])('refuses %j with one issue', (patch, path, message) => {
    expect(issuesOf({ ...MINIMAL, ...patch })).toEqual([{ path, message }])
  })

  it.each([{ injectionMode: undefined }, { injectionMode: 'sometimes' }])(
    'refuses %j at injectionMode',
    (patch) => {
      expect(issuesOf({ ...MINIMAL, ...patch }).map((issue) => issue.path)).toEqual([
        ['injectionMode'],
      ])
    },
  )
})
