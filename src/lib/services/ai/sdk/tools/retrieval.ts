/**
 * Retrieval Tools
 *
 * Tool definitions for intelligent lorebook entry retrieval.
 * Used by AgenticRetrievalService for multi-turn reasoning about which entries to include.
 */

import { tool, type ToolSet } from 'ai'
import * as z from 'zod'
import type { Entry, Chapter, StoryEntry, Character, Location, Item, StoryBeat } from '$lib/types'
import { entryTypeSchema } from '../schemas/lorebook'
import {
  entityNameMatches,
  findTextMatches,
  paragraphMatches,
  truncateAroundMatch,
} from '$lib/utils/text'
import type { RetrievalEventInput } from '../../retrieval/retrievalHistory'
import { sampleMatches } from '../../retrieval/grepSampling'
import { entryTimeTag } from '$lib/utils/storyTime'

/**
 * Shape of live WorldState snapshot available during agentic retrieval.
 */
export interface AgenticWorldState {
  characters?: Character[]
  locations?: Location[]
  items?: Item[]
  storyBeats?: StoryBeat[]
}

/**
 * Context provided to retrieval tools.
 */
export interface RetrievalToolContext {
  /** Available lorebook entries */
  entries: Entry[]
  /** Chapter summaries for context */
  chapters: Chapter[]
  /** Optional live WorldState snapshot */
  worldState?: AgenticWorldState
  /**
   * Record what the agent just did. Purely a log: the agent no longer returns entries, so
   * nothing downstream reconstructs state from these events.
   */
  onEvent: (event: RetrievalEventInput) => void
  /**
   * One line describing what the agent has already done, attached to every tool result.
   */
  describeProgress: () => string
  /**
   * Optional callback to answer a question about a chapter.
   * If provided, `query_chapter` uses this to get AI-generated answers.
   */
  onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
  /**
   * Optional callback to get story entries for a chapter.
   */
  getChapterEntries?: (chapter: Chapter) => StoryEntry[]
  /**
   * Optional callback to get unchapterized story entries (after the last chapter).
   */
  getUnchapterizedEntries?: () => StoryEntry[]
  /**
   * The `AgenticRetrievalSettings.grepEnabled` flag. Registration also needs chapters and an
   * entry reader -- all three live in `canGrepChapters`, which the tool list, the prompt
   * template and the tail split all read, because when the condition was written twice the
   * model got a tool its instructions denied existed.
   */
  grepEnabled?: boolean
  /**
   * Excerpts one grep_chapters call may quote. Defaults to MAX_GREP_EXCERPTS. Excerpt
   * *size* is not a setting: it is derived per passage from its hit count, see `wordsFor`.
   *
   * The only quota. A run-wide budget used to sit beside it and rationed by arrival order:
   * the broad exploratory grep ate it, and the narrowed follow-up -- the one that avoids a
   * query_chapter -- was cut for running second.
   */
  grepExcerptsPerSearch?: number
}

/**
 * Max excerpts one grep_chapters call will quote.
 *
 * An excerpt is ~110 tokens; the query_chapter it saves is ~17,000. Every time this cap was
 * lowered the agent paid the fallback instead, so it is deliberately generous.
 */
export const MAX_GREP_EXCERPTS = 40

/**
 * Word bounds for a single excerpt. Below the floor `findTextMatches` grows the window by
 * whole paragraphs; above it `truncateAroundMatch` trims, keeping the whole span of hits when
 * that fits. The ceiling is per passage and scales with its hit count -- see `wordsFor`.
 *
 * Measured on real runs: a fixed three-paragraph window overshot the old 300-character cap
 * 75% of the time and came back as thin as 17 words the rest of it. Sizing by words makes
 * the cost predictable while paragraphs keep the excerpt starting and ending where the
 * prose does.
 */
const MIN_EXCERPT_WORDS = 30
export const MAX_EXCERPT_WORDS = 60

/**
 * Ceiling when a search returns few enough passages to afford wider ones.
 *
 * The budget for a search is a *volume* of prose, not a count of snippets. Spending it on
 * twenty 60-word fragments and on three 60-word fragments are not equally good uses: with
 * three hits there is room to show each one properly, and a search that finds little is
 * exactly where a fragment is least useful -- there is nothing else to cross-read it
 * against.
 */
const WIDE_EXCERPT_WORDS = 150

/**
 * The chapter number standing for the not-yet-chapterized tail of the story.
 *
 * It needs *a* number because that tail is addressable: the agent is told it can search
 * it, and a search it cannot narrow to is not much use. -1 is what the sampler already
 * groups it under, so this makes the identifier the agent sees and the one the code uses
 * the same value rather than two conventions that have to agree.
 */
export const UNCHAPTERIZED = -1

