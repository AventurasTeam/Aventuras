import { describe, expect, it } from 'vitest'

import {
  descriptionOutputSchema,
  loreSuggestionsSchema,
  openingOutputSchema,
  titleChipsSchema,
} from './assist-schemas'

describe('wizard assist schemas', () => {
  it('openingOutputSchema accepts a well-formed opening', () => {
    expect(
      openingOutputSchema.parse({
        prose: 'Hi',
        sceneEntities: ['c1'],
        currentLocationId: null,
        worldTime: 0,
      }),
    ).toMatchObject({ prose: 'Hi', sceneEntities: ['c1'] })
  })
  it('openingOutputSchema rejects missing fields and a non-zero worldTime', () => {
    expect(() => openingOutputSchema.parse({ prose: 'Hi' })).toThrow()
    expect(() =>
      openingOutputSchema.parse({
        prose: 'Hi',
        sceneEntities: [],
        currentLocationId: null,
        worldTime: 1,
      }),
    ).toThrow()
  })
  it('titleChipsSchema requires at least one title', () => {
    expect(titleChipsSchema.parse({ titles: ['A', 'B'] }).titles).toEqual(['A', 'B'])
    expect(() => titleChipsSchema.parse({ titles: [] })).toThrow()
  })
  it('descriptionOutputSchema parses a log line', () => {
    expect(descriptionOutputSchema.parse({ description: 'A tale.' }).description).toBe('A tale.')
  })
})

describe('loreSuggestionsSchema', () => {
  it('accepts a batch of title/body rows', () => {
    const parsed = loreSuggestionsSchema.parse({
      lore: [{ title: 'The Old Empire', body: 'A thousand years ago…', category: 'history' }],
    })
    expect(parsed.lore[0].title).toBe('The Old Empire')
    expect(parsed.lore[0].category).toBe('history')
  })

  it('defaults an omitted category to empty so the import needs no post-fill', () => {
    const parsed = loreSuggestionsSchema.parse({ lore: [{ title: 'T', body: 'B' }] })
    expect(parsed.lore[0].category).toBe('')
  })

  it('trims padded model output before it can reach the store', () => {
    // The list result's `payload` carries the parsed row straight into
    // importLore, bypassing markExisting's render-layer trim entirely.
    const parsed = loreSuggestionsSchema.parse({
      lore: [{ title: '  The Old Empire  ', body: '  Fell.  ', category: '  history  ' }],
    })
    expect(parsed.lore[0]).toEqual({
      title: 'The Old Empire',
      body: 'Fell.',
      category: 'history',
    })
  })

  it('rejects a reply with no lore array', () => {
    expect(() => loreSuggestionsSchema.parse({})).toThrow()
  })
})
