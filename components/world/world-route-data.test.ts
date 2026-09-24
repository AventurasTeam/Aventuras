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
  makeEntity({ id: 'char_zed', kind: 'character', name: 'Bram' }),
]

describe('relationshipLinksFor', () => {
  it('orients each row to the character and sorts by the other name', () => {
    const rows = new Map([
      ['rel_1', rel('rel_1', 'char_aria', 'char_kael', 'brother', 'sister')],
      ['rel_2', rel('rel_2', 'char_kael', 'char_zed', 'mentor', null)],
      ['rel_3', rel('rel_3', 'char_aria', 'char_zed', 'x', 'y', 'br_2')],
    ])
    expect(relationshipLinksFor('char_kael', 'br_1', rows, ENTITIES)).toEqual([
      { rowId: 'rel_1', otherId: 'char_aria', selfToOther: 'sister', otherToSelf: 'brother' },
      { rowId: 'rel_2', otherId: 'char_zed', selfToOther: 'mentor', otherToSelf: null },
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
    ])
    const happenings = new Map([
      ['hap_a', { id: 'hap_a', title: 'A pact' } as Happening],
      ['hap_b', { id: 'hap_b', title: 'The fire' } as Happening],
    ])
    expect(involvementsFor('char_kael', 'br_1', involvements, happenings)).toEqual([
      { id: 'hinv_2', happeningId: 'hap_a', title: 'A pact', role: null },
      { id: 'hinv_1', happeningId: 'hap_b', title: 'The fire', role: 'witness' },
    ])
  })
})
