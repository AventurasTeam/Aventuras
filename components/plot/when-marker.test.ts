import { describe, expect, it } from 'vitest'

import type { Happening } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import { formatEntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import { whenMarker } from './when-marker'

function entry(id: string, position: number): EntryRef {
  return { id, position, kind: 'ai_reply', chapterId: null, excerpt: '' }
}

const ENTRIES: EntryIndex = new Map([entry('e1', 1), entry('e3', 3)].map((e) => [e.id, e]))

function happening(extra: Partial<Happening> = {}): Happening {
  return {
    id: 'h_1',
    branchId: 'br_1',
    title: 'Ambush',
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

describe('whenMarker', () => {
  it('shows the free-text temporal, soft-toned', () => {
    expect(whenMarker(happening({ temporal: 'years past' }), ENTRIES)).toEqual({
      tone: 'soft',
      label: 'years past',
    })
  })

  it('treats a whitespace-only temporal as unset', () => {
    expect(whenMarker(happening({ temporal: '   ' }), ENTRIES)).toBeNull()
  })

  it('trims the temporal label', () => {
    expect(whenMarker(happening({ temporal: ' years past ' }), ENTRIES)).toEqual({
      tone: 'soft',
      label: 'years past',
    })
  })

  it('returns null with no temporal and no anchor', () => {
    expect(whenMarker(happening(), ENTRIES)).toBeNull()
  })

  it('warns with the dangling copy when the anchor id is not in the index', () => {
    const key = 'entryRefDangling'
    const marker = whenMarker(happening({ occurredAtEntryId: 'gone' }), ENTRIES)
    expect(marker).toEqual({ tone: 'warning', label: t(key) })
    // `t` echoes a missing key, which would make the line above pass vacuously.
    expect(hasCopy(key)).toBe(true)
  })

  it('resolves a live anchor to its entry #n ref', () => {
    expect(whenMarker(happening({ occurredAtEntryId: 'e3' }), ENTRIES)).toEqual({
      tone: 'soft',
      label: formatEntryRef(3),
    })
  })
})
