import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '../index'

const render = (context: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context)

/**
 * Every bucket buildGenerationContext emits, populated. Empty rather than absent
 * where a case does not care: the builder emits all of them on every call, so a
 * fixture that omits one tests `nil.size > 0`, which is false for the wrong reason.
 */
const context = (over: Record<string, unknown> = {}) => ({
  definition: {
    mode: 'adventure',
    genre: { label: 'Fantasy', promptBody: '' },
    tone: { label: 'Wry', promptBody: '' },
    setting: '',
  },
  entities: [
    {
      id: 'c1',
      kind: 'character',
      name: 'Kael',
      description: 'A courier with a stolen sigil.',
      status: 'active',
      injectionMode: 'auto',
    },
    {
      id: 'l1',
      kind: 'location',
      name: 'The Drowned Keep',
      description: 'Half sunk into the marsh.',
      status: 'active',
      injectionMode: 'auto',
    },
    {
      id: 'i9',
      kind: 'item',
      name: 'Veilstone',
      description: '',
      status: 'staged',
      injectionMode: 'auto',
    },
  ],
  sceneEntities: ['c1', 'l1'],
  structuralLocation: {
    id: 'l1',
    kind: 'location',
    status: 'active',
    name: 'The Drowned Keep',
    description: 'Half sunk into the marsh.',
  },
  lastTurns: [
    { position: 1, content: 'The marsh road ended at a wall of black water.' },
    { position: 2, content: 'Kael went first, testing the stones.' },
    { position: 3, content: 'I put the sword away and raised both hands.' },
    { position: 4, content: 'The keep answered with a single lantern, swinging.' },
  ],
  calendarVocabulary: {
    baseUnitName: 'day',
    secondsPerBaseUnit: 86400,
    tiers: [{ name: 'month', labels: ['Frostmoon', 'Thawmoon'] }],
  },
  locationIds: [],
  structuralActiveThreads: [
    { id: 't1', status: 'active', title: 'Find the heir', description: 'Still open.' },
  ],
  structuralPinnedEntities: [],
  structuralPinnedLore: [{ id: 'lore_1', title: 'House Eldrin', body: 'An exiled line.' }],
  structuralPinnedThreads: [],
  retrievedEntities: [
    { id: 'c2', displayName: 'Mora', renderedText: 'Mora — last seen at the ford.' },
  ],
  retrievedLore: [],
  retrievedHappenings: [
    { id: 'h1', displayName: 'The siege', renderedText: 'The siege broke on the third night.' },
  ],
  retrievedThreads: [],
  retrievedChapters: [
    { id: 'ch1', displayName: 'Chapter One', renderedText: 'Chapter One: the marsh road.' },
  ],
  piggybackFires: false,
  suggestionsFire: false,
  worldTimeDeltaBasis: 'sinceLastAiReply',
  ...over,
})

