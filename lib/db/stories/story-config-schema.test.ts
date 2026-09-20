import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  isStoryMode,
  STORY_MODES,
  storyDefinitionSchema,
  storySettingsPartialSchema,
  storySettingsSchema,
} from './story-config-schema'

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
  classifierContextEntries: 4,
  piggybackMode: 'off' as const,
  embeddingBackend: 'local' as const,
  embedding_model_id: 'bge-small',
  retrievalBudgets: { entities: 100, lore: 100, happenings: 100, threads: 100, chapters: 100 },
  keywordRetrieval: {
    mode: 'boost' as const,
    budgetShare: 0.5,
    scanEntries: 1,
    cascade: false,
    cascadeMaxDepth: 2,
  },
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
      embedding_swap_source_dim: 384,
      embedding_swap_target_dim: 768,
      embedding_provider_id: 'p1',
      effectiveDim: 256,
      models: {
        narrative: { providerId: 'prov-1', modelId: 'prof1' },
        'lore-mgmt': { providerId: 'prov-1', modelId: 'prof2' },
      },
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

  // Budgets are token counts the M7 sliders write straight into. A negative one
  // makes every candidate read as too large and seats nothing; Infinity puts NaN
  // in the funnel and leaves the prompt unbounded.
  it.each([-1, 1.5, Infinity, NaN])('rejects a token budget of %p', (value) => {
    const r = storySettingsSchema.safeParse({
      ...VALID_SETTINGS,
      retrievalBudgets: { ...VALID_SETTINGS.retrievalBudgets, lore: value },
    })
    expect(r.success).toBe(false)
  })

  it.each(['partialChapterBuffer', 'protectedBuffer'] as const)(
    'rejects a fractional %s rather than flooring it downstream',
    (key) => {
      const r = storySettingsSchema.safeParse({ ...VALID_SETTINGS, [key]: 2.5 })
      expect(r.success).toBe(false)
    },
  )
})

describe('storySettingsSchema keywordRetrieval', () => {
  const withKeyword = (over: Record<string, unknown>) => ({
    ...VALID_SETTINGS,
    keywordRetrieval: { ...VALID_SETTINGS.keywordRetrieval, ...over },
  })

  // Required, not defaulted: key-scoped json_set writes never reach an existing story's blob, so
  // migration 0011 backfills it — this assertion keeps schema and migration in step.
  it('requires the key', () => {
    const { keywordRetrieval: _omitted, ...without } = VALID_SETTINGS
    expect(storySettingsSchema.safeParse(without).success).toBe(false)
  })

  it('accepts both modes', () => {
    expect(storySettingsSchema.safeParse(withKeyword({ mode: 'boost' })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ mode: 'inject' })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ mode: 'always' })).success).toBe(false)
  })

  it('bounds budgetShare to 0..1', () => {
    expect(storySettingsSchema.safeParse(withKeyword({ budgetShare: 0 })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ budgetShare: 1 })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ budgetShare: 1.5 })).success).toBe(false)
    expect(storySettingsSchema.safeParse(withKeyword({ budgetShare: -0.1 })).success).toBe(false)
  })

  // Counts the trailing entries beside the always-scanned user action, so the floor is one.
  it('floors scanEntries at one whole entry', () => {
    expect(storySettingsSchema.safeParse(withKeyword({ scanEntries: 1 })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ scanEntries: 0 })).success).toBe(false)
    expect(storySettingsSchema.safeParse(withKeyword({ scanEntries: 1.5 })).success).toBe(false)
  })

  it('floors cascadeMaxDepth at one', () => {
    expect(storySettingsSchema.safeParse(withKeyword({ cascadeMaxDepth: 1 })).success).toBe(true)
    expect(storySettingsSchema.safeParse(withKeyword({ cascadeMaxDepth: 0 })).success).toBe(false)
  })
})

describe('storySettingsPartialSchema', () => {
  it('never materializes defaults — parse output equals the stored partial', () => {
    expect(storySettingsPartialSchema.parse({})).toEqual({})
    expect(storySettingsPartialSchema.parse({ activePackId: 'pack_x' })).toEqual({
      activePackId: 'pack_x',
    })
  })

  it('still validates present keys', () => {
    expect(storySettingsPartialSchema.safeParse({ chapterTokenThreshold: 'nope' }).success).toBe(
      false,
    )
    expect(storySettingsPartialSchema.safeParse({ suggestionCount: 7 }).success).toBe(false)
  })

  it('accepts a fully-populated settings object', () => {
    expect(storySettingsPartialSchema.safeParse(VALID_SETTINGS).success).toBe(true)
  })
})

describe('isStoryMode', () => {
  // Lead supplied because adventure mode refines on it; the point here is the
  // enum, not that cross-field rule.
  it('accepts every mode the schema enum accepts', () => {
    for (const mode of STORY_MODES) {
      expect(isStoryMode(mode)).toBe(true)
      expect(
        storyDefinitionSchema.safeParse({ ...BASE_DEFINITION, mode, leadEntityId: 'ent-lead' })
          .success,
      ).toBe(true)
    }
  })

  // The panel indexes palettes by this, so anything the predicate lets through
  // that the schema would reject is a lookup returning undefined.
  it.each([['sandbox'], ['Adventure'], [''], ['constructor']])(
    'rejects %j, which the schema also rejects',
    (value) => {
      expect(isStoryMode(value)).toBe(false)
      expect(storyDefinitionSchema.safeParse({ ...BASE_DEFINITION, mode: value }).success).toBe(
        false,
      )
    },
  )

  it('rejects non-strings without throwing', () => {
    for (const value of [null, undefined, 0, {}, []]) expect(isStoryMode(value)).toBe(false)
  })
})

