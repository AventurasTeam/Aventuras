import { describe, expect, it } from 'vitest'

import { emptyEntityState, entityStateSchemaForKind, VISUAL_CATEGORIES } from '@/lib/db'
import { MAX_EMITTED_QUERIES } from '@/lib/retrieval'

import {
  normalizeCreates,
  normalizeStackableTransfer,
  parseStateBlock,
  parseSuggestionsBlock,
  readCutOffReply,
  stripTrailingBlocks,
} from './parse'
import { MAX_RETRIEVAL_QUERIES, VISUAL_TEXT_MAX } from './types'

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
  <retrieval_queries>
    <query>House Eldrin's history and its sigil</query>
    <query>exiled nobility of the marshes</query>
  </retrieval_queries>
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
        items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c3', seq: 0 }],
        stackables: [{ key: 'gold', amount: 50, to: 'c1', from: 'c3' }],
        drops: [],
      },
      summary: 'Aria pushed into the marshes.',
      retrievalQueries: ["House Eldrin's history and its sigil", 'exiled nobility of the marshes'],
    })
  })

  it('lowercases stackable keys and drops a blank, over-long, non-positive-whole or unsafe transfer', () => {
    const result = parseStateBlock(`<state>
  <transfers>
    <stackable key=" Gold " amount="5" to="c1" />
    <stackable key="  " amount="5" to="c1" />
    <stackable key="${'k'.repeat(41)}" amount="5" to="c1" />
    <stackable key="arrows" amount="-3" to="c1" />
    <stackable key="arrows" amount="0" to="c1" />
    <stackable key="arrows" amount="2.5" to="c1" />
    <stackable key="arrows" amount="9007199254740993" to="c1" />
  </transfers>
</state>`)
    expect(result.block.transfers?.stackables).toEqual([{ key: 'gold', amount: 5, to: 'c1' }])
  })

  it('folds whitespace runs in a stackable key to single spaces, for both producers', () => {
    const result = parseStateBlock(`<state>
  <transfers>
    <stackable key=" Silver  coins " amount="5" to="c1" />
  </transfers>
</state>`)
    expect(result.block.transfers?.stackables).toEqual([
      { key: 'silver coins', amount: 5, to: 'c1' },
    ])
    expect(normalizeStackableTransfer({ key: 'Silver\ncoins', amount: 5, from: 'c1' })).toEqual({
      key: 'silver coins',
      amount: 5,
      from: 'c1',
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

  // Pins the schema cap to the truncation constant from the other side: a schema cap lower
  // than VISUAL_TEXT_MAX would still fail updateEntity on a note truncation calls in-bounds.
  describe('VISUAL_TEXT_MAX', () => {
    it.each(VISUAL_CATEGORIES)(
      'accepts %s at VISUAL_TEXT_MAX and rejects one character more',
      (category) => {
        const schema = entityStateSchemaForKind('character')
        const atCap = {
          ...emptyEntityState('character'),
          visual: { [category]: 'a'.repeat(VISUAL_TEXT_MAX) },
        }
        const overCap = {
          ...emptyEntityState('character'),
          visual: { [category]: 'a'.repeat(VISUAL_TEXT_MAX + 1) },
        }
        expect(schema.safeParse(atCap).success).toBe(true)
        expect(schema.safeParse(overCap).success).toBe(false)
      },
    )
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

  it('reads attributes that follow a closing quote with no space between them', () => {
    const { block, failures } = parseStateBlock(
      '<state><transfers><item id="i1" from="c3"to="c1" slot="inventory" />' +
        '<stackable key="gold" amount="50" from="c3"to="c1"/></transfers></state>',
    )
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [{ id: 'i1', slot: 'inventory', from: 'c3', to: 'c1', seq: 0 }],
      stackables: [{ key: 'gold', amount: 50, from: 'c3', to: 'c1' }],
      drops: [],
    })
  })

  it('reads attributes separated by a comma', () => {
    const { block, failures } = parseStateBlock(
      '<state><transfers><item id="i1",to="c1" slot="inventory" /></transfers></state>',
    )
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [{ id: 'i1', slot: 'inventory', to: 'c1', seq: 0 }],
      stackables: [],
      drops: [],
    })
  })

  it('an empty <transfers></transfers> tag is a legitimate no-op, not a failure', () => {
    const raw = `<state>
  <scene_entities>c1</scene_entities>
  <world_time_delta>0</world_time_delta>
  <transfers></transfers>
</state>`
    const result = parseStateBlock(raw)
    expect(result.block.transfers).toEqual({ items: [], stackables: [], drops: [] })
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

  // Reads like inconsistency but isn't: every other field here throws on empty content,
  // which fires a full extra LLM call — recovering an optional hint that way inverts cost.
  describe('<retrieval_queries> — total by contract', () => {
    const block = (inner: string) => `prose\n<state>\n${inner}\n</state>`

    it('extracts the emitted queries in order', () => {
      const { block: parsed, failures } = parseStateBlock(
        block(
          '<retrieval_queries><query>House Eldrin sigil</query><query>marsh nobility</query></retrieval_queries>',
        ),
      )
      expect(parsed.retrievalQueries).toEqual(['House Eldrin sigil', 'marsh nobility'])
      expect(failures).toEqual([])
    })

    it.each([
      ['unterminated children', '<retrieval_queries><query>House Eldrin'],
      ['no children at all', '<retrieval_queries>just prose here</retrieval_queries>'],
      ['empty children', '<retrieval_queries><query></query><query>  </query></retrieval_queries>'],
    ])('records no failure for %s', (_label, inner) => {
      const { failures } = parseStateBlock(block(`<summary>s</summary>${inner}`))
      expect(failures).toEqual([])
    })

    it('caps the emission at MAX_RETRIEVAL_QUERIES', () => {
      const queries = ['a', 'b', 'c', 'd'].map((q) => `<query>${q}</query>`).join('')
      const { block: parsed } = parseStateBlock(
        block(`<retrieval_queries>${queries}</retrieval_queries>`),
      )
      expect(parsed.retrievalQueries).toEqual(['a', 'b', 'c'])
    })

    // Cap counts DISTINCT queries (matches emittedSpecs in lib/retrieval/queries.ts) —
    // counting repeats would spend a slot on a duplicate and drop the distinct ask behind it.
    it('dedupes before capping, so a repeat does not cost a distinct query its slot', () => {
      const queries = ['a', 'a', 'b', 'c'].map((q) => `<query>${q}</query>`).join('')
      const { block: parsed } = parseStateBlock(
        block(`<retrieval_queries>${queries}</retrieval_queries>`),
      )
      expect(parsed.retrievalQueries).toEqual(['a', 'b', 'c'])
    })

    // The cap lives in two modules that can't import each other (see MAX_RETRIEVAL_QUERIES) —
    // drift here means storage and the query stack disagree on how many asks a turn gets.
    it('caps at the same number the query stack embeds', () => {
      expect(MAX_RETRIEVAL_QUERIES).toBe(MAX_EMITTED_QUERIES)
    })

    // Not cosmetic: parseStateBlock judges emptiness via Object.keys(block).length, so a
    // key set to undefined would read as a clean parse and suppress the fallback this turn needs.
    it('leaves a state block carrying only an unusable retrieval_queries reported empty', () => {
      const { block: parsed, failures } = parseStateBlock(
        block('<retrieval_queries>nothing parseable</retrieval_queries>'),
      )
      expect(parsed.retrievalQueries).toBeUndefined()
      expect(Object.keys(parsed)).toEqual([])
      expect(failures).toEqual([
        { field: 'state', detail: 'block content matched no known field tag' },
      ])
    })
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

  describe('a reply that breaks the one-of-each shape', () => {
    const state = (summary: string) => `<state><summary>${summary}</summary></state>`
    const suggestions = '<suggestions><item category="cat1">go</item></suggestions>'
    const nestedState = `<state><summary>x</summary>${suggestions}</state>`

    it('leaves no tag of a block nested in the other, either way round', () => {
      const nestedSuggestions = `<suggestions>${state('x')}</suggestions>`
      expect(stripTrailingBlocks(`Prose.\n\n${nestedState}`).prose).toBe('Prose.')
      expect(stripTrailingBlocks(`Prose.\n\n${nestedSuggestions}`).prose).toBe('Prose.')
    })

    it('does not read a nested block as out of position', () => {
      expect(stripTrailingBlocks(`Prose.\n\n${nestedState}`).outOfPosition).toBeUndefined()
    })

    it('keeps prose after a nested block, flagged out of position', () => {
      const { prose, outOfPosition } = stripTrailingBlocks(`Prose.\n\n${nestedState}\nAfter.`)
      expect(prose).toBe('Prose.\n\n\nAfter.')
      expect(outOfPosition).toBe(true)
    })

    it('excises every repeat of a closed block', () => {
      const { prose, outOfPosition } = stripTrailingBlocks(`Prose.\n\n${state('a')}\n${state('b')}`)
      expect(prose).toBe('Prose.')
      expect(outOfPosition).toBeUndefined()
    })

    it('reports the first repeat as the raw, the one parseStateBlock reads', () => {
      const raw = `Prose.\n\n${state('a')}\n${state('b')}`
      expect(stripTrailingBlocks(raw).stateRaw).toBe(state('a'))
      expect(parseStateBlock(raw).block.summary).toBe('a')
    })

    it('excises an unclosed block after a closed one', () => {
      const { prose, outOfPosition } = stripTrailingBlocks(
        `Prose.\n\n${state('a')}\n<state>\n<summary>b`,
      )
      expect(prose).toBe('Prose.')
      expect(outOfPosition).toBeUndefined()
    })

    it('excises repeats ahead of a trailing unclosed block', () => {
      const raw = `Prose.\n\n${state('a')}\n${state('b')}\n<state>\n<summary>c`
      expect(stripTrailingBlocks(raw).prose).toBe('Prose.')
    })

    it('excises both tags of a block nested in its own kind', () => {
      expect(stripTrailingBlocks(`Prose.\n\n<state>a<state>b</state>c</state>`).prose).toBe(
        'Prose.',
      )
    })

    it('still leaves an unclosed mention ahead of a closed block', () => {
      expect(stripTrailingBlocks(`A <state> of alarm.\n\n${state('a')}`).prose).toBe(
        'A <state> of alarm.',
      )
    })

    it('leaves a mention followed by markup ahead of a closed block', () => {
      expect(stripTrailingBlocks(`A <state> <em>alarm</em>.\n\n${state('a')}`).prose).toBe(
        'A <state> <em>alarm</em>.',
      )
    })

    it('leaves a mention after a closed block in the prose', () => {
      const { prose, outOfPosition } = stripTrailingBlocks(`${state('a')}\nA <state> of alarm.`)
      expect(prose).toBe('A <state> of alarm.')
      expect(outOfPosition).toBe(true)
    })

    it('leaves a mention followed by markup after a closed block in the prose', () => {
      const { prose, outOfPosition } = stripTrailingBlocks(
        `Prose.\n\n${state('a')}\nA <state> <em>alarm</em>.`,
      )
      expect(prose).toBe('Prose.\n\n\nA <state> <em>alarm</em>.')
      expect(outOfPosition).toBe(true)
    })

    it('excises an unclosed block right after the close of a closed one', () => {
      expect(stripTrailingBlocks(`Prose.\n\n${state('a')}<state>\n<summary>b`).prose).toBe('Prose.')
    })

    it('leaves a stray close tag no opener claims', () => {
      expect(stripTrailingBlocks('He wrote </state> on the wall.').prose).toBe(
        'He wrote </state> on the wall.',
      )
    })
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

// generation-pipeline.md → Cut-off replies: called only for a reply that stopped at 'length'.
describe('readCutOffReply', () => {
  const PROSE = 'The knight drew his sword.\n'

  it('reads a cut in plain prose as in the prose, leaving the text alone', () => {
    expect(readCutOffReply('The knight drew his sw')).toEqual({
      content: 'The knight drew his sw',
      inBlock: false,
    })
  })

  it('reads an empty reply as in the prose', () => {
    expect(readCutOffReply('')).toEqual({ content: '', inBlock: false })
  })

  // blockSpans opens no span on a mention followed by prose, so neither does the cut.
  it('reads prose that mentions a root tag in passing as prose', () => {
    const raw = 'The city declared a <state> of emergency that mor'
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: false })
  })

  it('reads a literal < earlier in the prose as prose', () => {
    const raw = 'She wrote 3 < 4 on the slate and then wa'
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: false })
  })

  it('reads a cut in prose after an out-of-position block as in the prose', () => {
    const raw = 'Before.<state><summary>x</summary></state>After, the knight rode to'
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: false })
  })

  it('reads a bare trailing < as a block begun, and removes it', () => {
    expect(readCutOffReply(`${PROSE}<`)).toEqual({ content: PROSE.trimEnd(), inBlock: true })
  })

  // The model opens its trailing block on a line of its own.
  it.each([
    'She whispered <',
    'He sighed <su',
    'Before.\n<state><summary>x</summary></state>\nAfter, more prose <',
  ])('reads a < cut mid-line (%j) as prose, leaving the text alone', (raw) => {
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: false })
  })

  it('reads an opener cut after an indented line start as in the block, trimming what it leaves', () => {
    expect(readCutOffReply(`${PROSE}\n \t<sta`)).toEqual({
      content: PROSE.trimEnd(),
      inBlock: true,
    })
  })

  // The span that ends last decides, not the first one.
  it('reads a cut in a block that follows a closed one as in the block', () => {
    const raw = `${PROSE}<state><summary>x</summary></state>\n<suggestions>\n<item category="a">Dr`
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: true })
  })

  it('reads a closed block after an unclosed sibling, with nothing after it, as in the block', () => {
    const raw = `${PROSE}<state><summary>x\n<suggestions><item category="a">go</item></suggestions>`
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: true })
  })

  // State is emitted first, so a closed <state> block is the usual `<` before a cut <sugg.
  it('reads a cut in an unclosed block after a closed one as in the block', () => {
    const raw = 'Prose.\n\n<state><summary>a</summary></state>\n<state>\n<summary>b'
    expect(readCutOffReply(raw).inBlock).toBe(true)
  })

  it('reads a cut in prose that mentions the tag after a closed block as outside it', () => {
    const raw = `${PROSE}<state><summary>a</summary></state>\nA <state> <em>alarm</em>.`
    expect(readCutOffReply(raw)).toEqual({ content: raw, inBlock: false })
  })

  it('reads an opener cut after a closed block as in the block, and removes it', () => {
    const closed = `${PROSE}<state>\n<summary>x</summary>\n</state>\n`
    expect(readCutOffReply(`${closed}<sugg`)).toEqual({ content: closed.trimEnd(), inBlock: true })
  })

  it.each(['', '  '])(
    'reads an opener cut right after a closed block on its line (%j between) as in the block',
    (gap) => {
      const closed = `${PROSE}<state><summary>x</summary></state>`
      expect(readCutOffReply(`${closed}${gap}<sugg`)).toEqual({ content: closed, inBlock: true })
    },
  )

  describe.each([
    {
      root: 'state',
      truncated: '<state>\n<scene_entities>c1',
      closed: '<state>\n<summary>x</summary>\n</state>',
      prefix: '<sta',
    },
    {
      root: 'suggestions',
      truncated: '<suggestions>\n<item category="a">Dr',
      closed: '<suggestions>\n<item category="a">Run.</item>\n</suggestions>',
      prefix: '<sugg',
    },
  ])('the <$root> block', ({ root, truncated, closed, prefix }) => {
    it('reads a cut inside it as in the block, leaving the text alone', () => {
      expect(readCutOffReply(`${PROSE}${truncated}`)).toEqual({
        content: `${PROSE}${truncated}`,
        inBlock: true,
      })
    })

    it('reads a closed block with nothing after it as in the block, never stripping it', () => {
      expect(readCutOffReply(`${PROSE}${closed}`)).toEqual({
        content: `${PROSE}${closed}`,
        inBlock: true,
      })
      expect(readCutOffReply(`${PROSE}${closed}\n\n`)).toEqual({
        content: `${PROSE}${closed}\n\n`,
        inBlock: true,
      })
    })

    it.each([prefix, `<${root}`])(
      'reads an opener cut mid-name (%s) as in the block, and removes it with the newline before it',
      (fragment) => {
        expect(readCutOffReply(`${PROSE}${fragment}`)).toEqual({
          content: PROSE.trimEnd(),
          inBlock: true,
        })
      },
    )
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
    expect(state.block.transfers?.items).toEqual([
      { id: 'i1', slot: 'inventory', to: 'c2', seq: 0 },
    ])
  })
})

