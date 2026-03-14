import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { allSamples } from './sampleContext'

describe.each(PROMPT_TEMPLATES)('$id template renders with allSamples', (template) => {
  it('content field renders non-empty without [object Object] or undefined', () => {
    const result = templateEngine.render(template.content, allSamples)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('undefined')
  })

  if (template.userContent) {
    it('userContent field renders without [object Object] or undefined', () => {
      const result = templateEngine.render(template.userContent!, allSamples)
      expect(result).not.toBeNull()
      expect(result).not.toContain('[object Object]')
      expect(result).not.toContain('undefined')
    })
  }
})
