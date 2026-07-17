import { describe, expect, it } from 'vitest'

import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { buildPerTurnGenerationContext } from './context'

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

describe('buildPerTurnGenerationContext', () => {
  it('keeps only the last partialChapterBuffer entries and drops system entries', () => {
    const entries = [
      entry('e1', 1, 'one'),
      entry('e2', 2, 'two'),
      entry('e3', 3, 'three'),
      entry('sys', 4, 'ERROR', 'system'),
      entry('e5', 5, 'five'),
    ] as never[]
    const ctx = buildPerTurnGenerationContext({
      entries,
      entities: [],
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    const contents = (ctx.entries as { content: string }[]).map((e) => e.content)
    expect(contents).toEqual(['two', 'three', 'five'])
    expect(contents).not.toContain('ERROR')
  })

  it('normalizes whitespace-only definitional fields to empty string', () => {
    const ctx = buildPerTurnGenerationContext({
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
    const ctx = buildPerTurnGenerationContext({
      entries: [],
      entities,
      definition,
      settings,
      idMap: new IdBiMap(),
    })
    expect((ctx.entities as { id: string }[])[0]!.id).toBe('c1')
  })

  it('renders the per-turn template with buffer + guarded headers', () => {
    const entries = [entry('e1', 1, 'The gate creaks open.')] as never[]
    const ctx = buildPerTurnGenerationContext({
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
  })
})
