import { describe, expect, it } from 'vitest'

import { parseStateBlock, stripStateBlock } from './parse'

const WELL_FORMED = `Some narrative prose here.
<state>
  <scene_entities>c1, c2</scene_entities>
  <current_location>l1</current_location>
  <world_time_delta>120</world_time_delta>
  <visual_changes>
    <entity id="c2" type="attire">cloak now muddied to the waist</entity>
    <entity id="c2" type="hair">damp and matted to her forehead</entity>
  </visual_changes>
  <transfers>
    <item id="i1" to="c1" from="c3" slot="inventory" />
    <stackable key="gold" amount="50" to="c1" from="c3" />
  </transfers>
  <summary>Aria pushed into the marshes.</summary>
</state>`

describe('parseStateBlock', () => {
  it('parses a well-formed block into every field, including multi-entry visual_changes and structured transfers', () => {
    const result = parseStateBlock(WELL_FORMED)
    expect(result.blockFound).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.block).toEqual({
      sceneEntities: ['c1', 'c2'],
      currentLocation: 'l1',
      worldTimeDelta: 120,
      visualChanges: [
        { id: 'c2', type: 'attire', text: 'cloak now muddied to the waist' },
        { id: 'c2', type: 'hair', text: 'damp and matted to her forehead' },
      ],
      transfers: {
        items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c3' }],
        stackables: [{ key: 'gold', amount: 50, to: 'c1', from: 'c3' }],
      },
      summary: 'Aria pushed into the marshes.',
    })
  })

  it('reports blockFound=false and no failures when no <state> tag exists', () => {
    const result = parseStateBlock('Just narrative prose, no trailing block at all.')
    expect(result.blockFound).toBe(false)
    expect(result.block).toEqual({})
    expect(result.failures).toEqual([])
  })

  it('isolates a truncated <visual_changes> segment without blocking sceneEntities', () => {
    const truncated = `<state>
  <scene_entities>c1</scene_entities>
  <current_location>l1</current_location>
  <world_time_delta>60</world_time_delta>
  <visual_changes>
    <entity id="c1" type="attire">torn cloak
</state>`
    const result = parseStateBlock(truncated)
    expect(result.blockFound).toBe(true)
    expect(result.block.sceneEntities).toEqual(['c1'])
    expect(result.block.currentLocation).toBe('l1')
    expect(result.block.worldTimeDelta).toBe(60)
    expect(result.block.visualChanges).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'visualChanges', detail: expect.any(String) }])
  })

  it('drops a visual_changes entry whose type is not one of the six known categories', () => {
    const invalidType = `<state>
  <scene_entities>c1</scene_entities>
  <visual_changes>
    <entity id="c1" type="clothing">a garbled category the model invented</entity>
  </visual_changes>
</state>`
    const result = parseStateBlock(invalidType)
    expect(result.blockFound).toBe(true)
    expect(result.block.visualChanges).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'visualChanges', detail: expect.any(String) }])
  })

  it('keeps a well-formed sibling entry when another entry in the same block has an invalid type', () => {
    const mixed = `<state>
  <scene_entities>c1</scene_entities>
  <visual_changes>
    <entity id="c1" type="clothing">a garbled category</entity>
    <entity id="c1" type="attire">a leather jacket</entity>
  </visual_changes>
</state>`
    const result = parseStateBlock(mixed)
    expect(result.block.visualChanges).toEqual([
      { id: 'c1', type: 'attire', text: 'a leather jacket' },
    ])
    expect(result.failures).toEqual([])
  })

  it('isolates a truncated <transfers> segment without blocking sceneEntities', () => {
    const truncated = `<state>
  <scene_entities>c1</scene_entities>
  <world_time_delta>0</world_time_delta>
  <transfers>
    <item id="i1" to="c1" from="c3" slot="inventory"
</state>`
    const result = parseStateBlock(truncated)
    expect(result.blockFound).toBe(true)
    expect(result.block.sceneEntities).toEqual(['c1'])
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
  })

  it('an empty <transfers></transfers> tag is a legitimate no-op, not a failure', () => {
    const raw = `<state>
  <scene_entities>c1</scene_entities>
  <world_time_delta>0</world_time_delta>
  <transfers></transfers>
</state>`
    const result = parseStateBlock(raw)
    expect(result.block.transfers).toEqual({ items: [], stackables: [] })
    expect(result.failures).toEqual([])
  })

  it('repairs a bad-JSON-ish interior in world_time_delta via jsonrepair-equivalent coercion', () => {
    const raw = `<state>
  <scene_entities>c1</scene_entities>
  <current_location>l1</current_location>
  <world_time_delta>  120, // seconds  </world_time_delta>
</state>`
    const result = parseStateBlock(raw)
    expect(result.block.worldTimeDelta).toBe(120)
  })

  it('records an unknown-placeholder failure per field without throwing', () => {
    const raw = `<state>
  <scene_entities>c1, not-a-placeholder-!!</scene_entities>
  <world_time_delta>30</world_time_delta>
</state>`
    const result = parseStateBlock(raw)
    expect(result.block.sceneEntities).toEqual(['c1', 'not-a-placeholder-!!'])
    expect(result.block.worldTimeDelta).toBe(30)
  })

  it('an empty <state></state> block parses with every field absent', () => {
    const result = parseStateBlock('<state></state>')
    expect(result.blockFound).toBe(true)
    expect(result.block).toEqual({})
    expect(result.failures).toEqual([])
  })

  describe('stripStateBlock', () => {
    it('returns raw prose when no <state> block is present', () => {
      const { prose, stateRaw } = stripStateBlock('Once upon a time...')
      expect(prose).toBe('Once upon a time...')
      expect(stateRaw).toBeUndefined()
    })

    it('separates prose from trailing <state> block', () => {
      const raw =
        'The knight drew his sword.\n\n<state>\n<scene_entities>c1</scene_entities>\n</state>'
      const { prose, stateRaw } = stripStateBlock(raw)
      expect(prose).toBe('The knight drew his sword.')
      expect(stateRaw).toBe('<state>\n<scene_entities>c1</scene_entities>\n</state>')
    })
  })
})
