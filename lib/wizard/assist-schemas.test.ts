import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  descriptionOutputSchema,
  openingOutputSchema,
  renderOutputFields,
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

describe('renderOutputFields', () => {
  it('renders one line per schema field with type and description', () => {
    const out = renderOutputFields(openingOutputSchema)
    expect(out.split('\n')).toHaveLength(Object.keys(openingOutputSchema.shape).length)
    expect(out).toContain('- "prose" (string): the opening passage as a string.')
    expect(out).toContain('"sceneEntities" (array of string)')
    expect(out).toContain('cast ids present in the scene')
  })

  it('labels nullable and literal fields', () => {
    const out = renderOutputFields(openingOutputSchema)
    expect(out).toMatch(/"currentLocationId" \(string or null\)/)
    expect(out).toMatch(/"worldTime" \(always 0\)/)
  })

  it('covers every schema key, so a schema edit cannot silently miss the prompt', () => {
    const out = renderOutputFields(openingOutputSchema)
    for (const key of Object.keys(openingOutputSchema.shape)) {
      expect(out).toContain(`"${key}"`)
    }
  })

  it('omits the description clause when a field has none', () => {
    const schema = z.object({ bare: z.number() })
    expect(renderOutputFields(schema)).toBe('- "bare" (number).')
  })
})
