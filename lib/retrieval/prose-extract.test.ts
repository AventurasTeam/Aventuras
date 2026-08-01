import { describe, expect, it } from 'vitest'

import { extractProse, splitSentences } from './prose-extract'

const index = {
  entityNames: new Set(['kara vex']),
  loreKeywords: new Set(['veilstone']),
}

describe('splitSentences', () => {
  it('splits on terminal punctuation and keeps it', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('keeps a quoted span together with its terminator', () => {
    expect(splitSentences('"Run," she said. Then silence.')).toEqual([
      '"Run," she said.',
      'Then silence.',
    ])
  })

  it('returns nothing for blank prose', () => {
    expect(splitSentences('   ')).toEqual([])
  })

  it('treats a unicode ellipsis as a terminator, same as the ASCII form', () => {
    expect(splitSentences('She paused... then spoke. He waited.')).toEqual([
      'She paused...',
      'then spoke.',
      'He waited.',
    ])
    expect(splitSentences('She paused… then spoke. He waited.')).toEqual([
      'She paused…',
      'then spoke.',
      'He waited.',
    ])
  })
})

describe('extractProse', () => {
  it('picks entity-name, keyword and verb sentences over filler', () => {
    const prose = [
      'The afternoon was mild and the awning had not yet been lowered.',
      'Kara Vex drew the blade.',
      'Dust settled slowly over the flagstones in the usual way.',
      'The veilstone hummed against her palm.',
      'It was, all things considered, an unremarkable sort of hour.',
    ].join(' ')
    const out = extractProse(prose, index, 2)
    expect(out.text).toContain('Kara Vex')
    expect(out.text).toContain('veilstone')
    expect(out.text).not.toContain('awning')
  })

  it('scores a dialogue span above equivalent narration', () => {
    const withDialogue = extractProse('"We run now," he said.', index, 1)
    const withoutDialogue = extractProse('They moved on quietly.', index, 1)
    expect(withDialogue.scores[0]).toBeGreaterThan(withoutDialogue.scores[0])
  })

  it('emits one score per sentence, in source order, for the probe capture', () => {
    const out = extractProse('Kara Vex drew the blade. Nothing happened at all.', index, 1)
    expect(out.scores).toHaveLength(2)
    expect(out.scores[0]).toBeGreaterThan(out.scores[1])
  })

  it('returns empty text for empty prose rather than throwing', () => {
    const out = extractProse('', index, 4)
    expect(out.text).toBe('')
    expect(out.scores).toEqual([])
  })

  it('keeps selected sentences in source order, not score order', () => {
    const out = extractProse('Filler here. Kara Vex drew the blade.', index, 2)
    expect(out.text.indexOf('Filler')).toBeLessThan(out.text.indexOf('Kara Vex'))
  })

  it('does not score a plain contraction apostrophe as dialogue', () => {
    const contraction = extractProse("She didn't move.", index, 1)
    const noApostrophe = extractProse('She did not move.', index, 1)
    expect(contraction.scores[0]).toBe(noApostrophe.scores[0])
  })

  it('weighs an entity-name hit in isolation, apart from verb/dialogue/keyword', () => {
    const withEntity = extractProse(
      'Kara Vex sat quietly in the corner of the room without moving at all today.',
      index,
      1,
    )
    const withoutEntity = extractProse(
      'A person sat quietly in the corner of the room without moving at all today.',
      index,
      1,
    )
    expect(withEntity.scores[0]).toBeGreaterThan(withoutEntity.scores[0])
  })

  it('weighs an action-verb hit in isolation, apart from entity/dialogue/keyword', () => {
    const withVerb = extractProse(
      'The stranger drew a knife slowly in the quiet dark alleyway tonight.',
      index,
      1,
    )
    const withoutVerb = extractProse(
      'The stranger stood slowly in the quiet dark alleyway tonight.',
      index,
      1,
    )
    expect(withVerb.scores[0]).toBeGreaterThan(withoutVerb.scores[0])
  })

  it('weighs a dialogue span in isolation, apart from entity/verb/keyword', () => {
    const withDialogue = extractProse(
      '"Wait here for me," the stranger whispered oddly today.',
      index,
      1,
    )
    const withoutDialogue = extractProse(
      'Wait here for me the stranger whispered oddly today.',
      index,
      1,
    )
    expect(withDialogue.scores[0]).toBeGreaterThan(withoutDialogue.scores[0])
  })

  it('weighs a short sentence over a long one when no other signal fires', () => {
    const short = extractProse('The room was quiet and still.', index, 1)
    const long = extractProse(
      'The very long and unremarkable afternoon stretched onward without any particular event occurring at all today.',
      index,
      1,
    )
    expect(short.scores[0]).toBeGreaterThan(long.scores[0])
  })

  it('still returns the best sentence when topK is 0', () => {
    const out = extractProse('Filler here. Kara Vex drew the blade.', index, 0)
    expect(out.text).toContain('Kara Vex')
  })
})
