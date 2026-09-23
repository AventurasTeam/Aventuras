import { describe, expect, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import {
  cadenceOverlap,
  MEMORY_KNOBS_KEYS,
  memoryKnobsDirtyKeys,
  thresholdPreset,
  toMemoryKnobsDraft,
  toMemoryKnobsPatch,
  validateMemoryKnobs,
  type MemoryKnobsDraft,
  type MemoryKnobsProblem,
} from './memory-knobs'

const SETTINGS = STORY_SETTINGS_DEFAULTS

// Every knob off its default and distinct from same-typed neighbours, so a
// helper that reads the wrong field, or a literal, can't pass.
const TUNED: StorySettings = {
  ...SETTINGS,
  chapterTokenThreshold: 48000,
  chapterAutoClose: false,
  fullChapterInBuffer: true,
  partialChapterBuffer: 12,
  protectedBuffer: 6,
  classifierContextEntries: 3,
  classifierCadence: 7,
  retrievalBudgets: { entities: 100, lore: 200, happenings: 300, threads: 400, chapters: 500 },
  keywordRetrieval: {
    mode: 'inject',
    budgetShare: 0.25,
    scanEntries: 2,
    cascade: true,
    cascadeMaxDepth: 4,
  },
}

describe('memory knobs draft', () => {
  it('reads clean against its own settings and patches every owned key wholesale', () => {
    const draft = toMemoryKnobsDraft(SETTINGS)
    expect(memoryKnobsDirtyKeys(draft, SETTINGS)).toEqual([])
    expect(validateMemoryKnobs(draft)).toBeNull()
    expect(toMemoryKnobsPatch(draft)).toEqual({
      chapterTokenThreshold: 24000,
      chapterAutoClose: true,
      fullChapterInBuffer: false,
      partialChapterBuffer: 10,
      protectedBuffer: 10,
      classifierContextEntries: 4,
      classifierCadence: 5,
      retrievalBudgets: SETTINGS.retrievalBudgets,
      keywordRetrieval: SETTINGS.keywordRetrieval,
    })
  })

  it('carries every knob from the draft into the patch', () => {
    const draft = toMemoryKnobsDraft(TUNED)
    expect(memoryKnobsDirtyKeys(draft, TUNED)).toEqual([])
    expect(toMemoryKnobsPatch(draft)).toEqual({
      chapterTokenThreshold: 48000,
      chapterAutoClose: false,
      fullChapterInBuffer: true,
      partialChapterBuffer: 12,
      protectedBuffer: 6,
      classifierContextEntries: 3,
      classifierCadence: 7,
      retrievalBudgets: { entities: 100, lore: 200, happenings: 300, threads: 400, chapters: 500 },
      keywordRetrieval: {
        mode: 'inject',
        budgetShare: 0.25,
        scanEntries: 2,
        cascade: true,
        cascadeMaxDepth: 4,
      },
    })
  })

  it('copies the nested objects, so a draft edit never reaches the stored settings', () => {
    const draft = toMemoryKnobsDraft(SETTINGS)
    expect(draft.retrievalBudgets).not.toBe(SETTINGS.retrievalBudgets)
    expect(draft.keywordRetrieval).not.toBe(SETTINGS.keywordRetrieval)
  })

  it('reports changed keys in tab order, nested objects by value', () => {
    const draft = {
      ...toMemoryKnobsDraft(SETTINGS),
      classifierCadence: 8,
      retrievalBudgets: { ...SETTINGS.retrievalBudgets, lore: 2000 },
      keywordRetrieval: { ...SETTINGS.keywordRetrieval },
    }
    expect(memoryKnobsDirtyKeys(draft, SETTINGS)).toEqual(['classifierCadence', 'retrievalBudgets'])
  })

  it('lists all nine keys in tab order when every knob changes', () => {
    expect(memoryKnobsDirtyKeys(toMemoryKnobsDraft(TUNED), SETTINGS)).toEqual([
      'chapterTokenThreshold',
      'chapterAutoClose',
      'fullChapterInBuffer',
      'partialChapterBuffer',
      'protectedBuffer',
      'classifierContextEntries',
      'classifierCadence',
      'retrievalBudgets',
      'keywordRetrieval',
    ])
  })

  it.each([
    ['threshold', { chapterTokenThreshold: 0 }],
    ['threshold', { chapterTokenThreshold: null }],
    ['partialBuffer', { partialChapterBuffer: -1 }],
    ['protectedBuffer', { protectedBuffer: -1 }],
    ['protectedBuffer', { protectedBuffer: null }],
    ['cadence', { classifierCadence: 0 }],
    ['cadence', { classifierCadence: 2.5 }],
    ['budget', { retrievalBudgets: { ...SETTINGS.retrievalBudgets, lore: null } }],
    ['budget', { retrievalBudgets: { ...SETTINGS.retrievalBudgets, entities: -1 } }],
    ['budgetShare', { keywordRetrieval: { ...SETTINGS.keywordRetrieval, budgetShare: 1.5 } }],
    ['budgetShare', { keywordRetrieval: { ...SETTINGS.keywordRetrieval, budgetShare: -0.1 } }],
    [
      'budgetShare',
      { keywordRetrieval: { ...SETTINGS.keywordRetrieval, budgetShare: Number.NaN } },
    ],
    ['scanEntries', { keywordRetrieval: { ...SETTINGS.keywordRetrieval, scanEntries: 0 } }],
    ['cascadeDepth', { keywordRetrieval: { ...SETTINGS.keywordRetrieval, cascadeMaxDepth: 0 } }],
    ['cascadeDepth', { keywordRetrieval: { ...SETTINGS.keywordRetrieval, cascadeMaxDepth: null } }],
  ] as const)('reports %s for %o', (problem, override) => {
    expect(validateMemoryKnobs({ ...toMemoryKnobsDraft(SETTINGS), ...override })).toBe(problem)
  })

  it('accepts each knob at its floor, and a budget share of 0 or 1', () => {
    const floor: MemoryKnobsDraft = {
      ...toMemoryKnobsDraft(SETTINGS),
      chapterTokenThreshold: 1,
      partialChapterBuffer: 0,
      protectedBuffer: 0,
      classifierCadence: 1,
      retrievalBudgets: { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
      keywordRetrieval: {
        ...SETTINGS.keywordRetrieval,
        budgetShare: 0,
        scanEntries: 1,
        cascadeMaxDepth: 1,
      },
    }
    expect(validateMemoryKnobs(floor)).toBeNull()
    const fullShare = { ...floor.keywordRetrieval, budgetShare: 1 }
    expect(validateMemoryKnobs({ ...floor, keywordRetrieval: fullShare })).toBeNull()
  })

  it('reports the first problem in tab order', () => {
    const fixes: ((draft: MemoryKnobsDraft) => MemoryKnobsDraft)[] = [
      (d) => ({ ...d, chapterTokenThreshold: 24000 }),
      (d) => ({ ...d, partialChapterBuffer: 10 }),
      (d) => ({ ...d, protectedBuffer: 10 }),
      (d) => ({ ...d, classifierCadence: 5 }),
      (d) => ({ ...d, retrievalBudgets: { ...d.retrievalBudgets, lore: 1800 } }),
      (d) => ({ ...d, keywordRetrieval: { ...d.keywordRetrieval, budgetShare: 0.5 } }),
      (d) => ({ ...d, keywordRetrieval: { ...d.keywordRetrieval, scanEntries: 1 } }),
      (d) => ({ ...d, keywordRetrieval: { ...d.keywordRetrieval, cascadeMaxDepth: 2 } }),
    ]
    let draft: MemoryKnobsDraft = {
      ...toMemoryKnobsDraft(SETTINGS),
      chapterTokenThreshold: null,
      partialChapterBuffer: null,
      protectedBuffer: null,
      classifierCadence: null,
      retrievalBudgets: { ...SETTINGS.retrievalBudgets, lore: null },
      keywordRetrieval: {
        ...SETTINGS.keywordRetrieval,
        budgetShare: null,
        scanEntries: null,
        cascadeMaxDepth: null,
      },
    }
    const reported: (MemoryKnobsProblem | null)[] = [validateMemoryKnobs(draft)]
    for (const fix of fixes) {
      draft = fix(draft)
      reported.push(validateMemoryKnobs(draft))
    }
    expect(reported).toEqual([
      'threshold',
      'partialBuffer',
      'protectedBuffer',
      'cadence',
      'budget',
      'budgetShare',
      'scanEntries',
      'cascadeDepth',
      null,
    ])
  })

  it('refuses to build a patch from an invalid draft', () => {
    expect(() =>
      toMemoryKnobsPatch({ ...toMemoryKnobsDraft(SETTINGS), classifierCadence: null }),
    ).toThrow()
  })
})

describe('presets and cadence', () => {
  it('maps the three preset token counts and everything else to custom', () => {
    expect(thresholdPreset(8000)).toBe('short')
    expect(thresholdPreset(24000)).toBe('balanced')
    expect(thresholdPreset(48000)).toBe('long')
    expect(thresholdPreset(9000)).toBe('custom')
    expect(thresholdPreset(null)).toBe('custom')
  })

  it('overlap is partial buffer minus the worst-case cadence; null inputs give null', () => {
    expect(cadenceOverlap(10, 8)).toBe(1)
    expect(cadenceOverlap(10, 5)).toBe(4)
    expect(cadenceOverlap(5, 5)).toBe(-1)
    expect(cadenceOverlap(10, 12)).toBe(-3)
    expect(cadenceOverlap(null, 8)).toBeNull()
    expect(cadenceOverlap(10, null)).toBeNull()
  })
})

// `t` echoes a key it cannot resolve, so a test comparing two `t()` calls passes
// with the copy missing. The panel builds both families by template literal, so
// nothing else would notice a dropped entry until it rendered as a raw key.
describe('locale coverage for the knob key families', () => {
  it('resolves a field label for every knob key', () => {
    for (const key of MEMORY_KNOBS_KEYS) {
      expect(hasCopy(`storySettings:memory.knobs.field.${key}`)).toBe(true)
    }
  })

  it('resolves an invalid reason for every problem', () => {
    // A Record, so adding a problem to the union fails to compile here rather
    // than silently going unchecked.
    const problems: Record<MemoryKnobsProblem, true> = {
      threshold: true,
      partialBuffer: true,
      protectedBuffer: true,
      cadence: true,
      budget: true,
      budgetShare: true,
      scanEntries: true,
      cascadeDepth: true,
    }
    for (const problem of Object.keys(problems) as MemoryKnobsProblem[]) {
      expect(hasCopy(`storySettings:memory.knobs.invalid.${problem}`)).toBe(true)
    }
  })
})
