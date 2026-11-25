import { describe, expect, it } from 'vitest'

import { macroGlobals, renderWith } from '../engine'
import {
  bundledPack,
  MACRO_IDS,
  renderTemplate,
  TEMPLATE_IDS,
  type Pack,
  type TemplateId,
} from '../index'
import { loadPack } from '../load-pack'

// Four turns stamped Mara, Mara, Jorin, Jorin under lead Jorin: marks on turns 1 and 3 only, the
// others carry no `leadMark` key. Each describe block puts the marks in its prompt's id scheme.
const FORMER = 'Mara'
const CURRENT = 'Jorin'
const SWITCHED_TURNS = [
  { position: 1, kind: 'opening', content: 'The gate stood open. I crossed the yard to the well.' },
  { position: 2, kind: 'user_action', content: 'I lower the bucket and listen.' },
  { position: 3, kind: 'user_action', content: 'I take the tower stairs two at a time.' },
  { position: 4, kind: 'ai_reply', content: 'You reach the top as the bell starts to ring.' },
] as const

/** `turns` with `marks[i]` as turn i's `leadMark`; a turn `marks` leaves out has no such key. */
function withMarks<T extends object>(turns: readonly T[], marks: Readonly<Record<number, object>>) {
  return turns.map((turn, i) => (i in marks ? { ...turn, leadMark: marks[i] } : { ...turn }))
}

/** The switched fixture's two marks: `former` on turn 1, `current` on turn 3. */
function switched<T extends object>(turns: readonly T[], former: object, current: object) {
  return withMarks(turns, { 0: former, 2: current })
}

// Written out, never read from the pack: the wording is a bundled default under test.
const markLine = (who: string) => `(From this turn on, "I" and "you" are ${who}.)`
const GONE_LINE =
  '(From this turn on, "I" and "you" are a character no longer in the story and none of those named here, so credit what they do to no one.)'
const NONE_LINE = '(From this turn on, the story had no lead.)'
const EXPLAINER =
  'In the story so far, a line "(From this turn on, …)" before a turn says who "I" and "you" are from that turn until the next such line, whatever the instructions say; before the first such line, they are who the instructions say. What you write now follows the instructions.'
const CLAUSE = ', except where a turn names another'
// A mark line opens its own line; the explainer quotes the opener mid-line, so it isn't counted.
const markCount = (text: string) => text.split('\n(From this turn on, ').length - 1

// Narrator, refresh and fallback marks: placeholder ids, as substituteIds leaves them.
const FORMER_MARK = { id: 'c2', name: FORMER }
const CURRENT_MARK = { id: 'c1', name: CURRENT }

// Every generationContext bucket a template reads, empty but present: the histories are under test.
const generationContext = (over: Record<string, unknown> = {}) => ({
  definition: {
    mode: 'adventure',
    narration: 'first',
    setting: '',
    genre: { label: '', promptBody: '' },
    tone: { label: '', promptBody: '' },
  },
  lead: { id: 'c1', name: CURRENT },
  entities: [
    {
      id: 'c1',
      kind: 'character',
      name: CURRENT,
      description: null,
      status: 'active',
      injectionMode: 'auto',
    },
    {
      id: 'c2',
      kind: 'character',
      name: FORMER,
      description: null,
      status: 'active',
      injectionMode: 'auto',
    },
  ],
  sceneEntities: [],
  structuralLocation: null,
  locationIds: [],
  placesListed: false,
  locationMap: [],
  locationMapUnplaced: [],
  currentLocationChain: [],
  heldItems: [],
  looseItems: [],
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
  namedCharacters: [],
  entries: [],
  lastTurns: [],
  worldTimeDeltaBasis: 'sinceLastAiReply',
  piggybackFires: false,
  suggestionsFire: false,
  suggestionCount: 2,
  suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
  composerWrapPov: 'first',
  refreshGuidance: '',
  ...over,
})

const narrator = (over: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.perTurnNarrative, generationContext(over))
const refresh = (over: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.suggestionRefresh, generationContext(over))
const fallback = (over: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, generationContext(over))

// Story so far over the switched fixture, as the narrator and the refresh render it, without ids.
const SWITCHED_HISTORY = [
  '# Story so far',
  EXPLAINER,
  '',
  markLine(FORMER),
  'The gate stood open. I crossed the yard to the well.',
  '',
  '<user_turn>',
  'I lower the bucket and listen.',
  '</user_turn>',
  '',
  markLine(CURRENT),
  '<user_turn>',
  'I take the tower stairs two at a time.',
  '</user_turn>',
  '',
  'You reach the top as the bell starts to ring.',
  '',
].join('\n')