/**
 * `query_chapter` calls one run may make.
 *
 * Nothing bounded this before: `timelineFill.maxQueries` only caps the *static* path's
 * generated question list, and the agent's own `maxIterations` counts steps, not queries.
 * A run was therefore free to spend every step on a whole-chapter read -- ~17,000 tokens
 * each, so ten steps is ~150,000 tokens for one narrator turn.
 *
 * Three is well clear of observed behaviour (runs use 0-2) and caps the worst case at
 * roughly one grep-led turn's total. Not a setting: it guards a failure mode, and the
 * number a user would want to tune is the excerpt cap that avoids reaching it.
 */
export const MAX_CHAPTER_QUERIES = 3

/**
 * Matches per excerpt slot above which a search is treated as noise rather than as an
 * answer.
 *
 * A spread is only informative while the excerpts stand for something. At five matches per
 * slot the sample already shows a fifth of what matched; far past that it is a random
 * handful of sentences, and the agent cannot tell "this term is everywhere" from "these are
 * the places that matter". Measured case: a character named "Ren" matched 1,000+ paragraphs
 * as a substring -- "rendered", "surrender", "wren" -- and the result was 40 excerpts of
 * unrelated prose plus a per-chapter table saying only that the letters occur throughout.
 *
 * Five rather than one, because a genuinely dense term is still worth reading a spread of:
 * `"rune"` at 120 matches against 40 slots is the case the sampler was built for and must
 * keep working.
 */
export const GREP_NOISE_RATIO = 5

/**
 * Excerpts quoted when a search is past `GREP_NOISE_RATIO`.
 *
 * Not zero: the agent still needs enough of a look to judge *which* narrowing to apply, and
 * a count with no prose to go on is what sends it to `query_chapter`. Enough to see what the
 * matches look like, cheap enough that the wasted ones cost little.
 */
export const NOISY_EXCERPT_LIMIT = 8

/**
 * How much of a substring search's match count the whole-word retry must remove to be
 * adopted in its place.
 *
 * A short name is the case this exists for: "Ren" as a substring is mostly other words,
 * and the whole-word count collapses to a fraction. A stem the agent meant loosely --
 * "rune" finding "runes", "runic" -- barely moves, so the retry is discarded and the
 * substring search stands. The threshold decides which of the two happened without having
 * to guess from the query's length: a rule on length alone would break `wholeWord`-hostile
 * searches like "rune" at exactly the size where they are most useful.
 */
const AUTO_NARROW_MAX_SHARE = 0.5

/**
 * Whether there is any live world state worth registering `inspect_world_state` for.
 *
 * Exported because the prompt template must describe that tool on exactly the same
 * condition that registers it. Keeping the rule in one place is the same lesson
 * `grepEnabled` taught: a second copy of a registration condition is a promise to the
 * model that nothing checks.
 */
export function hasLiveWorldState(worldState: AgenticWorldState | undefined): boolean {
  return (
    !!worldState &&
    ((worldState.characters?.length ?? 0) > 0 ||
      (worldState.locations?.length ?? 0) > 0 ||
      (worldState.items?.length ?? 0) > 0 ||
      (worldState.storyBeats?.length ?? 0) > 0)
  )
}
/**
 * Whether `grep_chapters` can be registered: the feature is on, there are chapters, and there
 * is a way to read their text.
 *
 * Exported for the same reason as `hasLiveWorldState`: the prompt template must describe the
 * tool on exactly the condition that registers it. A second copy of a registration condition
 * is a promise to the model that nothing checks.
 */
export function canGrepChapters(context: RetrievalToolContext): boolean {
  return context.chapters.length > 0 && !!context.grepEnabled && !!context.getChapterEntries
}

/** Mutable state shared by the tools of one run. */
interface RunState {
  /**
   * Grep results already produced, keyed by the exact call. A repeated grep is deterministic
   * (see grepSampling), so replaying the stored answer is cheaper than recomputing it and
   * spares the agent a second identical wall of prose.
   */
  grepResults: Map<string, Record<string, unknown>>
  /** Whole-chapter reads spent so far. See MAX_CHAPTER_QUERIES. */
  chapterQueries: number
}

