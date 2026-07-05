import { describe, expect, it } from 'vitest'

import { createHtmlStreamBuffer } from './stream-buffer'

describe('createHtmlStreamBuffer', () => {
  it('renders plain text chunks immediately', () => {
    const buf = createHtmlStreamBuffer()
    expect(buf.push('Hello ')).toBe('Hello ')
    expect(buf.push('world')).toBe('Hello world')
  })

  it('withholds a half-open tag until the closing bracket arrives', () => {
    const buf = createHtmlStreamBuffer()
    const afterFirst = buf.push('a <em')
    expect(afterFirst).toBe('a ')
    expect(afterFirst).not.toContain('<em')
    const afterSecond = buf.push('>b</em>')
    expect(afterSecond).toBe('a <em>b</em>')
  })

  it('never emits a broken fragment across many small chunks', () => {
    const buf = createHtmlStreamBuffer()
    const chunks = ['<', 'st', 'ro', 'ng', '>', 'x', '<', '/', 'st', 'rong', '>']
    let last = ''
    for (const c of chunks) {
      const out = buf.push(c)
      expect(out.startsWith(last) || last.startsWith(out)).toBe(true) // monotonic, no flicker
      last = out
    }
    expect(last).toBe('<strong>x</strong>')
  })

  it('flush() returns any remaining buffered content as-is', () => {
    const buf = createHtmlStreamBuffer()
    buf.push('trailing <e')
    expect(buf.flush()).toBe('trailing <e')
  })

  it('renders a literal < in prose immediately (not a tag-start)', () => {
    const buf = createHtmlStreamBuffer()
    expect(buf.push('the count was < 10, ok')).toBe('the count was < 10, ok')
  })

  it('withholds a quoted > inside an attribute value until the tag truly closes', () => {
    const buf = createHtmlStreamBuffer()
    // The '>' here is data inside the still-open href quote, not the tag close.
    expect(buf.push('<a href="x>y')).toBe('')
    expect(buf.push('">done</a>')).toBe('<a href="x>y">done</a>')
  })
})