const LEAD_LINE =
  'The story\'s lead is [c1] Jorin. Outside quoted speech, "I" and "you" in the turns are the lead'

describe('macro_story_entry', () => {
  const PROBE = 'tmpl_story_entry_probe'
  const probePack: Pack = {
    ...bundledPack,
    templates: {
      ...bundledPack.templates,
      [PROBE]: {
        group: 'generationContext',
        system: '',
        user: "{% include 'macro_story_entry', entry: entry, ids: form %}",
      },
    },
  }
  const { engine } = loadPack(probePack)
  const render = (entry: object, form: false | 'bracketed' | 'bare') =>
    renderWith(engine, PROBE, { entry, form }).user
  const ACTION = { kind: 'user_action', content: 'I wait by the well.' }
  const ACTION_TEXT = '<user_turn>\nI wait by the well.\n</user_turn>'

  // staticContent: a macro any group may include reads only its arguments.
  it('reads only its arguments', () => {
    expect([...macroGlobals(engine, MACRO_IDS.storyEntry)].toSorted()).toEqual(['entry', 'ids'])
  })

  it('prints a turn with no leadMark as it always has', () => {
    expect(render(ACTION, 'bracketed')).toBe(ACTION_TEXT)
    expect(render({ kind: 'ai_reply', content: 'The rain stops.' }, 'bare')).toBe('The rain stops.')
  })

  it.each([
    [false, 'Mara'],
    ['bracketed', '[c2] Mara'],
    ['bare', 'Mara (c2)'],
  ] as const)('prints a named mark with ids %s as %s, on a line before the turn', (form, who) => {
    expect(render({ ...ACTION, leadMark: { id: 'c2', name: 'Mara' } }, form)).toBe(
      `${markLine(who)}\n${ACTION_TEXT}`,
    )
  })

  // The chapter metadata and part calls carry no id map, so their marks hold the name alone.
  it('prints a mark that carries no id by its name', () => {
    expect(render({ ...ACTION, leadMark: { name: 'Mara' } }, false)).toBe(
      `${markLine('Mara')}\n${ACTION_TEXT}`,
    )
  })

  it.each([false, 'bracketed', 'bare'] as const)(
    'prints { gone } and { none } with no id whatever the form (ids %s)',
    (form) => {
      expect(render({ ...ACTION, leadMark: { gone: true } }, form)).toBe(
        `${GONE_LINE}\n${ACTION_TEXT}`,
      )
      expect(
        render({ kind: 'ai_reply', content: 'The rain stops.', leadMark: { none: true } }, form),
      ).toBe(`${NONE_LINE}\nThe rain stops.`)
    },
  )
})

