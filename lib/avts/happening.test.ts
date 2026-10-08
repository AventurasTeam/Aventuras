import { describe, expect, it } from 'vitest'

import type { Happening } from '@/lib/db'

import { HappeningImportSchema, happeningExport } from './happening'

const EXPORTED_AT = new Date(Date.UTC(2026, 9, 7, 9, 30))

const AMBUSH: Happening = {
  id: 'hap_93de',
  branchId: 'br_hero',
  title: 'Ambush at the ford',
  description: 'Raiders struck the caravan at dusk.',
  category: 'battle',
  icon: 'swords',
  temporal: null,
  occurredAtEntryId: 'ent_7',
  commonKnowledge: 1,
  embeddingStale: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
}

const FOUNDING: Happening = {
  ...AMBUSH,
  id: 'hap_0001',
  title: 'Founding of Vael',
  temporal: 'Three centuries before the story',
  occurredAtEntryId: null,
  commonKnowledge: 0,
}

const MINIMAL = { title: 'The bridge fell' } as const

const DEFAULTS = {
  description: null,
  category: null,
  icon: null,
  temporal: null,
  commonKnowledge: 0,
}

function payloadOf(row: Happening) {
  return JSON.parse(happeningExport(row, EXPORTED_AT).contents).happening
}

function issuesOf(value: unknown) {
  const result = HappeningImportSchema.safeParse(value)
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
}

describe('HappeningImportSchema', () => {
  it('refuses an entry anchor and a temporal anchor together, naming the exclusivity', () => {
    expect(issuesOf({ ...MINIMAL, occurredAtEntryId: 'ent_7', temporal: 'At dusk' })).toEqual([
      {
        path: ['occurredAtEntryId'],
        message: 'occurredAtEntryId and temporal can’t both be set.',
      },
    ])
  })

  it('reads an entry anchor alone and drops it', () => {
    const happening = HappeningImportSchema.parse({ ...MINIMAL, occurredAtEntryId: 'ent_7' })
    expect(happening).toEqual({ ...MINIMAL, ...DEFAULTS })
    expect(happening).not.toHaveProperty('occurredAtEntryId')
  })

  it('keeps a temporal anchor', () => {
    expect(HappeningImportSchema.parse({ ...MINIMAL, temporal: ' Long ago ' }).temporal).toBe(
      'Long ago',
    )
  })

  it.each([
    ['', 'At dusk'],
    ['   ', 'At dusk'],
    [null, 'At dusk'],
    ['ent_7', '  '],
  ])('reads entry anchor %j beside temporal %j as one anchor', (occurredAtEntryId, temporal) => {
    expect(issuesOf({ ...MINIMAL, occurredAtEntryId, temporal })).toEqual([])
  })

  it('drops hand-authored involvements, awareness and server-owned keys', () => {
    const happening = HappeningImportSchema.parse({
      ...MINIMAL,
      involvements: [{ entityId: 'char_1', role: 'actor' }],
      awareness: [{ characterId: 'char_1', source: 'witnessed' }],
      id: 'hap_x',
      branchId: 'br_x',
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(happening).toEqual({ ...MINIMAL, ...DEFAULTS })
  })

  it.each([
    [true, 1],
    [false, 0],
    [1, 1],
    [0, 0],
    [undefined, 0],
  ])('reads commonKnowledge %j as %j', (commonKnowledge, expected) => {
    expect(HappeningImportSchema.parse({ ...MINIMAL, commonKnowledge }).commonKnowledge).toBe(
      expected,
    )
  })

  it('refuses a commonKnowledge outside 0, 1 and booleans', () => {
    expect(issuesOf({ ...MINIMAL, commonKnowledge: 2 }).map((issue) => issue.path)).toEqual([
      ['commonKnowledge'],
    ])
  })

  it('refuses a blank title with the title copy', () => {
    expect(issuesOf({ title: ' ' })).toEqual([{ path: ['title'], message: 'A title is required.' }])
  })
})

describe('happeningExport', () => {
  it('writes an in-narrative happening without its entry anchor or links', () => {
    const file = happeningExport(AMBUSH, EXPORTED_AT)
    const parsed = JSON.parse(file.contents)
    expect(parsed).toMatchObject({ format: 'aventuras-happening', formatVersion: '1.0' })
    expect(parsed.happening).toEqual({
      title: 'Ambush at the ford',
      description: 'Raiders struck the caravan at dusk.',
      category: 'battle',
      icon: 'swords',
      temporal: null,
      commonKnowledge: 1,
    })
    expect(file.fileName).toBe('happening-ambush-at-the-ford.avts')
  })

  it('keeps an out-of-narrative happening’s temporal anchor', () => {
    expect(payloadOf(FOUNDING)).toMatchObject({
      temporal: 'Three centuries before the story',
      commonKnowledge: 0,
    })
  })

  it('writes absent optionals as null, never an empty string', () => {
    const bare = {
      ...AMBUSH,
      description: null,
      category: null,
      icon: null,
      commonKnowledge: 0,
    }
    expect(payloadOf(bare)).toEqual({ title: 'Ambush at the ford', ...DEFAULTS })
  })

  it.each([AMBUSH, FOUNDING])('re-imports $title unchanged', (row) => {
    const payload = payloadOf(row)
    expect(HappeningImportSchema.parse(payload)).toEqual(payload)
  })
})
