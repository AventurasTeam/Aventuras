import { describe, expect, it } from 'vitest'

import type { Translation } from '@/lib/db'

import { translationsStore } from './translations'

function trRow(
  id: string,
  targetId: string,
  field: string,
  lang: string,
  text: string,
): Translation {
  return {
    id,
    branchId: 'br_1',
    targetKind: 'entity',
    targetId,
    field,
    language: lang,
    translatedText: text,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('translationsStore', () => {
  it('hydrates and resolves the composite index; miss returns undefined', () => {
    translationsStore.__reset()
    translationsStore.hydrate('br_1', [
      trRow('tr_1', 'char_1', 'description', 'es', 'Hola'),
      trRow('tr_2', 'char_1', 'description', 'fr', 'Bonjour'),
    ])
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe('Hola')
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'fr')).toBe(
      'Bonjour',
    )
    // miss -> undefined -> caller falls back to source
    expect(
      translationsStore.getTranslation('entity', 'char_1', 'description', 'de'),
    ).toBeUndefined()
    expect(
      translationsStore.getTranslation('entity', 'char_9', 'description', 'es'),
    ).toBeUndefined()
  })

  it('create patch adds, update patch revalues, delete-by-id evicts the composite entry', () => {
    translationsStore.__reset()
    translationsStore.hydrate('br_1', [])

    translationsStore.patch('br_1', {
      op: 'create',
      id: 'tr_1',
      row: trRow('tr_1', 'char_1', 'description', 'es', 'Hola'),
    })
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe('Hola')

    translationsStore.patch('br_1', {
      op: 'update',
      id: 'tr_1',
      columns: { translatedText: 'Hola again' },
    })
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola again',
    )

    // delete carries ONLY the surrogate id — the store must resolve id -> composite to evict.
    translationsStore.patch('br_1', { op: 'delete', id: 'tr_1' })
    expect(
      translationsStore.getTranslation('entity', 'char_1', 'description', 'es'),
    ).toBeUndefined()
    expect(translationsStore.getById('tr_1')).toBeUndefined()
  })

  it('no-ops a patch for a non-held branch (index stays consistent)', () => {
    translationsStore.__reset()
    translationsStore.hydrate('br_1', [])
    translationsStore.patch('br_2', {
      op: 'create',
      id: 'tr_9',
      row: trRow('tr_9', 'char_9', 'description', 'es', 'Ghost'),
    })
    expect(
      translationsStore.getTranslation('entity', 'char_9', 'description', 'es'),
    ).toBeUndefined()
    expect(translationsStore.getById('tr_9')).toBeUndefined()
  })
})
