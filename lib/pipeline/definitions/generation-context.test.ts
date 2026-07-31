import { describe, expect, it } from 'vitest'

import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, VARIABLES } from '@/lib/prompts'

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

const settings = { partialChapterBuffer: 3, suggestionCategories: [] } as never

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

describe('buildGenerationContext', () => {
  it('drops system entries outright and keeps the full caller-scoped window', () => {
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
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    const contents = (ctx.entries as { content: string }[]).map((e) => e.content)
    expect(contents).toEqual(['one', 'two', 'three', 'five'])
    expect(contents).not.toContain('ERROR')
  })

  it('exposes partialChapterBuffer through userSettings for template-side windowing', () => {
    const ctx = buildGenerationContext({
      branchId: 'b1',
      entries: [],
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect(ctx.userSettings).toEqual({ partialChapterBuffer: 3 })
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

  it('renders the per-turn template windowed to partialChapterBuffer', () => {
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
    const prompt = renderTemplate(TEMPLATE_IDS.perTurnNarrative, ctx)
    expect(prompt).toContain('# Setting')
    expect(prompt).toContain('# Genre')
    expect(prompt).not.toContain('# Tone') // whitespace-only tone.promptBody guarded out
    expect(prompt).toContain('The gate creaks open.')
    expect(prompt).toContain('third-line')
    expect(prompt).not.toContain('first-line') // outside the 3-entry window
    expect(prompt).not.toContain('second-line')
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
    const paletteSettings = {
      partialChapterBuffer: 3,
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
    } as never
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
      settings: { partialChapterBuffer: 3, suggestionCategories: [] } as never,
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
      settings: {
        partialChapterBuffer: 3,
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
      } as never,
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
      settings: {
        partialChapterBuffer: 3,
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
      } as never,
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
      settings: { partialChapterBuffer: 3, suggestionCount: 5, suggestionCategories: [] } as never,
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

  it('resolves calendarVocabulary for known calendar id and null for unknown', () => {
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
    expect(unknownCtx.calendarVocabulary).toBeNull()
  })
})
