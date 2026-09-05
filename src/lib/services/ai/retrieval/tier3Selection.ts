/**
 * Tier 3 Selection
 *
 * The LLM selection step shared by `EntryRetrievalService` (lorebook entries) and
 * `WorldStateInjector` (live world state). Only the call itself is shared: how candidates
 * are built, and what cap and priority the result gets, stays with each caller.
 *
 * Both agree that nothing uncovered is silently dropped — each has a "small leftover"
 * branch that includes it without asking, and calls the model only for what is too big to
 * include. Both measure "too big" in words of candidate text, against their own
 * `tier3WholesaleWordBudget`; the budgets differ because their candidates do.
 */

import type { StoryEntry } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { entitySelectionSchema } from '../sdk/schemas/context'
import { generateStructured } from '../sdk/generate'
import { recentContent, AS_PROSE } from '$lib/utils/recentContent'
import { TIER3_SELECTION_CACHE_POSITIONS } from '../core/defaults'

import { activity } from '$lib/stores/activity.svelte'

const log = createLogger('Tier3Selection')

/**
 * Generic in `type` so a caller with a narrower vocabulary keeps it. `WorldStateInjector`
 * turns these straight into `WorldStateContextEntry`, whose `type` is a union of four
 * literals; a plain `string` here would force a cast at that boundary for no gain.
 */
export interface Tier3Candidate<TType extends string = string> {
  id: string
  type: TType
  name: string
  description: string | null
}

export interface Tier3SelectionResult {
  selectedIndices: Set<string>
  reasoning?: string
}

export interface Tier3SelectionRequest {
  /** Story whose pack supplies the template; undefined only outside a story. */
  storyId: string | undefined
  candidates: Tier3Candidate[]
  userInput: string
  recentEntries: StoryEntry[]
  recentEntriesCount: number
  presetId: string
  /**
   * Which caller this is, as it appears in the API Debug Logs.
   *
   * Both callers used to pass the same string, so the two selections were
   * indistinguishable in the log -- and since the view also filters by this value, there
   * was no way to look at one without the other. It does not affect which preset or
   * profile is used; that is `presetId`.
   */
  serviceLabel: string
  /**
   * The entry `userInput` was read from, so the prompt does not render the same action
   * twice. Matched by id rather than by text: translation rewrites the stored content, so
   * a text comparison stops recognising it exactly when the two diverge.
   */
  userActionEntryId?: string
  /** Step this selection nests under in the activity record. */
  activityParentId?: string
  /**
   * Current story position, used to age the selection cache. Omit to bypass the cache — a
   * caller that cannot say "when" cannot say whether a hit is still fresh.
   */
  currentPosition?: number
  signal?: AbortSignal
}

interface CachedSelection {
  /** What this answer is an answer to. Compared, not looked up — see below. */
  key: string
  position: number
  result: Tier3SelectionResult
}

/**
 * The last selection per caller. Module-level because the services are constructed once by
 * `ServiceFactory`, and the cache has to outlive a turn to be worth anything.
 *
 * Keyed by caller and holding one entry each, rather than keyed by the question: only the
 * most recent answer is ever reusable — the window is `TIER3_SELECTION_CACHE_POSITIONS`
 * positions wide — so keeping the others is growth with no hit rate behind it. Each key is
 * every candidate id concatenated, several KB on a large lorebook, retained for the whole
 * session on a WebView heap that is a hard cap on Android.
 *
 * Reset on story switch: entry ids are UUIDs and cannot collide, but a stale entry left
 * behind would still be answering about the wrong story if the same pool came back.
 */
const selectionCache = new Map<string, CachedSelection>()

/**
 * What a cached answer is an answer *to*: this caller, in this story, for this pool, in this
 * order, for this player action.
 *
 * The story matters because it picks the prompt pack, so two stories can ask the same
 * question of the same pool and get it phrased by different templates.
 *
 * Order matters because the answer is in index space — `"3"` means "the fourth candidate
 * in the list the prompt numbered". An order-independent key would resolve those indices
 * against a different ordering and name entirely different entries, which is reachable:
 * `WorldStateInjector` builds candidates from world state the classifier rewrites.
 *
 * The input matters because the answer is a judgement about a scene, not about the pool.
 * Keying on it means a reused answer is only ever reused for the same question — which is
 * what a retry or a second pass in the same turn asks — instead of answering a new action
 * with the previous one's verdict.
 *
 * The recent entries matter for exactly the same reason, and were missing. The prompt is
 * built from both, so keyed on the action alone two situations sharing a repeated action
 * ("continue", "wait") and an unmoved pool asked the same question as far as the cache
 * could see. Reachable across consecutive turns, and more easily still across a branch
 * switch, where two branches sit at the same position with the same lorebook and only
 * their history differs. Ids, not text: a slice of UUIDs is what distinguishes one history
 * from another, and translation rewrites the stored content without changing which entries
 * these are.
 *
 * With those in, the key is complete by content — the position window and the `clear` calls
 * are belt-and-braces rather than the thing standing between the cache and a wrong answer.
 */
function cacheKeyFor(
  serviceLabel: string,
  storyId: string | undefined,
  candidates: Tier3Candidate[],
  userInput: string,
  recentEntries: StoryEntry[],
  recentEntriesCount: number,
): string {
  return [
    serviceLabel,
    storyId ?? '',
    userInput,
    // The same slice the prompt is built from, so the key moves exactly when the prompt does.
    ...recentEntries.slice(-recentEntriesCount).map((e) => e.id),
    // Separator: without it a trailing history id and a leading candidate id could
    // rearrange into the same string across two different splits.
    '',
    ...candidates.map((c) => c.id),
  ].join('\u0000')
}

