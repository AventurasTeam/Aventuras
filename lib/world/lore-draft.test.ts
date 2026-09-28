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
  it('creates with trimmed text, normalized keywords and a blank category as null', () => {
    const [action] = loreActions({
      branchId: 'b1',
      row: null,
      draft: {
        ...EMPTY_LORE_DRAFT,
        title: ' Vael ',
        body: ' A city. ',
        category: ' ',
        keywords: ['Vael', 'vael ', ' '],
      },
      id: 'lore_2',
      now: 5,
    })
    expect(action).toMatchObject({
      kind: 'createLore',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'lore_2',
          title: 'Vael',
          body: 'A city.',
          category: null,
          keywords: ['Vael'],
          embeddingStale: 1,
        },
      },
    })
  })

  it('writes only the columns the draft changed, and nothing when none did', () => {
    const draft = loreDraftFrom(ROW)
    expect(loreActions({ branchId: 'b1', row: ROW, draft, id: ROW.id, now: 5 })).toEqual([])
    const [update] = loreActions({
      branchId: 'b1',
      row: ROW,
      draft: { ...draft, body: 'A sea of dark.', priority: 10 },
      id: ROW.id,
      now: 5,
    })
    expect(update).toEqual({
      kind: 'updateLore',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'lore_1', patch: { body: 'A sea of dark.' } },
    })
  })
})
