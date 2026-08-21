import { describe, expect, it } from 'vitest'

import { describeCalendarVocabulary, EARTH_GREGORIAN } from '@/lib/calendar'
import { STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, VARIABLES } from '@/lib/prompts'
import type { Candidate, CandidateKind, EntityRow, LoreRow, ThreadRow } from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'

import { buildGenerationContext, PROMPT_ENTITY_FIELDS } from './generation-context'

const definition = {
  mode: 'adventure' as const,
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: 'High fantasy realm.' },
  tone: { label: 'Wry', promptBody: '   ' }, // whitespace-only: must NOT leak a Tone header
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

// composePromptBuffer reads three settings, and `as never` on a partial literal
// hides a missing one as `undefined` rather than failing to compile.
function storySettings(overrides: Partial<StorySettings> = {}): StorySettings {
  return { ...STORY_SETTINGS_DEFAULTS, ...overrides }
}

// protectedBuffer 0 makes the shared window exactly partialChapterBuffer; the
// spillover floor has its own cases below.
const settings = storySettings({ partialChapterBuffer: 3, protectedBuffer: 0 })

function entry(id: string, position: number, content: string, kind = 'ai_reply') {
  return {
    id,
    branchId: 'b1',
    position,
    kind,
    content,
    chapterId: null,
    metadata: null,
    createdAt: 0,
  }
}

const LOC_A = 'loc_00000000-0000-4000-8000-0000000000a1'
const LOC_B = 'loc_00000000-0000-4000-8000-0000000000b2'

function sceneMetadata(currentLocationId: string | null, sceneEntities: string[] = []) {
  return { sceneEntities, currentLocationId, worldTime: 0 }
}

function candidate(kind: CandidateKind, id: string, displayName: string): Candidate {
  return {
    kind,
    id,
    displayName,
    renderedText: `${displayName} rendered`,
    sims: [0, 0, 0],
    vector: new Float32Array([1, 0, 0]),
    chaptersOld: 0,
    pinSignal: 0,
    commonKnowledge: false,
    keywordHits: [],
    occurredAtEntryId: null,
    awarenessIds: [],
    embeddingStale: false,
  }
}

function entityRow(id: string, name: string): EntityRow {
  return { id, kind: 'character', status: 'active', injectionMode: 'auto', name, description: null }
}

function loreRow(id: string, title: string): LoreRow {
  return { id, title, body: null, injectionMode: 'always', priority: 0 }
}

function threadRow(id: string, title: string): ThreadRow {
  return { id, status: 'active', injectionMode: 'auto', title, description: null }
}

// The union of what loadSourceRows hangs off a floor row (embeddingStale on
// every type, keywords on lore — lib/retrieval/source-rows.ts). Spread onto all
// four fixtures so one projection assertion covers the union; StructuralFloor's
// declared types omit both, so only a runtime fixture carries them in.
const LOADED_EXTRAS = { embeddingStale: true, keywords: ['ghost'] }

const keysOf = (bucket: unknown) => (bucket as object[]).map((r) => Object.keys(r).sort())

