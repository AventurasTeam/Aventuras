import { describe, it, expect } from 'vitest'
import {
  CLEAN_FOR_CLASSIFICATION,
  CLEAN_FOR_REVIEW,
  CLEAN_NONE,
  cleanNarration,
  narrationCleaner,
  type NarrationCleanOptions,
} from './narrationClean'

const P1 = 'She stepped into the tavern, the smell of smoke and ale washing over her.'
const P2 = '"Welcome, stranger," the bartender said, sliding a mug across the counter.'
const P3 = 'She studied the sign, then turned back to her drink.'
const PLAIN = [P1, P2, P3].join('\n\n')

const HTML = [
  `<p>${P1}</p>`,
  `<p><span style="color: #8B4513;">"Welcome, stranger,"</span> the bartender said, sliding a mug across the counter.</p>`,
  '<style>\n.tavern-sign { background: #2a1810; padding: 15px; }\n</style>',
  `<p>${P3}</p>`,
].join('\n\n')

const PIC = [
  `${P1}\n<pic prompt="A tavern interior, smoke and ale, dark fantasy art style" characters=""></pic>`,
  P2,
  `${P3}\n<pic prompt="A woman studying a sign, moody lighting" characters="Elena"></pic>`,
].join('\n\n')

const LAYOUT = [
  '### Late Morning | The Rusty Anchor',
  P1,
  '***',
  P2,
  '**The Reckoning**',
  P3,
  '---',
].join('\n\n')

const FIXTURES = { HTML, PIC, LAYOUT }
const PRESETS = { CLEAN_FOR_REVIEW, CLEAN_FOR_CLASSIFICATION }

function only(overrides: Partial<NarrationCleanOptions>): NarrationCleanOptions {
  return { ...CLEAN_NONE, ...overrides }
}

describe('CLEAN_FOR_REVIEW', () => {
  it.each(Object.entries(FIXTURES))(
    'turns the %s overlay back into plain prose',
    (_name, overlay) => {
      expect(cleanNarration(overlay, CLEAN_FOR_REVIEW)).toBe(PLAIN)
    },
  )

  it('leaves plain prose untouched', () => {
    expect(cleanNarration(PLAIN, CLEAN_FOR_REVIEW)).toBe(PLAIN)
  })

  it('keeps italics and bold inside a sentence', () => {
    const prose = 'She said **no** to the *Empress*.'
    expect(cleanNarration(prose, CLEAN_FOR_REVIEW)).toBe(prose)
  })
})

describe('presets', () => {
  it('CLEAN_NONE returns its input unchanged', () => {
    for (const fixture of [PLAIN, ...Object.values(FIXTURES)]) {
      expect(cleanNarration(fixture, CLEAN_NONE)).toBe(fixture)
    }
  })

  it('the classification preset differs from the review preset only in headings and boldLines', () => {
    expect(CLEAN_FOR_CLASSIFICATION).toEqual({
      ...CLEAN_FOR_REVIEW,
      headings: 'unwrap',
      boldLines: 'unwrap',
    })
  })

  it.each(Object.entries(PRESETS))('%s is idempotent on the fixtures', (_name, preset) => {
    for (const fixture of [PLAIN, ...Object.values(FIXTURES)]) {
      const once = cleanNarration(fixture, preset)
      expect(cleanNarration(once, preset)).toBe(once)
    }
  })

  it('narrationCleaner binds the options', () => {
    expect(narrationCleaner(CLEAN_FOR_REVIEW)(PIC)).toBe(PLAIN)
  })
})

describe('pic', () => {
  it('removes the whole tag, prompt included', () => {
    const content = `One. <pic prompt="a dragon, dark fantasy art style" characters=""></pic> Two.`
    expect(cleanNarration(content, only({ pic: 'remove' }))).toBe('One.  Two.')
  })

  it('keeps it when asked to', () => {
    expect(cleanNarration(PIC, only({ html: 'unwrap' }))).toContain('<pic prompt=')
  })
})

