import { describe, it, expect, vi, afterEach } from 'vitest'
import { compareVersions, validateExport, logVersionCompatibilityWarnings } from './validate'
import { EXPORT_FORMAT_VERSION } from './types'
import type { AventuraExport } from './types'

/**
 * The import path's first gate. Everything downstream -- the id remapping, the native image
 * streaming in `avt_import.rs` -- assumes it was handed a file of the shape declared here, so
 * a rejection that does not happen is a crash somewhere less legible.
 */

/** Minimal object that passes `validateExport`; tests narrow it per case. */
function validExport(overrides: Partial<AventuraExport> = {}): AventuraExport {
  return {
    version: '1.8.0',
    story: { id: 's1' },
    entries: [{ id: 'e1' }],
    ...overrides,
  } as AventuraExport
}

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
  })

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.8.0', '1.8.0')).toBe(0)
  })

  it('treats a missing segment as zero', () => {
    // '1.8' and '1.8.0' name the same format; the feature table is written with three
    // segments and files in the wild are not guaranteed to be.
    expect(compareVersions('1.8', '1.8.0')).toBe(0)
    expect(compareVersions('1.8', '1.8.1')).toBeLessThan(0)
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
  })

  it('still orders a pre-release correctly when major or minor decides it', () => {
    // The project ships pre-release builds (`ci.yml` tags `vX.Y.Z-pre.N`), so files carrying
    // such a version do reach the importer. `'1.9.0-pre.1'.split('.').map(Number)` is
    // `[1, 9, NaN, 1]`, but the loop returns at the first differing segment, so the NaN is
    // never reached whenever an earlier segment already answers the question.
    expect(compareVersions('1.9.0-pre.1', '1.8.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-pre.1', '1.8.0')).toBeLessThan(0)
  })

  it('returns NaN when a pre-release is the only thing separating two versions', () => {
    // The one case the loop cannot answer early: major and minor match, so it reaches the
    // segment holding the `-pre` suffix and compares `NaN !== 0`. Every ordering test against
    // the result is then false, which means `logVersionCompatibilityWarnings` treats the file
    // as "not older" -- the same conclusion a correct comparison reaches here, so nothing
    // observable is wrong today. It is pinned because the value is a landmine for any future
    // caller that branches on `> 0` as well as `< 0`.
    expect(Number.isNaN(compareVersions('1.8.0-pre.1', '1.8.0'))).toBe(true)
  })
})

describe('validateExport', () => {
  it('accepts a well-formed export', () => {
    expect(validateExport(validExport())).toBeNull()
  })

  it.each([
    ['version', { version: undefined }],
    ['story', { story: undefined }],
    ['entries', { entries: undefined }],
  ])('rejects a file with no %s', (_field, override) => {
    const message = validateExport(validExport(override as Partial<AventuraExport>))
    expect(message).toContain('does not appear to be an Aventura story file')
  })

  it('rejects a file whose entry list is empty', () => {
    // Distinct from the shape error above: the file is a valid export, it just has no story
    // in it, and importing it would create an empty story the user then has to find and delete.
    const message = validateExport(validExport({ entries: [] }))
    expect(message).toContain('no story entries')
  })

  it('accepts a file that records no pack at all', () => {
    // Every file written before v1.9.0. It must stay an ordinary import, not an invalid file.
    expect(validateExport(validExport({ packBinding: undefined }))).toBeNull()
  })

  it.each([
    ['a non-object', 'not-a-binding'],
    ['no pack identity', {}],
    ['a nameless pack', { pack: {} }],
    ['definitions of the wrong type', { pack: { name: 'P', author: 'A' }, variables: 'nope' }],
  ])('accepts a file whose packBinding is %s', (_label, packBinding) => {
    // packBinding is advisory: a malformed one degrades to "unknown pack" downstream, where the
    // user picks (or the auto-matcher falls back). Rejecting the file would cost the user their
    // whole story over a field that only decides which templates narrate it.
    expect(validateExport(validExport({ packBinding } as Partial<AventuraExport>))).toBeNull()
  })
})

describe('logVersionCompatibilityWarnings', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns once per feature the file predates', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings('1.5.0')
    // Predates 1.6.0, 1.7.0, 1.8.0 and 1.9.0; carries everything up to and including 1.5.0.
    expect(warn).toHaveBeenCalledTimes(4)
    expect(warn.mock.calls.map(String).join('\n')).toContain('branching data')
  })

  it('says nothing about a file at the current format version', () => {
    // Written against the constant, not a literal: a version bump whose FEATURE_HISTORY arm was
    // forgotten makes this app stamp its own exports as older than their contents, so every
    // re-import of a file it just wrote warns about a feature the file actually carries.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings(EXPORT_FORMAT_VERSION)
    expect(warn).not.toHaveBeenCalled()
  })

  it('says nothing about a file newer than anything it knows about', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings('2.0.0')
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn about a missing pack binding when an older sync payload carries one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings({
      version: '1.7.0',
      packBinding: { pack: { name: 'Grimdark', author: 'Ada' } },
    })

    expect(warn.mock.calls.map(String).join('\n')).not.toContain('prompt pack information')
  })

  it('warns when an older payload carries a malformed pack binding', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings({ version: '1.7.0', packBinding: {} as never })

    expect(warn.mock.calls.map(String).join('\n')).toContain('prompt pack information')
  })

  it('warns about every feature for the oldest possible file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logVersionCompatibilityWarnings('1.0.0')
    expect(warn).toHaveBeenCalledTimes(9)
  })
})