describe('bundled piggyback fallback classifier template', () => {
  /**
   * The template mixes trimming and non-trimming delimiters on purpose — line 21's
   * `{% comment %}` keeps the newline that separates the marker from `# In scene`,
   * while its siblings trim. Normalising them is a plausible tidy-up that welds a
   * heading onto the prose above it, and every `toContain` assertion survives that,
   * because `turn.# In scene` contains `# In scene`. Only a snapshot sees it.
   */
  it('matches the recorded snapshot', () => {
    expect(render(context())).toMatchSnapshot()
  })

  // piggyback.md → Fallback classifier context: Setting, Genre and Tone steer prose
  // style and bias an extraction call toward narrating. Neither output-format macro
  // either — this call carries its own structured-output schema.
  it('never renders Setting, Genre, Tone or an output-format macro', () => {
    const prompt = render(
      context({
        definition: {
          mode: 'adventure',
          setting: 'SETTING-MARKER a keep on a hill',
          genre: { label: 'Fantasy', promptBody: 'GENRE-MARKER high fantasy' },
          tone: { label: 'Wry', promptBody: 'TONE-MARKER dry and clipped' },
        },
      }),
    )

    expect(prompt).not.toContain('SETTING-MARKER')
    expect(prompt).not.toContain('GENRE-MARKER')
    expect(prompt).not.toContain('TONE-MARKER')
    expect(prompt).not.toContain('# Setting')
    expect(prompt).not.toContain('# Genre')
    expect(prompt).not.toContain('# Tone')
    expect(prompt).not.toContain('Write the next beat of the story as prose')
    expect(prompt).not.toContain('<state>')
  })

  // piggybackFires stays false on this path, so macro_memory_blocks brackets no ids and
  // the roster is the sole ID source; true would also inject per-turn.ts's
  // tagged-block-only lines, which instruct an emission this call does not make.
  it('renders memory blocks without bracketed ids and without tagged-block instructions', () => {
    const prompt = render(context())

    expect(prompt).toContain('# Elsewhere in the world')
    // The whole line, not a substring: a bracketed id would prefix it.
    expect(prompt.split('\n').find((l) => l.includes('Mora'))).toBe('Mora — last seen at the ford.')
    expect(prompt).not.toContain('include their ID (without brackets) in the trailing')
    expect(prompt).not.toContain('Use one of these place IDs')
  })

  // state-emission.ts phrases the tagged block's <world_time_delta> the same way against
  // the same variable — parity between the two per-turn implementations means a drift
  // here is exactly the failure this template exists to close.
  describe('world time delta basis', () => {
    it.each([
      ['sinceUserAction', "since the end of the user's action"],
      ['sinceLastAiReply', 'since the previous entry'],
    ])('states the %s basis in the prompt', (basis, phrase) => {
      const prompt = render(context({ worldTimeDeltaBasis: basis }))

      expect(prompt).toContain(phrase)
      expect(prompt).toContain('never negative')
    })
  })

  describe('extraction-turn marking (mandatory, not stylistic)', () => {
    // Newline-anchored: the background sentence quotes "# This turn" by name, so a
    // bare indexOf would find the pointer to the header rather than the header.
    const headingAt = (prompt: string, heading: string) => prompt.indexOf(`\n${heading}\n`)

    // The memory blocks are the hazard the marking exists for — older and bulkier than
    // any tail of entries, and arriving with no framing of their own.
    it('marks the reference sections as background', () => {
      const prompt = render(context())

      const backgroundAt = prompt.indexOf('the world as it stands going into that turn')
      const loreAt = prompt.indexOf('# Relevant lore')
      expect(backgroundAt).toBeGreaterThan(-1)
      expect(loreAt).toBeGreaterThan(backgroundAt)
    })

    it('marks entries above the pair as background and the pair as this turn', () => {
      const prompt = render(
        context({
          lastTurns: [
            { content: 'e1 oldest' },
            { content: 'e2 older' },
            { content: 'e3 the action' },
            { content: 'e4 the reply' },
          ],
        }),
      )

      const earlierAt = prompt.indexOf('\n# Earlier turns')
      const thisTurnAt = headingAt(prompt, '# This turn')
      expect(earlierAt).toBeGreaterThan(-1)
      expect(prompt.indexOf('e1 oldest')).toBeGreaterThan(earlierAt)
      expect(prompt.indexOf('e2 older')).toBeGreaterThan(earlierAt)
      expect(prompt.indexOf('e2 older')).toBeLessThan(thisTurnAt)
      expect(prompt.indexOf('e3 the action')).toBeGreaterThan(thisTurnAt)
      expect(prompt.indexOf('e4 the reply')).toBeGreaterThan(thisTurnAt)
    })

    // The pair is the evidence window — the user's action can carry the state change
    // ("I put the sword away") — so it is never marked background, target or not.
    it('omits the earlier-turns header when only the pair is present', () => {
      const prompt = render(
        context({ lastTurns: [{ content: 'e1 the action' }, { content: 'e2 the reply' }] }),
      )

      expect(prompt).not.toContain('# Earlier turns')
      expect(headingAt(prompt, '# This turn')).toBeGreaterThan(-1)
      expect(prompt).toContain('e1 the action')
      expect(prompt).toContain('e2 the reply')
    })

    it('still marks this turn when the branch holds a single entry', () => {
      const prompt = render(context({ lastTurns: [{ content: 'e1 only' }] }))

      expect(prompt).not.toContain('# Earlier turns')
      expect(headingAt(prompt, '# This turn')).toBeGreaterThan(-1)
      expect(prompt).toContain('e1 only')
    })
  })
})
