import { describe, expect, it } from 'vitest'

import { storyDefinitionSchema, storySettingsSchema } from './story-config-schema'

const BASE_DEFINITION = {
  mode: 'creative' as const,
  leadEntityId: null,
  narration: 'third' as const,
  genre: { label: 'Cozy fantasy', promptBody: 'Warm, low-stakes fantasy.' },
  tone: { label: 'Gentle', promptBody: 'Kind and reassuring.' },
  setting: 'A sleepy village at the foot of a green mountain.',
  calendarSystemId: 'earth',
  worldTimeOrigin: { year: 1, month: 1, day: 1 },
}

const VALID_SETTINGS = {
  chapterTokenThreshold: 24000,
  chapterAutoClose: true,
  fullChapterInBuffer: false,
  partialChapterBuffer: 10,
  protectedBuffer: 10,
  classifierCadence: 8,
  piggybackMode: 'off' as const,
  embeddingBackend: 'local' as const,
  embedding_model_id: 'bge-small',
  retrievalBudgets: { entities: 100, lore: 100, happenings: 100, threads: 100, chapters: 100 },
  probe_mode_active: false,
  composerModesEnabled: false,
  composerWrapPov: 'first' as const,
  suggestionsEnabled: true,
  suggestionCount: 3,
  suggestionCategories: [],
  translation: {
    enabled: false,
    targetLanguage: null,
    granularToggles: {
      narrative: false,
      entityNames: false,
      entityDescriptions: false,
      lore: false,
      threads: false,
      happenings: false,
      chapterMeta: false,
    },
  },
  models: {},
  activePackId: null,
  packVariables: {},
}

describe('storyDefinitionSchema cross-field lead constraint', () => {
  it('rejects creative + first-person + null lead', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'creative',
      narration: 'first',
      leadEntityId: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['leadEntityId'])
    }
  })

  it('allows creative + third-person + null lead (omniscient ensemble)', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'creative',
      narration: 'third',
      leadEntityId: null,
    })
    expect(r.success).toBe(true)
  })

  it('rejects adventure + third-person + null lead', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'adventure',
      narration: 'third',
      leadEntityId: null,
    })
    expect(r.success).toBe(false)
  })

  it('allows adventure + third-person + a lead', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'adventure',
      narration: 'third',
      leadEntityId: 'ent_1',
    })
    expect(r.success).toBe(true)
  })

  it('rejects creative + second-person + null lead', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'creative',
      narration: 'second',
      leadEntityId: null,
    })
    expect(r.success).toBe(false)
  })

  it('allows creative + first-person + a lead', () => {
    const r = storyDefinitionSchema.safeParse({
      ...BASE_DEFINITION,
      mode: 'creative',
      narration: 'first',
      leadEntityId: 'ent_1',
    })
    expect(r.success).toBe(true)
  })
})

describe('storyDefinitionSchema field requirements', () => {
  it('accepts a complete valid definition', () => {
    expect(storyDefinitionSchema.safeParse(BASE_DEFINITION).success).toBe(true)
  })

  it('has no defaults — rejects an empty object', () => {
    expect(storyDefinitionSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an unknown mode', () => {
    expect(storyDefinitionSchema.safeParse({ ...BASE_DEFINITION, mode: 'sandbox' }).success).toBe(
      false,
    )
  })
})

describe('storySettingsSchema spec-pinned defaults', () => {
  it('fills the 7 spec-pinned defaults when absent', () => {
    const { chapterTokenThreshold: _a, ...rest } = VALID_SETTINGS
    const r = storySettingsSchema.safeParse({
      ...rest,
      chapterTokenThreshold: undefined,
      chapterAutoClose: undefined,
      fullChapterInBuffer: undefined,
      partialChapterBuffer: undefined,
      protectedBuffer: undefined,
      probe_mode_active: undefined,
      suggestionCount: undefined,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.chapterTokenThreshold).toBe(24000)
      expect(r.data.chapterAutoClose).toBe(true)
      expect(r.data.fullChapterInBuffer).toBe(false)
      expect(r.data.partialChapterBuffer).toBe(10)
      expect(r.data.protectedBuffer).toBe(10)
      expect(r.data.probe_mode_active).toBe(false)
      expect(r.data.suggestionCount).toBe(3)
    }
  })

  it('accepts a fully-populated settings object', () => {
    expect(storySettingsSchema.safeParse(VALID_SETTINGS).success).toBe(true)
  })

  it('rejects an empty object (required, non-defaulted fields absent)', () => {
    expect(storySettingsSchema.safeParse({}).success).toBe(false)
  })

  it('enforces suggestionCount range 1-6', () => {
    expect(storySettingsSchema.safeParse({ ...VALID_SETTINGS, suggestionCount: 0 }).success).toBe(
      false,
    )
    expect(storySettingsSchema.safeParse({ ...VALID_SETTINGS, suggestionCount: 7 }).success).toBe(
      false,
    )
    expect(storySettingsSchema.safeParse({ ...VALID_SETTINGS, suggestionCount: 6 }).success).toBe(
      true,
    )
  })

  it('accepts the optional fields when present', () => {
    const r = storySettingsSchema.safeParse({
      ...VALID_SETTINGS,
      embedding_swap_target: 'bge-large',
      embedding_provider_id: 'p1',
      effectiveDim: 256,
      models: { narrative: 'prof1', 'lore-mgmt': 'prof2' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects a structurally-invalid retrievalBudgets', () => {
    const r = storySettingsSchema.safeParse({
      ...VALID_SETTINGS,
      retrievalBudgets: { entities: 100 },
    })
    expect(r.success).toBe(false)
  })
})
