import { describe, expect, it } from 'vitest'

import { macroGlobals, renderWith } from '../engine'
import { bundledPack, MACRO_IDS, renderTemplate, TEMPLATE_IDS, type Pack } from '../index'
import { loadPack } from '../load-pack'

// The shared switched fixture: four turns stamped Mara, Mara, Jorin, Jorin, Jorin the lead the
// prompt names. The helper marks turn 1 (Mara is not the named lead) and turn 3 (the switch); turns
// 2 and 4 carry no `leadMark` key. Each describe block puts the marks in its prompt's id scheme.
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

// The narrator's, the refresh's and the fallback's marks: placeholder ids, as substituteIds leaves them.
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

// Story so far over the switched fixture, as the narrator and the refresh render it, no id anywhere.
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

  // Q2: after a set with no turn since, every turn is the former lead's and only the first is
  // marked; the explainer must not read the last run as the current lead's.
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

  // Q5: a retired former lead's mark prints its placeholder, though the roster leaves it out.
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
