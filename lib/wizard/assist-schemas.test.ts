import { describe, expect, it } from 'vitest'

import { descriptionOutputSchema, openingOutputSchema, titleChipsSchema } from './assist-schemas'

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