/** Exported for tests, and called when the story or the branch changes. */
export function clearTier3SelectionCache(): void {
  selectionCache.clear()
}

/**
 * Ask the LLM to select the most relevant candidates for this turn.
 * Returns `null` on failure — both callers treat that as "no Tier 3 entries".
 */
export async function runTier3Selection({
  storyId,
  candidates,
  userInput,
  recentEntries,
  recentEntriesCount,
  presetId,
  serviceLabel,
  userActionEntryId,
  activityParentId,
  currentPosition,
  signal,
}: Tier3SelectionRequest): Promise<Tier3SelectionResult | null> {
  if (candidates.length === 0) {
    return { selectedIndices: new Set() }
  }

  const cacheKey = cacheKeyFor(
    serviceLabel,
    storyId,
    candidates,
    userInput,
    recentEntries,
    recentEntriesCount,
  )
  const cached = currentPosition === undefined ? undefined : selectionCache.get(serviceLabel)
  if (
    cached &&
    currentPosition !== undefined &&
    cached.key === cacheKey &&
    // Strictly inside the window, not on its edge. A turn is exactly two positions, so
    // `<=` let a hit land on the *next* turn: same action text ("continue", "wait"), an
    // unchanged candidate pool, and last turn's verdict answering this turn's scene.
    // Either direction, because a retry moves the position back and is the same question.
    Math.abs(currentPosition - cached.position) < TIER3_SELECTION_CACHE_POSITIONS
  ) {
    log('Tier 3 selection reused from cache', {
      serviceLabel,
      candidates: candidates.length,
      selected: cached.result.selectedIndices.size,
    })
    activity.recordStep('Tier 3 selection', {
      parentId: activityParentId,
      detail: `cached · ${cached.result.selectedIndices.size} of ${candidates.length}`,
    })
    return cached.result
  }

  // `recentEntries` ends with the action in `userInput`, and the prompt renders both.
  // Sending it twice reads as emphasis the player never gave.
  const filteredRecent = userActionEntryId
    ? recentEntries.filter((e) => e.id !== userActionEntryId)
    : recentEntries

  const entrySummaries = candidates
    .map(
      (c, i) =>
        `${i}. [${c.type}] ${c.name}${c.description ? `: ${c.description.slice(0, 100)}` : ''}`,
    )
    .join('\n')

  const ctx = await ContextBuilder.forPack(storyId)
  ctx.add({
    recentContent: recentContent(filteredRecent, recentEntriesCount, AS_PROSE, { roles: true }),
    userInput,
    entrySummaries,
  })
  const { system, user: prompt } = await ctx.render('tier3-entry-selection')

  const stepId = activity.startStep('Tier 3 selection', {
    parentId: activityParentId,
    isLLM: true,
    detail: `${candidates.length} candidates`,
  })

  try {
    const result = await generateStructured(
      { presetId, schema: entitySelectionSchema, system, prompt, signal },
      serviceLabel,
    )
    const selection = {
      selectedIndices: new Set(result.selectedIndices),
      reasoning: result.reasoning,
    }
    if (currentPosition !== undefined) {
      selectionCache.set(serviceLabel, {
        key: cacheKey,
        position: currentPosition,
        result: selection,
      })
    }
    activity.endStep(stepId, 'done', `${selection.selectedIndices.size} of ${candidates.length}`)
    return selection
  } catch (error) {
    // Not cached: a failure says nothing about which candidates matter, and storing it
    // would suppress the retry that might succeed.
    activity.endStep(
      stepId,
      error instanceof Error && error.name === 'AbortError' ? 'skipped' : 'failed',
    )
    log('Tier 3 LLM selection failed', error)
    return null
  }
}

/**
 * Words the wholesale branch would put in the prompt for `entries`.
 *
 * Prices what the context block emits — `- <name>: <description>` per entry, with the
 * description truncated to `maxWordsPerEntry` — so the name counts too and nothing past
 * the truncation point does.
 */
export function countWholesaleWords(
  entries: { name?: string | null; description?: string | null }[],
  maxWordsPerEntry = 0,
): number {
  const wordsIn = (text: string | null | undefined) =>
    text?.trim() ? text.trim().split(/\s+/).length : 0

  let total = 0
  for (const entry of entries) {
    const description = wordsIn(entry.description)
    total +=
      wordsIn(entry.name) +
      (maxWordsPerEntry > 0 ? Math.min(description, maxWordsPerEntry) : description)
  }
  return total
}

/**
 * The prompt numbers the candidates and never renders an id, so the answer is an index.
 * The listing format (`0. [type] Name`) invites `"1."`, `"#1"` and `"[1]"` back, and each
 * is unambiguous once the only question is which digits.
 */
function extractIndex(raw: string): number | null {
  const match = /\d+/.exec(String(raw))
  if (!match) return null
  const index = Number.parseInt(match[0], 10)
  return Number.isSafeInteger(index) ? index : null
}

/**
 * Map a selection result back onto the candidate list by index. `candidates` must be in the
 * order `runTier3Selection` built the prompt from.
 *
 * Returned in the model's order, not candidate order: both callers cap the result, and
 * candidate order is an artifact of assembly — `WorldStateInjector` groups by type, so a
 * cap applied to it drops whole categories regardless of relevance.
 */
export function resolveTier3Selection<T extends { id: string }>(
  candidates: T[],
  result: Tier3SelectionResult,
): T[] {
  const selected: T[] = []
  const seen = new Set<number>()

  for (const raw of result.selectedIndices) {
    const index = extractIndex(raw)
    if (index === null) {
      log('Tier 3 selection dropped an unparseable entry', { raw })
      continue
    }
    if (index < 0 || index >= candidates.length || seen.has(index)) continue
    seen.add(index)
    selected.push(candidates[index])
  }

  return selected
}
