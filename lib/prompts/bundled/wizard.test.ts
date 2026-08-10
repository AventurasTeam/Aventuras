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
  leadName: 'Aria',
  leadEntityId: 'c1',
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
  it('carries creative content only — no output-format directives (middleware-injected)', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx)
    expect(out).toContain('opening passage')
    // The JSON contract (field list + format directive) is injected at call
    // time by lib/ai's prompt-schema middleware, never baked into the pack.
    expect(out.toLowerCase()).not.toContain('json')
  })

  it('names the lead and its cast id when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx)
    expect(out).toContain('Aria')
    // The placeholder id must reach the prompt so a real model can echo it back
    // in sceneEntities — otherwise the idMap round-trip has nothing to resolve.
    expect(out).toContain('cast id: c1')
  })

  it('does NOT reference a lead or cast id on the lead-less path and has no "undefined"', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx)
    expect(out).not.toContain('undefined')
    expect(out).not.toMatch(/lead character is/i)
    expect(out).not.toContain('cast id:')
  })

  it('renders per-invocation guidance only when present', () => {
    expect(renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx)).not.toContain('guidance')
    const withGuidance = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      ...leadlessCtx,
      guidance: 'darker tone',
    })
    expect(withGuidance).toContain('Additional guidance: darker tone')
  })
})

describe('WIZARD_DESCRIPTION template', () => {
  it('asks for a synopsis/description, not next-beat narrative', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardDescription, {
      opening: { content: 'Once upon a time.' },
    })
    expect(out).toContain('Once upon a time.')
    expect(out.toLowerCase()).toMatch(/description|synopsis|log line|log-line/)
    // must NOT include the narrative next-beat macro text:
    expect(out.toLowerCase()).not.toContain('next beat')
  })
})

describe('WIZARD_OPENING lore block', () => {
  it('renders every authored row, uncapped', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      title: `Row ${i}`,
      body: `Body ${i}`,
    }))
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      lore: rows,
      leadEntityId: '',
      leadName: '',
      guidance: '',
    })
    expect(out).toContain('World reference:')
    expect(out).toContain('- Row 0: Body 0')
    expect(out).toContain('- Row 11: Body 11')
  })

  it('omits the block entirely when no lore is authored', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      lore: [],
      leadEntityId: '',
      leadName: '',
      guidance: '',
    })
    expect(out).not.toContain('World reference:')
  })

  it('does not throw and omits the block when lore is absent from the context entirely', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      leadEntityId: '',
      leadName: '',
      guidance: '',
    })
    expect(out).not.toContain('World reference:')
  })
})

describe('WIZARD_LORE', () => {
  it('lists already-written titles so the model does not repeat them', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardLore, {
      definition: { setting: 'A drowned coast', genre: {} },
      lore: [{ title: 'The Old Empire', body: 'ignored here' }],
      guidance: '',
    })
    expect(out).toContain('Already written (do not repeat these):')
    expect(out).toContain('- The Old Empire')
    expect(out, 'bodies stay out of the dedupe list').not.toContain('ignored here')
  })
})
