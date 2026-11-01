import { describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'
import { chapterProgressOf } from './chapter-progress'

const row = (kind: StoryEntry['kind'], tokens = 0) => ({ kind, tokens })

describe('canEndChapter', () => {
  it.each([
    ['opening', false],
    ['user_action', false],
    ['system', false],
    ['ai_reply', true],
  ] as const)('reads %s as %s', (kind, expected) => {
    expect(canEndChapter({ kind })).toBe(expected)
  })
})

describe('chapterProgressOf', () => {
  it('reads a series against its threshold', () => {
    expect(chapterProgressOf([row('opening', 300), row('ai_reply', 700)], 4_000)).toEqual({
      tokens: 1_000,
      threshold: 4_000,
      percent: 25,
      tone: 'success',
      canClose: true,
    })
  })

  it('reads an empty region as zeros, keeping the threshold', () => {
    expect(chapterProgressOf([], 4_000)).toEqual({
      tokens: 0,
      threshold: 4_000,
      percent: 0,
      tone: 'success',
      canClose: false,
    })
  })

  it('reads percent above the threshold as a cap at 100, keeping the real sum', () => {
    const progress = chapterProgressOf([row('ai_reply', 7_000)], 4_000)
    expect(progress.tokens).toBe(7_000)
    expect(progress.percent).toBe(100)
  })

  it('reads exactly the threshold as 100', () => {
    expect(chapterProgressOf([row('ai_reply', 4_000)], 4_000).percent).toBe(100)
  })

  it.each([
    ['a zero', 0],
    ['a negative', -500],
    ['a NaN', Number.NaN],
    ['an infinite', Number.POSITIVE_INFINITY],
    ['a negative infinite', Number.NEGATIVE_INFINITY],
  ])('reads percent 0 for %s threshold and returns it as given', (_name, threshold) => {
    const progress = chapterProgressOf([row('ai_reply', 700)], threshold)
    expect(progress.percent).toBe(0)
    expect(progress.tone).toBe('success')
    expect(progress.tokens).toBe(700)
    expect(progress.threshold).toBe(threshold)
  })

  it.each([
    [79, 'success'],
    [80, 'warning'],
    [90, 'danger'],
    [250, 'danger'],
  ])('takes tone from percent for %d tokens of 100', (tokens, tone) => {
    expect(chapterProgressOf([row('ai_reply', tokens)], 100).tone).toBe(tone)
  })

  it('can close once the region holds an ai_reply, whatever else it holds', () => {
    expect(chapterProgressOf([row('opening', 900)], 100).canClose).toBe(false)
    expect(chapterProgressOf([row('user_action'), row('user_action')], 100).canClose).toBe(false)
    expect(
      chapterProgressOf([row('opening'), row('user_action'), row('ai_reply')], 100).canClose,
    ).toBe(true)
  })
})