function createSearchEntriesTool({ entries, onEvent, describeProgress }: RetrievalToolContext) {
  /**
   * Search available lorebook entries by keyword or text.
   * Uses fuzzy entityNameMatches for names/aliases and text includes for content.
   */
  return tool({
    description:
      'Search available lorebook entries by keyword, name, or type. ' +
      'Returns matching entry summaries with their IDs, names, types, and brief excerpts. ' +
      'Reference material for your own reasoning: reading an entry does not put it in ' +
      "the narrator's prompt, which is decided separately.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          'Search term to match against entry names, aliases, keywords, or content. Empty matches all.',
        ),
      type: entryTypeSchema
        .optional()
        .describe('Filter entries by type (character, location, item, faction, concept, event)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .describe('Maximum number of entries to return (1-50, default 20)'),
    }),
    execute: async ({
      query,
      type,
      limit = 20,
    }: {
      query?: string
      type?: z.infer<typeof entryTypeSchema>
      limit?: number
    }) => {
      let matches = entries

      // Filter by type if specified
      if (type) {
        matches = matches.filter((e) => e.type === type)
      }

      // Filter by query if specified
      if (query && query.trim()) {
        const q = query.trim().toLowerCase()
        matches = matches.filter((e) => {
          // Check name and aliases using entityNameMatches
          if (entityNameMatches(q, e.name)) return true
          if (e.aliases && e.aliases.some((alias) => entityNameMatches(q, alias))) return true

          // Check explicit keywords
          if (e.injection?.keywords && e.injection.keywords.some((k) => entityNameMatches(q, k)))
            return true

          // Check description text using word boundary matching
          if (e.description && entityNameMatches(q, e.description)) return true

          return false
        })
      }

      const availableTotal = matches.length
      const sliced = matches.slice(0, limit)

      onEvent({ kind: 'search', query, type, resultCount: availableTotal })

      return {
        query: query ?? null,
        type: type ?? null,
        availableTotal,
        returnedCount: sliced.length,
        hasMore: availableTotal > sliced.length,
        entries: sliced.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          aliases: e.aliases ?? [],
          description: e.description,
          excerpt: e.description.length > 150 ? `${e.description.slice(0, 150)}...` : e.description,
          injectionMode: e.injection?.mode ?? 'keyword',
          priority: e.injection?.priority ?? 50,
        })),
        soFar: describeProgress(),
      }
    },
  })
}

function createGetEntryTool({ entries, onEvent, describeProgress }: RetrievalToolContext) {
  /**
   * Get full details of a specific lorebook entry by ID.
   */
  return tool({
    description:
      'Get the complete text and details of a specific lorebook entry by its ID. ' +
      'Use this when a search summary is not enough to understand a name or term you ' +
      'came across.',
    inputSchema: z.object({
      entryId: z.string().optional().describe('The ID of the lorebook entry to inspect'),
      id: z.string().optional().describe('Alias for entryId'),
    }),
    execute: async ({ entryId, id }: { entryId?: string; id?: string }) => {
      const targetId = entryId ?? id
      const entry = entries.find((e) => e.id === targetId)

      if (!entry) {
        onEvent({ kind: 'entry', entryId: targetId, found: false })
        return {
          success: false,
          found: false,
          entryId: targetId ?? null,
          error: targetId
            ? `No lorebook entry found with ID "${targetId}".`
            : 'No entry id given. Pass the `entryId` from a search_entries result.',
          soFar: describeProgress(),
        }
      }

      onEvent({ kind: 'entry', entryId: entry.id, name: entry.name, found: true })
      return {
        success: true,
        found: true,
        entry: {
          id: entry.id,
          name: entry.name,
          type: entry.type,
          aliases: entry.aliases ?? [],
          description: entry.description,
          state: entry.state ?? null,
          injection: entry.injection ?? { mode: 'keyword', priority: 50, keywords: [] },
        },
        soFar: describeProgress(),
      }
    },
  })
}

function createFinishRetrievalTool({ onEvent }: RetrievalToolContext) {
  /**
   * Terminal tool to finish retrieval session.
   * Returns the final synthesis and signals completion.
   */
  return tool({
    description:
      'Call this when you have finished gathering context. Summarize what you learned from the chapters you searched and queried.',
    inputSchema: z.object({
      synthesis: z.string().describe('Explanation of what you looked for and what you found'),
      chapterSummary: z
        .string()
        .optional()
        .describe(
          'Summary of key information learned from chapter queries that is relevant to the current situation (character states, past events, relationships, etc.)',
        ),
      confidence: z
        .enum(['low', 'medium', 'high'])
        .describe('How well the context you gathered answers what the situation needed'),
      additionalContext: z
        .string()
        .optional()
        .describe('Any additional context notes for the narrative'),
    }),
    execute: async (args: {
      synthesis: string
      chapterSummary?: string
      confidence: 'low' | 'medium' | 'high'
      additionalContext?: string
    }) => {
      onEvent({
        kind: 'finish',
        confidence: args.confidence,
        hasSummary: !!args.chapterSummary,
      })

      // This tool's execution signals completion of the retrieval loop
      return {
        completed: true,
        ...args,
      }
    },
  })
}