describe('the narrator', () => {
  const marked = { entries: switched(SWITCHED_TURNS, FORMER_MARK, CURRENT_MARK) }
  const unmarked = { entries: withMarks(SWITCHED_TURNS, {}) }

  it("prints a mark line naming the character, with no id, before each run's first turn, under the explainer", () => {
    const { user } = narrator(marked)
    expect(user).toContain(SWITCHED_HISTORY)
    expect(markCount(user)).toBe(2)
  })

  it("adds no clause, and its system half is an unmarked render's, naming the current lead", () => {
    const switchedRender = narrator(marked)
    const plain = narrator(unmarked)
    expect(switchedRender.system).toBe(plain.system)
    expect(switchedRender.system).toContain('"I" is Jorin')
    expect(switchedRender.system + switchedRender.user).not.toContain(CLAUSE)
  })

  it('renders no explainer and no mark line when no turn is marked', () => {
    const { user } = narrator(unmarked)
    expect(user).not.toContain(EXPLAINER)
    expect(markCount(user)).toBe(0)
    expect(user).toContain('# Story so far\n\nThe gate stood open.')
  })

  it('explains a mark on the last turn alone', () => {
    const { user } = narrator({ entries: withMarks(SWITCHED_TURNS, { 3: { none: true } }) })
    expect(user).toContain(`# Story so far\n${EXPLAINER}\n\nThe gate stood open.`)
    expect(user).toContain(`\n${NONE_LINE}\nYou reach the top as the bell starts to ring.`)
    expect(markCount(user)).toBe(1)
  })

  // Stamps Jorin, Mara, Mara, Jorin under Jorin: the first run is the named lead's and unmarked.
  it('marks the switch away from the named lead and the switch back, not the first run', () => {
    const { user } = narrator({
      entries: withMarks(SWITCHED_TURNS, { 1: FORMER_MARK, 3: CURRENT_MARK }),
    })
    expect(user).toContain(`# Story so far\n${EXPLAINER}\n\nThe gate stood open.`)
    expect(user).toContain(`\n${markLine(FORMER)}\n<user_turn>\nI lower the bucket and listen.`)
    expect(user).toContain(`\n${markLine(CURRENT)}\nYou reach the top as the bell starts to ring.`)
    expect(markCount(user)).toBe(2)
  })

  // After a set with no turn since, the latest run is a former lead's; the explainer must not read
  // it as the current lead's.
  it('after a set with no turn since, marks the first turn alone and still explains', () => {
    const { system, user } = narrator({ entries: withMarks(SWITCHED_TURNS, { 0: FORMER_MARK }) })
    expect(user).toContain(`# Story so far\n${EXPLAINER}\n\n${markLine(FORMER)}\nThe gate`)
    expect(markCount(user)).toBe(1)
    expect(system).toContain('"I" is Jorin')
  })

  it.each([
    ['{ gone }', { gone: true }, GONE_LINE],
    ['{ none }', { none: true }, NONE_LINE],
  ] as const)('prints a %s run with no name', (_form, mark, line) => {
    const { user } = narrator({ entries: switched(SWITCHED_TURNS, mark, CURRENT_MARK) })
    expect(user).toContain(`${EXPLAINER}\n\n${line}\nThe gate stood open.`)
    expect(user).toContain(`\n${markLine(CURRENT)}\n<user_turn>\nI take the tower stairs`)
  })

  // A creative story after Unset: the walk starts from no lead, and the instructions name none.
  it('explains the marks on a branch with no lead', () => {
    const { system, user } = narrator({
      definition: {
        mode: 'creative',
        narration: 'third',
        setting: '',
        genre: { label: '', promptBody: '' },
        tone: { label: '', promptBody: '' },
      },
      lead: null,
      entries: withMarks(SWITCHED_TURNS, { 0: FORMER_MARK }),
    })
    expect(user).toContain(`# Story so far\n${EXPLAINER}\n\n${markLine(FORMER)}\nThe gate`)
    expect(system).toContain('Narrate in the third person.')
    expect(system).not.toContain(FORMER)
    expect(system).not.toContain(CURRENT)
  })

  it('matches the recorded switched render', () => {
    expect(narrator(marked).user).toMatchSnapshot()
  })
})

describe('the suggestion refresh', () => {
  const marked = { entries: switched(SWITCHED_TURNS, FORMER_MARK, CURRENT_MARK) }
  const unmarked = { entries: withMarks(SWITCHED_TURNS, {}) }

  it("prints a mark line naming the character, with no id, before each run's first turn, under the explainer", () => {
    const { user } = refresh(marked)
    expect(user).toContain(`${SWITCHED_HISTORY}\n# Next-turn options`)
    expect(markCount(user)).toBe(2)
  })

  it("adds no clause and leaves its system half as an unmarked render's", () => {
    const switchedRender = refresh(marked)
    expect(switchedRender.system).toBe(refresh(unmarked).system)
    expect(switchedRender.system + switchedRender.user).not.toContain(CLAUSE)
  })

  it('renders no explainer and no mark line when no turn is marked', () => {
    const { user } = refresh(unmarked)
    expect(user).not.toContain(EXPLAINER)
    expect(markCount(user)).toBe(0)
  })

  it('explains a mark on the last turn alone', () => {
    const { user } = refresh({ entries: withMarks(SWITCHED_TURNS, { 3: { none: true } }) })
    expect(user).toContain(`# Story so far\n${EXPLAINER}\n\nThe gate stood open.`)
    expect(user).toContain(`\n${NONE_LINE}\nYou reach the top as the bell starts to ring.`)
    expect(markCount(user)).toBe(1)
  })

  it('matches the recorded switched render', () => {
    expect(refresh(marked).user).toMatchSnapshot()
  })
})

