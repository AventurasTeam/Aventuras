import { describe, expect, it } from 'vitest'

import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'

import { hasStateContent, renderNarrative, renderStateBlock } from './tagged-block'

describe('renderStateBlock', () => {
  it('round-trips every field through the app parser', () => {
    const raw = renderStateBlock({
      sceneEntities: ['c1', 'c2'],
      currentLocation: 'l1',
      worldTimeDelta: 300,
      visualChanges: [{ id: 'c1', type: 'attire', text: 'a rain-dark cloak' }],
      transfers: {
        items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c2' }],
        stackables: [{ key: 'gold', amount: 5, from: 'c1' }],
      },
      summary: 'Kael takes the cloak and pays for passage.',
    })

    const { block, failures, blockFound } = parseStateBlock(raw)

    expect(blockFound).toBe(true)
    expect(failures).toEqual([])
    expect(block.sceneEntities).toEqual(['c1', 'c2'])
    expect(block.currentLocation).toBe('l1')
    expect(block.worldTimeDelta).toBe(300)
    expect(block.visualChanges).toEqual([{ id: 'c1', type: 'attire', text: 'a rain-dark cloak' }])
    expect(block.transfers).toEqual({
      items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c2' }],
      stackables: [{ key: 'gold', amount: 5, from: 'c1' }],
    })
    expect(block.summary).toBe('Kael takes the cloak and pays for passage.')
  })

  it('omits empty collections rather than emitting a tag the parser reads as truncated', () => {
    const raw = renderStateBlock({
      worldTimeDelta: 0,
      sceneEntities: [],
      visualChanges: [],
      transfers: { items: [], stackables: [] },
    })

    expect(raw).not.toContain('<visual_changes>')
    expect(raw).not.toContain('<transfers>')
    expect(raw).not.toContain('<scene_entities>')

    const { block, failures } = parseStateBlock(raw)
    expect(failures).toEqual([])
    expect(block.worldTimeDelta).toBe(0)
    expect(block.visualChanges).toBeUndefined()
  })

  it('drops quotes and angle brackets from an attribute value so the tag still parses', () => {
    const raw = renderStateBlock({
      visualChanges: [{ id: 'c1"><script>', type: 'hair', text: 'shorn short' }],
    })

    const { block, failures } = parseStateBlock(raw)
    expect(failures).toEqual([])
    expect(block.visualChanges).toEqual([{ id: 'c1script', type: 'hair', text: 'shorn short' }])
  })

  it('keeps a close tag typed into free text from truncating the entry', () => {
    const raw = renderStateBlock({
      summary: 'She wrote </summary> across the page, then kept going.',
    })

    expect(parseStateBlock(raw).block.summary).toBe('She wrote  across the page, then kept going.')
  })

  it('reports content with no extractable entries only when the mock did not build it', () => {
    // Guards the reason empty tags are omitted: the app treats a populated but
    // unextractable segment as a failure, not as "nothing to report".
    const { failures } = parseStateBlock('<state>\n  <transfers>garbage</transfers>\n</state>')
    expect(failures).toEqual([
      {
        field: 'transfers',
        detail: 'transfers: content present but no well-formed entries extracted',
      },
    ])
  })
})

describe('hasStateContent', () => {
  it('is false for an all-empty block and true once any field carries content', () => {
    expect(hasStateContent(undefined)).toBe(false)
    expect(hasStateContent({ sceneEntities: [], transfers: { items: [], stackables: [] } })).toBe(
      false,
    )
    expect(hasStateContent({ worldTimeDelta: 0 })).toBe(true)
    expect(hasStateContent({ summary: 'something happened' })).toBe(true)
  })
})

describe('renderNarrative', () => {
  it('separates prose from both trailing blocks the way the reader does', () => {
    const raw = renderNarrative({
      prose: 'The blade rasps free of its sheath.',
      state: { worldTimeDelta: 120, summary: 'Kael draws.' },
      suggestions: [
        { categoryRef: 'cat1', text: 'You press on toward the bell.' },
        { categoryRef: 'cat2', text: 'You sheathe the blade and listen.' },
      ],
    })

    expect(stripTrailingBlocks(raw).prose).toBe('The blade rasps free of its sheath.')

    const state = parseStateBlock(raw)
    expect(state.failures).toEqual([])
    expect(state.block.worldTimeDelta).toBe(120)
    expect(state.block.summary).toBe('Kael draws.')

    const suggestions = parseSuggestionsBlock(raw)
    expect(suggestions.failed).toBe(false)
    expect(suggestions.malformedCount).toBe(0)
    expect(suggestions.items).toEqual([
      { categoryRef: 'cat1', text: 'You press on toward the bell.' },
      { categoryRef: 'cat2', text: 'You sheathe the blade and listen.' },
    ])
  })

  it('omits both blocks when there is nothing to report', () => {
    const raw = renderNarrative({ prose: 'Rain.', state: { sceneEntities: [] }, suggestions: [] })

    expect(raw).toBe('Rain.')
    expect(parseStateBlock(raw).blockFound).toBe(false)
    expect(parseSuggestionsBlock(raw).blockFound).toBe(false)
  })

  it('escapes a root tag typed into the prose so it cannot truncate the reply', () => {
    const raw = renderNarrative({
      prose: 'He scrawled <state> on the wall.',
      state: { worldTimeDelta: 60 },
    })

    expect(stripTrailingBlocks(raw).prose).toBe('He scrawled &lt;state&gt; on the wall.')
    expect(parseStateBlock(raw).block.worldTimeDelta).toBe(60)
  })
})
