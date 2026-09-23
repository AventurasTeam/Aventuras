import { describe, expect, it } from 'vitest'

import type { Happening, HappeningAwareness, HappeningInvolvement } from '@/lib/db'

import {
  happeningActions,
  happeningDraftFrom,
  happeningDraftSchema,
  type HappeningLinks,
} from './happening-draft'

const ROW: Happening = {
  id: 'hap_1',
  branchId: 'br_1',
  title: 'The alley ambush',
  description: null,
  category: 'conflict',
  icon: 'swords',
  temporal: null,
  occurredAtEntryId: 'e_10',
  commonKnowledge: 0,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}
const INV_KAEL: HappeningInvolvement = {
  id: 'hinv_kael',
  branchId: 'br_1',
  happeningId: 'hap_1',
  entityId: 'char_kael',
  role: 'target',
}
const AW_MIRA: HappeningAwareness = {
  id: 'haw_mira',
  branchId: 'br_1',
  happeningId: 'hap_1',
  characterId: 'char_mira',
  learnedAtEntryId: 'e_11',
  decayResistance: 0.6,
  retrievalCount: 1,
  source: 'told',
}
const LINKS: HappeningLinks = { involvements: [INV_KAEL], awareness: [AW_MIRA] }

let counter = 0
const newId = (prefix: string) => `${prefix}_${++counter}`

function build(
  draft: ReturnType<typeof happeningDraftFrom>,
  row: Happening | null = ROW,
  links: HappeningLinks = LINKS,
) {
  return happeningActions({
    branchId: 'br_1',
    row,
    links,
    draft,
    id: row?.id ?? 'hap_new',
    now: 7,
    newId,
  })
}

describe('happeningDraftSchema', () => {
  it('refuses both time fields at once, on temporal', () => {
    const result = happeningDraftSchema.safeParse({
      ...happeningDraftFrom(ROW, LINKS),
      temporal: 'years past',
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['temporal'], message: 'timeAnchorExclusive' }),
      )
  })

  it('refuses a duplicate character and a duplicate entity', () => {
    const base = happeningDraftFrom(ROW, LINKS)
    const dupChar = happeningDraftSchema.safeParse({
      ...base,
      awareness: [
        ...base.awareness,
        {
          id: null,
          characterId: 'char_mira',
          learnedAtEntryId: null,
          decayResistance: null,
          source: '',
        },
      ],
    })
    expect(dupChar.success).toBe(false)
    if (!dupChar.success)
      expect(dupChar.error.issues[0]).toMatchObject({
        path: ['awareness', 1, 'characterId'],
        message: 'duplicateCharacter',
      })
    const dupEntity = happeningDraftSchema.safeParse({
      ...base,
      involvements: [...base.involvements, { id: null, entityId: 'char_kael', role: '' }],
    })
    expect(dupEntity.success).toBe(false)
  })
})