describe('the fallback classifier', () => {
  const marked = { lastTurns: switched(SWITCHED_TURNS, FORMER_MARK, CURRENT_MARK) }

  it('prints the bracketed placeholder on each mark line, and the clause on its lead line', () => {
    const { user } = fallback(marked)
    expect(user).toContain(`\n${markLine('[c2] Mara')}\nThe gate stood open.`)
    expect(user).toContain(`# This turn\n\n${markLine('[c1] Jorin')}\n<user_turn>\nI take`)
    expect(user).toContain(`${LEAD_LINE}${CLAUSE}.\n`)
    expect(markCount(user)).toBe(2)
    expect(user).not.toContain(EXPLAINER)
  })

  it('keeps its lead line unqualified when no turn is marked', () => {
    const { user } = fallback({ lastTurns: withMarks(SWITCHED_TURNS, {}) })
    expect(user).toContain(`${LEAD_LINE}.\n`)
    expect(user).not.toContain(CLAUSE)
    expect(markCount(user)).toBe(0)
  })

  it('qualifies its lead line when only the last turn is marked', () => {
    const { user } = fallback({ lastTurns: withMarks(SWITCHED_TURNS, { 3: { gone: true } }) })
    expect(user).toContain(`${LEAD_LINE}${CLAUSE}.\n`)
    expect(user).toContain(`\n${GONE_LINE}\nYou reach the top as the bell starts to ring.`)
  })

  // Stamps Mara, Jorin, Jorin, Jorin: the run crossing from Earlier turns into This turn is marked
  // where it starts, and This turn opens on no mark of its own.
  it('marks a run that crosses into This turn once', () => {
    const { user } = fallback({
      lastTurns: withMarks(SWITCHED_TURNS, { 0: FORMER_MARK, 1: CURRENT_MARK }),
    })
    expect(user).toContain('# This turn\n\n<user_turn>\nI take the tower stairs two at a time.')
    expect(markCount(user)).toBe(2)
  })

  // A retired former lead's mark prints its placeholder, though the roster leaves it out.
  it("prints a retired former lead's placeholder, which its roster leaves out", () => {
    const { user } = fallback({
      ...marked,
      entities: [
        {
          id: 'c1',
          kind: 'character',
          name: CURRENT,
          description: null,
          status: 'active',
          injectionMode: 'auto',
        },
        {
          id: 'c2',
          kind: 'character',
          name: FORMER,
          description: null,
          status: 'retired',
          injectionMode: 'auto',
        },
      ],
    })
    expect(user).not.toContain('- [c2] Mara')
    expect(user).toContain(`\n${markLine('[c2] Mara')}\nThe gate stood open.`)
  })

  it('matches the recorded switched render', () => {
    expect(fallback(marked).user).toMatchSnapshot()
  })
})

