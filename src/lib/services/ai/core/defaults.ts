/**
 * Shipped defaults for values the settings store also holds.
 *
 * A leaf module on purpose: it imports nothing. The settings store and `AI_CONFIG` both
 * need these numbers, but `core/config.ts` imports the store, so the store could not
 * import back from it -- and the numbers were duplicated instead, under a comment asking
 * whoever changed one to remember the other. Two copies of a default that must agree is
 * exactly the kind of thing that quietly stops agreeing.
 *
 * Only defaults that genuinely live in both places belong here. Everything else stays
 * where it is used.
 */

/** Selection limits for `WorldStateInjector`. All exposed as Advanced Settings sliders. */
export const WORLD_STATE_INJECTION_DEFAULTS = {
  /**
   * Where "include the whole leftover" turns into "ask the model which of it matters".
   * See `WorldStateInjector.buildContext`.
   */
  llmThreshold: 30,
  /** Cap on Tier 2 (name matched). */
  maxTier2Entries: 40,
  /** Cap on Tier 3, in the branch where the LLM had to choose. */
  maxTier3Entries: 50,
} as const

/**
 * Selection limits for `EntryRetrievalService`.
 *
 * Deliberately tighter than the world-state caps above, for the same count. These entries
 * are paragraphs of authored prose; world-state records are one sentence the classifier
 * rewrote last turn. Equal counts would put roughly ten times as much text in the prompt
 * on this side, so equal counts is not the same as equal weight.
 */
export const ENTRY_RETRIEVAL_DEFAULTS = {
  /** Cap on Tier 2 (keyword matched). */
  maxTier2Entries: 20,
  /** Cap on Tier 3 (LLM selected). */
  maxTier3Entries: 30,
} as const

/** Limits for the agentic retrieval loop. Exposed as an Advanced Settings slider. */
export const AGENTIC_RETRIEVAL_DEFAULTS = {
  /**
   * Tool-calling rounds per turn. Measured runs finish in 3-5, so this only bounds the
   * worst case -- which is what it is for: each extra step re-sends the whole conversation.
   */
  maxIterations: 10,
  /**
   * Excerpts one grep_chapters call may quote. Raised twice: at 20 it still bound on every
   * search, and the agent answered the rest with `query_chapter` -- 33% of a turn's cost to
   * avoid ~1,200 tokens of quotes.
   */
  grepExcerptsPerSearch: 40,
} as const

/**
 * Chapter-read budget, as a multiple of `memoryConfig.tokenThreshold`.
 *
 * A chapter *is* roughly `tokenThreshold` tokens by construction -- `ChapterBatchPlanner`
 * accumulates entries until it crosses it -- so this reads as "about 2.5 chapters" and scales
 * with the user's own setting instead of being a number picked here. Verified on a real save:
 * threshold 16,000, measured chapter 17,245 tokens.
 */
export const CHAPTER_READ_BUDGET_RATIO = 2.5

/** Fallback when a story has no usable threshold. Mirrors `AI_CONFIG.memory.defaultTokenThreshold`. */
const DEFAULT_TOKEN_THRESHOLD = 16000

/** Token budget for the chapter text of one chapter-reading prompt. */
export function chapterReadBudget(tokenThreshold: number | undefined): number {
  const threshold =
    typeof tokenThreshold === 'number' && tokenThreshold > 0
      ? tokenThreshold
      : DEFAULT_TOKEN_THRESHOLD
  return Math.round(threshold * CHAPTER_READ_BUDGET_RATIO)
}

/** Max lorebook entries handed to the plot-suggestion generator. */
export const MAX_LOREBOOK_ENTRIES_FOR_SUGGESTIONS = 15
