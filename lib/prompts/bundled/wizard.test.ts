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
  leadEntityId: 'c1',
  // wizardTemplateContext resolves `lead` from the cast row (activeLead).
  lead: { id: 'c1', name: 'Aria' },
  cast: [{ id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'active' }],
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
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx).user
    expect(out).toContain('opening passage')
    // The JSON contract (field list + format directive) is injected at call
    // time by lib/ai's prompt-schema middleware, never baked into the pack.
    expect(out.toLowerCase()).not.toContain('json')
  })

  it('names the lead and its cast id when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadCtx).user
    expect(out).toContain('Aria')
    // The placeholder id must reach the prompt so a real model can echo it back
    // in sceneEntities — otherwise the idMap round-trip has nothing to resolve.
    expect(out).toContain('cast id: c1')
  })

  it('does NOT reference a lead or cast id on the lead-less path and has no "undefined"', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx).user
    expect(out).not.toContain('undefined')
    expect(out).not.toMatch(/lead character is/i)
    expect(out).not.toContain('cast id:')
  })

  it('renders per-invocation guidance only when present', () => {
    expect(renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx).user).not.toContain('guidance')
    const withGuidance = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      ...leadlessCtx,
      guidance: 'darker tone',
    }).user
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
    }).user
    expect(out).toContain('Write it as hard sci-fi, terse and technical.')
    expect(out).toContain('Keep it clinical and understated.')
  })
})

// architecture.md → System and user halves: the opening carries the narrator's standing
// instructions, through the macro the per-turn narrative includes too.
describe('WIZARD_OPENING standing instructions', () => {
  const firstPerson = {
    ...leadCtx,
    definition: { ...leadCtx.definition, narration: 'first' },
  }

  it('gives the narrator the mode, the narration and the lead by name, after the directive', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, firstPerson).user
    expect(out).toMatch(
      /^Write the opening passage of this adventure story\.\n\nYou are the narrator of an interactive story in which the user plays Aria\./,
    )
    expect(out).toContain("you stop where Aria's next choice begins")
    expect(out).toContain('Narrate in the first person, as Aria: "I" is Aria.')
  })

  it('names no lead on the lead-less path', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, leadlessCtx).user
    expect(out).toContain('You are the narrator of a story the user directs.')
    expect(out).not.toContain('Aria')
  })

  it('carries the same instructions into a refine', () => {
    const generate = renderTemplate(TEMPLATE_IDS.wizardOpening, firstPerson).user
    const refine = renderTemplate(TEMPLATE_IDS.wizardOpeningRefine, {
      ...firstPerson,
      current: { content: 'The harbor lay still.' },
      instruction: 'darker',
    }).user
    const instructions = generate.slice(
      generate.indexOf('You are the narrator'),
      generate.indexOf('\n\nNarrate'),
    )
    expect(instructions.length).toBeGreaterThan(100)
    expect(refine).toContain(instructions)
  })

  it('gives the start moment when the calendar renders one', () => {
    expect(
      renderTemplate(TEMPLATE_IDS.wizardOpening, {
        ...leadCtx,
        startTime: 'March 14, 1200 AD 09:00',
      }).user,
    ).toContain('\n\nThe story starts at March 14, 1200 AD 09:00.\n')
    expect(
      renderTemplate(TEMPLATE_IDS.wizardOpening, { ...leadCtx, startTime: null }).user,
    ).not.toContain('The story starts at')
  })
})