function createGrepChaptersTool(context: RetrievalToolContext, state: RunState) {
  const {
    chapters,
    onEvent,
    describeProgress,
    getChapterEntries,
    getUnchapterizedEntries,
    grepExcerptsPerSearch = MAX_GREP_EXCERPTS,
  } = context

  return tool({
    description:
      'Fast exact-text search across chapter narrative text and the unchapterized recent tail. ' +
      'Returns how many paragraphs match in each chapter, plus a spread of the matching ' +
      'passages, each stamped with its in-story time. Zero LLM cost. ' +
      'PREFER THIS OVER query_chapter WHEN LOOKING FOR NAMES, PLACES, ITEMS, OR SPECIFIC PHRASES. ' +
      'Use query_chapter ONLY when grep returns no matches or when you need semantic reasoning.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'Literal substring to search for, case-insensitive by default. Not a keyword ' +
            'search: a multi-word query matches only where those words appear consecutively, ' +
            'so combining two ideas in one query finds nothing. Prefer a single ' +
            'distinctive word.',
        ),
      chapterNumbers: z
        .array(z.number().int())
        .optional()
        .describe(
          `Specific chapter numbers to search, where ${UNCHAPTERIZED} is the recent not-yet-chapterized tail. ` +
            'Omit or pass an empty array to search everything.',
        ),
      wholeWord: z
        .boolean()
        .optional()
        .describe(
          'Match whole words only (e.g. "orc" won\'t match "orchestra"). Leave this out ' +
            'and a search that drowns in substring noise -- a short name like "Ren" ' +
            'matching "surrender" -- is retried as a whole-word search automatically; the ' +
            'result says when that happened. Pass false to force the substring search.',
        ),
      caseSensitive: z.boolean().optional().default(false).describe('Match case sensitively.'),
    }),
    execute: async ({
      query,
      chapterNumbers,
      wholeWord,
      caseSensitive = false,
    }: {
      query: string
      chapterNumbers?: number[]
      wholeWord?: boolean
      caseSensitive?: boolean
    }) => {
      const targetChapterNumbers =
        chapterNumbers && chapterNumbers.length > 0 ? Array.from(new Set(chapterNumbers)) : null

      const signature = JSON.stringify([
        query,
        targetChapterNumbers ? [...targetChapterNumbers].sort((a, b) => a - b) : null,
        wholeWord,
        caseSensitive,
      ])
      const cached = state.grepResults.get(signature)
      if (cached) {
        onEvent({
          kind: 'grep',
          query,
          chapters: targetChapterNumbers,
          // The flag the cached run actually searched under, which auto-narrowing may have
          // flipped -- not the one the agent asked for.
          wholeWord: (cached.wholeWord as boolean) ?? false,
          caseSensitive,
          totalMatches: (cached.totalMatches as number) ?? 0,
          excerptsShown: (cached.excerptsShown as number) ?? 0,
          sampled: (cached.sampled as boolean) ?? false,
          repeated: true,
        })
        return {
          ...cached,
          repeatedSearch: 'You already ran this exact search; this is the same answer.',
          soFar: describeProgress(),
        }
      }

      const chaptersThatDoNotExist: number[] = []
      const tail = getUnchapterizedEntries?.() ?? []
      const corpus: {
        chapterNumber: number
        chapterTitle: string
        chapter: Chapter | null
        entries: StoryEntry[]
      }[] = []

      const addChapter = (ch: Chapter) => {
        corpus.push({
          chapterNumber: ch.number,
          chapterTitle: ch.title || `Chapter ${ch.number}`,
          chapter: ch,
          entries: getChapterEntries ? getChapterEntries(ch) : [],
        })
      }
      const addTail = () => {
        if (tail.length === 0) return
        corpus.push({
          chapterNumber: UNCHAPTERIZED,
          chapterTitle: 'Recent (Unchapterized)',
          chapter: null,
          entries: tail,
        })
      }

      if (targetChapterNumbers === null) {
        for (const ch of chapters) addChapter(ch)
        addTail()
      } else {
        for (const num of targetChapterNumbers) {
          // The tail is addressable like any chapter. Without this it could only ever be
          // searched as part of "everything", so narrowing to it -- the single most
          // likely thing to narrow to, since it is the most recent story -- silently
          // searched nothing and reported "no matches", which reads as a real answer.
          if (num === UNCHAPTERIZED) addTail()
          else {
            const ch = chapters.find((c) => c.number === num)
            if (ch) addChapter(ch)
            // Same failure as the tail used to have: a chapter number that does not exist
            // was skipped in silence, so the result said "0 matches" -- which the
            // instructions teach the agent to read as "the phrase is not in the story".
            else chaptersThatDoNotExist.push(num)
          }
        }
      }

      /**
       * One quotable passage: a matched paragraph plus its context, or several merged
       * when they were close enough to overlap.
       *
       * The passage is the unit of *quoting* (budget and sampling). It is deliberately
       * not the unit of *counting*: how many passages a chapter yields depends on how
       * wide each window grew, so counting them would make the same search report
       * different densities on different prose. `hits` counts matching paragraphs, which
       * does not move.
       */
      interface GrepMatchItem {
        chapterNumber: number
        chapterTitle: string
        entryIndex: number
        timestamp: string | null
        role: 'ACTION' | 'NARRATIVE'
        excerpt: string
        hits: number
      }

      const countHits = (items: GrepMatchItem[]) => items.reduce((n, m) => n + m.hits, 0)

      /** One full pass over the corpus under a given whole-word setting. */
      const collect = (useWholeWord: boolean) => {
        const found = corpus.map((item) => {
          const matches: GrepMatchItem[] = []
          for (let idx = 0; idx < item.entries.length; idx++) {
            const entry = item.entries[idx]
            if (!entry.content) continue
            const textMatches = findTextMatches(entry.content, query, {
              wholeWord: useWholeWord,
              caseSensitive,
              minWords: MIN_EXCERPT_WORDS,
            })
            for (const textMatch of textMatches) {
              matches.push({
                chapterNumber: item.chapterNumber,
                chapterTitle: item.chapterTitle,
                entryIndex: idx,
                // With the chapter, so entries written before time tracking existed still
                // get the chapter's span as an approximate stamp instead of "unknown".
                timestamp: entryTimeTag(entry, item.chapter),
                // Which side of the table this text came from. Without it the agent cannot
                // tell the narration from what the player typed, and can hand the player's
                // own words back to the narrator as established fact.
                role: entry.type === 'user_action' ? 'ACTION' : 'NARRATIVE',
                excerpt: textMatch.excerpt,
                hits: textMatch.paragraphIndexes.length,
              })
            }
          }
          return { chapterNumber: item.chapterNumber, matches }
        })
        return { groups: found, total: found.reduce((n, g) => n + countHits(g.matches), 0) }
      }

      // Same allowance every call; see `grepExcerptsPerSearch`.
      const callLimit = grepExcerptsPerSearch
      const noiseThreshold = callLimit * GREP_NOISE_RATIO

      let effectiveWholeWord = wholeWord ?? false
      let pass = collect(effectiveWholeWord)
      let autoNarrowedFrom: number | null = null

      // A substring search that drowns is retried on word boundaries. Only when the agent
      // left `wholeWord` unset -- an explicit `false` is a decision, and honouring it is
      // what makes the flag usable at all. The retry is a second pass over text already in
      // memory, and it only happens on a search that was going to be useless anyway.
      if (wholeWord === undefined && pass.total > noiseThreshold) {
        const narrowed = collect(true)
        if (narrowed.total > 0 && narrowed.total <= pass.total * AUTO_NARROW_MAX_SHARE) {
          autoNarrowedFrom = pass.total
          pass = narrowed
          effectiveWholeWord = true
        }
      }

      const groups = pass.groups
      const totalMatches = pass.total

      // Past the threshold the spread stops being a sample of anything, so it is cut to a
      // look at what the matches are, and the result says how to narrow instead. Spending
      // the full allowance here is the expensive half of the failure: 40 excerpts of prose
      // that matched by accident, quoted into a prompt paid for every turn.
      const noisy = totalMatches > noiseThreshold
      const excerptLimit = noisy ? Math.min(NOISY_EXCERPT_LIMIT, callLimit) : callLimit

      // Weighted by hits, not by passage count: `findTextMatches` merges neighbouring
      // matching paragraphs, so counting passages penalises exactly the chapters where the
      // term concentrates -- twenty mentions in one scene weigh two, four scattered ones
      // weigh four. See `sampleMatches`.
      const sampleResult = sampleMatches(groups, excerptLimit, (m) => m.hits)

      /**
       * Hits the agent can actually read in a passage once it has been length-capped.
       *
       * Counted rather than assumed: `truncateAroundMatch` now keeps the whole span of
       * occurrences when it fits, so a truncated passage may still show all of them and the
       * old "truncated means one" rule would understate it. Counting matching paragraphs in
       * what is actually returned keeps `matchesShown` in the same unit as `matches`, and
       * cannot claim more than the passage held.
       */
      const hitsVisible = (match: GrepMatchItem, shown: string) => {
        if (shown === match.excerpt) return match.hits
        const seen = shown
          .split(/\n\s*\n/)
          .filter((p) =>
            paragraphMatches(p, query, { wholeWord: effectiveWholeWord, caseSensitive }),
          ).length
        return Math.min(Math.max(seen, 1), match.hits)
      }

      /**
       * Words a passage may spend, proportional to the hits it holds.
       *
       * The budget for a search is a *volume* of prose. Sharing it equally gives a passage
       * that merged five matching paragraphs the same room as one holding a single mention,
       * and the truncation then cuts the merged one back to its first hit -- undoing the
       * merge that made it worth showing. Sharing by hits gives it room to arrive whole.
       *
       * With every passage at one hit this reduces exactly to the previous uniform split.
       * The ceiling rises with the hit count for the same reason the share does; the floor
       * keeps a single-hit passage readable.
       */
      const sampledMatches = sampleResult.groups.flatMap((g) => g.matches)
      const totalHits = sampledMatches.reduce((n, m) => n + m.hits, 0)
      // `excerptLimit`, not `callLimit`: a noisy search quotes fewer passages, and the
      // volume of prose has to shrink with them. Sizing off the full allowance would hand
      // eight excerpts the word budget of forty and undo the trim entirely.
      const volume = excerptLimit * MAX_EXCERPT_WORDS
      const wordsFor = (match: GrepMatchItem) => {
        const share = totalHits > 0 ? Math.floor((volume * match.hits) / totalHits) : 0
        const ceiling = Math.max(WIDE_EXCERPT_WORDS, match.hits * MAX_EXCERPT_WORDS)
        return Math.min(ceiling, Math.max(MAX_EXCERPT_WORDS, share))
      }

      const shownByChapter = new Map<number, number>()
      const excerpts = sampleResult.groups.flatMap((group) =>
        group.matches.map((match) => {
          const excerpt = truncateAroundMatch(match.excerpt, query, wordsFor(match), {
            caseSensitive,
            // Same rule the passage was selected under, so the excerpt opens on a hit that
            // was actually counted rather than on a substring inside a longer word.
            wholeWord: effectiveWholeWord,
          })
          const visible = hitsVisible(match, excerpt)
          shownByChapter.set(
            group.chapterNumber,
            (shownByChapter.get(group.chapterNumber) ?? 0) + visible,
          )
          return {
            chapter: match.chapterNumber,
            chapterTitle: match.chapterTitle,
            entryIndex: match.entryIndex,
            timestamp: match.timestamp,
            role: match.role,
            // So the agent can tell an excerpt covering five mentions from one covering a
            // single passing reference, and narrow accordingly.
            hits: visible,
            excerpt,
          }
        }),
      )

      // The whole point of the sample: which chapters the term is in, including the ones
      // no excerpt was spent on. Without this the agent cannot tell a chapter it has
      // seen everything of from one it has seen nothing of. Both figures count matching
      // paragraphs, so `matchesShown < matches` always means something really was left out.
      const perChapter = groups
        .filter((g) => g.matches.length > 0)
        .map((g) => ({
          chapter: g.chapterNumber,
          title: corpus.find((c) => c.chapterNumber === g.chapterNumber)?.chapterTitle ?? '',
          matches: countHits(g.matches),
          matchesShown: shownByChapter.get(g.chapterNumber) ?? 0,
        }))

      onEvent({
        kind: 'grep',
        query,
        chapters: targetChapterNumbers,
        wholeWord: effectiveWholeWord,
        caseSensitive,
        totalMatches,
        excerptsShown: excerpts.length,
        sampled: sampleResult.sampled,
        repeated: false,
      })

      const result: Record<string, unknown> = {
        query,
        searchedChapters: targetChapterNumbers ?? 'all',
        // What actually ran. Auto-narrowing can flip it, and a result that does not say so
        // reads as though the substring search returned these counts.
        wholeWord: effectiveWholeWord,
        // Named so it cannot be read as "searched and found nothing".
        ...(chaptersThatDoNotExist.length > 0
          ? {
              chaptersThatDoNotExist,
              chaptersThatDoNotExistNote:
                `Chapter ${chaptersThatDoNotExist.join(', ')} does not exist and was not ` +
                `searched. Available: ${chapters.map((c) => c.number).join(', ')}` +
                `${tail.length > 0 ? `, plus ${UNCHAPTERIZED} for the recent tail` : ''}.`,
            }
          : {}),
        totalMatches,
        matchesByChapter: perChapter,
        excerptsShown: excerpts.length,
        sampled: sampleResult.sampled,
        excerpts,
      }
      // Said before anything else about the result, because every count below it is the
      // narrowed search's, not the one the agent asked for.
      if (autoNarrowedFrom !== null) {
        result.autoNarrowed =
          `A substring search for "${query}" matched ${autoNarrowedFrom} paragraphs, mostly ` +
          `inside longer words, so this is the whole-word search instead: ${totalMatches} ` +
          'matches. Every count and excerpt below is from that search. Pass wholeWord false ' +
          'to get the substring search back.'
      }

      // The distinct failure the sampled note does not cover: not "more matched than fit",
      // but "this search did not discriminate". Different fix, so it says a different thing
      // -- narrowing the *query* rather than the chapter range, which is what a term this
      // common actually needs.
      if (noisy) {
        result.tooManyMatches =
          `"${query}" matches ${totalMatches} paragraphs across the story. That is too many ` +
          `to sample usefully, so only ${excerpts.length} excerpts were quoted -- read them ` +
          'as a look at what the matches are, not as an answer. Narrow the search rather ' +
          'than paying query_chapter: use a longer and more distinctive phrase, set ' +
          'chapterNumbers to the chapters with the highest counts above, or set ' +
          'caseSensitive to separate a name from an ordinary word.' +
          (effectiveWholeWord
            ? ''
            : ' wholeWord true would also drop the matches inside longer words.')
      }

      // A count and a next step, not a list of chapter numbers: naming them reads as a
      // to-do list whose cheapest-looking fix is query_chapter. `matchesByChapter` already
      // says which they are.
      if (sampleResult.sampled && !noisy) {
        const unseen = sampleResult.omittedChapters.length
        result.note =
          'More matched than fit. The excerpts above are spread across the matching ' +
          'chapters, weighted toward the chapters with the most hits; the per-chapter ' +
          'counts stay complete either way. ' +
          (unseen > 0
            ? `${unseen} matching chapter${unseen === 1 ? '' : 's'} got no excerpt. `
            : '') +
          'Re-run this search with chapterNumbers set to the chapters you care about: ' +
          'the whole allowance then goes to them, and it costs nothing.'
      }

      state.grepResults.set(signature, result)
      return { ...result, soFar: describeProgress() }
    },
  })
}

