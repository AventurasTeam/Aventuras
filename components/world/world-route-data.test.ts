import { describe, expect, it } from 'vitest'

import type { CharacterRelationship, Happening, HappeningInvolvement } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { involvementsFor, relationshipLinksFor } from './world-route-data'

const rel = (
  id: string,
  aId: string,
  bId: string,
  kind: string | null,
  inverseKind: string | null,
  branchId = 'br_1',
): CharacterRelationship => ({
  id,
  branchId,
  aId,
  bId,
  kind,
  inverseKind,
  createdAt: 1,
  updatedAt: 1,
})

const ENTITIES = [
  makeEntity({ id: 'char_aria', kind: 'character', name: 'Aria' }),
  makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' }),
  makeEntity({ id: 'char_zed', kind: 'character', name: 'Abe' }),
]

describe('relationshipLinksFor', () => {
  it('orients each row to the character and sorts by the other name', () => {
    const rows = new Map([
      ['rel_1', rel('rel_1', 'char_aria', 'char_kael', 'brother', 'sister')],
      ['rel_2', rel('rel_2', 'char_kael', 'char_zed', 'mentor', null)],
      // Involves char_kael too, but on another branch: proves the branch check, not just the pair check.
      ['rel_3', rel('rel_3', 'char_kael', 'char_zed', 'x', 'y', 'br_2')],
    ])
    // 'Abe' sorts before 'Aria', while insertion and rowId order both put rel_1 first: proves the sort runs.
    expect(relationshipLinksFor('char_kael', 'br_1', rows, ENTITIES)).toEqual([
      { rowId: 'rel_2', otherId: 'char_zed', selfToOther: 'mentor', otherToSelf: null },
      { rowId: 'rel_1', otherId: 'char_aria', selfToOther: 'sister', otherToSelf: 'brother' },
    ])
    expect(relationshipLinksFor(null, 'br_1', rows, ENTITIES)).toEqual([])
  })
})

describe('involvementsFor', () => {
  it('lists the entity involvements with their happening titles, skipping a dangling happening', () => {
    const involvements = new Map<string, HappeningInvolvement>([
      [
        'hinv_1',
        {
          id: 'hinv_1',
          branchId: 'br_1',
          happeningId: 'hap_b',
          entityId: 'char_kael',
          role: 'witness',
        },
      ],
      [
        'hinv_2',
        { id: 'hinv_2', branchId: 'br_1', happeningId: 'hap_a', entityId: 'char_kael', role: null },
      ],
      [
        'hinv_3',
        {
          id: 'hinv_3',
          branchId: 'br_1',
          happeningId: 'hap_gone',
          entityId: 'char_kael',
          role: null,
        },
      ],
      [
        'hinv_4',
        { id: 'hinv_4', branchId: 'br_1', happeningId: 'hap_a', entityId: 'char_aria', role: null },
      ],
      // Involves char_kael too, but on another branch: must stay excluded.
      [
        'hinv_5',
        { id: 'hinv_5', branchId: 'br_2', happeningId: 'hap_a', entityId: 'char_kael', role: null },
      ],
    ])
    // Titles sort opposite their happeningId order, so the output proves it sorts by title.
    const happenings = new Map([
      ['hap_a', { id: 'hap_a', title: 'The fire' } as Happening],
      ['hap_b', { id: 'hap_b', title: 'A pact' } as Happening],
    ])
    expect(involvementsFor('char_kael', 'br_1', involvements, happenings)).toEqual([
      { id: 'hinv_1', happeningId: 'hap_b', title: 'A pact', role: 'witness' },
      { id: 'hinv_2', happeningId: 'hap_a', title: 'The fire', role: null },
    ])
  })
})
