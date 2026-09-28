import { describe, expect, it } from 'vitest'

import type { Lore } from '@/lib/db'

import { WORLD_ISSUE } from './issues'
import { EMPTY_LORE_DRAFT, loreActions, loreDraftFrom, loreDraftSchema } from './lore-draft'

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
