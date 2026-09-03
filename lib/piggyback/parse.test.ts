import { describe, expect, it } from 'vitest'

import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from './parse'

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

  // An empty block must not read as a clean parse: that sets piggybackParseSucceeded,
  // which suppresses the fallback classifier and strands the turn with no state.
  it('records a block-level failure for an empty <state></state>', () => {
    const result = parseStateBlock('<state></state>')
    expect(result.blockFound).toBe(true)
    expect(result.block).toEqual({})
    expect(result.failures).toEqual([
      { field: 'state', detail: 'block was empty or truncated at the open tag' },
    ])
  })

  it('records a block-level failure when the stream truncates at the open tag', () => {
    const result = parseStateBlock('Some prose.<state>')
    expect(result.blockFound).toBe(true)
    expect(result.failures).toEqual([
      { field: 'state', detail: 'block was empty or truncated at the open tag' },
    ])
  })

  it('records a block-level failure when every inner tag is unrecognised', () => {
    const result = parseStateBlock('<state><scene>c1, c2</scene></state>')
    expect(result.block).toEqual({})
    expect(result.failures).toEqual([
      { field: 'state', detail: 'block content matched no known field tag' },
    ])
  })

  // Guards the other direction: one parsed field is a real report, however sparse,
  // and must not be reclassified as a failure.
  it('leaves a block that parsed a single field alone', () => {
    const result = parseStateBlock('<state><summary>Kael left.</summary></state>')
    expect(result.block).toEqual({ summary: 'Kael left.' })
    expect(result.failures).toEqual([])
  })
})

describe('parseSuggestionsBlock', () => {
  const block = `Prose here.
<state><summary>x</summary></state>
<suggestions>
  <item category="cat1">Draw the blade and step into the light.</item>
  <item category="cat2">"Who sent you?"</item>
</suggestions>`

  it('extracts items with their category refs', () => {
    const result = parseSuggestionsBlock(block)
    expect(result.blockFound).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.items).toEqual([
      { categoryRef: 'cat1', text: 'Draw the blade and step into the light.' },
      { categoryRef: 'cat2', text: '"Who sent you?"' },
    ])
  })

  it('reports blockFound false when no suggestions block is present', () => {
    const result = parseSuggestionsBlock('Prose only.<state><summary>x</summary></state>')
    expect(result.blockFound).toBe(false)
    expect(result.failed).toBe(false)
    expect(result.items).toEqual([])
  })

  it('fails when the block has content but no well-formed items', () => {
    const result = parseSuggestionsBlock('<suggestions>garbage, no items at all</suggestions>')
    expect(result.blockFound).toBe(true)
    expect(result.failed).toBe(true)
    expect(result.items).toEqual([])
  })

  it('treats an empty block as a legitimate zero-suggestion emission', () => {
    const result = parseSuggestionsBlock('<suggestions></suggestions>')
    expect(result.blockFound).toBe(true)
    expect(result.failed).toBe(false)
    expect(result.items).toEqual([])
  })

  it('skips an item missing its category attribute without failing the rest', () => {
    const result = parseSuggestionsBlock(
      '<suggestions><item>orphan</item><item category="cat1">kept</item></suggestions>',
    )
    expect(result.failed).toBe(false)
    expect(result.items).toEqual([{ categoryRef: 'cat1', text: 'kept' }])
  })

  it('recovers items from an unterminated block', () => {
    const result = parseSuggestionsBlock('<suggestions><item category="cat1">kept</item>')
    expect(result.items).toEqual([{ categoryRef: 'cat1', text: 'kept' }])
  })

  // Items the parser skips never reach `items`, so resolveSuggestionItems'
  // droppedCount cannot count them. Without malformedCount, one good chip
  // beside two bad ones is indistinguishable from a model that emitted one.
  it('counts a skipped item as malformed', () => {
    const result = parseSuggestionsBlock(
      '<suggestions><item>no category</item><item category="cat1">kept</item></suggestions>',
    )
    expect(result.items).toHaveLength(1)
    expect(result.malformedCount).toBe(1)
  })

  it('counts an empty-text item as malformed', () => {
    const result = parseSuggestionsBlock(
      '<suggestions><item category="cat1">   </item><item category="cat2">kept</item></suggestions>',
    )
    expect(result.items).toEqual([{ categoryRef: 'cat2', text: 'kept' }])
    expect(result.malformedCount).toBe(1)
  })

  // A final item cut off mid-stream never matches the paired regex, so it is
  // counted off the opening tag rather than in the match loop.
  it('counts an item truncated mid-stream as malformed', () => {
    const result = parseSuggestionsBlock(
      '<suggestions><item category="cat1">kept</item><item category="cat2">cut off',
    )
    expect(result.items).toEqual([{ categoryRef: 'cat1', text: 'kept' }])
    expect(result.malformedCount).toBe(1)
  })

  it('reports no malformed items when every item parses', () => {
    const result = parseSuggestionsBlock(
      '<suggestions><item category="cat1">one</item><item category="cat2">two</item></suggestions>',
    )
    expect(result.malformedCount).toBe(0)
  })
})

