import { describe, expect, it } from 'vitest'

import type { Lore } from '@/lib/db'

import { WORLD_ISSUE } from './issues'
import {
  EMPTY_LORE_DRAFT,
  loreActions,
  loreDraftFrom,
  loreDraftSchema,
  withCanonicalCategory,
} from './lore-draft'

const ROW: Lore = {
  id: 'lore_1',
  branchId: 'b1',
  title: 'The Aetherium',
  body: 'A sea of light.',
  category: 'cosmology',
  tags: ['core'],
  keywords: ['Aetherium'],
  injectionMode: 'auto',
  priority: 10,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

describe('loreDraftSchema', () => {
  it('refuses a blank body and a blank title', () => {
    const result = loreDraftSchema.safeParse({ ...EMPTY_LORE_DRAFT, title: '  ', body: ' \n ' })
    expect(result.success).toBe(false)
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([WORLD_ISSUE.titleRequired, WORLD_ISSUE.bodyRequired]),
    )
  })
})

describe('loreDraftFrom', () => {
  it('hands each blank draft lists of its own', () => {
    loreDraftFrom(null).keywords.push('Vael')
    loreDraftFrom(null).tags.push('myth')
    expect(loreDraftFrom(null)).toMatchObject({ keywords: [], tags: [] })
  })
})

describe('loreActions', () => {
  it('creates with trimmed text, normalized keywords, cleaned tags and a blank category as null', () => {
    const [action] = loreActions({
      branchId: 'b1',
      row: null,
      draft: {
        ...EMPTY_LORE_DRAFT,
        title: ' Vael ',
        body: ' A city. ',
        category: ' ',
        keywords: ['Vael', 'vael ', ' '],
        tags: [' myth ', ''],
      },
      id: 'lore_2',
      now: 5,
    })
    expect(action).toEqual({
      kind: 'createLore',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'lore_2',
          branchId: 'b1',
          title: 'Vael',
          body: 'A city.',
          category: null,
          injectionMode: 'auto',
          priority: 0,
          keywords: ['Vael'],
          tags: ['myth'],
          embeddingStale: 1,
          createdAt: 5,
          updatedAt: 5,
        },
      },
    })
  })

  it('emits nothing when the draft equals the row', () => {
    expect(
      loreActions({ branchId: 'b1', row: ROW, draft: loreDraftFrom(ROW), id: ROW.id, now: 5 }),
    ).toEqual([])
  })

  it('emits nothing when the committed title, body, category, tags and keywords carry whitespace or casing the draft normalizes away', () => {
    const untrimmedRow: Lore = {
      ...ROW,
      title: '  The Aetherium ',
      body: ' A sea of light.\n',
      category: ' cosmology ',
      tags: [' core '],
      keywords: ['Aetherium', 'aetherium '],
    }
    expect(
      loreActions({
        branchId: 'b1',
        row: untrimmedRow,
        draft: loreDraftFrom(untrimmedRow),
        id: untrimmedRow.id,
        now: 5,
      }),
    ).toEqual([])
  })

  it('writes a re-cased keyword: its stored spelling changes though matching ignores case', () => {
    const draft = { ...loreDraftFrom(ROW), keywords: ['aetherium'] }
    const [update] = loreActions({ branchId: 'b1', row: ROW, draft, id: ROW.id, now: 5 })
    expect(update).toMatchObject({ payload: { patch: { keywords: ['aetherium'] } } })
  })

  it('writes only the columns the draft changed', () => {
    const draft = loreDraftFrom(ROW)
    const changed = {
      ...draft,
      title: '  The Aetherium, Reborn  ',
      body: ' A sea of dark. ',
      category: ' ', // blank clears to null
      keywords: ['Mana', 'mana ', 'Aetherium'], // internal duplicate + a real change
      tags: ['core', ' myth ', ''],
      injectionMode: 'always' as const,
      priority: 42,
    }
    const [update] = loreActions({ branchId: 'b1', row: ROW, draft: changed, id: ROW.id, now: 5 })
    expect(update).toEqual({
      kind: 'updateLore',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'lore_1',
        patch: {
          title: 'The Aetherium, Reborn',
          body: 'A sea of dark.',
          category: null,
          keywords: ['Mana', 'Aetherium'],
          tags: ['core', 'myth'],
          injectionMode: 'always',
          priority: 42,
        },
      },
    })
  })
})

describe('withCanonicalCategory', () => {
  // distinctCategories' order: a branch can hold one category in two casings.
  const CATEGORIES = ['cosmology', 'Cosmology', 'religion']

  it('keeps an unedited category the branch also holds in another casing', () => {
    const row: Lore = { ...ROW, category: 'Cosmology' }
    const committed = loreDraftFrom(row)
    const draft = withCanonicalCategory({ ...committed, priority: 40 }, committed, CATEGORIES)
    expect(loreActions({ branchId: 'b1', row, draft, id: row.id, now: 5 })).toEqual([
      {
        kind: 'updateLore',
        source: 'user_edit',
        payload: { branchId: 'b1', id: row.id, patch: { priority: 40 } },
      },
    ])
  })

  it('reads padding around the committed category as unedited', () => {
    const committed = loreDraftFrom({ ...ROW, category: 'Cosmology' })
    const draft = { ...committed, category: ' Cosmology ' }
    expect(withCanonicalCategory(draft, committed, CATEGORIES)).toBe(draft)
  })

  it('saves an edited case variant in the branch casing', () => {
    const committed = loreDraftFrom(ROW)
    const draft = withCanonicalCategory(
      { ...committed, category: ' Religion ' },
      committed,
      CATEGORIES,
    )
    expect(draft.category).toBe('religion')
  })

  it('saves a variant typed into a create draft in the branch casing', () => {
    const committed = loreDraftFrom(null)
    const draft = withCanonicalCategory(
      { ...committed, title: 'Vael', category: 'RELIGION' },
      committed,
      CATEGORIES,
    )
    expect(draft.category).toBe('religion')
  })

  it('keeps a category the branch lacks as typed', () => {
    const committed = loreDraftFrom(ROW)
    const draft = { ...committed, category: 'Myth' }
    expect(withCanonicalCategory(draft, committed, CATEGORIES)).toBe(draft)
  })
})