/**
 * Required = no `.default()`/`.optional()`: a blob predating a key fails parse and won't open.
 * Key-scoped `json_set` writes (settings-ops.ts) never reach an existing blob, so each key here
 * owes a backfill migration — 0007, 0011 and 0013 carry the ones added since; the rest shipped
 * with 0000. Making the key `.optional()` / `.default()` instead needs no entry here.
 */
const REQUIRED_SETTINGS_KEYS = [
  'activePackId',
  'classifierCadence',
  'classifierContextEntries',
  'composerModesEnabled',
  'composerWrapPov',
  'embeddingBackend',
  'embedding_model_id',
  'keywordRetrieval',
  'models',
  'packVariables',
  'piggybackMode',
  'retrievalBudgets',
  'suggestionCategories',
  'suggestionsEnabled',
  'translation',
] as const

describe('storySettingsSchema backfill obligations', () => {
  it('has no required key that is not on the allowlist', () => {
    const required = Object.entries(storySettingsSchema.shape)
      .filter(([, field]) => !(field instanceof z.ZodDefault) && !(field instanceof z.ZodOptional))
      .map(([key]) => key)
      .sort()
    expect(required).toEqual([...REQUIRED_SETTINGS_KEYS].sort())
  })
})

describe('models overrides are provider-qualified', () => {
  const base = {
    classifierCadence: 5,
    classifierContextEntries: 4,
    piggybackMode: 'off',
    embeddingBackend: 'local',
    embedding_model_id: 'm',
    retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
    keywordRetrieval: {
      mode: 'boost',
      budgetShare: 0.5,
      scanEntries: 1,
      cascade: false,
      cascadeMaxDepth: 2,
    },
    composerModesEnabled: true,
    composerWrapPov: 'first',
    suggestionsEnabled: false,
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
    activePackId: null,
    packVariables: {},
  }

  it('accepts a { providerId, modelId } override per story target', () => {
    const parsed = storySettingsSchema.parse({
      ...base,
      models: {
        narrative: { providerId: 'prov-1', modelId: 'm-narr' },
        'lore-mgmt': { providerId: 'prov-2', modelId: 'm-lore' },
      },
    })
    expect(parsed.models).toEqual({
      narrative: { providerId: 'prov-1', modelId: 'm-narr' },
      'lore-mgmt': { providerId: 'prov-2', modelId: 'm-lore' },
    })
  })

  it('rejects a bare model-id string override', () => {
    expect(() => storySettingsSchema.parse({ ...base, models: { narrative: 'bare-id' } })).toThrow()
  })

  it('has no slot for the global wizard-assist agent', () => {
    const parsed = storySettingsSchema.parse({
      ...base,
      models: { 'wizard-assist': { providerId: 'p', modelId: 'm' } },
    })
    expect(parsed.models).toEqual({})
  })

  // `resolveModel` reports `ok` for a ref whose modelId is blank, pre-flight passes
  // it, and the provider call fires with no model — so the ref has to refuse it.
  it('rejects a ref whose halves do not name anything', () => {
    for (const models of [
      { narrative: { providerId: 'prov-1', modelId: '' } },
      { narrative: { providerId: 'prov-1', modelId: '   ' } },
      { narrative: { providerId: '', modelId: 'm-narr' } },
    ]) {
      expect(() => storySettingsSchema.parse({ ...base, models })).toThrow()
    }
  })

  it('stores a padded model id trimmed, the form it was validated in', () => {
    const parsed = storySettingsSchema.parse({
      ...base,
      models: { narrative: { providerId: 'prov-1', modelId: '  m-narr  ' } },
    })
    expect(parsed.models.narrative).toEqual({ providerId: 'prov-1', modelId: 'm-narr' })
  })
})

describe('storySettingsSchema — knob bounds', () => {
  // The Memory tab holds both of these to a whole number of at least 1, and no
  // surface writes them any other way, so a stored 0 or fraction is unreachable
  // and unrepairable: the panel would refuse every save naming an untouched field.
  it('rejects a zero or fractional chapter threshold and classifier cadence', () => {
    for (const patch of [
      { chapterTokenThreshold: 0 },
      { chapterTokenThreshold: 12000.5 },
      { chapterTokenThreshold: -1 },
      { classifierCadence: 0 },
      { classifierCadence: 4.5 },
      { classifierCadence: -2 },
    ]) {
      expect(() => storySettingsSchema.parse({ ...VALID_SETTINGS, ...patch })).toThrow()
    }
  })

  it('keeps accepting the values the knobs can produce', () => {
    const parsed = storySettingsSchema.parse({
      ...VALID_SETTINGS,
      chapterTokenThreshold: 1,
      classifierCadence: 1,
      partialChapterBuffer: 0,
      protectedBuffer: 0,
    })
    expect(parsed.chapterTokenThreshold).toBe(1)
    expect(parsed.classifierCadence).toBe(1)
    expect(parsed.partialChapterBuffer).toBe(0)
  })

  // Deliberately looser than its neighbours: a hand-edited 0 degrades at read time
  // rather than refusing to open the story.
  it('still tolerates a zero classifier context window', () => {
    expect(
      storySettingsSchema.parse({ ...VALID_SETTINGS, classifierContextEntries: 0 }),
    ).toMatchObject({
      classifierContextEntries: 0,
    })
  })
})
