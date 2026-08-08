import { describe, it, expect } from 'vitest'
import { bumpVersion, isValidVersion, parseVersion, compareVersions } from './version.js'

describe('bumpVersion', () => {
  it('bumps a stable version', () => {
    expect(bumpVersion('0.7.6', 'patch')).toBe('0.7.7')
    expect(bumpVersion('0.7.6', 'minor')).toBe('0.8.0')
    expect(bumpVersion('0.7.6', 'major')).toBe('1.0.0')
  })

  it('promotes a pre-release that already sits at the level being bumped', () => {
    expect(bumpVersion('0.7.6-pre.1', 'patch')).toBe('0.7.6')
    expect(bumpVersion('0.8.0-pre.1', 'minor')).toBe('0.8.0')
    expect(bumpVersion('1.0.0-pre.1', 'major')).toBe('1.0.0')
  })

  it('never moves backwards from a pre-release', () => {
    expect(bumpVersion('0.7.6-pre.1', 'minor')).toBe('0.8.0')
    expect(bumpVersion('0.7.6-pre.1', 'major')).toBe('1.0.0')
  })

  it('moves the patch before starting a pre-release from a stable version', () => {
    // The alternative sorts before the version already shipped: an offered downgrade.
    expect(bumpVersion('0.7.6', 'prerelease')).toBe('0.7.7-pre.1')
    expect(compareVersions(bumpVersion('0.7.6', 'prerelease'), '0.7.6')).toBeGreaterThan(0)
  })

  it('counts up within a pre-release series', () => {
    expect(bumpVersion('0.7.7-pre.1', 'prerelease')).toBe('0.7.7-pre.2')
    expect(bumpVersion('0.7.7-pre.9', 'prerelease')).toBe('0.7.7-pre.10')
  })

  it('every bump type produces a version strictly greater than its input', () => {
    const inputs = ['0.0.0', '0.7.6', '1.0.0', '0.7.6-pre.1', '0.8.0-pre.2', '1.0.0-pre.1']
    for (const from of inputs) {
      for (const type of ['major', 'minor', 'patch', 'prerelease']) {
        const to = bumpVersion(from, type)
        expect(
          compareVersions(to, from),
          `${from} + ${type} produced ${to}, which does not follow it`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('passes a literal version straight through', () => {
    expect(bumpVersion('0.7.6', '1.2.3')).toBe('1.2.3')
  })

  it('returns undefined when no type was given, which the caller reports as usage', () => {
    expect(bumpVersion('0.7.6', undefined)).toBeUndefined()
  })
})

describe('isValidVersion', () => {
  it('accepts the two shapes the release workflows build', () => {
    expect(isValidVersion('0.7.6')).toBe(true)
    expect(isValidVersion('0.7.6-pre.1')).toBe(true)
    expect(isValidVersion('10.20.30')).toBe(true)
  })

  it('rejects a pre-release shape no workflow would build', () => {
    expect(isValidVersion('1.2.3-beta.1')).toBe(false)
    expect(isValidVersion('1.2.3-pre')).toBe(false)
  })

  it('rejects anything that is not a version', () => {
    expect(isValidVersion('banana')).toBe(false)
    expect(isValidVersion('; rm -rf /')).toBe(false)
    expect(isValidVersion('1.2')).toBe(false)
    expect(isValidVersion('v1.2.3')).toBe(false)
    expect(isValidVersion('')).toBe(false)
    expect(isValidVersion(undefined)).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders a pre-release before the version it leads to', () => {
    expect(compareVersions('0.7.6-pre.1', '0.7.6')).toBeLessThan(0)
    expect(compareVersions('0.7.6', '0.7.6-pre.1')).toBeGreaterThan(0)
  })

  it('orders a pre-release series numerically, not as text', () => {
    expect(compareVersions('0.7.6-pre.9', '0.7.6-pre.10')).toBeLessThan(0)
  })

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('0.8.0', '0.7.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.7.6', '0.7.6')).toBe(0)
  })

  it('refuses to compare something it cannot parse', () => {
    expect(() => compareVersions('banana', '0.7.6')).toThrow()
  })
})

describe('parseVersion', () => {
  it('returns null rather than a half-parsed object', () => {
    expect(parseVersion('banana')).toBeNull()
  })

  it('distinguishes no pre-release from pre-release zero', () => {
    expect(parseVersion('0.7.6').pre).toBeNull()
    expect(parseVersion('0.7.6-pre.0').pre).toBe(0)
  })
})
