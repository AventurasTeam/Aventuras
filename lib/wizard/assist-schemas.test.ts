import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'

import {
  CAST_SOFT_CAPS,
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
  it('parses a mixed batch across all four kinds and trims every padded field', () => {
    const parsed = castSuggestionsSchema.parse({
      entities: [
        {
          kind: 'character',
          name: ' Aria ',
          description: '  A blacksmith.  ',
          faction_name: '  Ashfall Pact  ',
          traits: ['  brave  '],
          drives: ['  protect the forge  '],
          visual: {
            physique: '  stocky  ',
            face: '  scarred  ',
            hair: '  black  ',
            eyes: '  grey  ',
            attire: '  leather apron  ',
            distinguishing: '  soot-stained hands  ',
          },
        },
        {
          kind: 'location',
          name: 'Mornstone Keep',
          description: 'A fortress.',
          parent_location_name: '  The Vale  ',
          condition: '  war-damaged  ',
        },
        { kind: 'item', name: 'Silver Coin', description: 'Old currency.', condition: 'worn' },
        {
          kind: 'faction',
          name: 'Ashfall Pact',
          description: 'A cult.',
          agenda: ['  expand  '],
          standing: '  fractured  ',
          status: 'staged',
        },
      ],
    })
    // Reference-name fields (faction_name, parent_location_name) must trim:
    // resolveCastImports matches them case-insensitively against cast names.
    expect(parsed.entities[0]).toMatchObject({
      name: 'Aria',
      description: 'A blacksmith.',
      status: 'active',
      faction_name: 'Ashfall Pact',
      traits: ['brave'],
      drives: ['protect the forge'],
      visual: {
        physique: 'stocky',
        face: 'scarred',
        hair: 'black',
        eyes: 'grey',
        attire: 'leather apron',
        distinguishing: 'soot-stained hands',
      },
    })
    expect(parsed.entities[1]).toMatchObject({
      parent_location_name: 'The Vale',
      condition: 'war-damaged',
    })
    expect(parsed.entities[2]).toMatchObject({ condition: 'worn' })
    expect(parsed.entities[3]).toMatchObject({
      agenda: ['expand'],
      standing: 'fractured',
      status: 'staged',
    })
  })

  it('renders through the real prompt-schema path without degrading to unknown', () => {
    // castSuggestionsSchema is the schema that motivated fixing the renderer's
    // oneOf blind spot; this must render the actual schema, not a synthetic
    // stand-in, so a regression here is caught at the source.
    const block = schemaToTypeScriptBlock(z.toJSONSchema(castSuggestionsSchema) as JsonSchema)
    expect(block).not.toContain('unknown')
    expect(block).toContain('faction_name')
    expect(block).toContain('physique')
    expect(block).toContain('agenda')
    expect(block).toContain(`personality/skill traits, at most ${CAST_SOFT_CAPS.traits}`)
    expect(block).toContain(`goals, fears, sore spots, at most ${CAST_SOFT_CAPS.drives}`)
    expect(block).toContain(`current goals, at most ${CAST_SOFT_CAPS.agenda}`)
  })

  it('leaves soft-cap enforcement to import so an oversized batch can be salvaged', () => {
    const parsed = castSuggestionsSchema.parse({
      entities: [
        {
          kind: 'character',
          name: 'Aria',
          description: 'A blacksmith.',
          traits: Array(CAST_SOFT_CAPS.traits + 1).fill('brave'),
          drives: Array(CAST_SOFT_CAPS.drives + 1).fill('protect the forge'),
        },
        {
          kind: 'faction',
          name: 'Ashfall Pact',
          description: 'A cult.',
          agenda: Array(CAST_SOFT_CAPS.agenda + 1).fill('expand'),
        },
      ],
    })

    expect(parsed.entities[0]).toMatchObject({
      traits: Array(CAST_SOFT_CAPS.traits + 1).fill('brave'),
      drives: Array(CAST_SOFT_CAPS.drives + 1).fill('protect the forge'),
    })
    expect(parsed.entities[1]).toMatchObject({
      agenda: Array(CAST_SOFT_CAPS.agenda + 1).fill('expand'),
    })
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
