import { describe, expect, it } from 'vitest'

import {
  castSuggestionsSchema,
  descriptionOutputSchema,
  labeledPromptOutputSchema,
  loreSuggestionsSchema,
  openingOutputSchema,
  settingOutputSchema,
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

describe('labeledPromptOutputSchema', () => {
  it('accepts a well-formed label + body', () => {
    const parsed = labeledPromptOutputSchema.parse({
      label: 'Hard sci-fi',
      promptBody: 'This is hard science fiction.',
    })
    expect(parsed).toEqual({ label: 'Hard sci-fi', promptBody: 'This is hard science fiction.' })
  })

  it('trims padded model output before it can reach the store', () => {
    const parsed = labeledPromptOutputSchema.parse({
      label: '  Hard sci-fi  ',
      promptBody: '  This is hard science fiction.  ',
    })
    expect(parsed).toEqual({ label: 'Hard sci-fi', promptBody: 'This is hard science fiction.' })
  })

  it('rejects a reply missing promptBody', () => {
    expect(() => labeledPromptOutputSchema.parse({ label: 'Hard sci-fi' })).toThrow()
  })
})

describe('settingOutputSchema', () => {
  it('accepts a well-formed setting', () => {
    expect(settingOutputSchema.parse({ setting: 'A drowned coast.' }).setting).toBe(
      'A drowned coast.',
    )
  })

  it('trims padded model output before it can reach the store', () => {
    expect(settingOutputSchema.parse({ setting: '  A drowned coast.  ' }).setting).toBe(
      'A drowned coast.',
    )
  })

  it('rejects a reply with no setting field', () => {
    expect(() => settingOutputSchema.parse({})).toThrow()
  })
})

describe('castSuggestionsSchema', () => {
  it('parses a mixed batch and defaults omitted status to active', () => {
    const parsed = castSuggestionsSchema.parse({
      entities: [
        {
          kind: 'character',
          name: ' Aria ',
          description: '  A blacksmith.  ',
          faction_name: '  Ashfall Pact  ',
        },
        {
          kind: 'location',
          name: 'Mornstone Keep',
          description: 'A fortress.',
          parent_location_name: '  The Vale  ',
        },
        { kind: 'item', name: 'Silver Coin', description: 'Old currency.', condition: 'worn' },
        {
          kind: 'faction',
          name: 'Ashfall Pact',
          description: 'A cult.',
          agenda: ['  expand  '],
          status: 'staged',
        },
      ],
    })
    // Reference-name fields (faction_name, parent_location_name) must trim: Task 9's
    // import resolver matches them case-insensitively against authored cast names.
    expect(parsed.entities[0]).toMatchObject({
      name: 'Aria',
      description: 'A blacksmith.',
      status: 'active',
      faction_name: 'Ashfall Pact',
    })
    expect(parsed.entities[1]).toMatchObject({ parent_location_name: 'The Vale' })
    expect(parsed.entities[3]).toMatchObject({ agenda: ['expand'], status: 'staged' })
  })

  it('rejects an unknown kind', () => {
    expect(
      castSuggestionsSchema.safeParse({
        entities: [{ kind: 'deity', name: 'X', description: 'Y' }],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty entities array', () => {
    expect(castSuggestionsSchema.safeParse({ entities: [] }).success).toBe(false)
  })

  it('silently strips a field that belongs to a different kind', () => {
    // Cross-kind fields aren't rejected — plain z.object() members strip unknown
    // keys rather than erroring, so a model that misfiles a field just loses it.
    const parsed = castSuggestionsSchema.parse({
      entities: [
        {
          kind: 'character',
          name: 'Aria',
          description: 'A blacksmith.',
          parent_location_name: 'The Vale',
        },
      ],
    })
    expect(parsed.entities[0]).not.toHaveProperty('parent_location_name')
  })
})