describe('parse independence — the four outcome combinations', () => {
  const good = '<state><summary>fine</summary></state>'
  const badState = '<state><world_time_delta>not-a-number-at-all</world_time_delta></state>'
  const goodSug = '<suggestions><item category="cat1">go</item></suggestions>'
  const badSug = '<suggestions>garbage</suggestions>'

  it('both ok', () => {
    const raw = `p\n${good}\n${goodSug}`
    expect(parseStateBlock(raw).failures).toEqual([])
    expect(parseSuggestionsBlock(raw).failed).toBe(false)
  })

  it('state fails, suggestions survive', () => {
    const raw = `p\n${badState}\n${goodSug}`
    expect(parseStateBlock(raw).failures.length).toBeGreaterThan(0)
    expect(parseSuggestionsBlock(raw).items).toHaveLength(1)
  })

  it('suggestions fail, state survives', () => {
    const raw = `p\n${good}\n${badSug}`
    expect(parseStateBlock(raw).failures).toEqual([])
    expect(parseSuggestionsBlock(raw).failed).toBe(true)
  })

  it('both fail independently', () => {
    const raw = `p\n${badState}\n${badSug}`
    expect(parseStateBlock(raw).failures.length).toBeGreaterThan(0)
    expect(parseSuggestionsBlock(raw).failed).toBe(true)
  })
})

describe('stripTrailingBlocks', () => {
  it('returns raw prose when no <state> block is present', () => {
    const { prose, stateRaw } = stripTrailingBlocks('Once upon a time...')
    expect(prose).toBe('Once upon a time...')
    expect(stateRaw).toBeUndefined()
  })

  it('separates prose from trailing <state> block', () => {
    const raw =
      'The knight drew his sword.\n\n<state>\n<scene_entities>c1</scene_entities>\n</state>'
    const { prose, stateRaw } = stripTrailingBlocks(raw)
    expect(prose).toBe('The knight drew his sword.')
    expect(stateRaw).toBe('<state>\n<scene_entities>c1</scene_entities>\n</state>')
  })

  it('excises each block and returns both raws', () => {
    const raw =
      'The rain falls.\n<state><summary>x</summary></state>\n<suggestions><item category="cat1">go</item></suggestions>'
    const { prose, stateRaw, suggestionsRaw } = stripTrailingBlocks(raw)
    expect(prose).toBe('The rain falls.')
    expect(stateRaw).toContain('<summary>x</summary>')
    expect(suggestionsRaw).toContain('cat1')
  })

  it('cuts at suggestions when it precedes state', () => {
    const raw =
      'Prose.\n<suggestions><item category="cat1">go</item></suggestions>\n<state><summary>x</summary></state>'
    expect(stripTrailingBlocks(raw).prose).toBe('Prose.')
  })

  it('returns prose untouched when no block is present', () => {
    expect(stripTrailingBlocks('Just prose.')).toEqual({ prose: 'Just prose.' })
  })

  it('leaves stateRaw undefined for a suggestions-only turn', () => {
    // entry-card gates its state viewer on stateRaw != null; a regression here
    // lights the viewer on an entry that has no state.
    const { stateRaw, suggestionsRaw } = stripTrailingBlocks(
      'p\n<suggestions><item category="cat1">go</item></suggestions>',
    )
    expect(stateRaw).toBeUndefined()
    expect(suggestionsRaw).toContain('cat1')
  })

  // The cut is keyed on the close tag, not on position: prose that mentions the
  // tag in passing carries no closer, and truncating there is unrecoverable.
  it('leaves prose that merely mentions the tag intact', () => {
    const raw = 'The city declared a <state> of emergency that morning.'
    expect(stripTrailingBlocks(raw)).toEqual({ prose: raw })
  })

  it('excises the real block when prose also mentions the tag', () => {
    const raw = 'The city declared a <state> of emergency.<state><summary>x</summary></state>'
    const { prose, stateRaw } = stripTrailingBlocks(raw)
    expect(prose).toBe('The city declared a <state> of emergency.')
    expect(stateRaw).toBe('<state><summary>x</summary></state>')
  })

  // Truncating at a misplaced block would drop every word after it. Excising the
  // span keeps both halves and flags the ordering the prompt forbids.
  it('keeps prose on both sides of an out-of-position block', () => {
    const raw = 'Before.<state><summary>x</summary></state>After.'
    const { prose, stateRaw, outOfPosition } = stripTrailingBlocks(raw)
    expect(prose).toBe('Before.After.')
    expect(stateRaw).toBe('<state><summary>x</summary></state>')
    expect(outOfPosition).toBe(true)
  })

  it('does not flag a block that sits after the prose', () => {
    const raw = 'Prose.\n<state><summary>x</summary></state>'
    expect(stripTrailingBlocks(raw).outOfPosition).toBeUndefined()
  })

  it('cuts an opener the stream truncated before its content', () => {
    const { prose, stateRaw } = stripTrailingBlocks('The knight rides on.<state>')
    expect(prose).toBe('The knight rides on.')
    expect(stateRaw).toBe('<state>')
  })

  it('assigns each raw to its own block when suggestions precede state', () => {
    const raw =
      'p\n<suggestions><item category="cat1">go</item></suggestions>\n<state><summary>x</summary></state>'
    const { stateRaw, suggestionsRaw } = stripTrailingBlocks(raw)
    expect(stateRaw).toContain('<summary>x</summary>')
    expect(stateRaw).not.toContain('cat1')
    expect(suggestionsRaw).toContain('cat1')
    expect(suggestionsRaw).not.toContain('<summary>')
  })
})