describe('buildGenerationContext', () => {
  it('drops system entries outright', () => {
    const entries = [
      entry('e1', 1, 'one'),
      entry('e2', 2, 'two'),
      entry('e3', 3, 'three'),
      entry('sys', 4, 'ERROR', 'system'),
      entry('e5', 5, 'five'),
    ] as never[]
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries,
      // Wide enough that composition windows nothing out, so the assertion
      // isolates the system-kind exclusion.
      settings: storySettings({ partialChapterBuffer: 10, protectedBuffer: 0 }),
      entities: [],
      definition,
      idMap: new IdBiMap(),
    })
    const contents = (ctx.entries as { content: string }[]).map((e) => e.content)
    expect(contents).toEqual(['one', 'two', 'three', 'five'])
    expect(contents).not.toContain('ERROR')
  })

  it('exposes all three buffer knobs through userSettings', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect(ctx.userSettings).toEqual({
      fullChapterInBuffer: false,
      partialChapterBuffer: 3,
      protectedBuffer: 0,
    })
  })

  it('emits every variable the generationContext registry pins', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    for (const variable of VARIABLES.generationContext) {
      expect(Object.keys(ctx)).toContain(variable.name)
    }
  })

  it('normalizes whitespace-only definitional fields to empty string', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.definition as typeof definition).tone.promptBody).toBe('')
    expect((ctx.definition as typeof definition).setting).toBe('A keep on a hill.')
  })

  it('substitutes entity UUIDs to placeholders', () => {
    const entities = [
      {
        id: 'char_00000000-0000-4000-8000-000000000001',
        branchId: 'b1',
        kind: 'character',
        name: 'Mara',
        description: 'A knight.',
        status: 'active',
        injectionMode: 'auto',
      },
    ] as never[]
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities,
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.entities as { id: string }[])[0]!.id).toBe('c1')
  })

  // Packs are user-authored, so whatever reaches the context is template surface
  // whether the bundled template renders it or not. Passing the drizzle row whole
  // would silently enrol every future column and make it undroppable.
  it('projects entities to PROMPT_ENTITY_FIELDS, dropping the rest of the row', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [
        {
          id: 'char_00000000-0000-4000-8000-000000000001',
          branchId: 'b1',
          kind: 'character',
          name: 'Mara',
          description: 'A knight.',
          status: 'active',
          retiredReason: null,
          injectionMode: 'auto',
          nameCollisionFlag: 0,
          state: { traits: ['stoic'] },
          tags: ['secret'],
          embeddingStale: 1,
          createdAt: 1,
          updatedAt: 2,
        } as never,
      ],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    const [entity] = ctx.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual([...PROMPT_ENTITY_FIELDS].sort())
  })

  it('extracts sceneEntities from the last non-system entry, substituted like the entities', () => {
    const leadId = 'char_00000000-0000-4000-8000-000000000001'
    const entries = [
      {
        ...entry('e1', 1, 'The gate creaks open.', 'opening'),
        metadata: { sceneEntities: [leadId], currentLocationId: null, worldTime: 0 },
      },
      entry('sys', 2, 'ERROR', 'system'),
    ] as never[]
    const entities = [
      {
        id: leadId,
        branchId: 'b1',
        kind: 'character',
        name: 'Mara',
        description: 'A knight.',
        status: 'active',
        injectionMode: 'auto',
      },
    ] as never[]
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries,
      entities,
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect(ctx.sceneEntities).toEqual([(ctx.entities as { id: string }[])[0]!.id])

    const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, ctx)
    expect(prompt).toContain('# In scene')
    expect(prompt).toContain('A knight.')
  })

  it('yields empty sceneEntities when no entry carries scene metadata', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [entry('e1', 1, 'one')] as never[],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect(ctx.sceneEntities).toEqual([])
  })

  // End-to-end, not a mechanism check: the builder composes the window and the
  // template renders it whole, so the composed list is asserted on its own
  // before the render assertions ride on top of it.
  it('renders the per-turn template over exactly the composed window', () => {
    const entries = [
      entry('e1', 1, 'first-line'),
      entry('e2', 2, 'second-line'),
      entry('e3', 3, 'third-line'),
      entry('e4', 4, 'fourth-line'),
      entry('e5', 5, 'The gate creaks open.'),
    ] as never[]
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries,
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.entries as { content: string }[]).map((e) => e.content)).toEqual([
      'third-line',
      'fourth-line',
      'The gate creaks open.',
    ])

    const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, ctx)
    expect(prompt).toContain('# Setting')
    expect(prompt).toContain('# Genre')
    expect(prompt).not.toContain('# Tone') // whitespace-only tone.promptBody guarded out
    expect(prompt).toContain('The gate creaks open.')
    expect(prompt).toContain('third-line')
    expect(prompt).toContain('fourth-line')
    expect(prompt).not.toContain('first-line') // composed out, three entries back
    expect(prompt).not.toContain('second-line')
  })

  // story_entries.content persists the reply verbatim; the reader renders
  // stripTrailingBlocks(...).prose. Re-injecting the raw column feeds the model
  // its own markup back as narrative and diverges from what the user sees.
  it("carries the reader's prose, not the persisted trailing blocks", () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [
        entry('e1', 1, 'The gate creaks open.\n<state><summary>At the gate</summary></state>'),
        entry('e2', 2, 'I step through.', 'user_action'),
      ] as never[],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })

    expect((ctx.entries as { content: string }[]).map((e) => e.content)).toEqual([
      'The gate creaks open.',
      'I step through.',
    ])

    const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, ctx)
    expect(prompt).toContain('The gate creaks open.')
    expect(prompt).not.toContain('<state>')
    expect(prompt).not.toContain('At the gate')
  })

  it('drops entries and entities belonging to another branch', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [entry('e1', 1, 'ours'), { ...entry('e2', 2, 'theirs'), branchId: 'b2' }] as never[],
      entities: [
        { id: 'char_00000000-0000-4000-8000-00000000000a', name: 'Ours', branchId: 'b1' },
        { id: 'char_00000000-0000-4000-8000-00000000000b', name: 'Theirs', branchId: 'b2' },
      ] as never[],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.entries as { content: string }[]).map((e) => e.content)).toEqual(['ours'])
    expect((ctx.entities as { name: string }[]).map((e) => e.name)).toEqual(['Ours'])
  })

  it('always carries suggestionSlots; suggestionsFire gates only the instruction', () => {
    const paletteSettings = storySettings({
      suggestionCategories: [
        {
          id: 'cat_a',
          label: 'Action',
          promptHint: 'Do something.',
          color: 'red',
          enabled: true,
          order: 0,
        },
      ],
    })
    const base = { branchId: 'b1', entries: [], entities: [], definition, idMap: new IdBiMap() }

    // The slots are the story's palette, not an instruction to emit — a caller
    // that renders a template reading them (suggestion-refresh) must not have
    // to claim it is "firing" to receive its own subject matter.
    const quiet = buildGenerationContext({ ...base, settings: paletteSettings })
    expect(quiet.suggestionSlots).toEqual([
      { ref: 'cat1', label: 'Action', promptHint: 'Do something.' },
    ])
    expect(quiet.suggestionsFire).toBe(false)

    const firing = buildGenerationContext({
      ...base,
      settings: paletteSettings,
      suggestionsFire: true,
    })
    expect(firing.suggestionsFire).toBe(true)
  })

  it('re-gates suggestionsFire to false when the palette has nothing enabled', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings: storySettings({ suggestionCategories: [] }),
      idMap: new IdBiMap(),
      suggestionsFire: true,
    })
    expect(ctx.suggestionsFire).toBe(false)
  })

  it('emits placeholder-ref slots for the enabled categories, in order, when suggestionsFire is true', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings: storySettings({
        suggestionCategories: [
          {
            id: 'cat_a',
            label: 'Action',
            promptHint: 'Do something.',
            color: 'red',
            enabled: true,
            order: 0,
          },
          {
            id: 'cat_b',
            label: 'Dialogue',
            promptHint: 'Say something.',
            color: 'blue',
            enabled: false,
            order: 1,
          },
        ],
      }),
      idMap: new IdBiMap(),
      suggestionsFire: true,
    })
    expect(ctx.suggestionSlots).toEqual([
      { ref: 'cat1', label: 'Action', promptHint: 'Do something.' },
    ])
  })

  it('forces suggestionsFire back to false when the caller says true but every category is disabled', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings: storySettings({
        suggestionCategories: [
          {
            id: 'cat_a',
            label: 'Action',
            promptHint: 'Do something.',
            color: 'red',
            enabled: false,
            order: 0,
          },
        ],
      }),
      idMap: new IdBiMap(),
      suggestionsFire: true,
    })
    expect(ctx.suggestionsFire).toBe(false)
    expect(ctx.suggestionSlots).toEqual([])
  })

  it('passes suggestionCount through from settings regardless of whether suggestions fire', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings: storySettings({ suggestionCount: 5 }),
      idMap: new IdBiMap(),
    })
    expect(ctx.suggestionCount).toBe(5)
  })

  it('defaults refreshGuidance to empty and normalizes a whitespace-only steer', () => {
    const empty = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect(empty.refreshGuidance).toBe('')

    const blank = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
      refreshGuidance: '   ',
    })
    expect(blank.refreshGuidance).toBe('')

    const steered = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
      refreshGuidance: 'I sneak around the back',
    })
    expect(steered.refreshGuidance).toBe('I sneak around the back')
  })

  it('resolves calendarVocabulary for a known id, and falls back to earth-gregorian for an unknown one', () => {
    const knownCtx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition: { ...definition, calendarSystemId: 'earth-gregorian' },
      settings,
      idMap: new IdBiMap(),
    })
    expect(knownCtx.calendarVocabulary).not.toBeNull()
    expect((knownCtx.calendarVocabulary as { baseUnitName: string }).baseUnitName).toBe('second')

    const unknownCtx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition: { ...definition, calendarSystemId: 'nonexistent-calendar' },
      settings,
      idMap: new IdBiMap(),
    })
    // Same fallback the reader's world-time footer uses (resolveCalendar) —
    // prompt and footer must describe the same calendar.
    expect(unknownCtx.calendarVocabulary).toEqual(describeCalendarVocabulary(EARTH_GREGORIAN))
  })

  it('emits no runtime key the generationContext registry does not define', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    const defined = VARIABLES.generationContext.map((v) => v.name)
    expect(Object.keys(ctx).filter((key) => !defined.includes(key))).toEqual([])
  })
})

