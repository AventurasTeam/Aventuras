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

  it('keeps the closing sentence when a French closer stands spaced off its mark', () => {
    expect(firstLastSentences('« Bonjour. » Il partit. « Adieu. »')).toEqual({
      first: '« Bonjour.',
      last: '« Adieu. »',
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

    it('cuts each sentence on its own', () => {
      expect(firstLastSentences('Short one. the long road north with no end in sight', 20)).toEqual(
        { first: 'Short one.', last: 'the long road north…' },
      )
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
