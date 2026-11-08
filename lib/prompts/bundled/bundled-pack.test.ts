import { describe, expect, it } from 'vitest'

import { macroGlobals, renderWith, templateGlobals } from '../engine'
import {
  bundledPack,
  MACRO_IDS,
  renderTemplate,
  TEMPLATE_GROUPS,
  TEMPLATE_IDS,
  templateReads,
  VARIABLES,
  type ContextGroup,
  type Pack,
} from '../index'
import { loadPack } from '../load-pack'
import { validatePackIncludes } from '../validate-includes'

describe('bundled pack', () => {
  it('passes include-compatibility validation', () => {
    expect(validatePackIncludes(bundledPack)).toEqual([])
  })

  // A read the registry doesn't define is a variable no builder emits: an include site that leaves
  // out one of a macro's arguments reads it as one (macro_entity_state's ids, here).
  it.each(Object.values(TEMPLATE_IDS).filter((id) => TEMPLATE_GROUPS[id] === 'generationContext'))(
    '%s reads only variables the registry defines',
    (templateId) => {
      const defined = new Set(VARIABLES.generationContext.map((v) => v.name))
      expect([...templateReads(templateId)].filter((name) => !defined.has(name))).toEqual([])
    },
  )

  // Stated, not derived: the pack reads its groups from the registry, so only these pin them.
  const EXPECTED_GROUPS: Record<keyof typeof TEMPLATE_IDS, string> = {
    perTurnNarrative: 'generationContext',
    piggybackFallbackClassifier: 'generationContext',
    periodicClassifier: 'classifierContext',
    suggestionRefresh: 'generationContext',
    chapterMetadata: 'chapter',
    wizardOpening: 'wizard',
    wizardOpeningRefine: 'wizard',
    wizardTitleChips: 'wizard',
    wizardDescription: 'wizard',
    wizardDescriptionRefine: 'wizard',
    wizardLore: 'wizard',
    wizardGenre: 'wizard',
    wizardGenreRefine: 'wizard',
    wizardTone: 'wizard',
    wizardToneRefine: 'wizard',
    wizardSetting: 'wizard',
    wizardSettingRefine: 'wizard',
    wizardCast: 'wizard',
  }
  it.each(Object.entries(EXPECTED_GROUPS))('groups %s as %s', (key, group) => {
    expect(TEMPLATE_GROUPS[TEMPLATE_IDS[key as keyof typeof TEMPLATE_IDS]]).toBe(group)
  })

  // The include validator reads the pack's group, the editor the registry's: they must agree.
  it.each(Object.values(TEMPLATE_IDS))("files %s under the registry's group", (templateId) => {
    expect(bundledPack.templates[templateId]?.group).toBe(TEMPLATE_GROUPS[templateId])
  })

  it('loads without throwing (engine builds)', () => {
    expect(() => loadPack(bundledPack)).not.toThrow()
  })

  // architecture.md → System and user halves: a wizard template's system half is empty.
  it('leaves every wizard template system half empty', () => {
    const wizard = Object.entries(bundledPack.templates).filter(([, t]) => t.group === 'wizard')
    expect(wizard).toHaveLength(13)
    expect(wizard.filter(([, t]) => t.system !== '').map(([id]) => id)).toEqual([])
  })

  // The context builder skips the query behind an unread variable, so a system-half-only read
  // left out of templateReads would render empty.
  it('reports the variables a template reads in its system half', () => {
    const { engine } = loadPack(bundledPack)
    const id = TEMPLATE_IDS.perTurnNarrative
    expect(templateGlobals(engine, id, 'user')).not.toContain('calendarVocabulary')
    expect(templateReads(id)).toContain('calendarVocabulary')
  })

  it('renders the wizard opening from definition + lead', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: {
        mode: 'adventure',
        setting: 'A frozen coast.',
        genre: { promptBody: '' },
        tone: { promptBody: '' },
      },
      leadEntityId: 'c1',
      lead: { id: 'c1', name: 'Aria' },
      cast: [{ id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'active' }],
    }).user
    expect(out).toContain('adventure')
    expect(out).toContain('A frozen coast.')
    expect(out).toContain('Aria')
    expect(out).toContain('cast id: c1')
    expect(out).toMatchSnapshot()
  })

  // Both structured surfaces include macro_suggestion_emission_json; editing the
  // chip contract inline in one template instead of the macro diverges them here.
  it('renders one identical JSON chip instruction on both structured surfaces', () => {
    const context = {
      definition: { mode: 'adventure', genre: { promptBody: '' }, tone: { promptBody: '' } },
      entities: [],
      entries: [{ content: 'The gate groaned open.' }],
      suggestionsFire: true,
      suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'act' }],
      suggestionCount: 2,
    }
    const instruction = (prompt: string) => {
      const start = prompt.indexOf('Populate the "suggestions" field')
      const end = prompt.indexOf('one or two sentences.')
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      return prompt.slice(start, end)
    }

    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user
    // suggestionsFire: false is what the refresh phase actually produces — it
    // never sets the flag, so buildGenerationContext defaults it. Rendering
    // this half with `true` would let a suggestionsFire guard be added to the
    // refresh template and still pass, while shipping a prompt with no chip
    // section at all.
    const refresh = renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
      ...context,
      suggestionsFire: false,
    }).user

    expect(instruction(classifier)).toBe(instruction(refresh))
    expect(instruction(refresh)).toContain('exactly 2 distinct entries')
    expect(instruction(refresh)).toContain('id "cat1" = Action — use it for: act')
    // The tagged-block macro is the OTHER contract; it must not leak in here.
    expect(classifier + refresh).not.toContain('<suggestions>')
  })

  it('asks the fallback classifier for the one-sentence summary Q3 retrieval needs', () => {
    const context = {
      entities: [],
      lastTurns: [{ content: 'The gate groaned open.' }],
    }
    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user

    expect(classifier).toMatch(/one[- ]sentence summary/i)
  })

  it('asks the fallback classifier for the retrieval queries Q4 needs', () => {
    const context = { entities: [], lastTurns: [{ content: 'The gate groaned open.' }] }
    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user

    expect(classifier).toMatch(/up to three/i)
    expect(classifier).toMatch(/next turn/i)
  })
})