describe('html', () => {
  const unwrap = only({ html: 'unwrap' })

  it('removes a style block with its contents', () => {
    expect(cleanNarration('One.<style>.a { color: red; }</style>\n\nTwo.', unwrap)).toBe(
      'One.\n\nTwo.',
    )
  })

  it('keeps the text of in-world markup and drops only its tags', () => {
    const sign =
      '<div class="tavern-sign">\n  <h2>The Rusty Anchor</h2>\n  <p>Est. 1847</p>\n</div>'
    expect(cleanNarration(sign, unwrap)).toBe('The Rusty Anchor\n\nEst. 1847')
  })

  it('leaves text that only looks like a tag', () => {
    const prose = 'Elena called <Kael> twice, and 3 < 5 held.'
    expect(cleanNarration(prose, unwrap)).toBe(prose)
  })

  it('does not swallow a stray angle bracket up to a later tag', () => {
    expect(cleanNarration('If x <b then <em>y</em>', unwrap)).toBe('If x <b then *y*')
  })

  it('converts emphasis tags to markdown', () => {
    expect(
      cleanNarration('<em>slow</em> and <i>low</i>, <strong>loud</strong>, <b>hard</b>', unwrap),
    ).toBe('*slow* and *low*, **loud**, **hard**')
  })

  it('breaks lines after block ends and <br>', () => {
    expect(cleanNarration('<h2>Title</h2>Text<br>More<br/>End', unwrap)).toBe(
      'Title\n\nText\nMore\nEnd',
    )
    expect(cleanNarration('<p>Intro</p><ul><li>a</li><li>b</li></ul>', unwrap)).toBe(
      'Intro\n\na\nb',
    )
  })

  it('reads a heading line hidden inside a tag', () => {
    expect(cleanNarration('<p>### Dawn | The Keep</p><p>She wakes.</p>', CLEAN_FOR_REVIEW)).toBe(
      'She wakes.',
    )
  })

  it('decodes named and numeric entities once', () => {
    expect(cleanNarration('Tom &amp; Jerry&#39;s &#x2014; &quot;hi&quot;&hellip;', unwrap)).toBe(
      'Tom & Jerry\'s — "hi"…',
    )
    expect(cleanNarration('&amp;lt;b&amp;gt;', unwrap)).toBe('&lt;b&gt;')
  })

  it('leaves an unknown entity and an out-of-range code point alone', () => {
    expect(cleanNarration('&bogus; &#99999999;', unwrap)).toBe('&bogus; &#99999999;')
  })

  it('keeps indentation in text that had no tags', () => {
    expect(cleanNarration('  - a\n    - b', unwrap)).toBe('- a\n    - b')
  })

  it('keeps everything when asked to', () => {
    expect(cleanNarration(HTML, only({ pic: 'remove' }))).toContain('<style>')
  })
})

describe('headings, bold lines and rules', () => {
  it('removes a heading line', () => {
    expect(
      cleanNarration('### Late Morning | The Grotto\nShe freezes.', only({ headings: 'remove' })),
    ).toBe('She freezes.')
  })

  it('unwraps a heading, and one that is also bold', () => {
    const unwrap = only({ headings: 'unwrap', boldLines: 'unwrap' })
    expect(cleanNarration('### Late Morning | The Grotto\n\nShe freezes.', unwrap)).toBe(
      'Late Morning | The Grotto\n\nShe freezes.',
    )
    expect(cleanNarration('### **Mid-Morning | The Grotto Pool**', unwrap)).toBe(
      'Mid-Morning | The Grotto Pool',
    )
  })

  it('removes rules and closes the gap they leave', () => {
    expect(
      cleanNarration(
        'One.\n\n***\n\nTwo.\n\n---\n\nThree.\n\n___\n\nFour.',
        only({ rules: 'remove' }),
      ),
    ).toBe('One.\n\nTwo.\n\nThree.\n\nFour.')
  })

  it('leaves a bullet alone, which is not a rule', () => {
    expect(cleanNarration('- a bullet', only({ rules: 'remove' }))).toBe('- a bullet')
  })

  it('removes a short unpunctuated bold line', () => {
    expect(cleanNarration('One.\n\n**The Backlash**\n\nTwo.', only({ boldLines: 'remove' }))).toBe(
      'One.\n\nTwo.',
    )
  })

  it('unwraps a bold line that reads as a sentence, and one that is long', () => {
    const remove = only({ boldLines: 'remove' })
    expect(cleanNarration('One.\n\n**NO.**\n\nTwo.', remove)).toBe('One.\n\nNO.\n\nTwo.')
    const long = 'The dark fantasy heroine finally opened the very last door there'
    expect(cleanNarration(`**${long}**`, remove)).toBe(long)
  })

  it("'unwrap' unwraps every bold line, however heading-like", () => {
    expect(
      cleanNarration('One.\n\n**The Assessment**\n\nTwo.', only({ boldLines: 'unwrap' })),
    ).toBe('One.\n\nThe Assessment\n\nTwo.')
  })

  it('leaves bold inside a sentence, and a line carrying two spans, alone', () => {
    const remove = only({ boldLines: 'remove' })
    expect(cleanNarration('She said **no** to the Empress.', remove)).toBe(
      'She said **no** to the Empress.',
    )
    expect(cleanNarration('**Morning** at **the pool**', remove)).toBe(
      '**Morning** at **the pool**',
    )
  })
})

describe('inlineEmphasis', () => {
  const unwrap = only({ inlineEmphasis: 'unwrap' })

  it('strips italic and bold spans inside a sentence', () => {
    expect(cleanNarration('She said **no** to the *Empress*, and ***meant*** it.', unwrap)).toBe(
      'She said no to the Empress, and meant it.',
    )
  })

  it('leaves a bullet marker and an underscore name alone', () => {
    expect(cleanNarration('* one\n* two\nsnake_case_name', unwrap)).toBe(
      '* one\n* two\nsnake_case_name',
    )
  })

  it('runs after bold-line detection, so a bold heading is still removed', () => {
    const options = only({ boldLines: 'remove', inlineEmphasis: 'unwrap' })
    expect(cleanNarration('One.\n\n**The Backlash**\n\nShe said **no**.', options)).toBe(
      'One.\n\nShe said no.',
    )
  })
})