// wizard.md → Title + description: both calls see the whole story.
describe.each([
  ['title', TEMPLATE_IDS.wizardTitleChips],
  ['description', TEMPLATE_IDS.wizardDescription],
])('the %s call', (_field, templateId) => {
  const story = {
    definition: {
      mode: 'adventure',
      narration: 'second',
      setting: 'A drowned coast of salt marsh.',
      genre: { label: 'Low fantasy', promptBody: 'GENRE-BODY-MARKER' },
      tone: { label: 'Wry', promptBody: 'TONE-BODY-MARKER' },
      calendarSystemId: 'earth-gregorian',
      worldTimeOrigin: { year: 1200 },
    },
    lead: { id: 'c1', name: 'Aria' },
    leadEntityId: 'c1',
    startTime: 'START-TIME-MARKER',
    cast: [
      { id: 'c1', kind: 'character', name: 'Aria', description: 'A diver.', status: 'active' },
      { id: 'l1', kind: 'location', name: 'The Sunken Archive', description: '', status: 'active' },
      { id: 'c2', kind: 'character', name: 'Gandalf', description: 'A wizard.', status: 'staged' },
    ],
    lore: [{ title: 'The Salt Wells', body: 'LORE-BODY-MARKER' }],
    opening: { content: 'The tide went out and did not come back.' },
  }
  const out = renderTemplate(templateId, story).user

  it('reads the mode and the lead, the genre and tone by label, and the setting', () => {
    expect(out).toContain('An interactive story the user plays as Aria.\n')
    expect(out).toContain(
      'Genre: Low fantasy\nTone: Wry\nSetting: A drowned coast of salt marsh.\n',
    )
    expect(out).not.toContain('BODY-MARKER')
  })

  it('reads the active cast by name and description, and the lore by title, with no ids', () => {
    expect(out).toContain('Cast:\n- Aria: A diver.\n- The Sunken Archive\n')
    expect(out).not.toContain('Gandalf')
    expect(out).toContain('World reference:\n- The Salt Wells\n')
    expect(out).not.toMatch(/\bc1\b|\bl1\b/)
  })

  it('reads the opening, and nothing of the calendar', () => {
    expect(out).toContain('Opening:\nThe tide went out and did not come back.\n')
    expect(out).not.toContain('START-TIME-MARKER')
    expect(out).not.toContain('1200')
  })

  it('names a creative story and leaves out what is unset', () => {
    const bare = renderTemplate(templateId, {
      definition: { mode: 'creative', setting: '', genre: { label: '' }, tone: { label: '' } },
      lead: null,
      cast: [],
      lore: [],
      opening: { content: 'It began.' },
    }).user
    expect(bare).toContain('A story.\nOpening:\nIt began.\n')
    expect(bare).not.toMatch(/Genre:|Tone:|Setting:|Cast:|World reference:|undefined/)
  })
})

describe('WIZARD_DESCRIPTION template', () => {
  it('asks for a premise of one to three sentences, not next-beat narrative', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardDescription, {
      opening: { content: 'Once upon a time.' },
    }).user
    expect(out).toContain('Once upon a time.')
    expect(out).toContain(
      "A description is one to three sentences on the story's premise: who it is about, where, and what is at stake. Do not write narrative prose.",
    )
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
      guidance: '',
    }).user
    expect(out).toContain('World reference:')
    expect(out).toContain('- Row 0: Body 0')
    expect(out).toContain('- Row 11: Body 11')
  })

  it('omits the block entirely when no lore is authored', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      lore: [],
      leadEntityId: '',
      guidance: '',
    }).user
    expect(out).not.toContain('World reference:')
  })

  it('does not throw and omits the block when lore is absent from the context entirely', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      leadEntityId: '',
      guidance: '',
    }).user
    expect(out).not.toContain('World reference:')
  })
})

describe('WIZARD_LORE', () => {
  it('lists already-written titles so the model does not repeat them', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardLore, {
      definition: { setting: 'A drowned coast', genre: {} },
      lore: [{ title: 'The Old Empire', body: 'ignored here' }],
      guidance: '',
    }).user
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
    }).user
    expect(out).toContain('Setting: A drowned coast')
    expect(out).toContain('Tone: Write it grim.')
  })

  it('omits setting and tone blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, { definition: {}, guidance: '' }).user
    expect(out).not.toContain('Setting:')
    expect(out).not.toContain('Tone:')
  })

  it('asks for both a short label and a substantial body', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, { definition: {}, guidance: '' }).user
    expect(out.toLowerCase()).toContain('label')
    expect(out.toLowerCase()).toContain('promptbody')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardGenre, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    }).user
    expect(out).not.toContain('The Old Empire')
    expect(out).not.toContain('World reference')
  })
})

describe('WIZARD_TONE', () => {
  it('renders setting and genre when present', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: { setting: 'A drowned coast', genre: { promptBody: 'Hard sci-fi rules.' } },
      guidance: '',
    }).user
    expect(out).toContain('Setting: A drowned coast')
    expect(out).toContain('Genre: Hard sci-fi rules.')
  })

  it('omits setting and genre blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, { definition: {}, guidance: '' }).user
    expect(out).not.toContain('Setting:')
    expect(out).not.toContain('Genre:')
  })

  it('asks for both a short label and a substantial body', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, { definition: {}, guidance: '' }).user
    expect(out.toLowerCase()).toContain('label')
    expect(out.toLowerCase()).toContain('promptbody')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    }).user
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
    }).user
    expect(out).toContain('Genre: Hard sci-fi rules.')
    expect(out).toContain('Tone: Write it grim.')
  })

  it('omits genre and tone blocks when absent', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardSetting, { definition: {}, guidance: '' }).user
    expect(out).not.toContain('Genre:')
    expect(out).not.toContain('Tone:')
  })

  it('does not render lore even when lore rows exist in context', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardSetting, {
      definition: {},
      lore: [{ title: 'The Old Empire', body: 'Fell.' }],
      guidance: '',
    }).user
    expect(out).not.toContain('The Old Empire')
    expect(out).not.toContain('World reference')
  })
})