function createQueryChapterTool(context: RetrievalToolContext, state: RunState) {
  const { chapters, onEvent, describeProgress, onQueryChapter } = context

  return tool({
    description:
      'Ask a targeted question about specific past chapters to get detailed AI-generated answers. ' +
      'USE THIS SPARINGLY — it invokes an LLM and is much slower/costlier than grep_chapters. ' +
      'FIRST use grep_chapters to find relevant chapters, then query ONLY those chapters.',
    inputSchema: z.object({
      chapterNumber: z
        .number()
        .int()
        .describe(
          `The specific chapter number to query (e.g. 1 for Chapter 1). ${UNCHAPTERIZED} is not ` +
            'valid here: the recent tail has no summary to read, and it is already in your ' +
            'RECENT SCENE.',
        ),
      question: z.string().describe("The specific question to ask about this chapter's events."),
    }),
    execute: async ({ chapterNumber, question }: { chapterNumber: number; question: string }) => {
      // Checked before the chapter lookup so a spent budget reads the same whichever
      // chapter was asked for, and points at the tool that can still answer.
      if (state.chapterQueries >= MAX_CHAPTER_QUERIES) {
        return {
          answered: false,
          chapterNumber,
          error:
            `You have used all ${MAX_CHAPTER_QUERIES} whole-chapter reads for this turn. ` +
            'Use grep_chapters instead -- with chapterNumbers set to the chapter you ' +
            'wanted, the whole excerpt allowance goes to it, and it costs nothing.',
          soFar: describeProgress(),
        }
      }

      const chapter = chapters.find((c) => c.number === chapterNumber)
      if (!chapter) {
        // The tail is addressable by grep but not here, and the agent is told so by
        // grep's own schema -- so the generic "does not exist" reads as a contradiction
        // rather than an answer. Say which tool owns it instead.
        const error =
          chapterNumber === UNCHAPTERIZED
            ? `${UNCHAPTERIZED} is the recent un-chapterized tail, which has no chapter summary to ` +
              'read. It is already quoted in your RECENT SCENE, and searchable with grep_chapters.'
            : `Chapter ${chapterNumber} does not exist. Available chapters: ${chapters.map((c) => c.number).join(', ')}`
        return {
          answered: false,
          chapterNumber,
          error,
          soFar: describeProgress(),
        }
      }

      state.chapterQueries++

      let answer: string
      if (onQueryChapter) {
        // No try/catch: `onQueryChapter` owns its failures, and the one real
        // implementation deliberately turns them into a cached answer so a failing
        // question is not re-asked until the step budget is gone. Catching here as well
        // would bypass that -- and its event recording, leaving the failure out of the
        // transcript entirely.
        answer = await onQueryChapter(chapterNumber, question)
      } else {
        answer = chapter.summary || 'No summary available for this chapter.'
        onEvent({
          kind: 'query',
          chapterNumber,
          question,
          answer,
          cached: false,
        })
      }

      return {
        answered: true,
        chapterNumber,
        chapterTitle: chapter.title || `Chapter ${chapter.number}`,
        question,
        answer,
        soFar: describeProgress(),
      }
    },
  })
}

