import { describe, expect, it } from 'vitest'

import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, VARIABLES } from '@/lib/prompts'

import { buildGenerationContext } from './generation-context'

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

const settings = { partialChapterBuffer: 3 } as never

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
      entries: [],
      entities,
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.entities as { id: string }[])[0]!.id).toBe('c1')
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

  it('resolves calendarVocabulary for known calendar id and null for unknown', () => {
    const knownCtx = buildGenerationContext({
      entries: [],
      entities: [],
      definition: { ...definition, calendarSystemId: 'earth-gregorian' },
      settings,
      idMap: new IdBiMap(),
    })
    expect(knownCtx.calendarVocabulary).not.toBeNull()
    expect((knownCtx.calendarVocabulary as { baseUnitName: string }).baseUnitName).toBe('second')

    const unknownCtx = buildGenerationContext({
      entries: [],
      entities: [],
      definition: { ...definition, calendarSystemId: 'nonexistent-calendar' },
      settings,
      idMap: new IdBiMap(),
    })
    expect(unknownCtx.calendarVocabulary).toBeNull()
  })
})
