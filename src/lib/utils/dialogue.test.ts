import { describe, it, expect } from 'vitest'
import { matchDialogueAt, findDialogueStart, segmentDialogue, dialogueSpans } from './dialogue'
import { parseStoryMarkdown, parseMarkdown } from './markdown'

describe('matchDialogueAt', () => {
  it('matches the three supported quote pairs', () => {
    expect(matchDialogueAt('"hello"')?.inner).toBe('hello')
    expect(matchDialogueAt('“hello”')?.inner).toBe('hello')
    expect(matchDialogueAt('«hello»')?.inner).toBe('hello')
  })

  it('does not match single quotes, so apostrophes survive', () => {
    expect(matchDialogueAt("'hello'")).toBeNull()
    expect(segmentDialogue("He didn't know the man's name")).toEqual([
      { text: "He didn't know the man's name", isDialogue: false },
    ])
  })

  it('rejects an unterminated quote', () => {
    expect(matchDialogueAt('"hello')).toBeNull()
  })

  it('rejects a quote holding only whitespace', () => {
    expect(matchDialogueAt('"   "')).toBeNull()
    expect(matchDialogueAt('""')).toBeNull()
  })

  it('does not cross a blank line', () => {
    expect(matchDialogueAt('"hello\n\nworld"')).toBeNull()
  })

  it('crosses a single newline, which is a line break inside one paragraph', () => {
    expect(matchDialogueAt('"hello\nworld"')?.inner).toBe('hello\nworld')
  })

  it('returns null when there is no opening quote at the index', () => {
    expect(matchDialogueAt('hello "world"')).toBeNull()
    expect(matchDialogueAt('hello "world"', 6)?.inner).toBe('world')
  })
})

describe('findDialogueStart', () => {
  it('finds the earliest opener of any style', () => {
    expect(findDialogueStart('a «b» c "d"')).toBe(2)
    expect(findDialogueStart('a "b" c «d»')).toBe(2)
    expect(findDialogueStart('nothing here')).toBe(-1)
  })
})

describe('segmentDialogue', () => {
  it('alternates narrator and dialogue', () => {
    expect(segmentDialogue('She said "run" and left.')).toEqual([
      { text: 'She said ', isDialogue: false },
      { text: '"run"', isDialogue: true },
      { text: ' and left.', isDialogue: false },
    ])
  })

  it('handles several quotes in one paragraph', () => {
    const segments = segmentDialogue('"One." He paused. "Two." Silence. "Three."')
    expect(segments.filter((s) => s.isDialogue).map((s) => s.text)).toEqual([
      '"One."',
      '"Two."',
      '"Three."',
    ])
  })

  it('is lossless — segments concatenate back to the input', () => {
    const text = 'A «first» then "second"\n\nand a third" dangling quote “closed”.'
    expect(
      segmentDialogue(text)
        .map((s) => s.text)
        .join(''),
    ).toBe(text)
  })

  it('treats an unterminated quote as narrator text', () => {
    expect(segmentDialogue('He said "wait')).toEqual([{ text: 'He said "wait', isDialogue: false }])
  })

  it('takes the outer span when quote styles nest', () => {
    expect(segmentDialogue('«He said "hi" to me»')).toEqual([
      { text: '«He said "hi" to me»', isDialogue: true },
    ])
  })

  it('does not speak an attribute value as dialogue, and stays lossless', () => {
    // TTS reaches this with markup still in place whenever `removeHtmlTags` is off.
    const text = 'He said <b class="x">nothing</b> at all.'
    const segments = segmentDialogue(text)

    expect(segments.every((s) => !s.isDialogue)).toBe(true)
    expect(segments.map((s) => s.text).join('')).toBe(text)
  })

  it('returns nothing for empty input', () => {
    expect(segmentDialogue('')).toEqual([])
  })
})

describe('dialogueSpans', () => {
  it('reports the spans an image marker must not cut', () => {
    expect(dialogueSpans('He said "hi" and left.')).toEqual([{ start: 8, end: 12 }])
  })

  it('reports no span for markup, whose quotes are attribute values', () => {
    // This is what `ImageEmbeddingService` snaps markers to, and it also runs over
    // Visual Prose content, which is entirely generated HTML. Reading `class="x"` as
    // speech there would widen a marker across a tag and split it when it is lifted
    // out of the content.
    expect(dialogueSpans('He said "hi <b class="x">bold</b> onward')).toEqual([])
    expect(dialogueSpans('<p class="a">Plain prose.</p>')).toEqual([])
  })
})

describe('parseStoryMarkdown', () => {
  it('wraps dialogue, quotes included', () => {
    expect(parseStoryMarkdown('She said "run".')).toContain(
      '<span class="dialogue-line">"run"</span>',
    )
  })

  it('still parses markdown inside a quote', () => {
    const html = parseStoryMarkdown('"*Run*," she said.')
    expect(html).toContain('<span class="dialogue-line">"<em>Run</em>,"</span>')
  })

  it('handles raw HTML inside a quote exactly as the plain renderer does', () => {
    // marked passes raw HTML through, in this renderer and in parseMarkdown alike.
    // The dialogue extension must stay neutral about that rather than quietly
    // changing the escaping rules for narration.
    const inQuote = parseStoryMarkdown('"<b>x</b>"')
    expect(inQuote).toContain('<span class="dialogue-line">"<b>x</b>"</span>')
    expect(parseMarkdown('<b>x</b>')).toContain('<b>x</b>')
  })

  it('leaves quotes inside code spans alone', () => {
    const html = parseStoryMarkdown('Use `say "hi"` here.')
    expect(html).not.toContain('dialogue-line')
  })

  it('does not mark up an unterminated quote', () => {
    expect(parseStoryMarkdown('He said "wait')).not.toContain('dialogue-line')
  })

  it('does not join quotes across paragraphs', () => {
    const html = parseStoryMarkdown('First "one.\n\nSecond" two.')
    expect(html).not.toContain('dialogue-line')
  })

  it('does not let an attribute quote close a span opened in prose', () => {
    // The extension runs before marked's `tag` tokenizer, so nothing but the tag
    // skip stops an unterminated quote from closing on `class="`. When it did, the
    // tag was split: half escaped into text, half left as a stray end tag.
    const html = parseStoryMarkdown('He said "hi <span class="a">x</span> done')
    expect(html).not.toContain('dialogue-line')
    expect(html).toContain('<span class="a">x</span>')
  })

  it('leaves a pic tag intact after an unterminated quote', () => {
    // StreamingEntry parses before substituting <pic> placeholders, so a mangled
    // tag here is an image silently lost from the entry.
    const src = 'She whispered "wait— <pic prompt="dark hall"> the hall was dark.'
    const html = parseStoryMarkdown(src)
    expect(html).not.toContain('dialogue-line')
    expect(html).toContain('<pic prompt="dark hall">')
  })

  it('still closes a quote that legitimately contains a tag', () => {
    const html = parseStoryMarkdown('"hi <b>there</b> friend"')
    expect(html).toContain('<span class="dialogue-line">"hi <b>there</b> friend"</span>')
  })

  it('treats a bare less-than as ordinary text, not a tag', () => {
    const html = parseStoryMarkdown('"a < b, always"')
    expect(html).toContain('dialogue-line')
  })

  it('keeps image placeholders intact inside dialogue', () => {
    // ImageEmbeddingService substitutes placeholders before rendering and swaps
    // the real markup back afterwards; a placeholder inside a quote must survive.
    const html = parseStoryMarkdown('"Look at PICPH0PICPH now."')
    expect(html).toContain('<span class="dialogue-line">"Look at PICPH0PICPH now."</span>')
  })
})