// `total` entries, the last `openTail` of them in the open region (chapterId
// null); everything before that closed under one chapter.
function branchEntries(total: number, openTail: number) {
  return Array.from({ length: total }, (_, i) => ({
    ...entry(`e${i + 1}`, i + 1, `line-${i + 1}`),
    chapterId: i < total - openTail ? 'chap_x' : null,
  })) as never[]
}

const contentsOf = (ctx: Record<string, unknown>) =>
  (ctx.entries as { content: string }[]).map((e) => e.content)

describe('buildGenerationContext — composed prompt buffer', () => {
  const base = () => ({ branchId: 'b1', entities: [], definition, idMap: new IdBiMap() })

  it('windows partial mode to partialChapterBuffer, tail-first', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: branchEntries(40, 15),
      settings: storySettings({
        fullChapterInBuffer: false,
        partialChapterBuffer: 4,
        protectedBuffer: 0,
      }),
    })
    expect(contentsOf(ctx)).toEqual(['line-37', 'line-38', 'line-39', 'line-40'])
  })

  // Distinguishes the two modes on the same fixture: partial gives 4, full 15.
  // Reachable only from chapterId, so it also pins that composition runs before
  // the entry -> { content } map strips it.
  it('takes the whole open region in full mode', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: branchEntries(40, 15),
      settings: storySettings({
        fullChapterInBuffer: true,
        partialChapterBuffer: 4,
        protectedBuffer: 0,
      }),
    })
    expect(contentsOf(ctx)).toHaveLength(15)
    expect(contentsOf(ctx)[0]).toBe('line-26')
    expect(contentsOf(ctx).at(-1)).toBe('line-40')
  })

  // cadence.md -> Composition rule: a short open region is filled from the
  // previous chapter up to protectedBuffer, so the window crosses the boundary.
  it('widens past the open region to satisfy the protectedBuffer floor', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: branchEntries(40, 3),
      settings: storySettings({
        fullChapterInBuffer: false,
        partialChapterBuffer: 4,
        protectedBuffer: 22,
      }),
    })
    expect(contentsOf(ctx)).toHaveLength(22)
    expect(contentsOf(ctx)[0]).toBe('line-19')
  })

  // Contract pin for the piggyback fallback classifier, which passes exactly
  // the tail pair it wants extracted rather than a branch: under the shipped
  // defaults the composition must not truncate a caller window that short.
  it('leaves a two-entry caller window intact under the default knobs', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: branchEntries(2, 2),
      settings: storySettings(),
    })
    expect(contentsOf(ctx)).toEqual(['line-1', 'line-2'])
  })

  // The boundary the pin above sits on, and the cost of crossing it. take is
  // max(protectedBuffer, min(openCount, wanted)), so a protectedBuffer of 0 over
  // a region with no open entries composes to nothing at all and the classifier
  // gets its extraction instruction with no prose beneath it. Reachable from M5,
  // when chapter-close starts stamping chapterId on recent entries.
  it('composes that same pair away at protectedBuffer 0 once both entries are chaptered', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: branchEntries(2, 0),
      settings: storySettings({ protectedBuffer: 0 }),
    })
    expect(contentsOf(ctx)).toEqual([])
  })
})