describe('<item> tag collision between transfers and suggestions', () => {
  const raw =
    'Prose.\n<state><transfers><item id="i1" slot="inventory" to="c2" /></transfers></state>\n' +
    '<suggestions><item category="cat1">Draw the blade.</item></suggestions>'

  it('routes transfer items and suggestion items to their own parsers', () => {
    const state = parseStateBlock(raw)
    expect(state.block.transfers?.items).toEqual([
      { id: 'i1', slot: 'inventory', to: 'c2', seq: 0 },
    ])
    expect(parseSuggestionsBlock(raw).items).toEqual([
      { categoryRef: 'cat1', text: 'Draw the blade.' },
    ])
  })
})

describe('creation tags', () => {
  // piggyback.md → Creating a place or an item, verbatim.
  const CANON = `The fog lifted.
<state>
  <new_location handle="new:saltmere" parent="top" name="Saltmere">a fishing town under chalk cliffs</new_location>
  <new_location handle="new:docks" parent="new:saltmere" name="the Smuggler's Docks">a rotting pier below the eastern cliffs</new_location>
  <current_location>new:docks</current_location>
  <new_item handle="new:key" name="rusted key">an iron key, flaked with rust</new_item>
  <transfers>
    <item id="new:key" to="c1" slot="inventory" />
  </transfers>
</state>`

  it("parses canon's example into creates beside the refs that name them", () => {
    const result = parseStateBlock(CANON)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(0)
    expect(result.block).toEqual({
      currentLocation: 'new:docks',
      transfers: {
        items: [{ id: 'new:key', slot: 'inventory', to: 'c1', seq: 0 }],
        stackables: [],
        drops: [],
      },
      newLocations: [
        {
          handle: 'new:saltmere',
          name: 'Saltmere',
          description: 'a fishing town under chalk cliffs',
          parent: 'top',
        },
        {
          handle: 'new:docks',
          name: "the Smuggler's Docks",
          description: 'a rotting pier below the eastern cliffs',
          parent: 'new:saltmere',
        },
      ],
      newItems: [
        { handle: 'new:key', name: 'rusted key', description: 'an iron key, flaked with rust' },
      ],
    })
  })

  it('reads a self-closed create with an empty description', () => {
    const { block, failures } = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location handle="new:yard" name="the yard" />
  <new_item handle="new:coin" name="coin"/>
</state>`)
    expect(failures).toEqual([])
    expect(block.newLocations).toEqual([{ handle: 'new:yard', name: 'the yard', description: '' }])
    expect(block.newItems).toEqual([{ handle: 'new:coin', name: 'coin', description: '' }])
  })

  it('reads attributes in any order and trims the handle, name and description', () => {
    const { block } = parseStateBlock(`<state>
  <new_item name="  rusted key " handle=" new:key ">
    an iron key
  </new_item>
</state>`)
    expect(block.newItems).toEqual([
      { handle: 'new:key', name: 'rusted key', description: 'an iron key' },
    ])
  })

  it('keeps a parent only on a location', () => {
    const { block } = parseStateBlock(`<state>
  <new_location handle="new:a" name="A">x</new_location>
  <new_item handle="new:b" parent="l1" name="B">y</new_item>
</state>`)
    expect(block.newLocations).toEqual([{ handle: 'new:a', name: 'A', description: 'x' }])
    expect(block.newItems).toEqual([{ handle: 'new:b', name: 'B', description: 'y' }])
  })

  it('drops and counts a create with no new: handle or no name, failing no field', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location name="Saltmere">no handle</new_location>
  <new_location handle="saltmere" name="Saltmere">no prefix</new_location>
  <new_location handle="new:" name="Saltmere">nothing after the prefix</new_location>
  <new_item handle="new:key" name="   ">blank name</new_item>
  <new_item handle="new:coin">no name</new_item>
  <new_item handle="new:ring" name="ring">kept</new_item>
</state>`)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(5)
    expect(result.block.newLocations).toBeUndefined()
    expect(result.block.newItems).toEqual([
      { handle: 'new:ring', name: 'ring', description: 'kept' },
    ])
  })

  it('drops a handle declared earlier in the block, across both kinds', () => {
    const result = parseStateBlock(`<state>
  <new_location handle="new:a" name="First">kept</new_location>
  <new_location handle="new:a" name="Second">dropped</new_location>
  <new_item handle="new:a" name="Third">dropped</new_item>
</state>`)
    expect(result.malformedCreates).toBe(2)
    expect(result.block.newLocations).toEqual([
      { handle: 'new:a', name: 'First', description: 'kept' },
    ])
    expect(result.block.newItems).toBeUndefined()
  })

  // A stream cut off in a block that declares a create may have lost the tags after it
  // (the refs that name it), so the fallback fires; the fields before it are kept.
  it('fails the state block when the stream was cut off inside a create', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location handle="new:a" name="A">a pier below`)
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    expect(result.block).toEqual({ sceneEntities: ['c1'] })
    expect(result.malformedCreates).toBe(1)
  })

  it('fails the state block when the stream was cut off inside current_location after a create', () => {
    const result = parseStateBlock(
      '<state><new_location handle="new:a" name="A">a pier</new_location><current_location>new:',
    )
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    expect(result.malformedCreates).toBe(0)
  })

  it('fails the state block when the cut falls between tags after whole creates', () => {
    const result = parseStateBlock(
      '<state><new_location handle="new:a" name="A">a pier</new_location><current_location>new:a</current_location>',
    )
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    expect(result.block.currentLocation).toBe('new:a')
  })

  it('fails the state block when the cut lands right after a create opener', () => {
    const result = parseStateBlock('<state><scene_entities>c1</scene_entities><new_location')
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    expect(result.malformedCreates).toBe(1)
  })

  it('fails the state block when a cut-off block holds a whole create with bad attributes', () => {
    const result = parseStateBlock(
      `<state><new_item handle="new:k" name='key'>iron</new_item><scene_entities>c1`,
    )
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    expect(result.malformedCreates).toBe(1)
  })

  it('fails a cut-off block with creates even when prose before it quotes </state>', () => {
    const result = parseStateBlock(
      'The sign read </state> in chalk.\n<state><new_location handle="new:a" name="A">a pier</new_location><current_location>new:',
    )
    expect(result.failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
  })

  it('leaves a cut-off block that declares no creates as a clean parse', () => {
    const result = parseStateBlock('<state><scene_entities>c1</scene_entities><current_location>l')
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(0)
  })

  it('keeps a closed block with an unclosed create warn-only', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location handle="new:a" name="A">a pier below
</state>`)
    expect(result.failures).toEqual([])
    expect(result.block).toEqual({ sceneEntities: ['c1'] })
    expect(result.malformedCreates).toBe(1)
  })

  // Attribute text must be entirely key="value" pairs.
  it.each([
    ['an unescaped quote in a value', 'name="the "Rusty" Anchor"'],
    ['single quotes', `name="Anchor" parent='l1'`],
    ['spaces around =', 'name="Anchor" parent = "l1"'],
    ['a bare word', 'name="Anchor" hidden'],
    ['a stray slash', 'name="Anchor" /x'],
    ['pairs run together', 'name="Anchor"parent="l1"'],
  ])('drops and counts a create with %s in its attributes', (_label, attrs) => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_item handle="new:a" ${attrs}>x</new_item>
  <new_item handle="new:ok" name="ok">y</new_item>
</state>`)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(1)
    expect(result.block.newItems).toEqual([{ handle: 'new:ok', name: 'ok', description: 'y' }])
  })

  it('reads a hyphenated attribute key whole, so it cannot overwrite handle or name', () => {
    const { block, failures } = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location handle="new:a" name="A" alt-name="B" x-handle="new:z">x</new_location>
</state>`)
    expect(failures).toEqual([])
    expect(block.newLocations).toEqual([{ handle: 'new:a', name: 'A', description: 'x' }])
  })

  it('drops a self-closed create with malformed attributes, counting it once', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_location handle="new:a" name='A' />
</state>`)
    expect(result.malformedCreates).toBe(1)
    expect(result.block.newLocations).toBeUndefined()
  })

  it('counts a bare create with no attributes once', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_item>iron</new_item>
</state>`)
    expect(result.malformedCreates).toBe(1)
    expect(result.block.newItems).toBeUndefined()
  })

  it('counts a malformed-attribute create and a duplicate handle separately', () => {
    const result = parseStateBlock(`<state>
  <new_item handle="new:a" name="A">x</new_item>
  <new_item handle="new:a" name="B">dup</new_item>
  <new_item handle="new:c" name='C'>bad</new_item>
</state>`)
    expect(result.malformedCreates).toBe(2)
  })

  // The five XML entities, decoded in name and description only.
  it('decodes the five XML entities in a name and a description, in one pass', () => {
    const { block } = parseStateBlock(`<state>
  <new_location handle="new:a" name="the &quot;Rusty&quot; Anchor">a &lt;b&gt; sign</new_location>
  <new_location handle="new:b" name="Salt &amp; Pepper Inn">it&apos;s &amp;lt;</new_location>
</state>`)
    expect(block.newLocations).toEqual([
      { handle: 'new:a', name: 'the "Rusty" Anchor', description: 'a <b> sign' },
      { handle: 'new:b', name: 'Salt & Pepper Inn', description: "it's &lt;" },
    ])
  })

  it('decodes entities in an item the same way', () => {
    const { block } = parseStateBlock(
      '<state><new_item handle="new:k" name="Salt &amp; Pepper">a &lt;b&gt; &amp;lt;</new_item></state>',
    )
    expect(block.newItems).toEqual([
      { handle: 'new:k', name: 'Salt & Pepper', description: 'a <b> &lt;' },
    ])
  })

  it('does not decode entities in a handle or a parent', () => {
    const { block } = parseStateBlock(
      '<state><new_location handle="new:a&amp;b" parent="l&amp;1" name="A" /></state>',
    )
    expect(block.newLocations).toEqual([
      { handle: 'new:a&amp;b', name: 'A', description: '', parent: 'l&amp;1' },
    ])
  })

  // A model that echoes the prompt's bracket form still declares the handle.
  it('unwraps a bracketed handle', () => {
    const { block, failures } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><new_item handle="[new:key]" name="key">iron</new_item></state>',
    )
    expect(failures).toEqual([])
    expect(block.newItems).toEqual([{ handle: 'new:key', name: 'key', description: 'iron' }])
  })

  it('keeps a cut-off create from swallowing the create after it', () => {
    const result = parseStateBlock(`<state>
  <new_location handle="new:a" name="A">a pier below
  <new_location handle="new:b" name="B">kept</new_location>
</state>`)
    expect(result.block.newLocations).toEqual([{ handle: 'new:b', name: 'B', description: 'kept' }])
    expect(result.malformedCreates).toBe(1)
  })

  it('counts a create whose description holds a <, and drops it', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_item handle="new:k" name="key">an <b>iron</b> key</new_item>
</state>`)
    expect(result.failures).toEqual([])
    expect(result.block).toEqual({ sceneEntities: ['c1'] })
    expect(result.malformedCreates).toBe(1)
  })

  it('drops a create missing its > instead of reading the next tag as its attributes', () => {
    const result = parseStateBlock(`<state>
<scene_entities>c1</scene_entities>
<new_location handle="new:a" name="Saltmere"
<new_location name="the Docks" parent="l1">a pier</new_location>
<current_location>new:a</current_location>
</state>`)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(2)
    expect(result.block).toEqual({ sceneEntities: ['c1'], currentLocation: 'new:a' })
  })

  it('keeps a create with an unclosed name quote from swallowing the whole create after it', () => {
    const result = parseStateBlock(`<state>
<scene_entities>c1</scene_entities>
<new_location handle="new:a" name="Saltmere
<new_location handle="new:b" name="the Docks">a pier</new_location>
</state>`)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(1)
    expect(result.block.newLocations).toEqual([
      { handle: 'new:b', name: 'the Docks', description: 'a pier' },
    ])
  })

  it('does not count a longer tag that starts like a create as a cut-off create', () => {
    const result = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <new_items>
    <new_item handle="new:k" name="key">iron</new_item>
  </new_items>
  <new_locations></new_locations>
</state>`)
    expect(result.malformedCreates).toBe(0)
    expect(result.block.newItems).toEqual([{ handle: 'new:k', name: 'key', description: 'iron' }])
  })

  // Nothing in it can keep a create, and the turn would keep its old scene with no time or summary.
  it('records the empty-block failure for a block of creates alone, keeping them to report', () => {
    const result = parseStateBlock(
      '<state><new_item handle="new:key" name="key">iron</new_item></state>',
    )
    expect(result.failures).toEqual([{ field: 'state', detail: 'block held only creates' }])
    expect(result.malformedCreates).toBe(0)
    expect(result.block).toEqual({
      newItems: [{ handle: 'new:key', name: 'key', description: 'iron' }],
    })
  })

  // A block that carried nothing usable is no report: the fallback must still fire.
  it('records the empty-block failure when every create in the block was malformed', () => {
    const result = parseStateBlock('<state><new_item name="key">iron</new_item></state>')
    expect(result.block).toEqual({})
    expect(result.malformedCreates).toBe(1)
    expect(result.failures).toEqual([
      { field: 'state', detail: 'block held only malformed creates' },
    ])
  })

  it('reports no malformed creates when no block was found', () => {
    expect(parseStateBlock('Prose only.').malformedCreates).toBe(0)
  })

  // `<new_item` must not read as a transfer `<item`, nor a transfer item as a create.
  it('keeps a create inside <transfers> apart from the transfer items', () => {
    const { block, failures } = parseStateBlock(`<state>
  <transfers>
    <new_item handle="new:key" name="key">iron</new_item>
    <item id="new:key" to="c1" slot="inventory" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.newItems).toEqual([{ handle: 'new:key', name: 'key', description: 'iron' }])
    expect(block.transfers?.items).toEqual([{ id: 'new:key', slot: 'inventory', to: 'c1', seq: 0 }])
  })
})

// The fallback runs this on its structured reply, which the tag parser never saw.
describe('normalizeCreates', () => {
  it('trims what it keeps, drops a blank parent, and counts what it drops', () => {
    const { block, malformed } = normalizeCreates({
      sceneEntities: ['c1'],
      newLocations: [
        { handle: ' new:a ', name: ' A ', description: ' x ', parent: '  ' },
        { handle: 'new:b', name: 'B', description: '', parent: ' l1 ' },
        { handle: 'b', name: 'C', description: '' },
      ],
      newItems: [{ handle: 'new:b', name: 'duplicate', description: '' }],
    })
    expect(malformed).toBe(2)
    expect(block).toEqual({
      sceneEntities: ['c1'],
      newLocations: [
        { handle: 'new:a', name: 'A', description: 'x' },
        { handle: 'new:b', name: 'B', description: '', parent: 'l1' },
      ],
    })
  })

  it('reads a create with no description as an empty one', () => {
    const { block, malformed } = normalizeCreates({
      newLocations: [{ handle: 'new:a', name: 'A' }],
      newItems: [{ handle: 'new:k', name: 'key' }],
    })
    expect(malformed).toBe(0)
    expect(block).toEqual({
      newLocations: [{ handle: 'new:a', name: 'A', description: '' }],
      newItems: [{ handle: 'new:k', name: 'key', description: '' }],
    })
  })

  it('unwraps brackets on a handle before judging it', () => {
    const { block, malformed } = normalizeCreates({
      newLocations: [
        { handle: ' [new:a] ', name: 'A', description: '' },
        { handle: '[new:]', name: 'B', description: '' },
        { handle: '[new:a', name: 'C', description: '' },
        { handle: '[ new:b ]', name: 'D', description: '' },
      ],
    })
    expect(malformed).toBe(2)
    expect(block.newLocations).toEqual([
      { handle: 'new:a', name: 'A', description: '' },
      { handle: 'new:b', name: 'D', description: '' },
    ])
  })

  it('removes a list it emptied, and an empty list it was given', () => {
    expect(
      normalizeCreates({ newItems: [{ handle: 'key', name: 'key', description: '' }] }),
    ).toEqual({ block: {}, malformed: 1 })
    expect(normalizeCreates({ newLocations: [], newItems: [] })).toEqual({
      block: {},
      malformed: 0,
    })
  })

  it('leaves a block without creates as it is', () => {
    expect(normalizeCreates({ currentLocation: 'l1' })).toEqual({
      block: { currentLocation: 'l1' },
      malformed: 0,
    })
  })
})

// piggyback.md → Trailing block format.
describe('conditions and drops', () => {
  // The reference block, verbatim.
  const CANON_BLOCK = `<state>
  <scene_entities>c1, c2</scene_entities>
  <new_location handle="new:docks" parent="l1" name="the Smuggler's Docks">a rotting pier below the eastern cliffs</new_location>
  <current_location>new:docks</current_location>
  <world_time_delta>120</world_time_delta>
  <visual_changes>
    <entity id="c2" type="attire">a grey travel cloak muddied to the waist over a linen shirt; riding boots</entity>
  </visual_changes>
  <conditions>
    <entity id="i4">snapped in two at the hilt</entity>
  </conditions>
  <transfers>
    <item id="i1" to="c1" from="c3" slot="inventory" />
    <drop id="i4" from="c1" />
    <stackable key="gold" amount="50" to="c1" from="c3" />
  </transfers>
  <summary>Aria pushed into the marshes; met an exiled noble who recognized House Eldrin's sigil.</summary>
  <retrieval_queries>
    <query>House Eldrin's history and its sigil</query>
    <query>exiled nobility of the marsh territories</query>
  </retrieval_queries>
</state>`

  it("parses canon's reference block, its condition and its drop included", () => {
    const result = parseStateBlock(CANON_BLOCK)
    expect(result.failures).toEqual([])
    expect(result.malformedCreates).toBe(0)
    expect(result.block).toEqual({
      sceneEntities: ['c1', 'c2'],
      currentLocation: 'new:docks',
      worldTimeDelta: 120,
      visualChanges: [
        {
          id: 'c2',
          type: 'attire',
          text: 'a grey travel cloak muddied to the waist over a linen shirt; riding boots',
        },
      ],
      conditions: [{ id: 'i4', text: 'snapped in two at the hilt' }],
      transfers: {
        items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c3', seq: 0 }],
        stackables: [{ key: 'gold', amount: 50, to: 'c1', from: 'c3' }],
        drops: [{ id: 'i4', from: 'c1', seq: 1 }],
      },
      summary:
        "Aria pushed into the marshes; met an exiled noble who recognized House Eldrin's sigil.",
      retrievalQueries: [
        "House Eldrin's history and its sigil",
        'exiled nobility of the marsh territories',
      ],
      newLocations: [
        {
          handle: 'new:docks',
          name: "the Smuggler's Docks",
          description: 'a rotting pier below the eastern cliffs',
          parent: 'l1',
        },
      ],
    })
  })

  // data-model.md → Entry metadata shape: a blank condition is kept for apply.ts to reject.
  it('reads each condition trimmed, keeping a blank one and skipping one with no id', () => {
    const { block, failures } = parseStateBlock(`<state>
  <conditions>
    <entity id="l1">  burned to the ground  </entity>
    <entity name="ash">a ring of ash</entity>
    <entity id="i2">   </entity>
    <entity id="i4">snapped in two at the hilt</entity>
  </conditions>
</state>`)
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([
      { id: 'l1', text: 'burned to the ground' },
      { id: 'i2', text: '' },
      { id: 'i4', text: 'snapped in two at the hilt' },
    ])
  })

  it('reads a lone blank condition as an entry, failing no field', () => {
    const { block, failures } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><conditions><entity id="i4"></entity></conditions></state>',
    )
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([{ id: 'i4', text: '' }])
  })

  it.each([
    ['a self-closed', '<entity id="i4" />'],
    ['an unclosed', '<entity id="i4">snapped'],
  ])('skips %s condition entry without swallowing the next one', (_label, broken) => {
    const { block, failures } = parseStateBlock(`<state>
  <conditions>
    ${broken}
    <entity id="l1">burned to the ground</entity>
  </conditions>
</state>`)
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([{ id: 'l1', text: 'burned to the ground' }])
  })

  it('skips a condition entry whose id is empty', () => {
    const { block, failures } = parseStateBlock(`<state>
  <conditions>
    <entity id="">a ring of ash</entity>
    <entity id="l1">burned to the ground</entity>
  </conditions>
</state>`)
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([{ id: 'l1', text: 'burned to the ground' }])
  })

  it('fails conditions when its content holds no well-formed entry, leaving the other fields', () => {
    const { block, failures } = parseStateBlock(`<state>
  <scene_entities>c1</scene_entities>
  <conditions>burned to the ground</conditions>
</state>`)
    expect(block.conditions).toBeUndefined()
    expect(block.sceneEntities).toEqual(['c1'])
    expect(failures).toEqual([{ field: 'conditions', detail: expect.any(String) }])
  })

  it('reads an empty <conditions></conditions> as nothing to report', () => {
    const { block, failures } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><conditions></conditions></state>',
    )
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([])
  })

  it('numbers item moves and drops by their place among the transfer tags', () => {
    const { block, failures } = parseStateBlock(`<state>
  <transfers>
    <item id="i1" to="c1" slot="inventory" />
    <stackable key="gold" amount="5" to="c1" />
    <drop id="i1" from="c1" />
    <item id="i2" from="c2" to="c1" slot="equipped_items" />
    <drop id="i3" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [
        { id: 'i1', slot: 'inventory', to: 'c1', seq: 0 },
        { id: 'i2', slot: 'equipped_items', from: 'c2', to: 'c1', seq: 2 },
      ],
      stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
      drops: [
        { id: 'i1', from: 'c1', seq: 1 },
        { id: 'i3', seq: 3 },
      ],
    })
  })

  it('reads a transfers field holding only drops, skipping a drop with no id', () => {
    const { block, failures } = parseStateBlock(`<state>
  <transfers>
    <drop from="c1" />
    <drop id="i4" from="c1" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [],
      stackables: [],
      drops: [{ id: 'i4', from: 'c1', seq: 0 }],
    })
  })

  it('loses a move tag missing its > rather than reading the next tag into it', () => {
    const { block, failures } = parseStateBlock(`<state>
  <transfers>
    <item id="i1" to="c1" slot="inventory"
    <drop id="i4" from="c2" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [],
      stackables: [],
      drops: [{ id: 'i4', from: 'c2', seq: 0 }],
    })
  })

  it('skips a move or a drop whose id is empty, leaving it no place in the order', () => {
    const { block, failures } = parseStateBlock(`<state>
  <transfers>
    <item id="" to="c1" slot="inventory" />
    <drop id="" from="c1" />
    <item id="i1" to="c1" slot="inventory" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [{ id: 'i1', slot: 'inventory', to: 'c1', seq: 0 }],
      stackables: [],
      drops: [],
    })
  })

  // piggyback.md → Parse strategy and failure recovery: a cut may have taken the place the scene
  // moved to, so a cut-off block naming none holds its drops rather than land them where it left.
  describe('a block the stream cut off', () => {
    const transfers = '<transfers><drop id="i2" from="c1" /></transfers>'

    it('holds its drops when it names no current location, and fails for the fallback', () => {
      const { block, dropsCutOff, failures } = parseStateBlock(
        `<state><scene_entities>c1</scene_entities>${transfers}<world_time_delta>30`,
      )
      expect(block.transfers?.drops).toEqual([])
      expect(dropsCutOff).toEqual([{ id: 'i2', from: 'c1', seq: 0 }])
      expect(failures).toEqual([{ field: 'state', detail: 'block with drops cut off' }])
    })

    it('fails once when the cut block also declares a create', () => {
      const { failures } = parseStateBlock(
        `<state><scene_entities>c1</scene_entities>${transfers}<new_item handle="new:map" name="map">a folded map</new_item><world_time_delta>30`,
      )
      expect(failures).toEqual([{ field: 'state', detail: 'block with creates cut off' }])
    })

    it('keeps its drops when its current location came before the cut', () => {
      const { block, dropsCutOff, failures } = parseStateBlock(
        `<state><current_location>l1</current_location>${transfers}<world_time_delta>30`,
      )
      expect(block.transfers?.drops).toEqual([{ id: 'i2', from: 'c1', seq: 0 }])
      expect(dropsCutOff).toEqual([])
      expect(failures).toEqual([])
    })

    it('keeps the drops of a closed block that names no current location', () => {
      const { block, dropsCutOff, failures } = parseStateBlock(
        `<state><scene_entities>c1</scene_entities>${transfers}</state>`,
      )
      expect(block.transfers?.drops).toEqual([{ id: 'i2', from: 'c1', seq: 0 }])
      expect(dropsCutOff).toEqual([])
      expect(failures).toEqual([])
    })
  })

  // piggyback.md → Trailing block format: a drop away from the scene stays prose.
  it('drops a drop that names a place, reporting it, and leaves it no place in the order', () => {
    const { block, failures, dropsElsewhere } = parseStateBlock(`<state>
  <transfers>
    <drop id="i4" from="c1" to="l5" />
    <drop id="i2" from="c1" to="" />
    <item id="i1" to="c1" slot="inventory" />
  </transfers>
</state>`)
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({
      items: [{ id: 'i1', slot: 'inventory', to: 'c1', seq: 1 }],
      stackables: [],
      drops: [{ id: 'i2', from: 'c1', seq: 0 }],
    })
    expect(dropsElsewhere).toEqual([{ id: 'i4', to: 'l5' }])
  })

  it('reads transfers holding only a drop that names a place as nothing moved, failing no field', () => {
    const { block, failures, dropsElsewhere } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><transfers><drop id="i4" to="l99" /></transfers></state>',
    )
    expect(failures).toEqual([])
    expect(block.transfers).toEqual({ items: [], stackables: [], drops: [] })
    expect(dropsElsewhere).toEqual([{ id: 'i4', to: 'l99' }])
  })

  it('reports no drop elsewhere for a block without one, or with no block', () => {
    expect(parseStateBlock(CANON_BLOCK).dropsElsewhere).toEqual([])
    expect(parseStateBlock('Just prose.').dropsElsewhere).toEqual([])
  })

  it('fails transfers when its only tag is a drop with no id', () => {
    const { block, failures } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><transfers><drop from="c1" /></transfers></state>',
    )
    expect(block.transfers).toBeUndefined()
    expect(block.sceneEntities).toEqual(['c1'])
    expect(failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
  })

  it("reads a create's condition, decoding its entities as a name's are", () => {
    const { block, failures } = parseStateBlock(`<state>
  <new_location handle="new:yard" name="the yard" condition="flooded &amp; reeking of &quot;brine&quot;">a walled yard</new_location>
  <current_location>new:yard</current_location>
  <new_item handle="new:key" name="key" condition="bent &lt;badly&gt;">iron</new_item>
</state>`)
    expect(failures).toEqual([])
    expect(block.newLocations).toEqual([
      {
        handle: 'new:yard',
        name: 'the yard',
        description: 'a walled yard',
        condition: 'flooded & reeking of "brine"',
      },
    ])
    expect(block.newItems).toEqual([
      { handle: 'new:key', name: 'key', description: 'iron', condition: 'bent <badly>' },
    ])
  })

  it("keeps a create's condition trimmed and drops a blank one", () => {
    const { block, malformed } = normalizeCreates({
      newLocations: [
        { handle: 'new:a', name: 'A', condition: '  scorched  ' },
        { handle: 'new:b', name: 'B', condition: '   ' },
      ],
      newItems: [{ handle: 'new:k', name: 'key', condition: ' rusted ' }],
    })
    expect(malformed).toBe(0)
    expect(block.newLocations).toEqual([
      { handle: 'new:a', name: 'A', description: '', condition: 'scorched' },
      { handle: 'new:b', name: 'B', description: '' },
    ])
    expect(block.newItems).toEqual([
      { handle: 'new:k', name: 'key', description: '', condition: 'rusted' },
    ])
  })
})

// No `<` in attributes and no tag in text, as in conditions and moves: a malformed entry drops
// alone, and an unclosed opener can't run the scan to the segment end.
describe('an entry that never closes swallows nothing', () => {
  it('keeps the next visual change whole after a self-closed one', () => {
    const { block } = parseStateBlock(
      '<state><visual_changes><entity id="c1" type="attire"/><entity id="c2" type="hair">wet hair</entity></visual_changes></state>',
    )
    expect(block.visualChanges).toEqual([{ id: 'c2', type: 'hair', text: 'wet hair' }])
  })

  it('keeps the next stackable whole after one missing its `>`', () => {
    const { block } = parseStateBlock(
      '<state><transfers><stackable key="gold" amount="5" from="c1"<stackable key="silver" amount="3" to="c2" /></transfers></state>',
    )
    expect(block.transfers?.stackables).toEqual([{ key: 'silver', amount: 3, to: 'c2' }])
  })

  it('keeps the next retrieval query whole after an unclosed one', () => {
    const { block } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><retrieval_queries><query>the old bell<query>who rang it</query></retrieval_queries></state>',
    )
    expect(block.retrievalQueries).toEqual(['who rang it'])
  })

  it('keeps the next suggestion whole after an unclosed one', () => {
    const { items } = parseSuggestionsBlock(
      '<suggestions><item category="cat1">Ask the bell-ringer<item category="cat2">Climb the tower</item></suggestions>',
    )
    expect(items).toEqual([{ categoryRef: 'cat2', text: 'Climb the tower' }])
  })

  it('scans 20,000 unclosed visual openers without running to the segment end each time', () => {
    const openers = '<entity id="c1" type="hair">'.repeat(20_000)
    const started = performance.now()
    parseStateBlock(
      `<state><scene_entities>c1</scene_entities><visual_changes>${openers}</visual_changes></state>`,
    )
    // The bound sits far above a linear scan's few ms and below a quadratic one's ~800 ms.
    expect(performance.now() - started).toBeLessThan(250)
  })

  // The bound sits far above a linear scan's few ms and below a quadratic one's ~1 s.
  it.each([
    ['a visual change', (pad: string) => `<visual_changes><entity${pad}</visual_changes>`],
    ['a condition', (pad: string) => `<conditions><entity${pad}</conditions>`],
    ['an item move', (pad: string) => `<transfers><item${pad}</transfers>`],
    ['a stackable', (pad: string) => `<transfers><stackable${pad}</transfers>`],
  ])('scans %s opener trailing 60,000 spaces in linear time', (_label, field) => {
    const started = performance.now()
    parseStateBlock(
      `<state><scene_entities>c1</scene_entities>${field(' '.repeat(60_000))}</state>`,
    )
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('scans a suggestion opener trailing 60,000 spaces in linear time', () => {
    const started = performance.now()
    parseSuggestionsBlock(`<suggestions><item${' '.repeat(60_000)}</suggestions>`)
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe("an entry's text holding a `<` that opens no tag", () => {
  const visual = (...entries: string[]) =>
    parseStateBlock(
      `<state><scene_entities>c1</scene_entities><visual_changes>${entries.join('')}</visual_changes></state>`,
    )
  const scar = '<entity id="c1" type="distinguishing">a scar shaped like <3</entity>'
  const hair = '<entity id="c2" type="hair">wet hair</entity>'

  it('keeps a visual change holding one beside a sibling', () => {
    expect(visual(scar, hair).block.visualChanges).toEqual([
      { id: 'c1', type: 'distinguishing', text: 'a scar shaped like <3' },
      { id: 'c2', type: 'hair', text: 'wet hair' },
    ])
  })

  it('reads a visual change holding one alone, failing no field', () => {
    const { block, failures } = visual(scar)
    expect(failures).toEqual([])
    expect(block.visualChanges).toEqual([
      { id: 'c1', type: 'distinguishing', text: 'a scar shaped like <3' },
    ])
  })

  it.each(['<b>', '</b>', '<!-- x -->', '<?x?>'])(
    'drops a visual change holding %s alone, as a tag',
    (tag) => {
      const tagged = `<entity id="c1" type="distinguishing">a scar ${tag} here</entity>`
      expect(visual(tagged, hair).block.visualChanges).toEqual([
        { id: 'c2', type: 'hair', text: 'wet hair' },
      ])
    },
  )

  it('still stops an unclosed visual change at the next tag after one', () => {
    const unclosed = '<entity id="c1" type="distinguishing">a scar shaped like <3 and'
    expect(visual(unclosed, hair).block.visualChanges).toEqual([
      { id: 'c2', type: 'hair', text: 'wet hair' },
    ])
  })

  it('reads a condition, a query and a suggestion holding one', () => {
    const { block, failures } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><conditions><entity id="i1">cracked, 2 < 3 pieces</entity></conditions><retrieval_queries><query>the <3 carving</query></retrieval_queries></state>',
    )
    expect(failures).toEqual([])
    expect(block.conditions).toEqual([{ id: 'i1', text: 'cracked, 2 < 3 pieces' }])
    expect(block.retrievalQueries).toEqual(['the <3 carving'])
    expect(
      parseSuggestionsBlock('<suggestions><item category="cat1">Carve a <3</item></suggestions>')
        .items,
    ).toEqual([{ categoryRef: 'cat1', text: 'Carve a <3' }])
  })
})

describe('a create name with a numeric character reference', () => {
  it('decodes decimal and hex references as it does the named five', () => {
    const { block } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><new_location handle="new:inn" name="O&#39;Malley&#x27;s &amp; Sons">an inn</new_location><current_location>new:inn</current_location></state>',
    )
    expect(block.newLocations?.[0]?.name).toBe("O'Malley's & Sons")
  })

  const nameOf = (name: string) =>
    parseStateBlock(
      `<state><scene_entities>c1</scene_entities><new_location handle="new:inn" name="${name}">an inn</new_location><current_location>new:inn</current_location></state>`,
    ).block.newLocations?.[0]?.name

  it.each([
    ['NUL', '&#0;'],
    ['NUL in hex', '&#x0;'],
    ['a lone high surrogate', '&#xD800;'],
    ['a lone low surrogate', '&#57343;'],
    ['a code past U+10FFFF', '&#1114112;'],
  ])('leaves a reference to %s as written', (_label, ref) => {
    expect(nameOf(`Gem${ref}`)).toBe(`Gem${ref}`)
  })

  it('decodes the codes either side of the surrogates, and the last code', () => {
    expect(nameOf('&#xD7FF;&#xE000;&#x10FFFF;')).toBe('퟿\u{10FFFF}')
  })

  it('leaves an unknown named entity as written', () => {
    const { block } = parseStateBlock(
      '<state><scene_entities>c1</scene_entities><new_location handle="new:inn" name="the &QUOT;Bell&QUOT;">an inn</new_location><current_location>new:inn</current_location></state>',
    )
    expect(block.newLocations?.[0]?.name).toBe('the &QUOT;Bell&QUOT;')
  })
})
