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
})