// The composed window IS the prompt window (cadence.md → Composition rule): a
// template that re-trimmed `entries` by partialChapterBuffer would send the
// narrative and the chips two different stories. Full mode opens the widest gap
// between the composed window and that knob.
describe('buildGenerationContext — composed window reaches the bundled templates whole', () => {
  const settings = storySettings({
    fullChapterInBuffer: true,
    partialChapterBuffer: 3,
    protectedBuffer: 0,
  })
  const context = () =>
    buildGenerationContext({
      branchId: 'b1',
      entries: branchEntries(40, 12),
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })

  it('composes wider than partialChapterBuffer, so a re-trim would be visible', () => {
    expect(contentsOf(context())).toHaveLength(12)
    expect(contentsOf(context()).length).toBeGreaterThan(settings.partialChapterBuffer)
  })

  it.each([TEMPLATE_IDS.perTurnNarrative, TEMPLATE_IDS.suggestionRefresh])(
    'renders every composed entry in %s',
    (templateId) => {
      const ctx = context()
      const prompt = renderTemplate(templateId, ctx)
      const composed = contentsOf(ctx)
      expect(composed).toHaveLength(12)
      for (const content of composed) expect(prompt).toContain(content)
    },
  )
})

const CHAR_ID = 'char_00000000-0000-4000-8000-0000000000c1'
const CHAR_ID_2 = 'char_00000000-0000-4000-8000-0000000000c2'
const LORE_ID = 'lore_00000000-0000-4000-8000-0000000000d1'
const HAP_ID = 'hap_00000000-0000-4000-8000-0000000000e1'
const THR_ID = 'thr_00000000-0000-4000-8000-0000000000f1'
const THR_ID_2 = 'thr_00000000-0000-4000-8000-0000000000f2'
const CHAP_ID = 'chap_00000000-0000-4000-8000-00000000a001'

