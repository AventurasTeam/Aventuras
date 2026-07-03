import { describe, expect, it } from 'vitest'

import {
  descriptionOutputSchema,
  openingOutputSchema,
  parseStructured,
  titleChipsSchema,
} from './assist-schemas'

describe('parseStructured', () => {
  it('parses strict JSON', () => {
    const raw = '{"prose":"Hi","sceneEntities":["c1"],"currentLocationId":null,"worldTime":0}'
    expect(parseStructured(raw, openingOutputSchema)).toMatchObject({
      prose: 'Hi',
      sceneEntities: ['c1'],
    })
  })
  it('recovers via jsonrepair (trailing comma)', () => {
    const raw = '{"prose":"Hi","sceneEntities":[],"currentLocationId":null,"worldTime":0,}'
    expect(parseStructured(raw, openingOutputSchema).prose).toBe('Hi')
  })
  it('recovers via jsonrepair (unfenced / python-ish)', () => {
    const raw =
      '```json\n{"prose":"Hi","sceneEntities":[],"currentLocationId":null,"worldTime":0}\n```'
    // jsonrepair strips markdown fences; verify it recovers
    expect(parseStructured(raw, openingOutputSchema).prose).toBe('Hi')
  })
  it('throws on malformed-beyond-repair output', () => {
    expect(() => parseStructured('not json at all <<<', openingOutputSchema)).toThrow()
  })
  it('parses title chips shape', () => {
    expect(parseStructured('{"titles":["A","B"]}', titleChipsSchema).titles).toEqual(['A', 'B'])
  })
  it('parses description shape', () => {
    expect(parseStructured('{"description":"A tale."}', descriptionOutputSchema).description).toBe(
      'A tale.',
    )
  })
  it('rejects when zod validation fails even after valid JSON', () => {
    // valid JSON but wrong shape (worldTime must be 0, sceneEntities required)
    expect(() => parseStructured('{"prose":"Hi"}', openingOutputSchema)).toThrow()
  })
})
