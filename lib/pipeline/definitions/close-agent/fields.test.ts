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

/** Twelve traits, as a list a model escaped into one string held them. */
const TWELVE_TRAITS = [
  'old sailor',
  'man of substance',
  "has a banker's account",
  'lost a leg',
  'one-legged',
  'keeps a public-house in Bristol',
  'knows every seaman in Bristol',
  "ship's cook of the Hispaniola",
  'cheerful',
  'intelligent',
  'smiling',
  'has a large firm grasp',
]

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
  const entries = (value: string[]) => sentList(value)?.entries

  it('reads a missing, empty or all-blank list as omitted', () => {
    expect(sentList(undefined)).toBeUndefined()
    expect(sentList([])).toBeUndefined()
    expect(sentList(['', '  '])).toBeUndefined()
  })

  it('dedupes as a pass does: trimmed, first spelling kept, blanks dropped', () => {
    expect(entries(['brave', ' Brave ', '', 'courageous'])).toEqual(['brave', 'courageous'])
  })

  it('keeps the list as sent and deduped beside the entries it holds', () => {
    expect(sentList(['brave","wary', 'brave","wary', 'patient'])).toEqual({
      raw: ['brave","wary', 'brave","wary', 'patient'],
      deduped: ['brave","wary', 'patient'],
      entries: ['brave', 'wary', 'patient'],
    })
  })

  it.each([
    ['quotes between its entries', TWELVE_TRAITS.join('","'), TWELVE_TRAITS],
    ['spacing around the commas', 'brave", "wary" ,"patient', ['brave', 'wary', 'patient']],
    ['its brackets', '["brave","wary"]', ['brave', 'wary']],
    ['escaped quotes', 'brave\\",\\"wary\\",\\"patient', ['brave', 'wary', 'patient']],
    ['escaped quotes and brackets', '[\\"brave\\",\\"wary\\"]', ['brave', 'wary']],
    ['pretty-printed lines', '\n[\n  "brave",\n  "wary"\n]\n', ['brave', 'wary']],
  ])('reads a list joined into one entry with %s as the entries it holds', (_, joined, held) => {
    expect(entries([joined])).toEqual(held)
  })

  it('reads a bracketed one-entry list as its entry, escaped or not, and keeps bare brackets', () => {
    expect(entries(['["patient"]'])).toEqual(['patient'])
    expect(entries(['[\\"patient\\"]'])).toEqual(['patient'])
    expect(entries(['\n[\n  "patient"\n]\n'])).toEqual(['patient'])
    expect(entries(['[patient]'])).toEqual(['[patient]'])
  })

  it("keeps a decoded entry's own brackets, and reads a list encoded twice as its entry", () => {
    expect(entries(['["[patient]"]'])).toEqual(['[patient]'])
    expect(entries(['["[patient"]'])).toEqual(['[patient'])
    expect(entries(['["[\\"patient\\"]"]'])).toEqual(['patient'])
  })

  it('splits a decoded item on its escaped line breaks, its list markers dropped', () => {
    expect(entries(['["brave\\nwary", "patient"]'])).toEqual(['brave', 'wary', 'patient'])
    expect(entries(['["- brave\\n- wary"]'])).toEqual(['brave', 'wary'])
  })

  it('splits an entry on its line breaks, deduping across the pieces', () => {
    expect(entries(['brave\nwary\r\npatient', 'Wary'])).toEqual(['brave', 'wary', 'patient'])
  })

  it("drops a list marker from a split entry's lines, and keeps a line's own leading number", () => {
    expect(entries(['  - brave\n  * wary\n  12. patient'])).toEqual(['brave', 'wary', 'patient'])
    expect(entries(['wary\n1.5 times the size of a man'])).toEqual([
      'wary',
      '1.5 times the size of a man',
    ])
  })

  it('keeps whole an entry with a comma, its own quotes, or a marker on its only line', () => {
    const whole = [
      'quick-witted, if rash',
      'called "Barbecue"',
      `stands 6'2"`,
      'known as "Barbecue", "Long John" to some',
      'says "aye", "nay"',
      '"Pieces of eight," says the parrot',
      '"brave"',
      '"brave", 1, "wary"',
      '- brave',
    ]
    expect(entries(whole)).toEqual(whole)
  })

  it.each([['[]'], ['[ ]'], ['""'], ['[""]'], ['\\"\\"'], ['\n[\n]\n'], ['["[]"]']])(
    'reads an entry holding an empty list or only blanks, %j, as holding no entry',
    (empty) => {
      expect(sentList([empty])).toBeUndefined()
      expect(entries([empty, 'brave'])).toEqual(['brave'])
    },
  )

  it("keeps a split line's own quotes", () => {
    expect(entries([`stands 6'2"\nwary`])).toEqual([`stands 6'2"`, 'wary'])
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
  const list = (value: string[]) => sentList(value)!

  it('reads only the same entries in the same order as restated', () => {
    expect(restatedList(['patient', 'wary'], list(['patient', 'wary']))).toBe(true)
    expect(restatedList(['wary', 'patient'], list(['patient', 'wary']))).toBe(false)
    expect(restatedList(['patient'], list(['patient', 'wary']))).toBe(false)
    expect(restatedList(undefined, list(['patient']))).toBe(false)
  })

  it('reads a stored list equal to the list as sent or to the entries it holds as restated', () => {
    expect(restatedList(['stubborn\nwary'], list(['stubborn\nwary']))).toBe(true)
    expect(restatedList(['stubborn', 'wary'], list(['stubborn\nwary']))).toBe(true)
    expect(restatedList(['stubborn'], list(['stubborn\nwary']))).toBe(false)
  })

  it('reads a resent stored list holding duplicates or padding as restated', () => {
    expect(restatedList(['brave', 'brave'], list(['brave', 'brave']))).toBe(true)
    expect(restatedList([' brave ', 'wary'], list([' brave ', 'wary']))).toBe(true)
    expect(restatedList(['brave', 'brave'], list(['brave', 'wary']))).toBe(false)
  })

  it('reads a stored list equal to the list as sent once deduped as restated', () => {
    const stored = ['brave","wary', 'patient']
    expect(restatedList(stored, list(['brave","wary', ' Brave","Wary ', 'patient']))).toBe(true)
  })

  it('reads a list that drops a stored duplicate as a change', () => {
    expect(restatedList(['brave', 'Brave', 'loyal'], list(['brave', 'loyal']))).toBe(false)
    expect(restatedList([...terms(8), 'Trait 8'], list(terms(8)))).toBe(false)
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

  it('says a list joined into one entry was read as the entries it holds', () => {
    expect(softCapReason('traits', 8, sentList([TWELVE_TRAITS.join('","')]))).toBe(
      'traits is over its soft cap of 8: replace an entry rather than add one' +
        ' (read as 12 entries: a list joined into one string holds one entry per item)',
    )
    expect(softCapReason('traits', 8, sentList(terms(9)))).toBe(
      'traits is over its soft cap of 8: replace an entry rather than add one',
    )
  })
})