const RETRIEVED_KEYS = [
  'retrievedEntities',
  'retrievedLore',
  'retrievedHappenings',
  'retrievedThreads',
  'retrievedChapters',
] as const

const namesOf = (bucket: unknown) => (bucket as { displayName: string }[]).map((r) => r.displayName)

// Pre-seeded so a placeholder assertion pins the id it came from rather than
// the order substituteIds happens to walk the context keys in.
function seededIdMap(...ids: string[]): IdBiMap {
  const idMap = new IdBiMap()
  for (const id of ids) idMap.allocate(id)
  return idMap
}

describe('buildGenerationContext — retrieval bundles', () => {
  const base = () => ({
    branchId: 'b1',
    entries: [] as never[],
    entities: [],
    definition,
    settings,
    idMap: seededIdMap(CHAR_ID),
  })

  const populated = () =>
    retrievalSuccess({
      selected: {
        entities: [candidate('entity', CHAR_ID, 'Mara')],
        lore: [candidate('lore', LORE_ID, 'The Compact')],
        happenings: [candidate('happening', HAP_ID, 'The siege')],
        threads: [candidate('thread', THR_ID, 'Find the heir')],
        chapters: [candidate('chapter', CHAP_ID, 'Chapter One')],
      },
    })

  it('emits an empty array for every retrieved bucket when no retrieval ran', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: undefined })
    for (const key of RETRIEVED_KEYS) expect(ctx[key]).toEqual([])
  })

  // Positive control for the emptiness assertion above: the same five keys
  // carry their own bundle and only their own.
  it('routes each bundle to its own bucket', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    expect(namesOf(ctx.retrievedEntities)).toEqual(['Mara'])
    expect(namesOf(ctx.retrievedLore)).toEqual(['The Compact'])
    expect(namesOf(ctx.retrievedHappenings)).toEqual(['The siege'])
    expect(namesOf(ctx.retrievedThreads)).toEqual(['Find the heir'])
    expect(namesOf(ctx.retrievedChapters)).toEqual(['Chapter One'])
  })

  // Why those three and nothing else: see promptRows in generation-context.ts.
  it('projects a candidate to id / displayName / renderedText only', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    const row = (ctx.retrievedLore as Record<string, unknown>[])[0]!
    expect(Object.keys(row).sort()).toEqual(['displayName', 'id', 'renderedText'])
    expect(row.renderedText).toBe('The Compact rendered')
  })

  it('substitutes retrieved row ids to placeholders, like the entities list', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    expect((ctx.retrievedEntities as { id: string }[])[0]!.id).toBe('c1')
  })
})

