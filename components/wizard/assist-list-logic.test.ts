import { describe, expect, it } from 'vitest'

import { mergePages, markExisting, type AssistListItem } from './assist-list-logic'

const item = (name: string): AssistListItem => ({ name, detail: `${name} detail` })

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
