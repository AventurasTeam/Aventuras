import { describe, expect, it } from 'vitest'

import type { HappeningAwareness, HappeningInvolvement } from '@/lib/db'

import { distinctCategories, happeningLinksFor } from './plot-route-data'

function involvement(id: string, happeningId: string, branchId = 'br_1'): HappeningInvolvement {
  return { id, branchId, happeningId, entityId: 'char_1', role: null }
}

function awareness(id: string, happeningId: string, branchId = 'br_1'): HappeningAwareness {
  return {
    id,
    branchId,
    happeningId,
    characterId: 'char_1',
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

function byId<T extends { id: string }>(rows: T[]): ReadonlyMap<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

describe('distinctCategories', () => {
  it('trims, drops blanks and nulls, dedupes and sorts', () => {
    expect(
      distinctCategories([
        { category: ' politics ' },
        { category: null },
        { category: '   ' },
        { category: 'heist' },
        { category: 'politics' },
        { category: '' },
      ]),
    ).toEqual(['heist', 'politics'])
  })

  it('keeps values that differ only by case', () => {
    expect(distinctCategories([{ category: 'Heist' }, { category: 'heist' }])).toHaveLength(2)
  })
})

describe('happeningLinksFor', () => {
  const involvements = byId([
    involvement('inv_1', 'hap_1'),
    involvement('inv_2', 'hap_2'),
    involvement('inv_3', 'hap_1', 'br_other'),
  ])
  const aware = byId([
    awareness('aw_1', 'hap_1'),
    awareness('aw_2', 'hap_2'),
    awareness('aw_3', 'hap_1', 'br_other'),
  ])

  it("returns only the happening's rows on the branch", () => {
    const links = happeningLinksFor('hap_1', 'br_1', involvements, aware)
    expect(links.involvements.map((l) => l.id)).toEqual(['inv_1'])
    expect(links.awareness.map((l) => l.id)).toEqual(['aw_1'])
  })

  it('returns one shared empty value when no happening is selected', () => {
    const first = happeningLinksFor(null, 'br_1', involvements, aware)
    expect(first).toEqual({ involvements: [], awareness: [] })
    expect(happeningLinksFor(null, 'br_2', new Map(), new Map())).toBe(first)
  })
})