describe('unterminated blocks do not bleed into their sibling', () => {
  const unterminatedState =
    'Prose.\n<state><summary>The knight rides on.\n<suggestions><item category="cat1">go north</item></suggestions>'

  it('keeps a following suggestions block out of stateRaw', () => {
    expect(stripTrailingBlocks(unterminatedState).stateRaw).not.toContain('cat1')
  })

  it('keeps a following suggestions block out of a persisted summary', () => {
    // metadata.summary feeds the memory pipeline — markup here is silent
    // corruption, not a display blemish.
    expect(parseStateBlock(unterminatedState).block.summary).toBe('The knight rides on.')
  })

  it('keeps a following suggestions block out of sceneEntities', () => {
    const raw =
      'p\n<state><scene_entities>c1, c2\n<suggestions><item category="cat1">go</item></suggestions>'
    expect(parseStateBlock(raw).block.sceneEntities).toEqual(['c1', 'c2'])
  })

  // The mirror image. Every case above runs state-then-suggestions, so a guard
  // that bounded only <state> would pass them all while an unterminated
  // <suggestions> swallowed the <state> after it — which assertNotTruncated
  // then reads as a failed block, dropping chips that parsed cleanly.
  // Composed so the bleed is actually observable. <state>'s transfers reuse the
  // <item> tag name, and a bled transfer yields no chip (it has no `category`),
  // so `items` looks identical whether or not the boundary held — only the
  // malformed counter, which counts opening tags, can tell them apart.
  const unterminatedSuggestions =
    'Prose.\n<suggestions><item category="cat1">go north</item>\n' +
    '<state><transfers><item id="i1" slot="inventory" to="c2" /></transfers>' +
    '<summary>x</summary></state>'

  it("keeps <state>'s transfer items out of the suggestions segment", () => {
    const result = parseSuggestionsBlock(unterminatedSuggestions)
    expect(result.failed).toBe(false)
    expect(result.items).toEqual([{ categoryRef: 'cat1', text: 'go north' }])
    expect(result.malformedCount).toBe(0)
  })

  it('still parses the state block that follows an unterminated suggestions block', () => {
    const state = parseStateBlock(unterminatedSuggestions)
    expect(state.block.summary).toBe('x')
    expect(state.block.transfers?.items).toEqual([{ id: 'i1', slot: 'inventory', to: 'c2' }])
  })
})

describe('<item> tag collision between transfers and suggestions', () => {
  const raw =
    'Prose.\n<state><transfers><item id="i1" slot="inventory" to="c2" /></transfers></state>\n' +
    '<suggestions><item category="cat1">Draw the blade.</item></suggestions>'

  it('routes transfer items and suggestion items to their own parsers', () => {
    const state = parseStateBlock(raw)
    expect(state.block.transfers?.items).toEqual([{ id: 'i1', slot: 'inventory', to: 'c2' }])
    expect(parseSuggestionsBlock(raw).items).toEqual([
      { categoryRef: 'cat1', text: 'Draw the blade.' },
    ])
  })
})
