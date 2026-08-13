import { describe, expect, it } from 'vitest'

import {
  emptyCastDraft,
  emptyWorkingState,
  wizardCastDraftSchema,
  wizardWorkingStateSchema,
} from './working-state'

describe('wizardWorkingStateSchema', () => {
  it('emptyWorkingState parses and starts on step 1 with creative/third defaults', () => {
    const s = emptyWorkingState()
    expect(() => wizardWorkingStateSchema.parse(s)).not.toThrow()
    expect(s.step).toBe(1)
    expect(s.definition.mode).toBe('creative')
    expect(s.definition.narration).toBe('third')
    expect(s.leadName).toBe('')
    expect(s.opening.content).toBe('')
  })
  it('round-trips a fully-populated state', () => {
    const s = emptyWorkingState()
    s.definition.title = 'T'
    s.opening.content = 'Once.'
    s.opening.model = 'gpt-x'
    expect(() => wizardWorkingStateSchema.parse(s)).not.toThrow()
  })

  it('gives each call fresh object/array defaults (no shared mutable references)', () => {
    const a = emptyWorkingState()
    const b = emptyWorkingState()
    expect(a.definition.worldTimeOrigin).not.toBe(b.definition.worldTimeOrigin)
    expect(a.opening.sceneEntities).not.toBe(b.opening.sceneEntities)

    a.definition.worldTimeOrigin.year = 5
    a.opening.sceneEntities.push('entity_1')
    expect(b.definition.worldTimeOrigin).toEqual({})
    expect(b.opening.sceneEntities).toEqual([])
  })
})

describe('lore drafts', () => {
  it('defaults to an empty list on a fresh state', () => {
    expect(emptyWorkingState().lore).toEqual([])
  })

  it('parses a pre-3.6a blob that has no lore key at all', () => {
    // A session saved before this slice; must reopen without data loss.
    const legacy = { step: 5, leadName: 'Wren', definition: { title: 'Salt Road' } }
    const parsed = wizardWorkingStateSchema.parse(legacy)
    expect(parsed.lore).toEqual([])
    expect(parsed.leadName).toBe('Wren')
    expect(parsed.definition.title).toBe('Salt Road')
  })

  it('round-trips every More-options field', () => {
    const row = {
      id: 'lore_11111111-1111-4111-8111-111111111111',
      title: 'Magic systems',
      body: 'Magic flows from sealed wells.',
      category: 'cosmology',
      tags: ['magic', 'wells'],
      injectionMode: 'always' as const,
      priority: 7,
    }
    expect(
      wizardWorkingStateSchema.parse(JSON.parse(JSON.stringify({ lore: [row] }))).lore[0],
    ).toEqual(row)
  })

  it('fills More-options defaults when a row omits them', () => {
    const parsed = wizardWorkingStateSchema.parse({
      lore: [{ id: 'lore_1', title: 'T', body: 'B' }],
    })
    expect(parsed.lore[0]).toMatchObject({
      category: '',
      tags: [],
      injectionMode: 'auto',
      priority: 0,
    })
  })
})

describe('cast drafts', () => {
  it('defaults a pre-3.6b blob to an empty cast array', () => {
    expect(wizardWorkingStateSchema.parse({}).cast).toEqual([])
  })

  it('emptyCastDraft fills per-kind defaults', () => {
    const char = emptyCastDraft('character', 'char_1')
    expect(char).toMatchObject({
      kind: 'character',
      id: 'char_1',
      name: '',
      status: 'active',
      traits: [],
      drives: [],
      visual: { physique: '', distinguishing: '' },
      factionId: null,
      tags: [],
    })
    expect(emptyCastDraft('location', 'loc_1')).toMatchObject({
      kind: 'location',
      parentLocationId: null,
      condition: '',
    })
    expect(emptyCastDraft('item', 'item_1')).toMatchObject({ kind: 'item', condition: '' })
    expect(emptyCastDraft('faction', 'fact_1')).toMatchObject({
      kind: 'faction',
      agenda: [],
      standing: '',
    })
  })

  it('rejects a status outside active|staged', () => {
    expect(
      wizardCastDraftSchema.safeParse({ kind: 'character', id: 'x', status: 'retired' }).success,
    ).toBe(false)
  })
})
