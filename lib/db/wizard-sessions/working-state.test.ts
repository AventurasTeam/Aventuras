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

    const c = emptyCastDraft('character', 'char_1')
    const d = emptyCastDraft('character', 'char_2')
    expect(c.visual).not.toBe(d.visual)
    expect(c.traits).not.toBe(d.traits)
    expect(c.tags).not.toBe(d.tags)

    c.visual.physique = 'tall'
    c.traits.push('bold')
    c.tags.push('lead')
    expect(d.visual.physique).toBe('')
    expect(d.traits).toEqual([])
    expect(d.tags).toEqual([])
  })
})

describe('lore drafts', () => {
  it('defaults to an empty list on a fresh state', () => {
    expect(emptyWorkingState().lore).toEqual([])
  })

  it('parses a pre-3.6a blob that has no lore key at all', () => {
    // A session saved before this slice; must reopen without data loss.
    const legacy = { step: 5, definition: { title: 'Salt Road' } }
    const parsed = wizardWorkingStateSchema.parse(legacy)
    expect(parsed.lore).toEqual([])
    expect(parsed.definition.title).toBe('Salt Road')
  })

  // The bare lead name is deliberately NOT migrated (06b acceptance criteria);
  // what must hold is that its presence doesn't fail the parse and strand the
  // whole draft on the corrupt-state path.
  it("strips a pre-3.6b blob's bare lead name instead of rejecting the draft", () => {
    const legacy = { step: 5, leadName: 'Wren', definition: { title: 'Salt Road' } }
    const parsed = wizardWorkingStateSchema.parse(legacy)
    expect(parsed).not.toHaveProperty('leadName')
    expect(parsed.cast).toEqual([])
    expect(parsed.step).toBe(5)
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
    // Character is the widest kind — covers every shared field plus the
    // nested visual object — so toEqual here also pins the shared columns.
    expect(emptyCastDraft('character', 'char_1')).toEqual({
      kind: 'character',
      id: 'char_1',
      name: '',
      description: '',
      status: 'active',
      voice: '',
      traits: [],
      drives: [],
      factionId: null,
      tags: [],
      visual: { physique: '', face: '', hair: '', eyes: '', attire: '', distinguishing: '' },
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
