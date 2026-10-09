import { describe, expect, it } from 'vitest'
import { accessibleName } from './accessibleName'

const base = {
  ariaLabel: undefined,
  size: 'default',
  isResponsive: false,
  label: undefined,
  title: undefined,
}

describe('accessibleName', () => {
  it('names an icon-sized button from its title', () => {
    expect(accessibleName({ ...base, size: 'icon', title: 'Refresh gallery' })).toBe(
      'Refresh gallery',
    )
  })

  it('names a responsive button from its label before its title', () => {
    expect(
      accessibleName({ ...base, isResponsive: true, label: 'Save', title: 'Save all images' }),
    ).toBe('Save')
  })

  it('falls back to the title when a responsive button has no label', () => {
    expect(accessibleName({ ...base, isResponsive: true, title: 'Open menu' })).toBe('Open menu')
  })

  it('leaves a plain button to its own text', () => {
    expect(accessibleName({ ...base, label: 'Save', title: 'Save all images' })).toBeUndefined()
    expect(accessibleName({ ...base, title: 'Save all images' })).toBeUndefined()
  })

  it('names nothing when there is no label or title to use', () => {
    expect(accessibleName({ ...base, size: 'icon' })).toBeUndefined()
    expect(accessibleName({ ...base, isResponsive: true })).toBeUndefined()
  })

  it("keeps the caller's own aria-label over the derived name", () => {
    expect(accessibleName({ ...base, ariaLabel: 'Copy entry', size: 'icon', title: 'Copy' })).toBe(
      'Copy entry',
    )
    expect(accessibleName({ ...base, ariaLabel: 'Copy entry', title: 'Copy' })).toBe('Copy entry')
  })
})
