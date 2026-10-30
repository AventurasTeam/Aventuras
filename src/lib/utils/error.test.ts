import { describe, it, expect } from 'vitest'
import { errorSummary } from './error'

describe('errorSummary', () => {
  it('returns a single short line unchanged', () => {
    expect(errorSummary('Image API error 401: bad key')).toBe('Image API error 401: bad key')
  })

  it('keeps only the first line of a multi-line message', () => {
    expect(errorSummary('Image API error 502: <html>\n<body>Bad gateway</body>\n</html>')).toBe(
      'Image API error 502: <html>',
    )
  })

  it('skips blank leading lines', () => {
    expect(errorSummary('\n  \n  boom  \nmore')).toBe('boom')
  })

  it('cuts a long line to the limit, ending in an ellipsis', () => {
    const summary = errorSummary('x'.repeat(500), 200)
    expect(summary).toHaveLength(200)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('gives an empty string for blank text', () => {
    expect(errorSummary(' \n ')).toBe('')
  })
})
