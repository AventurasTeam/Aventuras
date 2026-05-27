import { describe, expect, it } from 'vitest'

import {
  flattenIssues,
  getReadErrorCopy,
  joinIssuePath,
  parseEnvelope,
  truncateMessage,
  truncatePath,
  EmptyClipboardError,
} from './import-dialog-pipeline'

const STORY_FORMAT = 'aventuras-story'
const CALENDAR_FORMAT = 'aventuras-calendar'
const STORY_KEY = 'story'

function envelope(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    format: STORY_FORMAT,
    formatVersion: '1.0',
    [STORY_KEY]: { title: 'Untitled' },
    ...overrides,
  })
}

describe('parseEnvelope', () => {
  it('returns the payload sub-object on a well-formed envelope', () => {
    const result = parseEnvelope({
      raw: envelope(),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({ kind: 'ok', payload: { title: 'Untitled' } })
  })

  it('flags non-JSON input as an invalid-JSON meta-error', () => {
    const result = parseEnvelope({
      raw: 'not json {',
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({ kind: 'error', copy: '⚠ This file isn’t valid JSON.' })
  })

  it('flags an array root as invalid JSON (envelope must be a plain object)', () => {
    const result = parseEnvelope({
      raw: '[1,2,3]',
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({ kind: 'error', copy: '⚠ This file isn’t valid JSON.' })
  })

  it('flags missing format as not-an-Aventuras-file', () => {
    const result = parseEnvelope({
      raw: JSON.stringify({ hello: 'world' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({ kind: 'error', copy: '⚠ This isn’t an Aventuras file.' })
  })

  it('flags non-aventuras format prefix as not-an-Aventuras-file', () => {
    const result = parseEnvelope({
      raw: JSON.stringify({ format: 'something-else', formatVersion: '1.0' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({ kind: 'error', copy: '⚠ This isn’t an Aventuras file.' })
  })

  it('flags format mismatch with both expected + got values in the copy', () => {
    const result = parseEnvelope({
      raw: envelope({ format: CALENDAR_FORMAT }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.copy).toContain(STORY_FORMAT)
    expect(result.copy).toContain(CALENDAR_FORMAT)
  })

  it('enforces case-sensitive format match', () => {
    const result = parseEnvelope({
      raw: envelope({ format: 'Aventuras-Story' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    // 'Aventuras-Story' doesn't start with 'aventuras-' (case-sensitive),
    // so it falls into the not-an-Aventuras-file branch rather than mismatch.
    expect(result).toEqual({ kind: 'error', copy: '⚠ This isn’t an Aventuras file.' })
  })

  it('rejects single-component or v-prefixed versions', () => {
    for (const bad of ['1', '1.0.0', 'v1.0', '', 'major.minor']) {
      const result = parseEnvelope({
        raw: envelope({ formatVersion: bad }),
        format: STORY_FORMAT,
        supportedMajor: 1,
        payloadKey: STORY_KEY,
      })
      expect(result).toEqual({ kind: 'error', copy: '⚠ This file is missing version information.' })
    }
  })

  it('flags older-major as older-version meta-error', () => {
    const result = parseEnvelope({
      raw: envelope({ formatVersion: '0.9' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({
      kind: 'error',
      copy: '⚠ This file is from an older version of Aventuras.',
    })
  })

  it('flags newer-major as newer-version meta-error', () => {
    const result = parseEnvelope({
      raw: envelope({ formatVersion: '2.0' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({
      kind: 'error',
      copy: '⚠ This file is from a newer version. Update Aventuras to import.',
    })
  })

  it('accepts higher-minor on the supported major (forward-compat strip behavior)', () => {
    const result = parseEnvelope({
      raw: envelope({ formatVersion: '1.5' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result.kind).toBe('ok')
  })

  it('flags missing payload key with the key name in the copy', () => {
    const result = parseEnvelope({
      raw: JSON.stringify({ format: STORY_FORMAT, formatVersion: '1.0' }),
      format: STORY_FORMAT,
      supportedMajor: 1,
      payloadKey: STORY_KEY,
    })
    expect(result).toEqual({
      kind: 'error',
      copy: '⚠ This file is missing its story data.',
    })
  })
})

describe('joinIssuePath', () => {
  it('joins string keys with dots', () => {
    expect(joinIssuePath(['calendar', 'eras'])).toBe('calendar.eras')
  })

  it('wraps numeric indices in brackets without leading dot', () => {
    expect(joinIssuePath(['calendar', 'units', 0, 'name'])).toBe('calendar.units[0].name')
  })

  it('handles a leading numeric index without a leading dot', () => {
    expect(joinIssuePath([0, 'name'])).toBe('[0].name')
  })

  it('returns empty string on an empty path', () => {
    expect(joinIssuePath([])).toBe('')
  })
})

describe('truncatePath', () => {
  it('passes paths shorter than the cap through unchanged', () => {
    expect(truncatePath('calendar.eras', 40)).toBe('calendar.eras')
  })

  it('middle-elides long paths preserving head + tail', () => {
    const long = 'calendar.units[0].name.subfield.deeplyNestedField'
    const out = truncatePath(long, 20)
    expect(out.length).toBe(20)
    expect(out).toContain('…')
    expect(out.startsWith('calendar')).toBe(true)
    expect(out.endsWith('Field')).toBe(true)
  })
})

describe('truncateMessage', () => {
  it('passes short messages through', () => {
    expect(truncateMessage('required', 80)).toBe('required')
  })

  it('tail-elides long messages', () => {
    const long = 'a'.repeat(200)
    const out = truncateMessage(long, 80)
    expect(out.length).toBe(80)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('flattenIssues', () => {
  it('drops symbol-typed path segments (zod internal sentinels)', () => {
    const issues = [{ path: ['calendar', Symbol('weird'), 'name'], message: 'required' }]
    const out = flattenIssues(issues)
    expect(out[0]?.path).toBe('calendar.name')
  })

  it('applies path + message truncation in one pass', () => {
    const issues = [
      {
        path: ['root', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'leaf'],
        message: 'x'.repeat(100),
      },
    ]
    const out = flattenIssues(issues)
    expect(out[0]?.path.length).toBeLessThanOrEqual(40)
    expect(out[0]?.message.length).toBeLessThanOrEqual(80)
  })
})

describe('getReadErrorCopy', () => {
  it('returns the file-read copy for the file source', () => {
    expect(getReadErrorCopy('file', new Error('I/O'))).toBe('⚠ Could not read file.')
  })

  it('returns the empty-clipboard copy when the sentinel is thrown', () => {
    expect(getReadErrorCopy('clipboard', new EmptyClipboardError())).toBe('⚠ Clipboard is empty.')
  })

  it('returns access-denied for generic clipboard failures', () => {
    expect(getReadErrorCopy('clipboard', new Error('permission'))).toBe(
      '⚠ Clipboard access denied.',
    )
  })
})