describe('WIZARD_OPENING cast block', () => {
  it('renders the opening context from the authored cast, active rows only', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: {
        mode: 'adventure',
        genre: { promptBody: '' },
        tone: { promptBody: '' },
        setting: 'A drowned coast.',
      },
      lore: [{ title: 'The Salt Wells', body: 'Nine wells.' }],
      cast: [
        {
          id: 'c1',
          kind: 'character',
          name: 'Aria',
          description: 'A blacksmith.',
          status: 'active',
        },
        {
          id: 'l1',
          kind: 'location',
          name: 'Mornstone Keep',
          description: 'A fortress.',
          status: 'active',
        },
        {
          id: 'c2',
          kind: 'character',
          name: 'Gandalf',
          description: 'A wizard.',
          status: 'staged',
        },
      ],
      leadEntityId: 'c1',
      lead: { id: 'c1', name: 'Aria' },
      guidance: '',
    }).user
    expect(out).toContain('Aria (character, cast id: c1): A blacksmith.')
    expect(out).toContain('Mornstone Keep (location, cast id: l1)')
    expect(out).not.toContain('Gandalf')
    expect(out).toContain("The lead character's cast id is c1")
  })

  it('tells the model which kinds belong in which metadata field', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {}, setting: '' },
      cast: [
        { id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'active' },
        { id: 'f1', kind: 'faction', name: 'The Charterhouse', description: '', status: 'active' },
      ],
      leadEntityId: '',
      guidance: '',
    }).user
    // data-model.md → Scene presence is kind-aware. Every active row is listed
    // (a faction grounds the prose) but openingOutputSchema.sceneEntities is a
    // bare string array, so the header is the model's only signal about which
    // of those ids may be echoed into which field.
    expect(out).toContain('The Charterhouse (faction, cast id: f1)')
    expect(out).toMatch(/sceneEntities[^\n]*character[^\n]*item/)
    expect(out).toMatch(/currentLocationId[^\n]*location/)
    expect(out).toMatch(/factions are never scene-tagged/i)
  })

  it('omits the cast header entirely when every authored row is staged', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {}, setting: '' },
      cast: [
        {
          id: 'c2',
          kind: 'character',
          name: 'Gandalf',
          description: 'A wizard.',
          status: 'staged',
        },
      ],
      leadEntityId: '',
      guidance: '',
    }).user
    expect(out).not.toContain('Cast —')
  })

  // wizardTemplateContext leaves `lead` null for a staged or non-character lead (activeLead), so
  // the template names no lead the cast block lists as something else, whatever leadEntityId says.
  it('drops the lead line when the lead id points at a staged row', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {}, setting: '' },
      cast: [
        { id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'staged' },
        { id: 'c2', kind: 'character', name: 'Bo', description: '', status: 'active' },
      ],
      leadEntityId: 'c1',
      lead: null,
      guidance: '',
    }).user
    expect(out).not.toContain('lead character')
    expect(out).not.toContain('Aria')
  })

  it('drops the lead line when the lead id points at a non-character row', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {}, setting: '' },
      cast: [
        { id: 'l1', kind: 'location', name: 'Mornstone Keep', description: '', status: 'active' },
      ],
      leadEntityId: 'l1',
      lead: null,
      guidance: '',
    }).user
    expect(out).toContain('Mornstone Keep (location, cast id: l1)')
    expect(out).not.toContain('lead character')
  })
})

