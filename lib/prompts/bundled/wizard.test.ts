import { describe, expect, it } from 'vitest'

import { renderTemplate } from '@/lib/prompts'
import { TEMPLATE_IDS } from '@/lib/prompts/ids'

const leadCtx = {
  definition: {
    mode: 'adventure',
    setting: '',
    genre: { promptBody: '' },
    tone: { promptBody: '' },
  },
  lead: { name: 'Aria' },
}
const leadlessCtx = {
  definition: {
    mode: 'creative',
    setting: '',
    genre: { promptBody: '' },
    tone: { promptBody: '' },
  },
}

describe('WIZARD_OPENING template', () => {
  it('instructs the JSON fields (prose, sceneEntities, currentLocationId, worldTime)', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx)
    expect(out).toContain('prose')
    expect(out).toContain('sceneEntities')
    expect(out).toContain('currentLocationId')
    expect(out).toContain('worldTime')
    expect(out.toLowerCase()).toContain('json') // from macro_output_format_json ("single JSON object")
  })

  it('names the lead when present', () => {
    expect(renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx)).toContain('Aria')
  })

  it('does NOT reference a lead on the lead-less path and has no "undefined"', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx)
    expect(out).not.toContain('undefined')
    expect(out).not.toMatch(/lead character is/i)
  })
})

describe('WIZARD_DESCRIPTION template', () => {
  it('asks for a synopsis/description and emits JSON, not next-beat narrative', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardDescription, { opening: 'Once upon a time.' })
    expect(out.toLowerCase()).toMatch(/description|synopsis|log line|log-line/)
    // must NOT include the narrative next-beat macro text:
    expect(out.toLowerCase()).not.toContain('next beat')
  })
})