// architecture.md → System and user halves: the periodic classifier prints a mark in its turn
// header; its turn intro and lead line speak of marks only when a turn holds one.
describe('the periodic classifier, switched', () => {
  type Mark = { id: string; name: string } | { gone: true } | { none: true }
  const row = (id: string, name: string) => ({
    id,
    name,
    kind: 'character',
    status: 'active',
    description: null,
    keywords: [],
    faction: null,
    standing: null,
  })
  const turn = (
    handle: string,
    kind: 'opening' | 'user_action' | 'ai_reply',
    content: string,
    over: { scene?: string[]; leadMark?: Mark } = {},
  ) => ({ handle, kind, content, scene: [] as string[], location: null, ...over })
  const context = (
    turns: readonly ReturnType<typeof turn>[],
    lead: { id: string; name: string } | null = { id: 'c2', name: 'Bael' },
  ) => ({
    mode: 'adventure',
    mentionedPlaces: false,
    entities: [row('c1', 'Aefre'), row('c2', 'Bael')],
    places: [],
    placesUnplaced: [],
    relationships: [],
    happenings: [],
    threads: [],
    lead,
    turns,
  })
  // Aefre's run, then Bael's, Bael the lead: as the builder emits it after substitution.
  const SWITCHED = [
    turn('t1', 'ai_reply', 'The gate groans open.', { leadMark: { id: 'c1', name: 'Aefre' } }),
    turn('t2', 'user_action', 'I step into the yard.', { scene: ['c1'] }),
    turn('t3', 'user_action', 'I bar the gate behind me.', {
      scene: ['c1'],
      leadMark: { id: 'c2', name: 'Bael' },
    }),
    turn('t4', 'ai_reply', 'The yard is silent.'),
  ]
  const INTRO =
    'After the handle, a turn where the lead changes says who "I" and "you" are from that turn until the next turn that says so, outside quoted speech; a turn the user wrote is marked as the user\'s'
  const CLAUSE = ', except where a turn names another'

  it("prints each run's mark after its handle, by placeholder and name, and no other turn's", () => {
    const { user } = renderTemplate(TEMPLATE_IDS.periodicClassifier, context(SWITCHED))
    expect(user).toContain(
      '\n[t1] from this turn on, "I" and "you" are [c1] Aefre\nThe gate groans open.\n',
    )
    expect(user).toContain("\n[t2] the user's turn; scene: [c1]\nI step into the yard.\n")
    expect(user).toContain(
      '\n[t3] from this turn on, "I" and "you" are [c2] Bael; the user\'s turn; scene: [c1]\nI bar the gate behind me.\n',
    )
    expect(user.endsWith('\n[t4]\nThe yard is silent.')).toBe(true)
  })

  it('explains the marks in the turn intro and adds the clause to the lead line, in the user half', () => {
    const prompt = renderTemplate(TEMPLATE_IDS.periodicClassifier, context(SWITCHED))
    expect(prompt.user).toContain(
      `\nThe story's lead is [c2] Bael. Outside quoted speech, "I" and "you" in the turns are the lead${CLAUSE}.\n\nTurns to classify.`,
    )
    expect(prompt.user).toContain(INTRO)
    expect(prompt.system).not.toContain('from this turn on')
    expect(prompt.system).not.toContain(CLAUSE)
    expect(prompt).toMatchSnapshot()
  })

  it('names someone no longer in the story, and a run with no lead, with no id', () => {
    const prompt = renderTemplate(
      TEMPLATE_IDS.periodicClassifier,
      context([
        turn('t1', 'ai_reply', 'A stranger speaks.', { leadMark: { gone: true } }),
        turn('t2', 'user_action', 'I answer him.', { leadMark: { none: true } }),
        turn('t3', 'ai_reply', 'The yard is silent.', { leadMark: { id: 'c2', name: 'Bael' } }),
      ]),
    )
    expect(prompt.user).toContain(
      '\n[t1] from this turn on, "I" and "you" are a character no longer in the story and none of those named here, so credit what they do to no one\nA stranger speaks.\n',
    )
    expect(prompt.user).toContain(
      "\n[t2] from this turn on, the story had no lead; the user's turn\nI answer him.\n",
    )
    expect(prompt.user).toContain(CLAUSE)
    expect(prompt).toMatchSnapshot()
  })

  // A creative story after an unset: no lead line, its older turns still marked.
  it('explains the marks with no lead line on a branch with no lead', () => {
    const { user } = renderTemplate(TEMPLATE_IDS.periodicClassifier, context(SWITCHED, null))
    expect(user).not.toContain("The story's lead")
    expect(user).not.toContain(CLAUSE)
    expect(user).toContain(INTRO)
    expect(user).toContain('\n[t1] from this turn on, "I" and "you" are [c1] Aefre\n')
  })

  // A pass lagging a switch: its window is one run under the former lead, so one mark, on t1.
  it('explains a lone mark on the first turn, with the clause on the lead line', () => {
    const { user } = renderTemplate(
      TEMPLATE_IDS.periodicClassifier,
      context([
        turn('t1', 'ai_reply', 'The gate groans open.', { leadMark: { id: 'c1', name: 'Aefre' } }),
        turn('t2', 'user_action', 'I step into the yard.', { scene: ['c1'] }),
      ]),
    )
    expect(user).toContain(
      '\n[t1] from this turn on, "I" and "you" are [c1] Aefre\nThe gate groans open.\n',
    )
    expect(user.endsWith("\n[t2] the user's turn; scene: [c1]\nI step into the yard.")).toBe(true)
    expect(user).not.toContain('[t2] from this turn on')
    expect(user).toContain(
      `\nThe story's lead is [c2] Bael. Outside quoted speech, "I" and "you" in the turns are the lead${CLAUSE}.\n\nTurns to classify.`,
    )
    expect(user).toContain(INTRO)
  })

  // A switch back to the named lead (Bael, Aefre, Bael): the first run is unmarked, later turns are.
  it('explains marks that begin after an unmarked first turn, and adds the clause', () => {
    const { user } = renderTemplate(
      TEMPLATE_IDS.periodicClassifier,
      context([
        turn('t1', 'ai_reply', 'The gate groans open.'),
        turn('t2', 'user_action', 'I step into the yard.', {
          leadMark: { id: 'c1', name: 'Aefre' },
        }),
        turn('t3', 'ai_reply', 'The yard is silent.', { leadMark: { id: 'c2', name: 'Bael' } }),
      ]),
    )
    expect(user).toContain(
      `\nThe story's lead is [c2] Bael. Outside quoted speech, "I" and "you" in the turns are the lead${CLAUSE}.\n\nTurns to classify.`,
    )
    expect(user).toContain(INTRO)
    expect(user).toContain('\n[t1]\nThe gate groans open.\n')
    expect(user).toContain(
      '\n[t2] from this turn on, "I" and "you" are [c1] Aefre; the user\'s turn\nI step into the yard.\n',
    )
  })

  it('says nothing of marks when no turn holds one', () => {
    const unmarked = SWITCHED.map(({ leadMark, ...rest }) => rest)
    const { user } = renderTemplate(TEMPLATE_IDS.periodicClassifier, context(unmarked))
    expect(user).not.toContain('from this turn on')
    expect(user).not.toContain(CLAUSE)
    expect(user).toContain(
      'Outside quoted speech, "I" and "you" in the turns are the lead.\n\nTurns to classify. Each is labelled with a turn handle in brackets — every fact you emit must carry the handle of the turn whose prose produced it. After the handle, a turn the user wrote is marked as the user\'s',
    )
  })
})

