/**
 * Shipped defaults for values the settings store also holds.
 *
 * A leaf module on purpose: it imports nothing. The settings store and `AI_CONFIG` both
 * need these numbers, but `core/config.ts` imports the store, so the store could not
 * import back from it -- and the numbers were duplicated instead, under a comment asking
 * whoever changed one to remember the other. Two copies of a default that must agree is
 * exactly the kind of thing that quietly stops agreeing.
 *
 * **What belongs here, and what does not.** A constant a user can change — anything with
 * a control in Advanced Settings, or that a stored setting can override — lives here, as a
 * named `*_DEFAULTS` object, so the shipped value exists once and the settings store and
 * `AI_CONFIG` read the same one. A constant that guards a failure mode and has no control
 * — `GREP_NOISE_RATIO`, `MAX_LIST_ENTRIES`, `MAX_FINISH_REJECTIONS`, `MAX_CHAPTER_QUERIES_*`
 * — stays next to the code it protects, where the reasoning for the number is.
 *
 * The test of which one a constant is: would a user ever want to change it? If yes it is a
 * default and it goes here; if the honest answer is "they would want to change something
 * else instead", it is a guard and it stays put.
 *
 * The corollary, and the rule that keeps this file honest: **a consumer never writes
 * `?? <default>`.** The settings store merges every block over its defaults on load, so a
 * key is always present, and a fallback at the call site is a second copy of the number
 * that nothing forces to agree — the form that produced four stale defaults at once.
 */

/** Selection limits for `WorldStateInjector`. All exposed as Advanced Settings sliders. */
export const WORLD_STATE_INJECTION_DEFAULTS = {
  /**
   * Where "include the whole leftover" turns into "ask the model which of it matters",
   * in words of candidate text. Measured on a 101-record world state: a live record runs
   * ~16 words, so 500 is about the 30 records this replaced.
   */
  tier3WholesaleWordBudget: 500,
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
  /**
   * Where "include the whole leftover" turns into "ask the model which of it matters",
   * in words of entry text.
   *
   * Higher than the world state's because a lorebook entry is a paragraph, not a line:
   * measured at ~69 words against ~16. At 1000 a leftover of roughly fifteen entries still
   * goes in whole, which is cheaper in latency than the call it replaces.
   */
  tier3WholesaleWordBudget: 1000,
} as const

/**
 * How far the story may move before a cached Tier 3 selection is asked again, in story
 * positions. Exclusive: a distance of exactly this many misses.
 *
 * The cache key already pins the caller, the candidate pool and the player's action, so a
 * hit is the same question being asked twice — a retry, or a second pass in one turn. This
 * only bounds how long that stays true, and a turn is exactly two positions, so 2-exclusive
 * is "within the turn the answer was given for" and nothing beyond it.
 */
export const TIER3_SELECTION_CACHE_POSITIONS = 2

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

/** Limits for the lore management loop. `maxIterations` is an Advanced Settings slider. */
export const LORE_MANAGEMENT_DEFAULTS = {
  /**
   * Tool-calling rounds per session. Higher than retrieval's because the work is bounded
   * by the lorebook rather than by the turn, but not by much: `MAX_GROUPS` caps the
   * duplicate worklist at 20 and each group closes in **one** call (`merge_entries` or
   * `keep_separate`), so 25 covers the worklist plus a few reads. Past that a run is
   * going in circles, and every step re-sends a prompt whose head is tens of thousands of
   * characters of chapter summary. `finishOnlyOnLastStep` spends the last one on the
   * summary, so hitting the ceiling costs the account of the run, not the run.
   */
  maxIterations: 25,
  /**
   * Refuse to finish while a flagged duplicate group is unresolved. Off: it changes what a
   * run costs, and the worklist is in the prompt either way.
   */
  requireDuplicateResolution: false,
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

function thresholdOr(tokenThreshold: number | undefined): number {
  return typeof tokenThreshold === 'number' && tokenThreshold > 0
    ? tokenThreshold
    : DEFAULT_TOKEN_THRESHOLD
}

/** Token budget for the chapter text of one chapter-reading prompt. */
export function chapterReadBudget(tokenThreshold: number | undefined): number {
  return Math.round(thresholdOr(tokenThreshold) * CHAPTER_READ_BUDGET_RATIO)
}

/**
 * Rough characters per token, for a budget expressed in one and spent in the other.
 *
 * `splitRecentTail` measures characters -- deliberately, so it costs a sum of string
 * lengths rather than a tokenizer pass -- while the budget below is derived from a token
 * setting. An approximation is enough: what guarantees the agent sees the present scene is
 * `MIN_RECENT_ENTRIES_FOR_LORE`, and the budget only governs the cost above that floor.
 */
const CHARS_PER_TOKEN = 4

/**
 * Characters of un-chapterized story handed to lore management.
 *
 * The same ratio as a chapter read, against the user's own `tokenThreshold`, so it reads as
 * "about 2.5 chapters" on both sides. It was a fixed 16,384 characters -- roughly 4k tokens
 * against a default threshold of 16k, so the agent saw about a quarter of the material no
 * chapter summary covers, and raising the threshold made that share smaller with nothing to
 * say so.
 *
 * Normally the tail is far under this: a session runs just after a chapter was cut. It
 * binds where it matters -- a story with automatic summarization off, or one that has not
 * reached its first chapter, where the tail is the whole story.
 */
export function recentStoryBudgetChars(tokenThreshold: number | undefined): number {
  return Math.round(thresholdOr(tokenThreshold) * CHAPTER_READ_BUDGET_RATIO * CHARS_PER_TOKEN)
}

/** Max lorebook entries handed to the plot-suggestion generator. */
export const MAX_LOREBOOK_ENTRIES_FOR_SUGGESTIONS = 15
