import { describe, expect, it } from 'vitest'

import type { StoryInfo } from '@/lib/db'

import {
  ABOUT_KEYS,
  aboutColumnPatch,
  aboutDirtyKeys,
  toAboutDraft,
  validateAbout,
} from './about-draft'

const STORY: StoryInfo = {
  title: 'Aria',
  description: null,
  tags: ['noir'],
  accentColor: null,
  status: 'active',
  favorite: 0,
}

const BASE = toAboutDraft(STORY)

function baselineOf(overrides: Partial<StoryInfo>) {
  return toAboutDraft({ ...STORY, ...overrides })
}

describe('about draft', () => {
  it('lists the fields in tab order', () => {
    expect(ABOUT_KEYS).toEqual([
      'title',
      'description',
      'tags',
      'accentColor',
      'status',
      'favorite',
    ])
  })

  it('derives a draft that reads clean against its own baseline', () => {
    expect(aboutDirtyKeys(toAboutDraft(STORY), BASE)).toEqual([])
    expect(aboutColumnPatch(toAboutDraft(STORY), BASE)).toEqual({})
  })

  it('reads favorite the way the library card does', () => {
    expect(baselineOf({ favorite: 1 }).favorite).toBe(true)
    expect(BASE.favorite).toBe(false)
  })

  it('reports only the changed keys, in field order, with trimmed title', () => {
    const draft = { ...BASE, title: '  Aria Rising ', favorite: true, tags: ['noir', 'rain'] }
    expect(aboutDirtyKeys(draft, BASE)).toEqual(['title', 'tags', 'favorite'])
    expect(aboutColumnPatch(draft, BASE)).toEqual({
      title: 'Aria Rising',
      tags: ['noir', 'rain'],
      favorite: true,
    })
  })

  it('ignores edits that only change whitespace or accent case', () => {
    const baseline = baselineOf({ description: 'old', accentColor: '#2563EB' })
    const draft = { ...baseline, title: ' Aria ', description: ' old\n', accentColor: '#2563eb' }
    expect(aboutDirtyKeys(draft, baseline)).toEqual([])
  })

  it('reports a whitespace-only title as dirty and invalid', () => {
    const draft = { ...BASE, title: '   ' }
    expect(validateAbout(draft, BASE)).toBe('empty-title')
    expect(aboutDirtyKeys(draft, BASE)).toEqual(['title'])
  })

  it('checks only what the save would write', () => {
    const baseline = baselineOf({ title: '  ', accentColor: 'blue' })
    expect(validateAbout({ ...baseline, favorite: true }, baseline)).toBeNull()
    expect(validateAbout({ ...BASE, accentColor: '#12345' }, BASE)).toBe('invalid-accent')
    expect(validateAbout({ ...BASE, accentColor: '#abc' }, BASE)).toBeNull()
  })

  it('refuses any edit on a draft story and never patches status to draft', () => {
    const baseline = baselineOf({ status: 'draft' })
    expect(validateAbout(baseline, baseline)).toBeNull()
    expect(validateAbout({ ...baseline, favorite: true }, baseline)).toBe('draft-story')
    expect(aboutColumnPatch({ ...BASE, status: 'draft' }, BASE)).toEqual({})
  })

  it('writes the description trimmed, and blank as null', () => {
    const baseline = baselineOf({ description: 'old' })
    expect(aboutColumnPatch({ ...baseline, description: '  new \n' }, baseline)).toEqual({
      description: 'new',
    })
    expect(aboutColumnPatch({ ...baseline, description: ' \n' }, baseline)).toEqual({
      description: null,
    })
    expect(aboutDirtyKeys({ ...BASE, description: '  ' }, BASE)).toEqual([])
  })

  it('drops a stored blank tag instead of re-sending it', () => {
    const baseline = baselineOf({ tags: [' noir', '  ', ''] })
    expect(baseline.tags).toEqual(['noir'])
    expect(aboutColumnPatch({ ...baseline, tags: ['noir', 'fog'] }, baseline)).toEqual({
      tags: ['noir', 'fog'],
    })
  })

  it('compares tags by value, not identity', () => {
    expect(aboutDirtyKeys({ ...BASE, tags: ['noir'] }, BASE)).toEqual([])
  })
})
