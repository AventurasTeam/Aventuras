import { describe, expect, it } from 'vitest'

import {
  overSoftCap,
  restatedList,
  restatedText,
  sentList,
  sentText,
  softCapReason,
  TEXT_BOUNDS,
} from './fields'

const terms = (n: number, word = 'trait'): string[] =>
  Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)

describe('sentText', () => {
  it('reads a missing or blank text as omitted', () => {
    expect(sentText(undefined, 'voice')).toBeUndefined()
    expect(sentText('', 'description')).toBeUndefined()
    expect(sentText(' \n\t ', 'standing')).toBeUndefined()
  })

  it('keeps the text as sent beside the text as it would be stored', () => {
    expect(sentText('  slow, certain  ', 'voice')).toEqual({
      sent: '  slow, certain  ',
      bounded: 'slow, certain',
    })
  })

  it('bounds a voice at 2,000 characters', () => {
    expect(sentText('v'.repeat(3000), 'voice')).toEqual({
      sent: 'v'.repeat(3000),
      bounded: 'v'.repeat(2000),
    })
  })

  it('bounds a description at 1,200, a title at 120 and a standing at 500', () => {
    expect(sentText('d'.repeat(1500), 'description')?.bounded).toBe('d'.repeat(1200))
    expect(sentText('t'.repeat(200), 'title')?.bounded).toBe('t'.repeat(120))
    expect(sentText('s'.repeat(510), 'standing')?.bounded).toBe('s'.repeat(500))
  })
})

describe('a bound cuts as a pass cuts', () => {
  it('cuts a standing at a clause boundary, not mid-word', () => {
    expect(sentText(`${'a'.repeat(300)}. ${'b'.repeat(300)}`, 'standing')?.bounded).toBe(
      `${'a'.repeat(300)}.`,
    )
  })

  it('trims the end of a description after the cut', () => {
    expect(sentText(`${'d'.repeat(1199)} tail`, 'description')?.bounded).toBe('d'.repeat(1199))
  })
})

describe('TEXT_BOUNDS', () => {
  it('trims each text before it cuts it, and leaves a short one whole', () => {
    expect(TEXT_BOUNDS.description('  A courier.  ')).toBe('A courier.')
    expect(TEXT_BOUNDS.title('  The relic  ')).toBe('The relic')
    expect(TEXT_BOUNDS.voice('  soft  ')).toBe('soft')
    expect(TEXT_BOUNDS.standing('  feared  ')).toBe('feared')
  })
})

describe('sentList', () => {
  it('reads a missing, empty or all-blank list as omitted', () => {
    expect(sentList(undefined)).toBeUndefined()
    expect(sentList([])).toBeUndefined()
    expect(sentList(['', '  '])).toBeUndefined()
  })

  it('dedupes as a pass does: trimmed, first spelling kept, blanks dropped', () => {
    expect(sentList(['brave', ' Brave ', '', 'courageous'])).toEqual(['brave', 'courageous'])
  })
})

describe('restatedText', () => {
  const long = 'd'.repeat(1500)

  it('reads a stored value equal to the text as sent as restated, though it is over the bound', () => {
    expect(restatedText(long, sentText(long, 'description')!)).toBe(true)
  })

  it('reads a stored value equal to the text as bounded as restated', () => {
    expect(restatedText('d'.repeat(1200), sentText(long, 'description')!)).toBe(true)
    expect(restatedText('soft', sentText(' soft ', 'voice')!)).toBe(true)
  })

  it('reads anything else, a missing value included, as a change', () => {
    expect(restatedText('gravel', sentText('soft', 'voice')!)).toBe(false)
    expect(restatedText(undefined, sentText('soft', 'voice')!)).toBe(false)
    expect(restatedText(null, sentText('soft', 'voice')!)).toBe(false)
  })
})

describe('restatedList', () => {
  it('reads only the same entries in the same order as restated', () => {
    expect(restatedList(['patient', 'wary'], ['patient', 'wary'])).toBe(true)
    expect(restatedList(['wary', 'patient'], ['patient', 'wary'])).toBe(false)
    expect(restatedList(['patient'], ['patient', 'wary'])).toBe(false)
    expect(restatedList(undefined, ['patient'])).toBe(false)
  })
})

describe('overSoftCap', () => {
  it('passes a list at its cap and refuses one past it, for each cap', () => {
    expect(overSoftCap(terms(8), ['patient'], 8)).toBe(false)
    expect(overSoftCap(terms(9), ['patient'], 8)).toBe(true)
    expect(overSoftCap(terms(6), [], 6)).toBe(false)
    expect(overSoftCap(terms(7), [], 6)).toBe(true)
    expect(overSoftCap(terms(4), undefined, 4)).toBe(false)
    expect(overSoftCap(terms(5), undefined, 4)).toBe(true)
  })

  it('refuses a list growing from its cap past it', () => {
    expect(overSoftCap(terms(9), terms(8), 8)).toBe(true)
  })

  it('on a row stored over its cap, passes a shorter list and a swap, and refuses growth', () => {
    const stored = terms(12)
    expect(overSoftCap(terms(10), stored, 8)).toBe(false)
    expect(overSoftCap([...terms(11), 'wary'], stored, 8)).toBe(false)
    expect(overSoftCap(terms(13), stored, 8)).toBe(true)
  })

  it('counts a stored value that is no list as empty', () => {
    expect(overSoftCap(terms(9), 'patient', 8)).toBe(true)
    expect(overSoftCap(terms(9), null, 8)).toBe(true)
    expect(overSoftCap(terms(9), 'x'.repeat(20), 8)).toBe(true)
  })
})

describe('softCapReason', () => {
  it('names the list, its cap, and to replace an entry rather than add one', () => {
    expect(softCapReason('traits', 8)).toBe(
      'traits is over its soft cap of 8: replace an entry rather than add one',
    )
    expect(softCapReason('agenda', 4)).toBe(
      'agenda is over its soft cap of 4: replace an entry rather than add one',
    )
  })
})