// memory/chapter-close.md → Phase 2: the chapter calls name the lead and the narration in their
// user half; a mark there names a character with no id, since the calls have no id map.
describe('the chapter metadata and part calls, switched', () => {
  type Mark = { name: string } | { gone: true } | { none: true }
  const entry = (
    position: number,
    kind: 'opening' | 'user_action' | 'ai_reply',
    content: string,
    leadMark?: Mark,
  ) => ({ position, kind, content, ...(leadMark === undefined ? {} : { leadMark }) })
  const context = (
    entries: readonly ReturnType<typeof entry>[],
    lead: { name: string } | null = { name: 'Bael' },
  ) => ({
    mode: 'adventure',
    narration: 'first',
    lead,
    previousChapterSummary: null,
    threads: [],
    entries,
  })
  // Aefre's run, then Bael's, Bael the lead: as buildChapterContext emits it.
  const SWITCHED = [
    entry(1, 'ai_reply', 'The gate groans open.', { name: 'Aefre' }),
    entry(2, 'user_action', 'I step into the yard.'),
    entry(3, 'ai_reply', 'The yard is silent.', { name: 'Bael' }),
    entry(4, 'user_action', 'I bar the gate behind me.'),
  ]
  const LEAD_LINE =
    'The story\'s lead is Bael. Outside quoted speech, "I" and "you" in the turns are the lead'
  const CLAUSE = ', except where a turn names another'

  it.each([
    [TEMPLATE_IDS.chapterMetadata, '# The chapter'],
    [TEMPLATE_IDS.chapterMetadataPart, '# This part of the chapter'],
  ] as const)(
    '%s names each run before its first turn, with no id, and adds the clause',
    (templateId, heading) => {
      const prompt = renderTemplate(templateId, context(SWITCHED))
      expect(prompt.user).toContain(
        `# The narration\nThe chapter is narrated in the first person.\n${LEAD_LINE}${CLAUSE}.\n\n${heading}\n`,
      )
      expect(prompt.user).toMatch(/Aefre[^\n]*\n+The gate groans open\./)
      expect(prompt.user).toMatch(/Bael[^\n]*\n+The yard is silent\./)
      expect(prompt.user).not.toMatch(/\bc\d+\b/)
      expect(prompt.system).not.toContain('Aefre')
      expect(prompt).toMatchSnapshot()
    },
  )

  // A switch back to the named lead: the first run is unmarked, a later entry carries the mark.
  it.each([
    [TEMPLATE_IDS.chapterMetadata, '# The chapter'],
    [TEMPLATE_IDS.chapterMetadataPart, '# This part of the chapter'],
  ] as const)('%s adds the clause when only a later turn is marked', (templateId, heading) => {
    const { user } = renderTemplate(
      templateId,
      context([
        entry(1, 'ai_reply', 'The yard is silent.'),
        entry(2, 'user_action', 'I bar the gate behind me.'),
        entry(3, 'ai_reply', 'The gate groans open.', { name: 'Aefre' }),
      ]),
    )
    expect(user).toContain(
      `# The narration\nThe chapter is narrated in the first person.\n${LEAD_LINE}${CLAUSE}.\n\n${heading}\n`,
    )
    expect(user).toMatch(/Aefre[^\n]*\n+The gate groans open\./)
  })

  it('marks no turn and adds no clause in a part with no switch inside it', () => {
    const { user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadataPart,
      context([
        entry(5, 'ai_reply', 'The yard is silent.'),
        entry(6, 'user_action', 'I bar the gate behind me.'),
      ]),
    )
    expect(user).toContain(
      `# The narration\nThe chapter is narrated in the first person.\n${LEAD_LINE}.\n\n# This part of the chapter\n\nThe yard is silent.\n\n<user_turn>\nI bar the gate behind me.\n</user_turn>`,
    )
    expect(user).not.toContain(CLAUSE)
    expect(user).not.toContain('Aefre')
  })

  it('renders a gone and a none mark with no id, and the clause', () => {
    const prompt = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      context([
        entry(1, 'ai_reply', 'A stranger speaks.', { gone: true }),
        entry(2, 'user_action', 'I answer him.', { none: true }),
        entry(3, 'ai_reply', 'The yard is silent.', { name: 'Bael' }),
      ]),
    )
    expect(prompt.user).toContain(`${LEAD_LINE}${CLAUSE}.\n`)
    expect(prompt.user).not.toMatch(/\bc\d+\b/)
    expect(prompt).toMatchSnapshot()
  })

  // A creative story after an unset: the narration still stated, the marks still printed.
  it('states the narration and no lead line on a branch with no lead', () => {
    const { user } = renderTemplate(TEMPLATE_IDS.chapterMetadata, context(SWITCHED, null))
    expect(user).toContain(
      '# The narration\nThe chapter is narrated in the first person.\n\n# The chapter\n',
    )
    expect(user).not.toContain("The story's lead")
    expect(user).toMatch(/Aefre[^\n]*\n+The gate groans open\./)
  })
})

