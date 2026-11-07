import { describe, expect, it } from 'vitest'

import {
  chapterFieldLabel,
  chapterHeading,
  chapterIssueText,
  chapterSaveFailureText,
  chapterSaveRejectionText,
  closedAtLabel,
  compactTokenLabel,
  entryRangeLabel,
  fullTokenLabel,
  timelineHeader,
} from './chapter-copy'

describe('compactTokenLabel', () => {
  it('reads a count under a thousand as the integer', () => {
    expect(compactTokenLabel(840)).toBe('840 tok')
    expect(compactTokenLabel(999)).toBe('999 tok')
    expect(compactTokenLabel(0)).toBe('0 tok')
  })

  it('reads thousands to one decimal, rounding half up and dropping a trailing .0', () => {
    expect(compactTokenLabel(12400)).toBe('12.4k tok')
    expect(compactTokenLabel(12000)).toBe('12k tok')
    expect(compactTokenLabel(1000)).toBe('1k tok')
    // toFixed(1) would give 12.4 here (12.45 is stored just below), and keep 12000's `.0`.
    expect(compactTokenLabel(12450)).toBe('12.5k tok')
  })
})

describe('fullTokenLabel', () => {
  it('groups the full count', () => {
    expect(fullTokenLabel(12400)).toBe('12,400 tok')
    expect(fullTokenLabel(840)).toBe('840 tok')
  })
})

describe('chapterSaveRejectionText', () => {
  it.each([
    ['in-flight', "Can't save while generation is running"],
    ['not-found', 'This chapter no longer exists'],
    ['failed', "Couldn't save the chapter"],
  ] as const)('gives %s its own text', (code, text) => {
    expect(chapterSaveRejectionText(code)).toBe(text)
  })

  it('reads a thrown save as the failed text', () => {
    expect(chapterSaveFailureText()).toBe("Couldn't save the chapter")
  })
})

describe('chapterIssueText', () => {
  it('translates each draft issue and passes any other message through', () => {
    expect(chapterIssueText('titleRequired')).toBe("Title can't be empty")
    expect(chapterIssueText('summaryRequired')).toBe("Summary can't be empty")
    expect(chapterIssueText('Invalid input')).toBe('Invalid input')
  })
})

describe('chapterFieldLabel', () => {
  it("names each draft field and passes an unknown one through, the prototype's included", () => {
    expect(chapterFieldLabel('title')).toBe('Title')
    expect(chapterFieldLabel('theme')).toBe('Theme')
    expect(chapterFieldLabel('summary')).toBe('Summary')
    expect(chapterFieldLabel('keywords')).toBe('Keywords')
    expect(chapterFieldLabel('tokenCount')).toBe('tokenCount')
    expect(chapterFieldLabel('toString')).toBe('toString')
  })
})

describe('card and header copy', () => {
  it('heads a card with its number and title', () => {
    expect(chapterHeading(2, 'The Keep Leans Closer')).toBe('Chapter 2 — The Keep Leans Closer')
  })

  it('counts the closed chapters, always with one in progress', () => {
    expect(timelineHeader(0)).toBe('Chapters · 0 closed + 1 in progress')
    expect(timelineHeader(2)).toBe('Chapters · 2 closed + 1 in progress')
  })

  it('reads an entry range with an en dash', () => {
    expect(entryRangeLabel({ first: 12, last: 34 })).toBe('entries 12–34')
  })

  it('reads a single-entry chapter as one entry', () => {
    expect(entryRangeLabel({ first: 12, last: 12 })).toBe('entry 12')
  })

  it('reads closed_at as a date with its year and time', () => {
    // Local time, so the expectation holds in any timezone.
    expect(closedAtLabel(new Date(2026, 2, 14, 9, 5).getTime())).toBe('closed 14 Mar 2026, 09:05')
  })
})
