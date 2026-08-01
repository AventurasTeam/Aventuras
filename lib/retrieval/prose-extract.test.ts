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

  it('splits after a terminator sitting inside the closing quote', () => {
    expect(splitSentences('"Run." She turned away.')).toEqual(['"Run."', 'She turned away.'])
    expect(splitSentences('He shouted, "Run!" Then he fled.')).toEqual([
      'He shouted, "Run!"',
      'Then he fled.',
    ])
    expect(splitSentences('She asked, "Why?" He shrugged.')).toEqual([
      'She asked, "Why?"',
      'He shrugged.',
    ])
  })

  it('does not split a contraction or an abbreviation on the trailing-quote rule', () => {
    expect(splitSentences("It's fine. Don't worry.")).toEqual(["It's fine.", "Don't worry."])
    expect(splitSentences('Mr. Halloway walked in.')).toEqual(['Mr.', 'Halloway walked in.'])
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

  it('sums the signal weights when several fire on one sentence', () => {
    const out = extractProse('Kara Vex drew the blade. The awning had not been lowered.', index, 2)
    // Entity 3 + action verb 2 + brevity 1; the second sentence fires brevity
    // alone. Only the ordering of these weights is canon, so this pins the
    // current tuning rather than a spec'd value.
    expect(out.scores).toEqual([6, 1])
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

  it('exposes the sentences scores was computed over, for pairing by the probe', () => {
    const out = extractProse('Kara Vex drew the blade. Nothing happened at all.', index, 1)
    expect(out.sentences).toEqual(['Kara Vex drew the blade.', 'Nothing happened at all.'])
  })

  it('does not treat a diacritic name as a false verb match', () => {
    const withDiacritic = extractProse('Ranéth stood in the hall.', index, 1)
    const asciiControl = extractProse('Xanadu stood in the hall.', index, 1)
    expect(withDiacritic.scores[0]).toBe(asciiControl.scores[0])
  })

  it('scores dialogue that spans a sentence break, on both fragments', () => {
    const prose = '"Kara Vex betrayed us. The veilstone was never hers." He spat.'
    const out = extractProse(prose, index, 3)
    expect(out.sentences).toEqual([
      '"Kara Vex betrayed us.',
      'The veilstone was never hers."',
      'He spat.',
    ])
    const bareOpening = extractProse('Kara Vex betrayed us.', index, 1).scores[0]
    const bareClosing = extractProse('The veilstone was never hers.', index, 1).scores[0]
    const bareSpat = extractProse('He spat.', index, 1).scores[0]
    // Both quoted fragments carry the dialogue signal, not just the one
    // holding the closing quote mark; the unquoted tag after it does not.
    expect(out.scores[0]).toBeGreaterThan(bareOpening)
    expect(out.scores[1]).toBeGreaterThan(bareClosing)
    expect(out.scores[2]).toBe(bareSpat)
  })

  it('does not award the brevity bonus to an abbreviation fragment from over-splitting', () => {
    const out = extractProse(
      [
        'The council chamber had grown unbearably long and utterly forgettable this evening somehow.',
        'Nothing of any real consequence occurred within its walls at any point whatsoever tonight.',
        'Mr. Halloway offered nothing further worth remarking upon at all in the official record.',
      ].join(' '),
      index,
      2,
    )
    expect(out.text).not.toContain('Mr.')
  })

  it('does not let a decomposed diacritic mark break a verb-list prefix into a false hit', () => {
    // "ñ" written as base "n" + a standalone combining tilde (U+0303), rather
    // than the precomposed codepoint — without \p{M} this splits into "ran" + "oth".
    const withCombiningMark = extractProse('Ra' + 'n' + '̃' + 'oth stood in the hall.', index, 1)
    const asciiControl = extractProse('Xanoth stood in the hall.', index, 1)
    expect(withCombiningMark.scores[0]).toBe(asciiControl.scores[0])
  })

  it('does not award the dialogue bonus to a sentence that merely shares prose with a quote', () => {
    const mixed = extractProse(
      '"Hello," she said. Nothing else happened at all today somehow.',
      index,
      2,
    )
    const isolated = extractProse('Nothing else happened at all today somehow.', index, 1)
    expect(mixed.scores[1]).toBe(isolated.scores[0])
  })

  it('does not award the brevity bonus one char below the floor', () => {
    expect(extractProse('I am.', index, 1).scores[0]).toBe(0)
  })

  it('awards the brevity bonus at the floor itself', () => {
    expect(extractProse('It is.', index, 1).scores[0]).toBe(1)
  })

  it('does not resolve a repeated sentence to an earlier quoted occurrence', () => {
    const out = extractProse('"Run." He left now. Run. Done here now.', index, 4)
    expect(out.sentences).toEqual(['"Run."', 'He left now.', 'Run.', 'Done here now.'])
    // The second "Run." is plain narration; a cursor that didn't advance past
    // the first, quoted "Run." would wrongly resolve it back to that span.
    expect(out.scores[2]).toBe(extractProse('Run.', index, 1).scores[0])
  })
})