describe('happeningActions', () => {
  it('creates the row first, then the links against the pre-generated id', () => {
    const draft = {
      ...happeningDraftFrom(null, { involvements: [], awareness: [] }),
      title: 'New',
      involvements: [{ id: null, entityId: 'char_kael', role: 'actor' }],
      awareness: [
        {
          id: null,
          characterId: 'char_kael',
          learnedAtEntryId: 'e_1',
          decayResistance: 0.5,
          source: '',
        },
      ],
    }
    const actions = build(draft, null, { involvements: [], awareness: [] })
    expect(actions.map((a) => a.kind)).toEqual([
      'createHappening',
      'createHappeningInvolvement',
      'upsertHappeningAwareness',
    ])
    expect(actions[1]).toMatchObject({
      payload: { entry: { happeningId: 'hap_new', entityId: 'char_kael', role: 'actor' } },
    })
    expect(actions[2]).toMatchObject({
      payload: {
        happeningId: 'hap_new',
        characterId: 'char_kael',
        learnedAtEntryId: 'e_1',
        decayResistance: 0.5,
        source: null,
      },
    })
  })

  it('patches only changed columns and diffs the links', () => {
    const base = happeningDraftFrom(ROW, LINKS)
    const draft = {
      ...base,
      commonKnowledge: true,
      involvements: [{ ...base.involvements[0], role: 'victim' }],
      awareness: [{ ...base.awareness[0], decayResistance: 0.9 }],
    }
    expect(build(draft)).toEqual([
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hap_1', patch: { commonKnowledge: 1 } },
      },
      {
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hinv_kael', patch: { role: 'victim' } },
      },
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          characterId: 'char_mira',
          happeningId: 'hap_1',
          decayResistance: 0.9,
        },
      },
    ])
  })

  it('deletes removed links and emits nothing for an unchanged draft', () => {
    expect(build(happeningDraftFrom(ROW, LINKS))).toEqual([])
    const draft = { ...happeningDraftFrom(ROW, LINKS), involvements: [], awareness: [] }
    expect(build(draft).map((a) => a.kind)).toEqual([
      'deleteHappeningInvolvement',
      'deleteHappeningAwareness',
    ])
  })

  it('swaps characters between two awareness rows as two updates, never two writes to one row', () => {
    const AW_KAEL: HappeningAwareness = {
      ...AW_MIRA,
      id: 'haw_kael',
      characterId: 'char_kael',
      learnedAtEntryId: 'e_3',
      decayResistance: 0.2,
    }
    const links: HappeningLinks = { involvements: [], awareness: [AW_MIRA, AW_KAEL] }
    const base = happeningDraftFrom(ROW, links)
    const draft = {
      ...base,
      awareness: [
        { ...base.awareness[0], characterId: 'char_kael' },
        { ...base.awareness[1], characterId: 'char_mira' },
      ],
    }
    expect(build(draft, ROW, links)).toEqual([
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          characterId: 'char_kael',
          happeningId: 'hap_1',
          learnedAtEntryId: 'e_11',
          decayResistance: 0.6,
        },
      },
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          characterId: 'char_mira',
          happeningId: 'hap_1',
          learnedAtEntryId: 'e_3',
          decayResistance: 0.2,
        },
      },
    ])
  })

  it('swaps entities between two involvement rows as role updates', () => {
    const INV_MIRA: HappeningInvolvement = {
      ...INV_KAEL,
      id: 'hinv_mira',
      entityId: 'char_mira',
      role: 'actor',
    }
    const links: HappeningLinks = { involvements: [INV_KAEL, INV_MIRA], awareness: [] }
    const base = happeningDraftFrom(ROW, links)
    const draft = {
      ...base,
      involvements: [
        { ...base.involvements[0], entityId: 'char_mira' },
        { ...base.involvements[1], entityId: 'char_kael' },
      ],
    }
    expect(build(draft, ROW, links)).toEqual([
      {
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hinv_mira', patch: { role: 'target' } },
      },
      {
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hinv_kael', patch: { role: 'actor' } },
      },
    ])
  })

  it('turns remove-then-re-add of the same character into one update, never delete plus create', () => {
    const draft = {
      ...happeningDraftFrom(ROW, LINKS),
      awareness: [
        {
          id: null,
          characterId: 'char_mira',
          learnedAtEntryId: 'e_11',
          decayResistance: 0.1,
          source: 'told',
        },
      ],
    }
    expect(build(draft)).toEqual([
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          characterId: 'char_mira',
          happeningId: 'hap_1',
          decayResistance: 0.1,
        },
      },
    ])
  })

  it('treats a classifier-shaped committed row as equal to its unchanged draft', () => {
    const rawRow: Happening = {
      ...ROW,
      title: '  The alley ambush  ',
      description: '  It happened fast.\n',
      category: '  conflict  ',
      occurredAtEntryId: null,
      temporal: '  years ago  \n',
    }
    const rawInvolvement: HappeningInvolvement = { ...INV_KAEL, role: '' }
    const rawAwareness: HappeningAwareness = { ...AW_MIRA, source: '' }
    const rawLinks: HappeningLinks = { involvements: [rawInvolvement], awareness: [rawAwareness] }
    expect(build(happeningDraftFrom(rawRow, rawLinks), rawRow, rawLinks)).toEqual([])
  })

  it('switches the anchor from an entry ref to free text as one patch', () => {
    const draft = {
      ...happeningDraftFrom(ROW, LINKS),
      temporal: 'years past',
      occurredAtEntryId: null,
    }
    expect(build(draft)).toEqual([
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'hap_1',
          patch: { temporal: 'years past', occurredAtEntryId: null },
        },
      },
    ])
  })

  it('switches the anchor from free text to an entry ref as one patch', () => {
    const temporalRow: Happening = { ...ROW, temporal: 'long ago', occurredAtEntryId: null }
    const draft = {
      ...happeningDraftFrom(temporalRow, LINKS),
      temporal: '',
      occurredAtEntryId: 'e_20',
    }
    expect(build(draft, temporalRow, LINKS)).toEqual([
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'hap_1',
          patch: { temporal: null, occurredAtEntryId: 'e_20' },
        },
      },
    ])
  })

  it('clears a blank-but-non-null committed temporal when the draft sets an entry anchor', () => {
    const blankTemporalRow: Happening = { ...ROW, temporal: '  ', occurredAtEntryId: null }
    const draft = { ...happeningDraftFrom(blankTemporalRow, LINKS), occurredAtEntryId: 'e_5' }
    expect(build(draft, blankTemporalRow, LINKS)).toEqual([
      {
        kind: 'updateHappening',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'hap_1',
          patch: { temporal: null, occurredAtEntryId: 'e_5' },
        },
      },
    ])
  })

  it('treats a whitespace-only committed temporal with no anchor change as unchanged', () => {
    const blankTemporalRow: Happening = { ...ROW, temporal: '  ', occurredAtEntryId: null }
    expect(build(happeningDraftFrom(blankTemporalRow, LINKS), blankTemporalRow, LINKS)).toEqual([])
  })

  it('treats a committed involvement with a null role as equal to its unchanged draft', () => {
    const nullRoleInv: HappeningInvolvement = { ...INV_KAEL, id: 'hinv_null', role: null }
    const links: HappeningLinks = { involvements: [nullRoleInv], awareness: [] }
    expect(build(happeningDraftFrom(ROW, links), ROW, links)).toEqual([])
  })

  it('keeps the duplicate committed involvement the draft row id points to, deletes its twin', () => {
    const I1: HappeningInvolvement = {
      id: 'hinv_dup1',
      branchId: 'br_1',
      happeningId: 'hap_1',
      entityId: 'char_x',
      role: 'a',
    }
    const I2: HappeningInvolvement = { ...I1, id: 'hinv_dup2', role: 'b' }
    const links: HappeningLinks = { involvements: [I1, I2], awareness: [] }
    const keepFirst = {
      ...happeningDraftFrom(ROW, links),
      involvements: [{ id: I1.id, entityId: I1.entityId, role: I1.role ?? '' }],
    }
    expect(build(keepFirst, ROW, links)).toEqual([
      {
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hinv_dup2' },
      },
    ])

    const keepSecond = {
      ...happeningDraftFrom(ROW, links),
      involvements: [{ id: I2.id, entityId: I2.entityId, role: I2.role ?? '' }],
    }
    expect(build(keepSecond, ROW, links)).toEqual([
      {
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'hinv_dup1' },
      },
    ])
  })

  it('ignores a stray links value in create mode', () => {
    const actions = happeningActions({
      branchId: 'br_1',
      row: null,
      links: LINKS,
      draft: happeningDraftFrom(null, { involvements: [], awareness: [] }),
      id: 'hap_new',
      now: 7,
      newId,
    })
    expect(actions.map((a) => a.kind)).toEqual(['createHappening'])
  })

  it('maps a commonKnowledge: 1 row to true and round-trips as unchanged', () => {
    const ckRow: Happening = { ...ROW, commonKnowledge: 1 }
    const draft = happeningDraftFrom(ckRow, LINKS)
    expect(draft.commonKnowledge).toBe(true)
    expect(build(draft, ckRow, LINKS)).toEqual([])
  })
})
