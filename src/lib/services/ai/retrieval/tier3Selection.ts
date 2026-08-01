/**
 * Tier 3 Selection
 *
 * Shared LLM-based candidate selection step used by both `EntryRetrievalService`
 * (lorebook `Entry[]` candidates) and `WorldStateInjector` (live `Character`/
 * `Location`/`Item`/`StoryBeat` candidates). Only the LLM call itself -- prompt
 * rendering, the `generateStructured` call, and mapping the result back onto the
 * candidate list -- is identical between the two callers. How candidates are
 * built, and what priority/cap is applied to the result, differs per caller and
 * intentionally stays there.
 *
 * *Whether it runs at all* also differs, though the two now agree on the principle: nothing
 * uncovered is ever silently dropped. `EntryRetrievalService` asks the model about any
 * leftover at all; `WorldStateInjector` includes a small leftover wholesale and only asks
 * once there is more of it than `llmThreshold` (default 30) -- for it the call is an
 * alternative to including everything, not a precondition for including anything.
 */

import type { StoryEntry } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { entitySelectionSchema } from '../sdk/schemas/context'
import { generateStructured } from '../sdk/generate'
import { recentContent, AS_PROSE } from '$lib/utils/recentContent'

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
  selectedIds: Set<string>
  reasoning?: string
}

export interface Tier3SelectionRequest {
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
  signal?: AbortSignal
}

/**
 * Ask the LLM to select the most relevant candidates for this turn.
 * Returns `null` on failure -- both current callers treat that as "no Tier 3 entries".
 *
 * Takes an object: it had six positional parameters before this one, and a seventh would
 * have made the call sites unreadable.
 */
export async function runTier3Selection({
  candidates,
  userInput,
  recentEntries,
  recentEntriesCount,
  presetId,
  serviceLabel,
  signal,
}: Tier3SelectionRequest): Promise<Tier3SelectionResult | null> {
  if (candidates.length === 0) {
    return { selectedIds: new Set() }
  }

  const entrySummaries = candidates
    .map(
      (c, i) =>
        `${i}. [${c.type}] ${c.name}${c.description ? `: ${c.description.slice(0, 100)}` : ''}`,
    )
    .join('\n')

  const ctx = new ContextBuilder()
  ctx.add({
    recentContent: recentContent(recentEntries, recentEntriesCount, AS_PROSE),
    userInput,
    entrySummaries,
  })
  const { system, user: prompt } = await ctx.render('tier3-entry-selection')

  try {
    const result = await generateStructured(
      { presetId, schema: entitySelectionSchema, system, prompt, signal },
      serviceLabel,
    )
    return { selectedIds: new Set(result.selectedIds), reasoning: result.reasoning }
  } catch (error) {
    log('Tier 3 LLM selection failed', error)
    return null
  }
}

/**
 * Map an LLM selection result back onto the original candidate list, matching by
 * id (preferred) or by numeric index (some models return indices instead of ids).
 * `candidates` must be in the same order used to build the prompt in `runTier3Selection`.
 *
 * Returned in the order the model listed them, not in candidate order. Both callers cap
 * the result, and candidate order is an artifact of how the prompt was assembled -- for
 * `WorldStateInjector` it is grouped by type, so a cap applied to it drops whole
 * categories (every story beat, always) regardless of what the model thought mattered.
 * A model's own ordering is at least a claim about relevance. `Set` preserves insertion
 * order, so this is information already in hand rather than a new contract.
 */
export function resolveTier3Selection<T extends { id: string }>(
  candidates: T[],
  result: Tier3SelectionResult,
): T[] {
  const rank = new Map([...result.selectedIds].map((id, order) => [id, order]))

  const selected: { candidate: T; rank: number }[] = []
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const matched = rank.get(candidate.id) ?? rank.get(i.toString())
    if (matched !== undefined) selected.push({ candidate, rank: matched })
  }

  return selected.sort((a, b) => a.rank - b.rank).map((s) => s.candidate)
}
