import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { getSamplesForTemplate } from './sampleContext'

describe.each(PROMPT_TEMPLATES)('$id template renders with samples', (template) => {
  it('content field renders non-empty without [object Object] or undefined', () => {
    const samples = getSamplesForTemplate(template.id)
    const result = templateEngine.render(template.content, samples)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('undefined')
  })

  if (template.userContent) {
    it('userContent field renders without [object Object] or undefined', () => {
      const samples = getSamplesForTemplate(template.id)
      const result = templateEngine.render(template.userContent!, samples)
      expect(result).not.toBeNull()
      expect(result).not.toContain('[object Object]')
      expect(result).not.toContain('undefined')
    })
  }
})