describe("the close's system-half macros", () => {
  const PROBE = 'tmpl_close_macros_probe'
  const probePack = (group: ContextGroup): Pack => ({
    ...bundledPack,
    templates: {
      ...bundledPack.templates,
      [PROBE]: {
        group,
        system: `{% include '${MACRO_IDS.closeInstructions}' %}\n\n{% include '${MACRO_IDS.closeProse}' %}`,
        user: 'Begin.',
      },
    },
  })
  const render = (context: Record<string, unknown>): string =>
    renderWith(loadPack(probePack('chapter')).engine, PROBE, context).system
  const TURNS = [
    { handle: 't1', kind: 'opening', content: 'The marsh road ended at a wall of black water.' },
    { handle: 't2', kind: 'user_action', content: 'I wade in.' },
    { handle: 't3', kind: 'ai_reply', content: 'The cold takes your breath.' },
  ]

  it('files both in the chapter group, so only a close template may include them', () => {
    expect(bundledPack.macros[MACRO_IDS.closeInstructions]?.group).toBe('chapter')
    expect(bundledPack.macros[MACRO_IDS.closeProse]?.group).toBe('chapter')
    expect(validatePackIncludes(probePack('chapter'))).toEqual([])
    expect(
      validatePackIncludes(probePack('generationContext')).map((v) => [v.macroId, v.reason]),
    ).toEqual([
      [MACRO_IDS.closeInstructions, 'group-mismatch'],
      [MACRO_IDS.closeProse, 'group-mismatch'],
    ])
  })

  it('reads only the mode in the instructions, and only the turns in the prose', () => {
    const { engine } = loadPack(bundledPack)
    expect([...macroGlobals(engine, MACRO_IDS.closeInstructions)]).toEqual(['mode'])
    expect([...macroGlobals(engine, MACRO_IDS.closeProse)]).toEqual(['closeTurns'])
  })

  it('tells every task no one answers it, to act by tool calls, and how a write answers', () => {
    const system = render({ mode: 'adventure', closeTurns: TURNS })
    expect(system).toContain(
      'This is an automated system. No one reads your replies or answers your questions, so act only through tool calls.',
    )
    expect(system).toContain('Every write gives "turns"')
    expect(system).toContain(
      '- ok: it landed. A value already stored is ok too, with nothing written.',
    )
    expect(system).toContain(
      "- rejected: it didn't land, and the reason or its note says what to do.",
    )
    expect(system).toContain('- skipped: the field stands as it is')
    expect(system).toContain('When the task is done, reply without a tool call.')
  })

  // The instructions hold the model to the rules the gates enforce, line by line.
  it.each([
    'Use the ids you are shown, exactly as written; never invent one.',
    'and "why", one sentence on what in the cited turns makes the write true.',
    'Write only to a row you have read in this task',
    'Creating a row names a new one, so it needs no read.',
    "A create's answer gives the new row's id.",
    "Don't write it again.",
    'A reply without a tool call ends the task, so until it is done, every reply calls a tool.',
  ])('states: %s', (line) => {
    expect(render({ mode: 'adventure', closeTurns: TURNS })).toContain(line)
  })

  it("reads a user's turn by the story's mode", () => {
    const adventure = render({ mode: 'adventure', closeTurns: TURNS })
    const creative = render({ mode: 'creative', closeTurns: TURNS })
    expect(adventure).toContain('Each is what the lead does, says or attempts')
    expect(adventure).not.toContain('Each is a direction or prose')
    expect(creative).toContain('Each is a direction or prose')
    expect(creative).not.toContain('Each is what the lead does, says or attempts')
  })

  it('shows each turn under its handle, the user turn marked as every history marks it', () => {
    const system = render({ mode: 'adventure', closeTurns: TURNS })
    expect(system).toContain('## t1 (the opening)\nThe marsh road ended at a wall of black water.')
    expect(system).toContain("## t2 (the user's turn)\n<user_turn>\nI wade in.\n</user_turn>")
    expect(system).toContain('## t3 (narration)\nThe cold takes your breath.')
  })
})
