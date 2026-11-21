import { describe, expect, it } from 'vitest'

import { firstLastSentences, SENTENCE_EXCERPT_MAX } from './first-last-sentences'

// chapter-close.md → Phase 1: a candidate reaches the model by its opening and closing sentences.
describe('firstLastSentences', () => {
  it('gives the first and last of two sentences', () => {
    expect(firstLastSentences('The rain had stopped. Kael stepped out into the yard.')).toEqual({
      first: 'The rain had stopped.',
      last: 'Kael stepped out into the yard.',
    })
  })

  it('skips the sentences between, splitting on a period, a bang and a question mark', () => {
    expect(
      firstLastSentences('The bell rang twice. Nobody came! Was Mora still at the ford?'),
    ).toEqual({ first: 'The bell rang twice.', last: 'Was Mora still at the ford?' })
  })

  it('gives no last sentence for a text of one', () => {
    expect(firstLastSentences('The ford was empty.')).toEqual({
      first: 'The ford was empty.',
      last: null,
    })
  })

  it('splits on CJK marks, which need no space after them', () => {
    expect(firstLastSentences('雨が止んだ。カエルは庭に出た！誰もいない？')).toEqual({
      first: '雨が止んだ。',
      last: '誰もいない？',
    })
  })

  it('keeps a closing quote or bracket with the sentence its mark ends', () => {
    expect(firstLastSentences('He nodded. "We leave at dawn."')).toEqual({
      first: 'He nodded.',
      last: '"We leave at dawn."',
    })
    expect(firstLastSentences('She paid. "Keep it." He left.')).toEqual({
      first: 'She paid.',
      last: 'He left.',
    })
    expect(firstLastSentences('「行こう。」彼は言った。')).toEqual({
      first: '「行こう。」',
      last: '彼は言った。',
    })
  })

  it('keeps a French closer spaced off its mark with the sentence it closes', () => {
    expect(firstLastSentences('« Bonjour. » Il partit. « Adieu. »')).toEqual({
      first: '« Bonjour. »',
      last: '« Adieu. »',
    })
    expect(firstLastSentences('Elle rit. « Au revoir ! » Il partit.')).toEqual({
      first: 'Elle rit.',
      last: 'Il partit.',
    })
  })

  it('does not end a sentence at a title or an initial', () => {
    expect(firstLastSentences('Mr. Smith arrived. Then Dr. Livesey came in.')).toEqual({
      first: 'Mr. Smith arrived.',
      last: 'Then Dr. Livesey came in.',
    })
    expect(firstLastSentences('The book was by J. R. Tolkien. It was long.')).toEqual({
      first: 'The book was by J. R. Tolkien.',
      last: 'It was long.',
    })
    expect(firstLastSentences('They met at St. James. The letter was signed J. T.')).toEqual({
      first: 'They met at St. James.',
      last: 'The letter was signed J. T.',
    })
  })

  it('still ends a sentence at "I."', () => {
    expect(firstLastSentences('Not I. She went alone.')).toEqual({
      first: 'Not I.',
      last: 'She went alone.',
    })
  })

  it('keeps a dialogue tag with the line it tags', () => {
    expect(
      firstLastSentences(
        'The road was dark. “Dash it, Dirk!” reiterated Pew, striking with his stick upon the road.',
      ),
    ).toEqual({
      first: 'The road was dark.',
      last: '“Dash it, Dirk!” reiterated Pew, striking with his stick upon the road.',
    })
    expect(firstLastSentences('He waited. “Who is it?” asked Jim quietly.')).toEqual({
      first: 'He waited.',
      last: '“Who is it?” asked Jim quietly.',
    })
  })

  it('carries an opening ellipsis into the first sentence', () => {
    expect(firstLastSentences('... and then the door opened. She stood there.')).toEqual({
      first: '... and then the door opened.',
      last: 'She stood there.',
    })
  })

  it('keeps markdown emphasis with the sentence it closes', () => {
    expect(firstLastSentences('He ran. *Faster.* She followed.')).toEqual({
      first: 'He ran.',
      last: 'She followed.',
    })
    expect(firstLastSentences('He ran. _Faster._ She followed. *Gone.*')).toEqual({
      first: 'He ran.',
      last: '*Gone.*',
    })
  })

  it('splits on half-width Japanese marks', () => {
    expect(firstLastSentences('彼は走った｡｢待て｣彼女は追いかけた｡')).toEqual({
      first: '彼は走った｡',
      last: '｢待て｣彼女は追いかけた｡',
    })
  })

  it('keeps German low-quote and guillemet closers with their sentence', () => {
    expect(firstLastSentences('„Wir gehen.“ Er nickte.')).toEqual({
      first: '„Wir gehen.“',
      last: 'Er nickte.',
    })
    expect(firstLastSentences('»Gut.« Er nickte.')).toEqual({
      first: '»Gut.«',
      last: 'Er nickte.',
    })
  })

  it('merges a letterless piece, an ellipsis, into the sentence before it', () => {
    expect(firstLastSentences('He waited. ... Then nothing came.')).toEqual({
      first: 'He waited. ...',
      last: 'Then nothing came.',
    })
    expect(firstLastSentences('He left. ...')).toEqual({
      first: 'He left. ...',
      last: null,
    })
  })

  it('does not split on a mark with no space after it', () => {
    expect(firstLastSentences('She paid 3.5 crowns at the gate.')).toEqual({
      first: 'She paid 3.5 crowns at the gate.',
      last: null,
    })
  })

  it('reads a trailing run with no mark as the last sentence', () => {
    expect(firstLastSentences('The bell rang. And then')).toEqual({
      first: 'The bell rang.',
      last: 'And then',
    })
  })

  it('puts each sentence on one line, trimmed', () => {
    expect(firstLastSentences('  The door\nopened.   Then\n\nnothing.  ')).toEqual({
      first: 'The door opened.',
      last: 'Then nothing.',
    })
  })

  it.each(['', '  \n '])('gives an empty first and no last for a blank text (%j)', (text) => {
    expect(firstLastSentences(text)).toEqual({ first: '', last: null })
  })

  describe('the cap', () => {
    it('is 240 code points by default', () => {
      expect(SENTENCE_EXCERPT_MAX).toBe(240)
      expect(firstLastSentences('a'.repeat(300))).toEqual({
        first: `${'a'.repeat(240)}…`,
        last: null,
      })
    })

    it("cuts a text with no sentence break to its start, at the last space in the cap's second half", () => {
      expect(firstLastSentences('the long road north with no end in sight', 20)).toEqual({
        first: 'the long road north…',
        last: null,
      })
    })

    it('keeps a word that ends exactly at the cap', () => {
      expect(firstLastSentences('the long road north with no end in sight', 19)).toEqual({
        first: 'the long road north…',
        last: null,
      })
    })

    it('cuts at the cap when the only space is in its first half', () => {
      expect(firstLastSentences('ab cdefghijklmnop', 10)).toEqual({
        first: 'ab cdefghi…',
        last: null,
      })
    })

    it('cuts each sentence on its own, the last to its end', () => {
      expect(firstLastSentences('Short one. The long road north with no end in sight', 20)).toEqual(
        { first: 'Short one.', last: '…with no end in sight' },
      )
    })

    it("cuts a long last sentence to its end, at the first space in the cap's first half", () => {
      expect(firstLastSentences('It began. The long road north with no end in sight', 19)).toEqual({
        first: 'It began.',
        last: '…no end in sight',
      })
    })

    it('cuts a long last sentence at the cap when its only space is in the second half', () => {
      expect(firstLastSentences('It began. Abcdefghijklmnop qr', 10)).toEqual({
        first: 'It began.',
        last: '…jklmnop qr',
      })
    })

    it('counts code points, never splitting a surrogate pair', () => {
      expect(firstLastSentences('😀'.repeat(12), 10)).toEqual({
        first: `${'😀'.repeat(10)}…`,
        last: null,
      })
    })

    it('leaves a sentence exactly at the cap whole', () => {
      expect(firstLastSentences('a'.repeat(10), 10)).toEqual({ first: 'a'.repeat(10), last: null })
    })
  })
})
