import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersions, isNewerVersion } from './version'

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('accepts the v prefix that release tags carry', () => {
    expect(parseVersion('v0.7.6')).toEqual({ major: 0, minor: 7, patch: 6, prerelease: [] })
  })

  it('splits pre-release identifiers on dots', () => {
    expect(parseVersion('v1.0.0-pre.2')?.prerelease).toEqual(['pre', '2'])
  })

  it('discards build metadata', () => {
    expect(parseVersion('1.0.0+20260808')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion('  1.0.0 ')?.major).toBe(1)
  })

  it.each(['', 'latest', '1.2', '1.2.3.4', 'v1.2.x', 'nightly-2026-08-08'])(
    'returns null for %o',
    (input) => {
      expect(parseVersion(input)).toBeNull()
    },
  )
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.1.2', '1.1.3')).toBeLessThan(0)
  })

  it('compares numerically, not lexically', () => {
    // The whole reason this module exists: '0.10.0' < '0.9.0' as strings.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })

  it('treats equal versions as equal regardless of the v prefix', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a stable release above its own pre-release', () => {
    expect(compareVersions('1.0.0', '1.0.0-pre.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-pre.1', '1.0.0')).toBeLessThan(0)
  })

  it('orders pre-release numbers numerically', () => {
    expect(compareVersions('1.0.0-pre.10', '1.0.0-pre.9')).toBeGreaterThan(0)
  })

  it('ranks a numeric identifier below an alphanumeric one', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
  })

  it('treats a longer identifier list as the later release when the prefix matches', () => {
    expect(compareVersions('1.0.0-pre.1.1', '1.0.0-pre.1')).toBeGreaterThan(0)
  })

  it('throws rather than guessing an order for an unreadable version', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow(/Unparseable/)
    expect(() => compareVersions('1.0.0', 'latest')).toThrow(/Unparseable/)
  })
})

describe('isNewerVersion', () => {
  it('is true only for a strictly greater candidate', () => {
    expect(isNewerVersion('0.7.7', '0.7.6')).toBe(true)
    expect(isNewerVersion('0.7.6', '0.7.6')).toBe(false)
    expect(isNewerVersion('0.7.5', '0.7.6')).toBe(false)
  })

  it('does not offer a pre-release as an upgrade over the matching stable', () => {
    expect(isNewerVersion('1.0.0-pre.1', '1.0.0')).toBe(false)
  })

  it('is false when either side is unparseable, so a bad tag cannot nag on every startup', () => {
    expect(isNewerVersion('nightly', '0.7.6')).toBe(false)
    expect(isNewerVersion('0.8.0', 'unknown')).toBe(false)
  })
})
