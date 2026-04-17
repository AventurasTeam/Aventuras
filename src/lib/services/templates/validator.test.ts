import { describe, it, expect } from 'vitest'
import { validateTemplate } from './validator'

describe('validateTemplate — templateId parameter', () => {
  it('accepts variables that belong to the mapped context group', () => {
    const result = validateTemplate('Hello {{ protagonistName }}', 'adventure')
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags variables that do not belong to the mapped context group', () => {
    const result = validateTemplate('{{ bogusVariable }}', 'adventure')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.type === 'unknown_variable')).toBe(true)
  })

  it('emits a single warning for an unmapped templateId and skips per-variable errors', () => {
    const result = validateTemplate('{{ anything }} {{ else }}', 'does-not-exist')
    const warnings = result.errors.filter((e) => e.severity === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('does-not-exist')
    // Template still considered valid because the issue is a warning, not an error.
    expect(result.valid).toBe(true)
  })

  it('seeds namespaced roots so dotted access resolves (packVariables.foo)', () => {
    const result = validateTemplate('{{ packVariables.runtimeVariables.anything }}', 'adventure', [
      'packVariables.runtimeVariables',
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('without templateId, only additionalVariables are considered valid', () => {
    const unknown = validateTemplate('{{ freeVar }}')
    expect(unknown.valid).toBe(false)

    const passed = validateTemplate('{{ freeVar }}', undefined, ['freeVar'])
    expect(passed.valid).toBe(true)
  })
})