function createInspectWorldStateTool({
  worldState,
  onEvent,
  describeProgress,
}: RetrievalToolContext) {
  return tool({
    description:
      'Inspect live-tracked WorldState entities (characters, locations, inventory items, story beats/quests). ' +
      'Use this to check entity statuses, current location, character relationships, or active plot threads in memory.',
    inputSchema: z.object({
      category: z
        .enum(['characters', 'locations', 'items', 'storyBeats', 'all'])
        .optional()
        .default('all')
        .describe('Category to inspect. Defaults to "all".'),
      query: z
        .string()
        .optional()
        .describe('Optional search query to filter entity names, statuses, or descriptions.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .describe('Maximum number of entities to return per category (1-50, default 20).'),
    }),
    execute: async ({
      category = 'all',
      query,
      limit = 20,
    }: {
      category?: 'characters' | 'locations' | 'items' | 'storyBeats' | 'all'
      query?: string
      limit?: number
    }) => {
      const ws = worldState!
      const trimmedQuery = query?.trim().toLowerCase()

      const match = (text: string | null | undefined) => {
        if (!trimmedQuery) return true
        if (!text) return false
        return entityNameMatches(trimmedQuery, text, { allowPrefix: true })
      }

      let totalMatched = 0
      let totalReturned = 0
      const results: Record<string, unknown[]> = {}

      if (category === 'characters' || category === 'all') {
        const matched = (ws.characters ?? []).filter(
          (c: Character) =>
            match(c.name) || match(c.description) || match(c.status) || match(c.relationship),
        )
        totalMatched += matched.length
        const sliced = matched.slice(0, limit).map((c: Character) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          relationship: c.relationship,
          description: c.description,
        }))
        totalReturned += sliced.length
        results.characters = sliced
      }

      if (category === 'locations' || category === 'all') {
        const matched = (ws.locations ?? []).filter(
          (l: Location) => match(l.name) || match(l.description),
        )
        totalMatched += matched.length
        const sliced = matched.slice(0, limit).map((l: Location) => ({
          id: l.id,
          name: l.name,
          current: l.current,
          description: l.description,
        }))
        totalReturned += sliced.length
        results.locations = sliced
      }

      if (category === 'items' || category === 'all') {
        const matched = (ws.items ?? []).filter(
          (i: Item) => match(i.name) || match(i.description) || match(i.location),
        )
        totalMatched += matched.length
        const sliced = matched.slice(0, limit).map((i: Item) => ({
          id: i.id,
          name: i.name,
          location: i.location,
          equipped: i.equipped,
          description: i.description,
        }))
        totalReturned += sliced.length
        results.items = sliced
      }

      if (category === 'storyBeats' || category === 'all') {
        const matched = (ws.storyBeats ?? []).filter(
          (b: StoryBeat) => match(b.title) || match(b.description) || match(b.status),
        )
        totalMatched += matched.length
        const sliced = matched.slice(0, limit).map((b: StoryBeat) => ({
          id: b.id,
          title: b.title,
          status: b.status,
          type: b.type,
          description: b.description,
        }))
        totalReturned += sliced.length
        results.storyBeats = sliced
      }

      onEvent({ kind: 'world_state', query, category, resultCount: totalReturned })

      return {
        category,
        query: query ?? null,
        results,
        totalMatched,
        totalReturned,
        hasMore: totalMatched > totalReturned,
        soFar: describeProgress(),
      }
    },
  })
}

/**
 * Build the tools available to the retrieval agent.
 *
 * `Tool` is generic in its own input/output schema, so a heterogeneous map of them has no
 * single instantiation to name. `ToolSet` is the SDK's own type for such a map -- each tool is
 * still checked against its own `inputSchema` where it is written.
 */
export function createRetrievalTools(context: RetrievalToolContext) {
  const state: RunState = { grepResults: new Map(), chapterQueries: 0 }

  const tools: ToolSet = {
    search_entries: createSearchEntriesTool(context),
    get_entry: createGetEntryTool(context),
    finish_retrieval: createFinishRetrievalTool(context),
  }

  if (canGrepChapters(context)) {
    tools.grep_chapters = createGrepChaptersTool(context, state)
  }
  if (context.chapters.length > 0) {
    tools.query_chapter = createQueryChapterTool(context, state)
  }
  if (hasLiveWorldState(context.worldState)) {
    tools.inspect_world_state = createInspectWorldStateTool(context)
  }

  return tools
}

export type RetrievalTools = ReturnType<typeof createRetrievalTools>
