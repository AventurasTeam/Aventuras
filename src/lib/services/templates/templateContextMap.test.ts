import { describe, it, expect } from 'vitest'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import {
  getContextGroup,
  getDisplayGroupsForTemplate,
  getVariableNamesForTemplate,
  getVariablesForTemplate,
  validateContextMapIntegrity,
} from './templateContextMap'

describe('templateContextMap integrity', () => {
  const report = validateContextMapIntegrity(PROMPT_TEMPLATES.map((t) => t.id))

  it('every loaded PROMPT_TEMPLATES id has a mapped context group', () => {
    expect(report.unmappedTemplateIds).toEqual([])
  })

  it('every display-group variable name exists in the group VARS list', () => {
    expect(report.orphanedDisplayVariables).toEqual([])
  })

  it('unmapped templateId returns null / empty collections', () => {
    expect(getContextGroup('does-not-exist')).toBeNull()
    expect(getVariablesForTemplate('does-not-exist')).toEqual([])
    expect(getDisplayGroupsForTemplate('does-not-exist')).toEqual([])
    expect(getVariableNamesForTemplate('does-not-exist')).toEqual([])
  })

  it('known templateId resolves to its group with non-empty variables', () => {
    expect(getContextGroup('adventure')).toBe('promptContext')
    expect(getVariablesForTemplate('adventure').length).toBeGreaterThan(0)
    expect(getDisplayGroupsForTemplate('adventure').length).toBeGreaterThan(0)
  })
})