// memory/chapter-close.md → Conversations: a close's turns carry each mark with its close handle,
// bare as the close writes every id.
describe('close prose: lead marks', () => {
  const MARKED_CLOSE_TURNS = [
    {
      handle: 't1',
      kind: 'opening',
      content: 'Rain on the river.',
      leadMark: { id: 'c2', name: 'Aria' },
    },
    { handle: 't2', kind: 'user_action', content: 'I wait for the ferry.' },
    { handle: 't3', kind: 'ai_reply', content: 'Tobin poles across.', leadMark: { gone: true } },
    { handle: 't4', kind: 'ai_reply', content: 'The far bank is dark.', leadMark: { none: true } },
    {
      handle: 't5',
      kind: 'user_action',
      content: 'I step onto the jetty.',
      leadMark: { id: 'c1', name: 'Wren' },
    },
  ]
  const closeSystem = (): string =>
    renderTemplate(TEMPLATE_IDS.closeLore, {
      mode: 'adventure',
      closeTurns: MARKED_CLOSE_TURNS,
      closeWritesSoFar: '',
    }).system

  it('prints a mark with its bare handle and name, after the turn heading and before its prose', () => {
    const system = closeSystem()

    expect(system).not.toContain('[c1]')
    expect(system).not.toContain('[c2]')
    const heading = system.indexOf('## t1 (the opening)')
    const mark = system.indexOf('Aria (c2)')
    expect(heading).toBeGreaterThan(-1)
    expect(mark).toBeGreaterThan(heading)
    expect(system.indexOf('Rain on the river.')).toBeGreaterThan(mark)
    // A user's turn: the mark sits before its <user_turn> tag.
    const userMark = system.indexOf('Wren (c1)')
    expect(userMark).toBeGreaterThan(system.indexOf("## t5 (the user's turn)"))
    expect(system.indexOf('<user_turn>\nI step onto the jetty.')).toBeGreaterThan(userMark)
    // Last, so it is first written once the handles print: the gone and none lines' wording.
    expect(system).toMatchSnapshot()
  })

  it('prints a line for a gone and a none mark, and nothing before an unmarked turn', () => {
    const system = closeSystem()

    expect(system).not.toContain('## t3 (narration)\nTobin poles across.')
    expect(system).not.toContain('## t4 (narration)\nThe far bank is dark.')
    expect(system).toContain(
      "## t2 (the user's turn)\n<user_turn>\nI wait for the ferry.\n</user_turn>",
    )
  })
})

