import { describe, it, expect } from 'vitest'
import { classifyTemplate, classifyTemplates } from './staleness'

const SHIPPED = 'shipped-hash'

function row(templateId: string, contentHash: string, baselineHash: string) {
  return { templateId, contentHash, baselineHash }
}

describe('classifyTemplate', () => {
  it('reads an untouched row as current', () => {
    expect(classifyTemplate(row('adventure', SHIPPED, SHIPPED), SHIPPED)).toBe('current')
  })

  it('reads an edited row whose baseline is the shipped text as customised', () => {
    expect(classifyTemplate(row('adventure', 'mine', SHIPPED), SHIPPED)).toBe('customised')
  })

  it('reads an edited row whose baseline predates the shipped text as behind', () => {
    expect(classifyTemplate(row('adventure', 'mine', 'older-shipped'), SHIPPED)).toBe('behind')
  })

  it('still reads as behind after a second edit', () => {
    // Only a baseline write moves baselineHash, and the refresh never touches an edited row,
    // so it stays pinned to the shipped text the user first diverged from.
    expect(classifyTemplate(row('adventure', 'mine-again', 'older-shipped'), SHIPPED)).toBe(
      'behind',
    )
  })

  it('reads a row with no baseline as customised, not behind', () => {
    // Nothing shipped is newer than a row the app never supplied, so the `behind` scope --
    // which promises to take only what the app has changed since -- must not overwrite it.
    expect(classifyTemplate(row('adventure', 'mine', ''), SHIPPED)).toBe('customised')
  })

  it('returns null for a template the app no longer ships', () => {
    expect(classifyTemplate(row('retired', 'mine', 'older'), undefined)).toBeNull()
  })

  it('reads an untouched row as current even before the startup refresh reaches it', () => {
    expect(classifyTemplate(row('adventure', 'older', 'older'), SHIPPED)).toBe('current')
  })
})

describe('classifyTemplates', () => {
  const shippedHashes = new Map([
    ['adventure', SHIPPED],
    ['adventure-user', SHIPPED],
    ['classifier', SHIPPED],
  ])

  it('splits the edited rows and drops the rest', () => {
    const result = classifyTemplates(
      [
        row('adventure', 'mine', 'older-shipped'),
        row('adventure-user', 'mine', SHIPPED),
        row('classifier', SHIPPED, SHIPPED),
      ],
      shippedHashes,
    )

    expect(result).toEqual({ behind: ['adventure'], customised: ['adventure-user'] })
  })

  it('keeps a row with no baseline out of the behind group', () => {
    const result = classifyTemplates([row('adventure', 'mine', '')], shippedHashes)

    expect(result).toEqual({ behind: [], customised: ['adventure'] })
  })

  it('excludes a row whose id the app no longer ships from both groups', () => {
    const result = classifyTemplates([row('retired', 'mine', 'older-shipped')], shippedHashes)

    expect(result).toEqual({ behind: [], customised: [] })
  })

  it('judges a user half independently of its system half', () => {
    const result = classifyTemplates(
      [row('adventure', SHIPPED, SHIPPED), row('adventure-user', 'mine', 'older-shipped')],
      shippedHashes,
    )

    expect(result).toEqual({ behind: ['adventure-user'], customised: [] })
  })
})
