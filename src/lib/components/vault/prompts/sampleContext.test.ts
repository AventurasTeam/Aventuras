import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { getContextGroup } from '$lib/services/templates/templateContextMap'
import { getSamplesForTemplate } from './sampleContext'

function hasVariableReferences(template: string): boolean {
  return /\{\{\s*\w/.test(template)
}

describe.each(PROMPT_TEMPLATES)('$id template renders with samples', (template) => {
  // staticContent partials (e.g. image-style-*) are variable-less by design —
  // rendering returns the same string, so the "substitution happened" check
  // doesn't apply to them.
  const isStaticContent = getContextGroup(template.id) === 'staticContent'

  it('content field renders non-empty without [object Object] or undefined', () => {
    const samples = getSamplesForTemplate(template.id)
    const result = templateEngine.render(template.content, samples)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('undefined')

    // Guard against silent regressions where samples shrink to {} or variables
    // are renamed: if the template references a variable, at least one must
    // have actually been substituted (rendered output differs from the raw).
    if (!isStaticContent && hasVariableReferences(template.content)) {
      expect(result).not.toBe(template.content)
    }
  })

  if (template.userContent) {
    it('userContent field renders without [object Object] or undefined', () => {
      const samples = getSamplesForTemplate(template.id)
      const result = templateEngine.render(template.userContent!, samples)
      expect(result).not.toBeNull()
      expect(result).not.toContain('[object Object]')
      expect(result).not.toContain('undefined')

      if (!isStaticContent && hasVariableReferences(template.userContent!)) {
        expect(result).not.toBe(template.userContent!)
      }
    })
  }
})