describe('buildGenerationContext — structural floor', () => {
  const base = () => ({
    branchId: 'b1',
    entries: [] as never[],
    entities: [],
    definition,
    settings,
    idMap: seededIdMap(LOC_A),
  })

  const populated = () =>
    retrievalSuccess({
      floor: {
        sceneEntities: [entityRow(CHAR_ID, 'Mara')],
        currentLocation: entityRow(LOC_A, 'The keep'),
        activeThreads: [threadRow(THR_ID, 'Find the heir')],
        alwaysEntities: [entityRow(CHAR_ID_2, 'Corvin')],
        alwaysLore: [loreRow(LORE_ID, 'The Compact')],
        alwaysThreads: [threadRow(THR_ID_2, 'The debt')],
      },
    })

  it('emits empty lists and a null location when no retrieval ran', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: undefined })
    expect(ctx.structuralActiveThreads).toEqual([])
    expect(ctx.structuralPinnedEntities).toEqual([])
    expect(ctx.structuralPinnedLore).toEqual([])
    expect(ctx.structuralPinnedThreads).toEqual([])
    expect(ctx.structuralLocation).toBeNull()
  })

  it('carries every floor field to its own bucket', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    expect((ctx.structuralLocation as { name: string }).name).toBe('The keep')
    expect((ctx.structuralActiveThreads as { title: string }[]).map((t) => t.title)).toEqual([
      'Find the heir',
    ])
  })

  // Why they are not one concatenated list: see the structuralPinned* keys in
  // generation-context.ts.
  it('keeps the pinned rows in per-type buckets a template can tell apart', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    expect((ctx.structuralPinnedEntities as { name: string }[]).map((e) => e.name)).toEqual([
      'Corvin',
    ])
    expect((ctx.structuralPinnedLore as { title: string }[]).map((l) => l.title)).toEqual([
      'The Compact',
    ])
    expect((ctx.structuralPinnedThreads as { title: string }[]).map((t) => t.title)).toEqual([
      'The debt',
    ])
  })

  it('substitutes floor row ids to placeholders', () => {
    const ctx = buildGenerationContext({ ...base(), retrieval: populated() })
    expect((ctx.structuralLocation as { id: string }).id).toBe('l1')
  })

  // The floor is built over LOADED source rows, so every row here still carries
  // embeddingStale (and lore's keywords) at runtime; StructuralFloor's declared
  // shape hides that from the compiler, which is why it needs a runtime pin.
  it('projects floor rows to render fields only, dropping retrieval bookkeeping', () => {
    const ctx = buildGenerationContext({
      ...base(),
      retrieval: retrievalSuccess({
        floor: {
          sceneEntities: [{ ...entityRow(CHAR_ID, 'Mara'), ...LOADED_EXTRAS } as EntityRow],
          currentLocation: { ...entityRow(LOC_A, 'The keep'), ...LOADED_EXTRAS } as EntityRow,
          activeThreads: [{ ...threadRow(THR_ID, 'Find the heir'), ...LOADED_EXTRAS } as ThreadRow],
          alwaysLore: [{ ...loreRow(LORE_ID, 'The Compact'), ...LOADED_EXTRAS } as LoreRow],
        },
      }),
    })
    expect(Object.keys(ctx.structuralLocation as object).sort()).toEqual([
      'description',
      'id',
      'kind',
      'name',
      'status',
    ])
    expect(keysOf(ctx.structuralActiveThreads)).toEqual([['description', 'id', 'status', 'title']])
    expect(keysOf(ctx.structuralPinnedLore)).toEqual([['body', 'id', 'title']])
  })

  // Positive control for the projection assertions: the same leaked fields are
  // present on the rows going in, so those key lists are a filter's output and
  // not just the fixture's own shape.
  it('receives floor rows that do carry the bookkeeping it drops', () => {
    const leaked = { ...entityRow(CHAR_ID, 'Mara'), ...LOADED_EXTRAS }
    expect(Object.keys(leaked)).toContain('embeddingStale')
    expect(Object.keys(leaked)).toContain('keywords')
  })
})