// memory/chapter-close.md → Conversations: each task's user half names the lead between its
// instructions and its rows; a prose task's line takes the clause when a turn of its part is
// marked, Happenings' and Awareness's never.
describe("a close task's lead line", () => {
  const LEAD = { id: 'c1', name: 'Wren' }
  const MARKED_TURNS = [
    {
      handle: 't1',
      kind: 'opening',
      content: 'Rain on the river.',
      leadMark: { id: 'c2', name: 'Aria' },
    },
    { handle: 't2', kind: 'user_action', content: 'I wait for the ferry.' },
    {
      handle: 't3',
      kind: 'ai_reply',
      content: 'Tobin poles across.',
      leadMark: { id: 'c1', name: 'Wren' },
    },
  ]
  const UNMARKED_TURNS = MARKED_TURNS.map(({ handle, kind, content }) => ({
    handle,
    kind,
    content,
  }))
  const FLAT_LINE =
    'The story\'s lead is Wren (c1). Outside quoted speech, "I" and "you" in the turns are the lead.'
  const CLAUSE_LINE =
    'The story\'s lead is Wren (c1). Outside quoted speech, "I" and "you" in the turns are the lead, except where a turn names another.'

  // [template, the instructions' last words, the text that opens the rows]
  const PROSE: readonly (readonly [TemplateId, string, string])[] = [
    [TEMPLATE_IDS.closeLore, 'cite turns only in "turns".', '# Lore rows'],
    [
      TEMPLATE_IDS.closeIdentity,
      'read it with read_row before writing to it.',
      'The rows below show the fields you may write',
    ],
    [
      TEMPLATE_IDS.closeThreads,
      "A thread's title changes only in a merge.",
      'The threads below show',
    ],
    [
      TEMPLATE_IDS.closeUpkeep,
      'cite turns only in "turns".',
      'The rows below show the fields you may write',
    ],
    [
      TEMPLATE_IDS.closeLifecycle,
      'read it with read_row before writing to it.',
      'The rows below show the fields you may write',
    ],
  ]
  const FLAT: readonly (readonly [TemplateId, string, string])[] = [
    [
      TEMPLATE_IDS.closeHappenings,
      'cite the turns the merged happenings occurred at.',
      'Each happening below shows',
    ],
    [TEMPLATE_IDS.closeAwareness, 'read it with read_turns, never cite it.', '# This chapter'],
  ]
  const userOf = (templateId: TemplateId, vars: Record<string, unknown>): string =>
    renderTemplate(templateId, {
      mode: 'adventure',
      closeWritesSoFar: '',
      closeChapterSummary: 'Wren crossed at night.',
      ...vars,
    }).user

  it.each(PROSE)('%s adds the clause when a turn of its part is marked', (id, before, after) => {
    expect(userOf(id, { lead: LEAD, closeTurns: MARKED_TURNS })).toContain(
      `${before}\n\n${CLAUSE_LINE}\n\n${after}`,
    )
  })

  // A switch back to the named lead: the part's first turn is unmarked, a later one is marked.
  it.each(PROSE)('%s adds the clause when only a later turn is marked', (id, before, after) => {
    const later = MARKED_TURNS.map(({ leadMark, ...turn }, i) =>
      i === 2 ? { ...turn, leadMark } : turn,
    )

    expect(userOf(id, { lead: LEAD, closeTurns: later })).toContain(
      `${before}\n\n${CLAUSE_LINE}\n\n${after}`,
    )
  })

  it.each(PROSE)('%s leaves the clause out when no turn is marked', (id, before, after) => {
    const user = userOf(id, { lead: LEAD, closeTurns: UNMARKED_TURNS })

    expect(user).toContain(`${before}\n\n${FLAT_LINE}\n\n${after}`)
    expect(user).not.toContain('except where a turn names another')
  })

  it.each([...PROSE, ...FLAT])('%s names no lead when the branch has none', (id, before, after) => {
    const user = userOf(id, { lead: null, closeTurns: MARKED_TURNS })

    expect(user).toContain(`${before}\n\n${after}`)
    expect(user).not.toContain("The story's lead")
  })

  it.each(FLAT)('%s keeps its line flat, whatever turns the context holds', (id, before, after) => {
    const user = userOf(id, { lead: LEAD, closeTurns: MARKED_TURNS })

    expect(user).toContain(`${before}\n\n${FLAT_LINE}\n\n${after}`)
    expect(user).not.toContain('except where a turn names another')
  })

  it.each([...PROSE, ...FLAT])('%s keeps the lead out of its system half', (id) => {
    const { system } = renderTemplate(id, {
      mode: 'adventure',
      lead: LEAD,
      closeTurns: MARKED_TURNS,
      closeWritesSoFar: '',
    })

    expect(system).not.toContain("The story's lead")
  })
})
