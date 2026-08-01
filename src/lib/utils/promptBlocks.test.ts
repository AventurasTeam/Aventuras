import { describe, it, expect } from 'vitest'
import { joinPromptBlocks } from './promptBlocks'

/** The shapes the real blocks actually have, so the regressions are the measured ones. */
const WORLD_STATE = '\n\n[ACTIVE THREADS]\n• Ren’s Liberation: she is now his devoted pet.'
const LOREBOOK = '\n\n[LOREBOOK CONTEXT]\n(CANONICAL - ...)'
const AGENTIC =
  '[Retrieved Context - I searched for all mentions of runes]\n\n## Past Story Context'

describe('joinPromptBlocks', () => {
  it('inserts the blank line a block does not bring itself', () => {
    // The measured bug: in agentic mode the narrator read
    // "...devoted pet.[Retrieved Context - ..." with no break at all.
    const joined = joinPromptBlocks(WORLD_STATE, AGENTIC)

    expect(joined).toContain('devoted pet.\n\n[Retrieved Context')
    expect(joined).not.toContain('pet.[Retrieved')
  })

  it('leaves an already-correct boundary byte-identical', () => {
    // The static path. Every byte here is part of the narrator prompt's reusable prefix,
    // so a gratuitous change at the seam is a change in every turn's request.
    expect(joinPromptBlocks(WORLD_STATE, LOREBOOK)).toBe(WORLD_STATE + LOREBOOK)
  })

  it('collapses a boundary that has too many newlines', () => {
    // The other measured shape: chapterContext ending in "\n" meeting the lorebook
    // block's own "\n\n" gave three.
    const joined = joinPromptBlocks('...existing runes.\n', LOREBOOK)

    expect(joined).toBe('...existing runes.\n\n[LOREBOOK CONTEXT]\n(CANONICAL - ...)')
    expect(joined).not.toContain('\n\n\n')
  })

  it('joins three blocks, normalising each boundary independently', () => {
    const joined = joinPromptBlocks('a', '\n\n\n\nb', 'c')
    expect(joined).toBe('a\n\nb\n\nc')
  })

  it('drops empty, null and undefined blocks without leaving a gap', () => {
    expect(joinPromptBlocks('a', '', null, undefined, 'b')).toBe('a\n\nb')
  })

  it('returns a single block untouched, whatever its own edges look like', () => {
    expect(joinPromptBlocks(WORLD_STATE)).toBe(WORLD_STATE)
    expect(joinPromptBlocks(null, AGENTIC, undefined)).toBe(AGENTIC)
  })

  it("returns '' when there is nothing to join", () => {
    // The narrative template guards on `!= ''`, and NarrativeService on truthiness.
    expect(joinPromptBlocks()).toBe('')
    expect(joinPromptBlocks(null, undefined, '')).toBe('')
  })

  it('does not trim whitespace that is not at a boundary', () => {
    expect(joinPromptBlocks('a  ', '  b')).toBe('a  \n\n  b')
  })

  it('takes surplus newlines off the newer block before the accumulated text', () => {
    // A block that deliberately ends in blank lines keeps them where it can.
    expect(joinPromptBlocks('a\n\n', '\n\nb')).toBe('a\n\nb')
  })

  it('absorbs a block that is nothing but newlines into the separator', () => {
    // Whitespace-only is not a block, and emitting it as one would leave a gap where the
    // narrator expects a heading. It contributes its newlines to the boundary and nothing
    // else, so the result is the same as if it had not been passed.
    expect(joinPromptBlocks('a', '\n\n', 'b')).toBe('a\n\nb')
    expect(joinPromptBlocks('a', '\n\n\n\n\n', 'b')).toBe('a\n\nb')
  })

  it('is associative over the pairs it is given, for the real three-block case', () => {
    const all = joinPromptBlocks(WORLD_STATE, AGENTIC, LOREBOOK)

    expect(all).toContain('devoted pet.\n\n[Retrieved Context')
    expect(all).toContain('Past Story Context\n\n[LOREBOOK CONTEXT]')
    expect(all).not.toContain('\n\n\n')
  })
})
