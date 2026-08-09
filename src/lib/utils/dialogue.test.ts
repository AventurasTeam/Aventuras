import { describe, it, expect } from 'vitest'
import { matchDialogueAt, findDialogueStart, segmentDialogue } from './dialogue'
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

  it('returns nothing for empty input', () => {
    expect(segmentDialogue('')).toEqual([])
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

  it('keeps image placeholders intact inside dialogue', () => {
    // ImageEmbeddingService substitutes placeholders before rendering and swaps
    // the real markup back afterwards; a placeholder inside a quote must survive.
    const html = parseStoryMarkdown('"Look at PICPH0PICPH now."')
    expect(html).toContain('<span class="dialogue-line">"Look at PICPH0PICPH now."</span>')
  })
})
