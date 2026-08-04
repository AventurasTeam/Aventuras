import { describe, it, expect } from 'vitest'
import {
  AGENTIC_RETRIEVAL_DEFAULTS,
  CHAPTER_READ_BUDGET_RATIO,
  chapterReadBudget,
  ENTRY_RETRIEVAL_DEFAULTS,
  WORLD_STATE_INJECTION_DEFAULTS,
} from './defaults'

describe('chapterReadBudget', () => {
  it("scales with the story's own chapterization threshold", () => {
    // A chapter *is* roughly `tokenThreshold` tokens by construction, so the budget reads
    // as "about 2.5 chapters" rather than as a number picked here.
    expect(chapterReadBudget(16_000)).toBe(40_000)
    expect(chapterReadBudget(4_000)).toBe(10_000)
  })

  it('falls back for a story with no usable threshold', () => {
    const fallback = 16_000 * CHAPTER_READ_BUDGET_RATIO

    expect(chapterReadBudget(undefined)).toBe(fallback)
    expect(chapterReadBudget(0)).toBe(fallback)
    // Negative is not a threshold anyone set; treating it as one would produce a budget
    // that omits every chapter and a prompt of nothing but the truncation marker.
    expect(chapterReadBudget(-1)).toBe(fallback)
  })

  it('returns a whole number of tokens', () => {
    // The budget is compared against integer `metadata.tokenCount` sums.
    expect(Number.isInteger(chapterReadBudget(4_001))).toBe(true)
  })
})

describe('shipped defaults', () => {
  it('keeps entry retrieval tighter than world-state injection at every tier', () => {
    // Not a style preference: entries are paragraphs of authored prose, world-state records
    // are one sentence the classifier rewrote last turn. Equal counts would put roughly ten
    // times as much text in the prompt on the entry side.
    expect(ENTRY_RETRIEVAL_DEFAULTS.maxTier2Entries).toBeLessThan(
      WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries,
    )
    expect(ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries).toBeLessThan(
      WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries,
    )
  })

  it('allows the agent enough steps to reach finish_retrieval after working', () => {
    // `finishOnlyOnLastStep` spends the final step on the summary, so a ceiling this low
    // would leave no steps to summarize anything from.
    expect(AGENTIC_RETRIEVAL_DEFAULTS.maxIterations).toBeGreaterThan(1)
  })
})