describe('WIZARD_CAST', () => {
  it('renders the cast template with existing-cast and suggested exclusions', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardCast, {
      definition: { genre: { promptBody: 'Grim fantasy.' }, tone: { promptBody: '' }, setting: '' },
      lore: [],
      cast: [
        { id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'active' },
        // Staged rows are still "already suggested" — the exclusion list must
        // not filter by status the way the opening's cast block does.
        { id: 'c2', kind: 'character', name: 'Bo', description: '', status: 'staged' },
      ],
      suggested: ['Old Jorin'],
      guidance: 'more factions',
    }).user
    expect(out).toContain('Suggest five cast entries')
    expect(out).toContain('- Aria (character)')
    expect(out).toContain('- Bo (character)')
    expect(out).toContain('- Old Jorin')
    expect(out).toContain('faction_name')
    expect(out).toContain('parent_location_name')
    expect(out).toContain('unless the guidance below directs otherwise')
    expect(out).toContain('Additional guidance: more factions')
  })

  it('omits the "below" and "existing cast" clauses when there is no guidance and no cast', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardCast, {
      definition: { genre: {}, tone: {}, setting: '' },
      guidance: '',
    }).user
    expect(out).not.toContain('below')
    expect(out).not.toContain('existing cast')
    expect(out).toContain(
      'Suggest five cast entries for this story — a mix of characters, locations, items and factions.',
    )
  })
})

// Each prose field is a generate/refine pair over one shared macro. These pin
// the sharing itself: a contract sentence that stops reaching both templates
// means the macro was inlined back into one of them and the two can now drift.
const REFINE_PAIRS = [
  {
    field: 'genre',
    generate: TEMPLATE_IDS.wizardGenre,
    refine: TEMPLATE_IDS.wizardGenreRefine,
    contract: 'not an encyclopedia entry describing the genre',
    directive: 'Revise the genre below',
    current: { label: 'Hard sci-fi', promptBody: 'Rigorous futures.' },
    rendered: ['Hard sci-fi', 'Rigorous futures.'],
  },
  {
    field: 'tone',
    generate: TEMPLATE_IDS.wizardTone,
    refine: TEMPLATE_IDS.wizardToneRefine,
    contract: 'not an explanation of the tone',
    directive: 'Revise the tone below',
    current: { label: 'Grim', promptBody: 'Consequences land.' },
    rendered: ['Grim', 'Consequences land.'],
  },
  {
    field: 'setting',
    generate: TEMPLATE_IDS.wizardSetting,
    refine: TEMPLATE_IDS.wizardSettingRefine,
    contract: 'one or two paragraphs of freeform prose',
    directive: 'Revise the setting below',
    current: { setting: 'A drowned coast.' },
    rendered: ['A drowned coast.'],
  },
  {
    field: 'description',
    generate: TEMPLATE_IDS.wizardDescription,
    refine: TEMPLATE_IDS.wizardDescriptionRefine,
    contract: "one to three sentences on the story's premise",
    directive: 'Revise the description below',
    current: { description: 'A diver hunts a drowned archive.' },
    rendered: ['A diver hunts a drowned archive.'],
  },
  {
    field: 'opening',
    generate: TEMPLATE_IDS.wizardOpening,
    refine: TEMPLATE_IDS.wizardOpeningRefine,
    // The opening pair shares grounding rather than a contract sentence.
    contract: 'Setting: A frozen coast.',
    directive: 'Revise the opening passage',
    current: { content: 'The harbor lay still.' },
    rendered: ['The harbor lay still.'],
  },
]

describe.each(REFINE_PAIRS)('$field refine template', (pair) => {
  const ctx = {
    definition: {
      mode: 'adventure',
      setting: 'A frozen coast.',
      genre: { label: 'Weird', promptBody: 'Genre body.' },
      tone: { label: 'Dry', promptBody: 'Tone body.' },
    },
    opening: { content: 'The harbor lay still.' },
    lore: [],
  }

  it('shares its contract with the generate template through the macro', () => {
    expect(renderTemplate(pair.generate, ctx).user).toContain(pair.contract)
    expect(
      renderTemplate(pair.refine, { ...ctx, current: pair.current, instruction: 'darker' }).user,
    ).toContain(pair.contract)
  })

  it('leads with the revise directive and renders current + instruction', () => {
    const out = renderTemplate(pair.refine, {
      ...ctx,
      current: pair.current,
      instruction: 'make it darker',
    }).user
    expect(out.startsWith(pair.directive)).toBe(true)
    for (const fragment of pair.rendered) expect(out).toContain(fragment)
    expect(out).toContain('Revision instruction: make it darker')
    expect(out).not.toContain('undefined')
  })

  it('carries no guidance block — guidance steers a generate, not a refine', () => {
    const out = renderTemplate(pair.refine, {
      ...ctx,
      current: pair.current,
      instruction: 'darker',
      guidance: 'GUIDANCE-MARKER',
    }).user
    expect(out).not.toContain('GUIDANCE-MARKER')
    expect(out).not.toContain('Additional guidance')
  })
})
