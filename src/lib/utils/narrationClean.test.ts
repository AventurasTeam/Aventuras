// @vitest-environment jsdom
import { Lexer } from 'marked'
import { describe, it, expect } from 'vitest'
import {
  CLEAN_FOR_CLASSIFICATION,
  CLEAN_FOR_REVIEW,
  CLEAN_NONE,
  cleanNarration,
  escapeStrayAngles,
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

  it('drops it as an unknown element under html unwrap, keeping the prose after it', () => {
    const content = 'One.<pic prompt="a dragon over the keep" />Two.'
    expect(cleanNarration(content, only({ html: 'unwrap' }))).toBe('One.Two.')
  })

  it('keeps it when nothing else is asked for', () => {
    expect(cleanNarration(PIC, CLEAN_NONE)).toContain('<pic prompt=')
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

  it('leaves a bracket that does not begin a tag', () => {
    expect(cleanNarration('3 < 5 <3 ->', unwrap)).toBe('3 < 5 <3 ->')
  })

  it('drops an unknown element as the reader does', () => {
    expect(cleanNarration('Elena called <Kael> twice', unwrap)).toBe('Elena called twice')
  })

  it('does not swallow a stray angle bracket up to a later tag', () => {
    expect(cleanNarration('If x <b then <em>y</em>', unwrap)).toBe('If x <b then *y*')
  })

  it('keeps the rest of the entry after a bracket that opens no tag', () => {
    expect(cleanNarration('x<y and then the rest', unwrap)).toBe('x<y and then the rest')
  })

  it('keeps a truncated tag at the end as text', () => {
    expect(cleanNarration('She ran. <span sty', unwrap)).toBe('She ran. <span sty')
  })

  it('keeps an autolink as text', () => {
    expect(cleanNarration('See <https://example.com> now', unwrap)).toBe(
      'See <https://example.com> now',
    )
  })

  it('unwraps names that collide with words, custom elements and any case', () => {
    expect(cleanNarration('<Mark>Twain</Mark>', unwrap)).toBe('Twain')
    expect(cleanNarration('<b-foo>kept</b-foo>', unwrap)).toBe('kept')
    expect(cleanNarration('<P>One</P><DIV>Two</DIV>', unwrap)).toBe('One\n\nTwo')
  })

  it('breaks a paragraph at an opening <p> with no closing tag', () => {
    expect(cleanNarration('<p>One<p>Two', unwrap)).toBe('One\n\nTwo')
  })

  it('moves whitespace inside an emphasis tag outside its markers', () => {
    expect(cleanNarration('a<em> x </em>b', unwrap)).toBe('a *x* b')
    expect(cleanNarration('<em> x </em>', unwrap)).toBe('*x*')
  })

  it('separates table cells with a space', () => {
    expect(cleanNarration('<table><tr><td>Str</td><td>12</td></tr></table>', unwrap)).toBe('Str 12')
  })

  it('drops a comment', () => {
    expect(cleanNarration('One.<!-- note -->Two.', unwrap)).toBe('One.Two.')
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
    expect(cleanNarration('a&nbsp;b &eacute;', unwrap)).toBe('a b é')
  })

  it('leaves an unknown entity alone and replaces an out-of-range code point', () => {
    expect(cleanNarration('&bogus; &#99999999;', unwrap)).toBe('&bogus; �')
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

describe('CLEAN_FOR_CLASSIFICATION', () => {
  const classify = (content: string) => cleanNarration(content, CLEAN_FOR_CLASSIFICATION)

  it('unwraps a heading rather than dropping it', () => {
    // The heading carries the hour and the place — the two scene fields the classifier fills.
    expect(classify('### Late Morning | The Grotto\n\nShe freezes.')).toBe(
      'Late Morning | The Grotto\n\nShe freezes.',
    )
  })

  it('unwraps a heading that is also bold', () => {
    expect(classify('### **Mid-Morning | The Grotto Pool**')).toBe('Mid-Morning | The Grotto Pool')
  })

  it('drops horizontal rules, which carry no text', () => {
    expect(classify('One.\n\n***\n\nTwo.\n\n---\n\nThree.\n\n___\n\nFour.')).toBe(
      'One.\n\nTwo.\n\nThree.\n\nFour.',
    )
  })

  it('unwraps a bold-only line, however heading-like', () => {
    expect(classify('One.\n\n**The Assessment**\n\nTwo.')).toBe('One.\n\nThe Assessment\n\nTwo.')
    expect(classify('**Late Morning | The Grotto Pool**')).toBe('Late Morning | The Grotto Pool')
  })

  it('leaves bold inside a sentence alone, and a line carrying two spans', () => {
    expect(classify('She said **no** to the Empress.')).toBe('She said **no** to the Empress.')
    expect(classify('**Morning** at **the pool**')).toBe('**Morning** at **the pool**')
  })

  it('collapses CRLF blank lines', () => {
    expect(classify('### Title\r\n\r\n\r\n\r\ntext')).toBe('Title\n\ntext')
  })

  it('collapses the gaps a dropped rule leaves behind', () => {
    expect(classify('# Title\n\n***\n\nProse.')).toBe('Title\n\nProse.')
  })

  it('leaves ordinary prose and a bullet untouched', () => {
    const prose = 'Morvana snorts.\n\n"Boring," she says.'
    expect(classify(prose)).toBe(prose)
    expect(classify('- a bullet')).toBe('- a bullet')
  })

  it('removes an image tag and unwraps Visual Prose HTML', () => {
    expect(classify(PIC)).toBe(PLAIN)
    expect(classify(HTML)).toBe(PLAIN)
  })

  it('unwraps HTML in a player action too, so it reads as the words typed', () => {
    expect(classify('<em>I</em> draw my sword &amp; charge.')).toBe('*I* draw my sword & charge.')
  })
})

describe('escapeStrayAngles', () => {
  // `marked` renders the raw HTML it tokenizes and escapes every other `<`. The cleaner must agree.
  const INPUTS = [
    'x<y and then the rest',
    '3 < 5 and <3',
    'a <b then <em>y</em>',
    'end <span sty',
    'See <https://example.com> now',
    'Elena called <Kael> twice',
    '<Mark>Twain</Mark> and <b-foo>x</b-foo>',
    `<a href="x" title='y' hidden>link</a>`,
    '<span class="a>b">text</span>',
    '<br/> and <br />',
    'one<!-- note -->two and <!-->three',
    '<?php echo 1 ?>rest',
    '<!DOCTYPE html>rest',
    '<![CDATA[raw]]>rest',
    '<= and <> and <-',
    '</ p> and </p >',
  ]

  it.each(INPUTS)('agrees with marked on %j', (input) => {
    const escaped = escapeStrayAngles(input)
    const kept = [...escaped.matchAll(/<|&lt;/g)].map((m) => m[0] === '<')

    const asHtml: boolean[] = []
    let offset = 0
    for (const token of Lexer.lexInline(input)) {
      for (let i = 0; i < token.raw.length; i++) {
        if (token.raw[i] === '<') asHtml.push(token.type === 'html' && i === 0)
      }
      offset += token.raw.length
    }
    expect(offset).toBe(input.length)
    expect(kept).toEqual(asHtml)
  })
})