describe('buildGenerationContext — locationIds', () => {
  const LOC_C = 'loc_00000000-0000-4000-8000-0000000000c3'
  const LOC_D = 'loc_00000000-0000-4000-8000-0000000000d4'

  const place = (id: string, name: string): EntityRow => ({
    ...entityRow(id, name),
    kind: 'location',
  })

  const base = () => ({
    branchId: 'b1',
    entries: [] as never[],
    entities: [],
    definition,
    settings,
    idMap: seededIdMap(LOC_A, LOC_B, LOC_C, LOC_D, CHAR_ID, CHAR_ID_2),
  })

  it('is empty when no retrieval ran', () => {
    expect(buildGenerationContext({ ...base(), retrieval: undefined }).locationIds).toEqual([])
  })

  it('collects every place the prompt renders an ID for, in reading order', () => {
    const ctx = buildGenerationContext({
      ...base(),
      retrieval: {
        ...retrievalSuccess({
          floor: {
            sceneEntities: [place(LOC_B, 'The yard')],
            currentLocation: place(LOC_A, 'The keep'),
            alwaysEntities: [place(LOC_C, 'The shrine')],
          },
          selected: { entities: [candidate('entity', LOC_D, 'The market')] },
        }),
        selectedLocationIds: [LOC_D],
      },
    })
    expect(ctx.locationIds).toEqual(['l2', 'l1', 'l3', 'l4'])
  })

  it('leaves out entities that are not places, from either the floor or the ranker', () => {
    const ctx = buildGenerationContext({
      ...base(),
      retrieval: {
        ...retrievalSuccess({
          floor: {
            sceneEntities: [entityRow(CHAR_ID, 'Mara')],
            currentLocation: place(LOC_A, 'The keep'),
            alwaysEntities: [entityRow(CHAR_ID_2, 'Corvin')],
          },
          selected: { entities: [candidate('entity', CHAR_ID_2, 'Corvin')] },
        }),
        // The pass reports no ranked place, so the ranked character below must
        // not reach the list even though it renders with a bracketed ID.
        selectedLocationIds: [],
      },
    })
    expect(ctx.locationIds).toEqual(['l1'])
    // Positive control: the ranked character does reach the template with an ID
    // of its own, so exclusion here is about kind rather than about absence.
    expect((ctx.retrievedEntities as { id: string }[]).map((e) => e.id)).toEqual(['c2'])
  })

  it('de-duplicates a place the floor and the ranker both name', () => {
    const ctx = buildGenerationContext({
      ...base(),
      retrieval: {
        ...retrievalSuccess({
          floor: { currentLocation: place(LOC_A, 'The keep') },
          selected: { entities: [candidate('entity', LOC_A, 'The keep')] },
        }),
        selectedLocationIds: [LOC_A],
      },
    })
    expect(ctx.locationIds).toEqual(['l1'])
  })
})

describe('buildGenerationContext — currentLocationId', () => {
  // LOC_A is l1 and LOC_B is l2, so the two entries below are distinguishable.
  const base = () => ({
    branchId: 'b1',
    entities: [],
    definition,
    settings,
    idMap: seededIdMap(LOC_A, LOC_B),
  })

  it('reads the narrative tail, not an earlier entry, and substitutes the id', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: [
        { ...entry('e1', 1, 'one'), metadata: sceneMetadata(LOC_A) },
        { ...entry('e2', 2, 'two'), metadata: sceneMetadata(LOC_B) },
      ] as never[],
    })
    expect(ctx.currentLocationId).toBe('l2')
  })

  it('falls back to null when the tail carries no location', () => {
    const ctx = buildGenerationContext({ ...base(), entries: [entry('e1', 1, 'one')] as never[] })
    expect(ctx.currentLocationId).toBeNull()
  })

  it('ignores a system row at the tail', () => {
    const ctx = buildGenerationContext({
      ...base(),
      entries: [
        { ...entry('e1', 1, 'one'), metadata: sceneMetadata(LOC_A) },
        { ...entry('sys', 2, 'ERROR', 'system'), metadata: sceneMetadata(LOC_B) },
      ] as never[],
    })
    expect(ctx.currentLocationId).toBe('l1')
  })
})
