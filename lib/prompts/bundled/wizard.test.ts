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

  it('carries the authored genre and tone bodies into the opening call', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: {
        mode: 'creative',
        setting: '',
        genre: { promptBody: 'Write it as hard sci-fi, terse and technical.' },
        tone: { promptBody: 'Keep it clinical and understated.' },
      },
    })
    expect(out).toContain('Write it as hard sci-fi, terse and technical.')
    expect(out).toContain('Keep it clinical and understated.')
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

describe('WIZARD_GENRE', () => {
  it('renders setting and tone when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, {
      definition: { setting: 'A drowned coast', tone: { promptBody: 'Write it grim.' } },
      guidance: '',
    })
    expect(out).toContain('Setting: A drowned coast')
    expect(out).toContain('Tone: Write it grim.')
  })

  it('omits setting and tone blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, { definition: {}, guidance: '' })
    expect(out).not.toContain('Setting:')
    expect(out).not.toContain('Tone:')
  })

  it('asks for both a short label and a substantial body', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, { definition: {}, guidance: '' })
    expect(out.toLowerCase()).toContain('label')
    expect(out.toLowerCase()).toContain('promptbody')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    })
    expect(out).not.toContain('The Old Empire')
    expect(out).not.toContain('World reference')
  })
})

describe('WIZARD_TONE', () => {
  it('renders setting and genre when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: { setting: 'A drowned coast', genre: { promptBody: 'Hard sci-fi rules.' } },
      guidance: '',
    })
    expect(out).toContain('Setting: A drowned coast')
    expect(out).toContain('Genre: Hard sci-fi rules.')
  })

  it('omits setting and genre blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, { definition: {}, guidance: '' })
    expect(out).not.toContain('Setting:')
    expect(out).not.toContain('Genre:')
  })

  it('asks for both a short label and a substantial body', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, { definition: {}, guidance: '' })
    expect(out.toLowerCase()).toContain('label')
    expect(out.toLowerCase()).toContain('promptbody')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    })
    expect(out).not.toContain('The Old Empire')
    expect(out).not.toContain('World reference')
  })
})

describe('WIZARD_SETTING', () => {
  it('renders genre and tone when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardSetting, {
      definition: {
        genre: { promptBody: 'Hard sci-fi rules.' },
        tone: { promptBody: 'Write it grim.' },
      },
      guidance: '',
    })
    expect(out).toContain('Genre: Hard sci-fi rules.')
    expect(out).toContain('Tone: Write it grim.')
  })

  it('omits genre and tone blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardSetting, { definition: {}, guidance: '' })
    expect(out).not.toContain('Genre:')
    expect(out).not.toContain('Tone:')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardSetting, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    })
    expect(out).not.toContain('The Old Empire')
    expect(out).not.toContain('World reference')
  })
})
