import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { describeCalendarVocabulary, EARTH_GREGORIAN } from '@/lib/calendar'
import {
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  type EntryMetadata,
  type StoryEntry,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, VARIABLES, type TemplateId } from '@/lib/prompts'
import type {
  Candidate,
  CandidateKind,
  EntityRow,
  LoreRow,
  RetrievalSuccess,
  ThreadRow,
} from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'
import { currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { buildGenerationContext, PROMPT_ENTITY_FIELDS } from './generation-context'
import { RETRIEVAL_INTERMEDIATE_KEY } from './per-turn-retrieval'

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

// promptBufferTake reads three settings, and `as never` on a partial literal
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

let testDb: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  testDb = await createTestDb()
  testDb.sqlite.exec(`
    INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s1', 'A story', 1, 1);
    INSERT INTO branches (id, story_id, name, created_at) VALUES ('b1', 's1', 'main', 1);
    INSERT INTO branches (id, story_id, name, created_at) VALUES ('b2', 's1', 'alt', 1);
  `)
})

beforeEach(() => {
  testDb.sqlite.exec('DELETE FROM story_entries')
  currentStoryStore.__reset()
  entriesStore.__reset()
  entitiesStore.__reset()
})

const phaseCtx = (intermediates: Record<string, unknown> = {}) => ({
  db: testDb.db,
  storyId: 's1',
  branchId: 'b1',
  intermediates,
})

const seedEntries = (rows: StoryEntry[]) =>
  testDb.db.insert(storyEntries).values(rows).onConflictDoNothing()

/**
 * Seeds the sources the builder reads, then calls it: a case states only what it
 * is about, and everything it omits stays at the fixture default.
 * onConflictDoNothing because a case that builds twice seeds the same rows twice.
 */
async function buildContext(args: {
  entries?: StoryEntry[]
  entities?: unknown[]
  definition?: unknown
  settings?: StorySettings
  idMap?: IdBiMap
  templateId?: TemplateId
  retrieval?: RetrievalSuccess
  piggybackFires?: boolean
  suggestionsFire?: boolean
  refreshGuidance?: string
}): Promise<Record<string, unknown>> {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: (args.definition ?? definition) as never,
    settings: args.settings ?? settings,
  })
  // branchId first, so a fixture that states its own (the cross-branch case)
  // still wins.
  entitiesStore.hydrate(
    'b1',
    (args.entities ?? []).map((e) => ({ branchId: 'b1', ...(e as object) })) as never[],
  )
  if (args.entries?.length) await seedEntries(args.entries)

  const intermediates: Record<string, unknown> = {}
  if (args.idMap) intermediates.idMap = args.idMap
  if (args.retrieval) intermediates[RETRIEVAL_INTERMEDIATE_KEY] = { ...args.retrieval, ok: true }

  const load = await buildGenerationContext(phaseCtx(intermediates), {
    phaseName: 'narrative',
    templateId: args.templateId ?? TEMPLATE_IDS.perTurnNarrative,
    piggybackFires: args.piggybackFires,
    suggestionsFire: args.suggestionsFire,
    refreshGuidance: args.refreshGuidance,
  })
  if (!load.ok) throw new Error(`expected a context, got ${JSON.stringify(load.result)}`)
  return load.context
}

