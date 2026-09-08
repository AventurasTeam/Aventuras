import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '../index'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'

const render = (context: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context)

// Anchored on the fixed opening/closing tokens so the mid-section — the two branches'
// inner phrasing — is whatever the source under test actually says, not assumed.
const WORLD_TIME_DELTA_CLAUSE =
  /\{% if worldTimeDeltaBasis == 'sinceUserAction' %\}[\s\S]*?\{% endif %\} \(0 for a flashback or memory; never negative\)/

function worldTimeDeltaClause(source: string): string {
  const match = source.match(WORLD_TIME_DELTA_CLAUSE)
  if (!match) throw new Error('world-time-delta clause not found in template source')
  return match[0]
}

/**
 * Every bucket buildGenerationContext emits, kept non-empty — an omitted one would make a
 * `nil.size > 0` assertion pass for the wrong reason.
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
   * Trimming vs. non-trimming delimiters here are intentional, not inconsistent — normalising
   * them welds a heading onto the prose above it, and `toContain` can't catch that
   * (`turn.# In scene` still contains `# In scene`). Only the snapshot below sees it.
   */
  it('matches the recorded snapshot', () => {
    expect(render(context())).toMatchSnapshot()
  })

  // piggyback.md → Fallback classifier context: Setting/Genre/Tone bias extraction toward
  // narrating, so neither renders here — this call carries its own structured-output schema.
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

  // piggybackFires false → macro_memory_blocks brackets no ids (roster is the sole ID source);
  // true would also inject per-turn.ts's tagged-block lines for an emission this never makes.
  it('renders memory blocks without bracketed ids and without tagged-block instructions', () => {
    const prompt = render(context())

    expect(prompt).toContain('# Elsewhere in the world')
    // The whole line, not a substring: a bracketed id would prefix it.
    expect(prompt.split('\n').find((l) => l.includes('Mora'))).toBe('Mora — last seen at the ford.')
    expect(prompt).not.toContain('include their ID (without brackets) in the trailing')
    expect(prompt).not.toContain('Use one of these place IDs')
  })

  // Builder half (a real resolveWorldTimeDeltaBasis call over a seeded turn pair) is
  // per-turn-piggyback.test.ts; this file only proves the template renders the variable.
  describe('world time delta basis', () => {
    it.each([
      ['sinceUserAction', "since the end of the user's action"],
      ['sinceLastAiReply', 'since the previous entry'],
    ])('states the %s basis in the prompt', (basis, phrase) => {
      const prompt = render(context({ worldTimeDeltaBasis: basis }))

      expect(prompt).toContain(phrase)
      expect(prompt).toContain('never negative')
    })

    // Hand-verified against state-emission.ts across three reviews; enforce it instead.
    it('matches state-emission.ts word for word on the world-time-delta clause', () => {
      expect(worldTimeDeltaClause(PIGGYBACK_FALLBACK_CLASSIFIER)).toBe(
        worldTimeDeltaClause(STATE_EMISSION),
      )
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
