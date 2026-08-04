import { describe, it, expect } from 'vitest'
import { formatAlreadyInContext } from './alreadyInContext'

describe('formatAlreadyInContext', () => {
  it('is empty when nothing is in context, so the caller can omit the section', () => {
    expect(formatAlreadyInContext([], [])).toBe('')
  })

  it('labels the two pools separately', () => {
    const block = formatAlreadyInContext(
      [
        { type: 'character', name: 'Aria' },
        { type: 'location', name: 'Oakvale' },
      ],
      [{ type: 'faction', name: 'The Orcs' }],
    )

    expect(block).toContain('- Live world state: [character] Aria, [location] Oakvale')
    expect(block).toContain('- Lorebook entries: [faction] The Orcs')
  })

  it('omits a group that is empty rather than printing a bare heading', () => {
    const block = formatAlreadyInContext([{ type: 'character', name: 'Aria' }], [])

    expect(block).toContain('Live world state')
    expect(block).not.toContain('Lorebook entries')
  })

  it('carries no descriptions', () => {
    // Paid on every turn that runs retrieval, on top of the largest prompt baseline in the
    // app. Type and name only.
    const block = formatAlreadyInContext(
      [{ type: 'character', name: 'Aria' }],
      [{ type: 'faction', name: 'The Orcs' }],
    )

    expect(block.split('\n')).toHaveLength(4)
  })

  it('says it describes the prompt, not what is relevant', () => {
    // Read as relevance it anchors: an agent told what matters stops looking, and this list
    // is capped and priority-pruned.
    const block = formatAlreadyInContext([{ type: 'character', name: 'Aria' }], [])

    expect(block).toContain('not a judgement of what matters')
  })

  it('lists an entity once when it is both live state and a lorebook entry', () => {
    // One thing to the narrator. Listing it twice suggests two separate pieces of context.
    const block = formatAlreadyInContext(
      [{ type: 'character', name: 'Aria' }],
      [{ type: 'character', name: 'aria' }],
    )

    expect(block).toContain('- Live world state: [character] Aria')
    expect(block).not.toContain('Lorebook entries')
  })

  it('dedupes within a group too', () => {
    const block = formatAlreadyInContext(
      [
        { type: 'character', name: 'Aria' },
        { type: 'character', name: ' Aria ' },
      ],
      [],
    )

    expect(block).toContain('- Live world state: [character] Aria\n')
  })

  it('keeps same-named entities of different types apart', () => {
    const block = formatAlreadyInContext(
      [
        { type: 'character', name: 'Oakvale' },
        { type: 'location', name: 'Oakvale' },
      ],
      [],
    )

    expect(block).toContain('[character] Oakvale, [location] Oakvale')
  })

  it('skips blank names instead of emitting an empty bracket', () => {
    const block = formatAlreadyInContext(
      [
        { type: 'character', name: '   ' },
        { type: 'character', name: 'Aria' },
      ],
      [],
    )

    expect(block).toContain('- Live world state: [character] Aria')
    expect(block).not.toContain('[character]  ')
  })
})