describe('buildGenerationContext', () => {
  it('drops system entries outright', async () => {
    const entries = [
      entry('e1', 1, 'one'),
      entry('e2', 2, 'two'),
      entry('e3', 3, 'three'),
      entry('sys', 4, 'ERROR', 'system'),
      entry('e5', 5, 'five'),
    ] as never[]
    const ctx = await buildContext({
      entries,
      // Wide enough that composition windows nothing out, so the assertion
      // isolates the system-kind exclusion.
      settings: storySettings({ partialChapterBuffer: 10, protectedBuffer: 0 }),
    })
    const contents = (ctx.entries as { content: string }[]).map((e) => e.content)
    expect(contents).toEqual(['one', 'two', 'three', 'five'])
    expect(contents).not.toContain('ERROR')
  })

  it('exposes all three buffer knobs through userSettings', async () => {
    const ctx = await buildContext({ settings })
    expect(ctx.userSettings).toEqual({
      fullChapterInBuffer: false,
      partialChapterBuffer: 3,
      protectedBuffer: 0,
    })
  })

  it('emits every variable the generationContext registry pins', async () => {
    const ctx = await buildContext({})
    for (const variable of VARIABLES.generationContext) {
      expect(Object.keys(ctx)).toContain(variable.name)
    }
  })

  it('normalizes whitespace-only definitional fields to empty string', async () => {
    const ctx = await buildContext({})
    expect((ctx.definition as typeof definition).tone.promptBody).toBe('')
    expect((ctx.definition as typeof definition).setting).toBe('A keep on a hill.')
  })

  it('substitutes entity UUIDs to placeholders', async () => {
    const entities = [
      {
        id: 'char_00000000-0000-4000-8000-000000000001',
        kind: 'character',
        name: 'Mara',
        description: 'A knight.',
        status: 'active',
        injectionMode: 'auto',
      },
    ] as never[]
    const ctx = await buildContext({ entities })
    expect((ctx.entities as { id: string }[])[0]!.id).toBe('c1')
  })

  // Packs are user-authored, so whatever reaches the context is template surface
  // whether the bundled template renders it or not. Passing the drizzle row whole
  // would silently enrol every future column and make it undroppable.
  it('projects entities to PROMPT_ENTITY_FIELDS, dropping the rest of the row', async () => {
    const ctx = await buildContext({
      entities: [
        {
          id: 'char_00000000-0000-4000-8000-000000000001',
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
    })
    const [entity] = ctx.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual([...PROMPT_ENTITY_FIELDS].sort())
  })

  it('extracts sceneEntities from the last non-system entry, substituted like the entities', async () => {
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
        kind: 'character',
        name: 'Mara',
        description: 'A knight.',
        status: 'active',
        injectionMode: 'auto',
      },
    ] as never[]
    const ctx = await buildContext({
      entries,
      entities,
    })
    expect(ctx.sceneEntities).toEqual([(ctx.entities as { id: string }[])[0]!.id])

    const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, ctx)
    expect(prompt).toContain('# In scene')
    expect(prompt).toContain('A knight.')
  })

  it('yields empty sceneEntities when no entry carries scene metadata', async () => {
    const ctx = await buildContext({ entries: [entry('e1', 1, 'one')] as never[] })
    expect(ctx.sceneEntities).toEqual([])
  })

  // End-to-end, not a mechanism check: the builder composes the window and the
  // template renders it whole, so the composed list is asserted on its own
  // before the render assertions ride on top of it.
  it('renders the per-turn template over exactly the composed window', async () => {
    const entries = [
      entry('e1', 1, 'first-line'),
      entry('e2', 2, 'second-line'),
      entry('e3', 3, 'third-line'),
      entry('e4', 4, 'fourth-line'),
      entry('e5', 5, 'The gate creaks open.'),
    ] as never[]
    const ctx = await buildContext({ entries })
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
  it("carries the reader's prose, not the persisted trailing blocks", async () => {
    const ctx = await buildContext({
      entries: [
        entry('e1', 1, 'The gate creaks open.\n<state><summary>At the gate</summary></state>'),
        entry('e2', 2, 'I step through.', 'user_action'),
      ] as never[],
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

  it('drops entries and entities belonging to another branch', async () => {
    const ctx = await buildContext({
      entries: [entry('e1', 1, 'ours'), { ...entry('e2', 2, 'theirs'), branchId: 'b2' }] as never[],
      entities: [
        { id: 'char_00000000-0000-4000-8000-00000000000a', name: 'Ours', branchId: 'b1' },
        { id: 'char_00000000-0000-4000-8000-00000000000b', name: 'Theirs', branchId: 'b2' },
      ] as never[],
    })
    expect((ctx.entries as { content: string }[]).map((e) => e.content)).toEqual(['ours'])
    expect((ctx.entities as { name: string }[]).map((e) => e.name)).toEqual(['Ours'])
  })

  it('always carries suggestionSlots; suggestionsFire gates only the instruction', async () => {
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
    // The slots are the story's palette, not an instruction to emit — a caller
    // that renders a template reading them (suggestion-refresh) must not have
    // to claim it is "firing" to receive its own subject matter.
    const quiet = await buildContext({ settings: paletteSettings })
    expect(quiet.suggestionSlots).toEqual([
      { ref: 'cat1', label: 'Action', promptHint: 'Do something.' },
    ])
    expect(quiet.suggestionsFire).toBe(false)

    const firing = await buildContext({ settings: paletteSettings, suggestionsFire: true })
    expect(firing.suggestionsFire).toBe(true)
  })

  it('re-gates suggestionsFire to false when the palette has nothing enabled', async () => {
    const ctx = await buildContext({
      settings: storySettings({ suggestionCategories: [] }),
      suggestionsFire: true,
    })
    expect(ctx.suggestionsFire).toBe(false)
  })

  it('emits placeholder-ref slots for the enabled categories, in order, when suggestionsFire is true', async () => {
    const ctx = await buildContext({
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
      suggestionsFire: true,
    })
    expect(ctx.suggestionSlots).toEqual([
      { ref: 'cat1', label: 'Action', promptHint: 'Do something.' },
    ])
  })

  it('forces suggestionsFire back to false when the caller says true but every category is disabled', async () => {
    const ctx = await buildContext({
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
      suggestionsFire: true,
    })
    expect(ctx.suggestionsFire).toBe(false)
    expect(ctx.suggestionSlots).toEqual([])
  })

  it('passes suggestionCount through from settings regardless of whether suggestions fire', async () => {
    const ctx = await buildContext({ settings: storySettings({ suggestionCount: 5 }) })
    expect(ctx.suggestionCount).toBe(5)
  })

  it('defaults refreshGuidance to empty and normalizes a whitespace-only steer', async () => {
    const empty = await buildContext({})
    expect(empty.refreshGuidance).toBe('')

    const blank = await buildContext({ refreshGuidance: '   ' })
    expect(blank.refreshGuidance).toBe('')

    const steered = await buildContext({ refreshGuidance: 'I sneak around the back' })
    expect(steered.refreshGuidance).toBe('I sneak around the back')
  })

  it('resolves calendarVocabulary for a known id, and falls back to earth-gregorian for an unknown one', async () => {
    const knownCtx = await buildContext({
      definition: { ...definition, calendarSystemId: 'earth-gregorian' },
    })
    expect(knownCtx.calendarVocabulary).not.toBeNull()
    expect((knownCtx.calendarVocabulary as { baseUnitName: string }).baseUnitName).toBe('second')

    const unknownCtx = await buildContext({
      definition: { ...definition, calendarSystemId: 'nonexistent-calendar' },
    })
    // Same fallback the reader's world-time footer uses (resolveCalendar) —
    // prompt and footer must describe the same calendar.
    expect(unknownCtx.calendarVocabulary).toEqual(describeCalendarVocabulary(EARTH_GREGORIAN))
  })

  it('emits no runtime key the generationContext registry does not define', async () => {
    const ctx = await buildContext({})
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
  it('windows partial mode to partialChapterBuffer, tail-first', async () => {
    const ctx = await buildContext({
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
  it('takes the whole open region in full mode', async () => {
    const ctx = await buildContext({
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
  it('widens past the open region to satisfy the protectedBuffer floor', async () => {
    const ctx = await buildContext({
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
  it('leaves a two-entry caller window intact under the default knobs', async () => {
    const ctx = await buildContext({
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
  it('composes that same pair away at protectedBuffer 0 once both entries are chaptered', async () => {
    const ctx = await buildContext({
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
  const context = () => buildContext({ entries: branchEntries(40, 12), settings })

  it('composes wider than partialChapterBuffer, so a re-trim would be visible', async () => {
    expect(contentsOf(await context())).toHaveLength(12)
    expect(contentsOf(await context()).length).toBeGreaterThan(settings.partialChapterBuffer)
  })

  it.each([TEMPLATE_IDS.perTurnNarrative, TEMPLATE_IDS.suggestionRefresh])(
    'renders every composed entry in %s',
    async (templateId) => {
      const ctx = await context()
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
  const base = () => ({ idMap: seededIdMap(CHAR_ID) })

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

  it('emits an empty array for every retrieved bucket when no retrieval ran', async () => {
    const ctx = await buildContext({ ...base(), retrieval: undefined })
    for (const key of RETRIEVED_KEYS) expect(ctx[key]).toEqual([])
  })

  // Positive control for the emptiness assertion above: the same five keys
  // carry their own bundle and only their own.
  it('routes each bundle to its own bucket', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
    expect(namesOf(ctx.retrievedEntities)).toEqual(['Mara'])
    expect(namesOf(ctx.retrievedLore)).toEqual(['The Compact'])
    expect(namesOf(ctx.retrievedHappenings)).toEqual(['The siege'])
    expect(namesOf(ctx.retrievedThreads)).toEqual(['Find the heir'])
    expect(namesOf(ctx.retrievedChapters)).toEqual(['Chapter One'])
  })

  // Why those three and nothing else: see promptRows in generation-context.ts.
  it('projects a candidate to id / displayName / renderedText only', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
    const row = (ctx.retrievedLore as Record<string, unknown>[])[0]!
    expect(Object.keys(row).sort()).toEqual(['displayName', 'id', 'renderedText'])
    expect(row.renderedText).toBe('The Compact rendered')
  })

  it('substitutes retrieved row ids to placeholders, like the entities list', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
    expect((ctx.retrievedEntities as { id: string }[])[0]!.id).toBe('c1')
  })
})

describe('buildGenerationContext — structural floor', () => {
  const base = () => ({ idMap: seededIdMap(LOC_A) })

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

  it('emits empty lists and a null location when no retrieval ran', async () => {
    const ctx = await buildContext({ ...base(), retrieval: undefined })
    expect(ctx.structuralActiveThreads).toEqual([])
    expect(ctx.structuralPinnedEntities).toEqual([])
    expect(ctx.structuralPinnedLore).toEqual([])
    expect(ctx.structuralPinnedThreads).toEqual([])
    expect(ctx.structuralLocation).toBeNull()
  })

  it('carries every floor field to its own bucket', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
    expect((ctx.structuralLocation as { name: string }).name).toBe('The keep')
    expect((ctx.structuralActiveThreads as { title: string }[]).map((t) => t.title)).toEqual([
      'Find the heir',
    ])
  })

  // Why they are not one concatenated list: see the structuralPinned* keys in
  // generation-context.ts.
  it('keeps the pinned rows in per-type buckets a template can tell apart', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
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

  it('substitutes floor row ids to placeholders', async () => {
    const ctx = await buildContext({ ...base(), retrieval: populated() })
    expect((ctx.structuralLocation as { id: string }).id).toBe('l1')
  })

  // The floor is built over LOADED source rows, so every row here still carries
  // embeddingStale (and lore's keywords) at runtime; StructuralFloor's declared
  // shape hides that from the compiler, which is why it needs a runtime pin.
  it('projects floor rows to render fields only, dropping retrieval bookkeeping', async () => {
    const ctx = await buildContext({
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
  it('receives floor rows that do carry the bookkeeping it drops', async () => {
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

  const base = () => ({ idMap: seededIdMap(LOC_A, LOC_B, LOC_C, LOC_D, CHAR_ID, CHAR_ID_2) })

  it('is empty when no retrieval ran', async () => {
    expect((await buildContext({ ...base(), retrieval: undefined })).locationIds).toEqual([])
  })

  it('collects every place the prompt renders an ID for, in reading order', async () => {
    const ctx = await buildContext({
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

  it('leaves out entities that are not places, from either the floor or the ranker', async () => {
    const ctx = await buildContext({
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

  it('de-duplicates a place the floor and the ranker both name', async () => {
    const ctx = await buildContext({
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
  const base = () => ({ idMap: seededIdMap(LOC_A, LOC_B) })

  it('reads the narrative tail, not an earlier entry, and substitutes the id', async () => {
    const ctx = await buildContext({
      ...base(),
      entries: [
        { ...entry('e1', 1, 'one'), metadata: sceneMetadata(LOC_A) },
        { ...entry('e2', 2, 'two'), metadata: sceneMetadata(LOC_B) },
      ] as never[],
    })
    expect(ctx.currentLocationId).toBe('l2')
  })

  it('falls back to null when the tail carries no location', async () => {
    const ctx = await buildContext({ ...base(), entries: [entry('e1', 1, 'one')] as never[] })
    expect(ctx.currentLocationId).toBeNull()
  })

  it('ignores a system row at the tail', async () => {
    const ctx = await buildContext({
      ...base(),
      entries: [
        { ...entry('e1', 1, 'one'), metadata: sceneMetadata(LOC_A) },
        { ...entry('sys', 2, 'ERROR', 'system'), metadata: sceneMetadata(LOC_B) },
      ] as never[],
    })
    expect(ctx.currentLocationId).toBe('l1')
  })
})

describe('buildGenerationContext — data source', () => {
  const dbEntry = (
    position: number,
    content: string,
    kind: StoryEntry['kind'] = 'ai_reply',
    metadata: EntryMetadata | null = null,
  ): StoryEntry => ({
    id: `entry_${position}`,
    branchId: 'b1',
    position,
    kind,
    content,
    chapterId: null,
    metadata,
    createdAt: position,
  })

  function openStory(overrides: Partial<StorySettings> = {}, branchId = 'b1') {
    currentStoryStore.set({
      storyId: 's1',
      branchId,
      definition: definition as never,
      settings: storySettings({ fullChapterInBuffer: true, protectedBuffer: 0, ...overrides }),
    })
    entitiesStore.hydrate(branchId, [])
  }

  async function build(
    intermediates: Record<string, unknown> = {},
    templateId: TemplateId = TEMPLATE_IDS.perTurnNarrative,
  ) {
    const load = await buildGenerationContext(phaseCtx(intermediates), {
      phaseName: 'narrative',
      templateId,
    })
    if (!load.ok) throw new Error(`expected a context, got ${JSON.stringify(load.result)}`)
    return load.context
  }

  it('composes entries from the database rather than a caller-supplied array', async () => {
    openStory()
    await seedEntries([dbEntry(1, 'first'), dbEntry(2, 'second')])

    const context = await build()

    expect((context.entries as { content: string }[]).map((e) => e.content)).toEqual([
      'first',
      'second',
    ])
  })

  it('exposes the last two non-system turns as lastTurns', async () => {
    openStory()
    await seedEntries([
      dbEntry(1, 'oldest'),
      dbEntry(2, 'user turn', 'user_action'),
      dbEntry(3, 'ai turn'),
      dbEntry(4, 'ERROR', 'system'),
    ])

    const context = await build({}, TEMPLATE_IDS.piggybackFallbackClassifier)

    expect((context.lastTurns as { content: string }[]).map((e) => e.content)).toEqual([
      'user turn',
      'ai turn',
    ])
  })

  it('scopes lastTurns to the branch', async () => {
    openStory()
    await seedEntries([
      dbEntry(1, 'ours'),
      { ...dbEntry(2, 'theirs'), id: 'entry_other', branchId: 'b2' },
    ])

    const context = await build({}, TEMPLATE_IDS.piggybackFallbackClassifier)

    expect((context.lastTurns as { content: string }[]).map((e) => e.content)).toEqual(['ours'])
  })

  it('projects entries to position and content, carrying no metadata', async () => {
    openStory()
    await seedEntries([
      dbEntry(1, 'prose', 'ai_reply', {
        sceneEntities: [],
        currentLocationId: null,
        worldTime: 42,
        summary: 'a summary',
        reasoning: 'model chain of thought',
      }),
    ])

    const narrative = await build()
    const classifier = await build({}, TEMPLATE_IDS.piggybackFallbackClassifier)

    const rows = [...narrative.entries, ...classifier.lastTurns] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['content', 'position'])
  })

  // The group's variable set does not shrink; the query behind an unread one does.
  it('skips the reads a template never mentions, leaving the variables empty', async () => {
    openStory()
    // Real scene state, or skipping the scene read would look the same as
    // reading a row that has none.
    await seedEntries([
      dbEntry(1, 'prose', 'ai_reply', {
        sceneEntities: [CHAR_ID],
        currentLocationId: LOC_A,
        worldTime: 7,
        summary: 'a summary',
      }),
      dbEntry(2, 'more prose', 'user_action', null),
    ])

    const narrative = await build()
    const classifier = await build({}, TEMPLATE_IDS.piggybackFallbackClassifier)

    expect(narrative.entries).toHaveLength(2)
    expect(narrative.lastTurns).toEqual([])
    expect(narrative.sceneMetadata).toMatchObject({ worldTime: 7, summary: 'a summary' })
    expect(classifier.lastTurns).toHaveLength(2)
    expect(classifier.entries).toEqual([])
    // The classifier reads no scene variable either, so its scene read is skipped.
    expect(classifier.sceneMetadata).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      summary: '',
    })
    for (const key of Object.keys(narrative)) expect(classifier).toHaveProperty(key)
  })

  it('takes sceneMetadata from the most recent AI entry, not the tail', async () => {
    openStory()
    await seedEntries([
      dbEntry(1, 'ai prose', 'ai_reply', {
        sceneEntities: [CHAR_ID],
        currentLocationId: LOC_A,
        worldTime: 42,
        summary: 'a summary',
        reasoning: 'model chain of thought',
      }),
      dbEntry(2, 'user prose', 'user_action', {
        sceneEntities: [],
        currentLocationId: null,
        worldTime: 0,
      }),
    ])

    const context = await build()

    expect(context.sceneMetadata).toEqual({
      sceneEntities: ['c1'],
      currentLocationId: 'l1',
      worldTime: 42,
      summary: 'a summary',
    })
    expect(context.sceneEntities).toEqual(['c1'])
    expect(context.currentLocationId).toBe('l1')
  })

  // resolveRef reads "in the id map" as "the model was shown this", so an id
  // that only ever appeared in an old entry's roster must not be resolvable.
  it('keeps a departed entity out of the id map when only history names it', async () => {
    openStory()
    await seedEntries([
      dbEntry(1, 'long ago', 'ai_reply', {
        sceneEntities: [CHAR_ID],
        currentLocationId: LOC_B,
        worldTime: 1,
      }),
      dbEntry(2, 'now', 'ai_reply', {
        sceneEntities: [],
        currentLocationId: LOC_A,
        worldTime: 2,
      }),
    ])

    const load = await buildGenerationContext(phaseCtx(), {
      phaseName: 'narrative',
      templateId: TEMPLATE_IDS.perTurnNarrative,
    })

    if (!load.ok) throw new Error('expected a context')
    expect(load.idMap.getPlaceholderFor(CHAR_ID)).toBeUndefined()
    expect(load.idMap.getPlaceholderFor(LOC_B)).toBeUndefined()
    expect(load.idMap.getPlaceholderFor(LOC_A)).toBeDefined()
  })

  it('leaves sceneMetadata empty on a branch with no AI entry yet', async () => {
    openStory()
    await seedEntries([dbEntry(1, 'user prose', 'user_action', null)])

    const context = await build()

    expect(context.sceneMetadata).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      summary: '',
    })
  })

  // Scene state is what the story is currently in, so it comes off the branch's
  // own tail rather than the window's: a chapter-assigned branch with no
  // protected floor composes an empty buffer, and the scene must survive that.
  it('takes scene state from the branch tail even when the buffer window is empty', async () => {
    openStory({ fullChapterInBuffer: false, partialChapterBuffer: 10, protectedBuffer: 0 })
    await seedEntries([
      {
        ...dbEntry(1, 'closed prose', 'ai_reply', {
          sceneEntities: [],
          currentLocationId: LOC_A,
          worldTime: 0,
        }),
        chapterId: 'chap_00000000-0000-4000-8000-00000000a001',
      },
    ])

    const context = await build()

    expect(context.entries).toEqual([])
    expect(context.currentLocationId).toBe('l1')
  })

  it('refuses the run when the open story is another branch', async () => {
    openStory({}, 'b2')

    const load = await buildGenerationContext(phaseCtx(), {
      phaseName: 'narrative',
      templateId: TEMPLATE_IDS.perTurnNarrative,
    })

    expect(load).toEqual({
      ok: false,
      result: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail: 'narrative: no open story for branch (story s1, branch b1)',
        },
      },
    })
  })

  it('refuses the run when the open story is another story on the same branch', async () => {
    currentStoryStore.set({
      storyId: 's2',
      branchId: 'b1',
      definition: definition as never,
      settings: storySettings(),
    })
    entitiesStore.hydrate('b1', [])

    const load = await buildGenerationContext(phaseCtx(), {
      phaseName: 'suggestion-emission',
      templateId: TEMPLATE_IDS.perTurnNarrative,
    })

    expect(load).toEqual({
      ok: false,
      result: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail: 'suggestion-emission: no open story for branch (story s1, branch b1)',
        },
      },
    })
  })

  it('refuses the run when the entities store is loaded for another branch', async () => {
    currentStoryStore.set({
      storyId: 's1',
      branchId: 'b1',
      definition: definition as never,
      settings: storySettings(),
    })
    entitiesStore.hydrate('b2', [])

    const load = await buildGenerationContext(phaseCtx(), {
      phaseName: 'piggyback-fallback-classifier',
      templateId: TEMPLATE_IDS.piggybackFallbackClassifier,
    })

    expect(load).toEqual({
      ok: false,
      result: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail:
            'piggyback-fallback-classifier: entities store loaded for another branch (story s1, branch b1)',
        },
      },
    })
  })

  it('reuses the run-scoped idMap so placeholders stay stable across phases', async () => {
    openStory()
    const idMap = new IdBiMap()
    const intermediates: Record<string, unknown> = { idMap }

    await build(intermediates)

    expect(intermediates.idMap).toBe(idMap)
  })

  it('installs an idMap on a run that has none, and hands it back', async () => {
    openStory()
    const intermediates: Record<string, unknown> = {}

    const load = await buildGenerationContext(phaseCtx(intermediates), {
      phaseName: 'narrative',
      templateId: TEMPLATE_IDS.perTurnNarrative,
    })

    if (!load.ok) throw new Error('expected a context')
    expect(load.idMap).toBeInstanceOf(IdBiMap)
    expect(intermediates.idMap).toBe(load.idMap)
  })
})
