import { describe, expect, it } from 'vitest'

import {
  composeKey,
  itemKey,
  mergePages,
  markExisting,
  type AssistListItem,
} from './assist-list-logic'

const item = (name: string): AssistListItem => ({ name, detail: `${name} detail`, payload: null })

describe('markExisting', () => {
  it('flags a case-insensitive collision with already-imported content', () => {
    const marked = markExisting([item('The Old Empire'), item('Magic wells')], ['the old empire'])
    expect(marked.map((m) => m.exists)).toEqual([true, false])
  })

  it('ignores surrounding whitespace when comparing', () => {
    expect(markExisting([item('  Noir  ')], ['noir'])[0].exists).toBe(true)
  })

  it('leaves everything importable when nothing exists yet', () => {
    expect(markExisting([item('A'), item('B')], []).every((m) => !m.exists)).toBe(true)
  })

  it('trims the surviving name so the heading matches the dedupe key', () => {
    expect(markExisting([item('  Noir  ')], [])[0].name).toBe('Noir')
  })
})

describe('mergePages', () => {
  it('appends a later page after the earlier one', () => {
    expect(mergePages([item('A')], [item('B')]).map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('drops a duplicate the model re-emitted on Generate more', () => {
    expect(mergePages([item('A')], [item('a'), item('B')]).map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('keeps the first occurrence when a single page repeats itself', () => {
    const merged = mergePages([], [item('A'), item('A')])
    expect(merged).toHaveLength(1)
  })
})

describe('dedupeKey', () => {
  const loc = { name: 'Ashfall', detail: 'a city', dedupeKey: 'location:Ashfall', payload: 1 }
  const fac = { name: 'Ashfall', detail: 'a cult', dedupeKey: 'faction:Ashfall', payload: 2 }

  it('mergePages keeps same-named items with distinct dedupeKeys', () => {
    expect(mergePages([loc], [fac])).toHaveLength(2)
  })

  it('mergePages still dedupes on dedupeKey case-insensitively', () => {
    expect(mergePages([loc], [{ ...loc, dedupeKey: 'location:ASHFALL ' }])).toHaveLength(1)
  })

  it('markExisting matches kind-qualified existing keys against dedupeKey', () => {
    const marked = markExisting([loc, fac], ['faction:ashfall'])
    expect(marked[0].exists).toBe(false)
    expect(marked[1].exists).toBe(true)
  })

  it('falls back to the normalized name when dedupeKey is absent (lore path unchanged)', () => {
    const a = { name: 'The Wells', detail: '', payload: 1 }
    expect(mergePages([a], [{ ...a, name: ' the wells' }])).toHaveLength(1)
    expect(markExisting([a], ['THE WELLS'])[0].exists).toBe(true)
  })

  it('itemKey normalizes whichever identity it uses', () => {
    expect(itemKey({ name: ' The Wells ' })).toBe('the wells')
    expect(itemKey({ name: 'x', dedupeKey: ' Location:Ashfall ' })).toBe('location:ashfall')
  })
})

describe('composeKey', () => {
  it('normalizes each part, so a padded name still matches a clean key built the same way', () => {
    const paddedRow = {
      name: 'x',
      detail: '',
      dedupeKey: composeKey('location', '  Ashfall  '),
      payload: 1,
    }
    const cleanExistingKey = composeKey('location', 'Ashfall')
    expect(itemKey(paddedRow)).toBe(cleanExistingKey)

    // Naive interpolation — normalizing the JOINED string rather than each part
    // — would leave the padding as interior whitespace and miss this match.
    const naiveKey = 'location:  Ashfall  '.trim().toLowerCase()
    expect(naiveKey).not.toBe(cleanExistingKey)
  })
})
