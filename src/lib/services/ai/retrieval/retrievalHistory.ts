/**
 * Retrieval History
 *
 * One typed, append-only record of what the retrieval agent did during a run, plus the
 * two views built from it: a one-line progress note handed back to the agent inside every
 * tool result, and a readable transcript for humans.
 *
 * This replaces four parallel, differently-shaped trackers (a preformatted
 * `queryHistory: string[]`, a `queriedChapters: string[]`, a selection map, and a grep
 * cache that never left the tool closure). None of them reached the agent during the
 * loop, and none reached the user afterwards.
 *
 * Deliberately dependency-free and pure, so the formatting and the metrics can be tested
 * without an LLM. Event ordering is carried by `at`, a step counter rather than a
 * timestamp: wall-clock would make snapshots unstable and says nothing useful here.
 */

interface BaseEvent {
  /** Sequence number within the run, starting at 0. */
  at: number
}

export type RetrievalEvent =
  | (BaseEvent & {
      kind: 'grep'
      query: string
      /** null means "everything", including the unchapterized tail. */
      chapters: number[] | null
      wholeWord: boolean
      caseSensitive: boolean
      totalMatches: number
      excerptsShown: number
      /** True when more matched than were shown (see grepSampling). */
      sampled: boolean
      /** True when this exact call had already been made in this run. */
      repeated: boolean
    })
  | (BaseEvent & {
      kind: 'query'
      chapterNumber: number
      question: string
      answer: string
      /** True when served from an answer already paid for in this run. */
      cached: boolean
      /** True when the chapter query threw; `answer` then holds the failure text. */
      failed?: boolean
      durationMs?: number
    })
  | (BaseEvent & {
      kind: 'search'
      query?: string
      type?: string
      resultCount: number
    })
  | (BaseEvent & {
      kind: 'world_state'
      query?: string
      category?: string
      resultCount: number
    })
  | (BaseEvent & {
      kind: 'entry'
      entryId?: string
      name?: string
      found: boolean
    })
  | (BaseEvent & {
      kind: 'finish'
      confidence: string
      hasSummary: boolean
    })

/**
 * A `RetrievalEvent` before the sequence number is stamped on -- what emitters pass in.
 *
 * Written distributively rather than as `Omit<RetrievalEvent, 'at'>`: a plain Omit
 * collapses a discriminated union into one object type with only the shared keys, so
 * every event-specific field would be rejected.
 */
export type RetrievalEventInput = RetrievalEvent extends infer T
  ? T extends RetrievalEvent
    ? Omit<T, 'at'>
    : never
  : never

/** Longest list of past search terms worth repeating back to the agent. */
const MAX_TERMS_IN_PROGRESS = 6

function quoted(values: string[]): string {
  return values.map((v) => `"${v}"`).join(', ')
}

/**
 * Step budget. `steps` must come from the loop's stop condition, not `events.length`:
 * one step can call several tools, or none, so an event count misstates the budget.
 */
export interface ProgressBudget {
  steps?: number
  maxIterations?: number
}

/**
 * A single line describing what the agent has already done, to be attached to every tool
 * result.
 *
 * This is the cheap half of the fix: the agent cannot see its own history, so without it
 * nothing stops it re-searching a term it already tried or re-asking a question it
 * already paid for. Returning it inline costs a few tokens per call and needs no extra
 * round trip, unlike a "what have I done" tool. Keep it to one line -- it is paid on
 * every single tool call.
 */
export function summarizeProgress(events: RetrievalEvent[], budget: ProgressBudget = {}): string {
  if (events.length === 0) return 'Nothing done yet.'

  // Kept apart by tool. They used to share one "already searched" list, which told the
  // agent a term had been tried without telling it *how* -- so a word greppped through the
  // story text read as though the lorebook had also been searched for it, and vice versa.
  // Those are different questions with different answers, and re-running the other one is
  // exactly what this line exists to make an informed choice about.
  const grepped: string[] = []
  const searchedEntries: string[] = []
  const inspectedWs: string[] = []
  const readEntries: string[] = []
  const queriedChapters: number[] = []

  const remember = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value)
  }

  for (const event of events) {
    if (event.kind === 'grep') remember(grepped, event.query)
    if (event.kind === 'search' && event.query) remember(searchedEntries, event.query)
    if (event.kind === 'world_state' && event.query) remember(inspectedWs, event.query)
    if (event.kind === 'entry' && event.found && event.name) remember(readEntries, event.name)
    if (event.kind === 'query' && !queriedChapters.includes(event.chapterNumber))
      queriedChapters.push(event.chapterNumber)
  }

  const parts: string[] = []
  /** Most recent first-use, since that is what the agent is most likely to repeat. */
  const listed = (label: string, values: string[]) => {
    if (values.length === 0) return
    const shown = values.slice(-MAX_TERMS_IN_PROGRESS)
    const extra = values.length - shown.length
    parts.push(`${label}: ${quoted(shown)}${extra > 0 ? ` (+${extra} more)` : ''}`)
  }

  listed('grepped', grepped)
  listed('searched entries', searchedEntries)
  listed('inspected world state', inspectedWs)
  listed('read entries', readEntries)
  if (queriedChapters.length > 0) {
    parts.push(`already queried: ch.${queriedChapters.join(', ch.')}`)
  }
  // Only a real step count gets called a step.
  if (budget.steps !== undefined) {
    parts.push(
      budget.maxIterations
        ? `step ${budget.steps}/${budget.maxIterations}`
        : `step ${budget.steps}`,
    )
  } else {
    parts.push(`tool calls: ${events.length}`)
  }

  return parts.join(' · ')
}

function describeChapters(chapters: number[] | null): string {
  if (chapters === null) return 'everywhere'
  if (chapters.length === 0) return 'everywhere'
  return `ch.${chapters.join(', ch.')}`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function describeEvent(event: RetrievalEvent): string {
  switch (event.kind) {
    case 'grep': {
      const where = describeChapters(event.chapters)
      const flags = [event.wholeWord ? 'whole-word' : null, event.caseSensitive ? 'case' : null]
        .filter(Boolean)
        .join(', ')
      const scope = flags ? `${where}, ${flags}` : where
      const outcome =
        event.totalMatches === 0
          ? 'no matches'
          : `${event.totalMatches} matches · showed ${event.excerptsShown}${event.sampled ? ' (sampled)' : ''}`
      return `grep "${event.query}" (${scope})  ${outcome}${event.repeated ? '  [repeat]' : ''}`
    }
    case 'query':
      return `query ch.${event.chapterNumber} "${truncate(event.question, 60)}"  → ${truncate(event.answer, 80)}${event.cached ? '  [cached]' : ''}${event.failed ? '  [failed]' : ''}`
    case 'search':
      return `search_entries ${event.query ? `"${event.query}"` : '(all)'}${event.type ? ` type=${event.type}` : ''}  ${event.resultCount} results`
    case 'entry':
      return `get_entry ${event.name ? `"${event.name}"` : (event.entryId ?? '(no id)')}${event.found ? '' : '  not found'}`
    case 'world_state':
      return `inspect_world_state category=${event.category ?? 'all'}${event.query ? ` query="${event.query}"` : ''}  ${event.resultCount} entities`
    case 'finish':
      return `finish  confidence: ${event.confidence}${event.hasSummary ? '' : '  (no chapter summary!)'}`
  }
}

/**
 * Human-readable transcript of a run. Used by the debug view, and as the fallback
 * explanation when the agent stops without producing its own synthesis -- in that case
 * this is the only account of what the turn actually spent.
 */
export function formatRetrievalHistory(events: RetrievalEvent[]): string {
  if (events.length === 0) return 'Retrieval · nothing recorded'

  const m = retrievalMetrics(events)
  const header =
    `Retrieval · ${m.toolCalls} tool call${m.toolCalls === 1 ? '' : 's'} · ` +
    `${m.llmCalls} LLM call${m.llmCalls === 1 ? '' : 's'} · ` +
    `${m.greps} grep${m.greps === 1 ? '' : 's'}`

  const lines = events.map((event, i) => {
    const branch = i === events.length - 1 ? '└─' : '├─'
    return `${branch} ${describeEvent(event)}`
  })

  return [header, ...lines].join('\n')
}

export interface RetrievalMetrics {
  /**
   * Recorded tool calls, not agent steps -- one step can call several tools, or none.
   * The step budget is `ProgressBudget.steps`, which only the loop's stop condition knows.
   */
  toolCalls: number
  greps: number
  /** query_chapter calls that actually hit the model (cached repeats excluded). */
  llmCalls: number
  cachedQueries: number
  failedQueries: number
  repeatedGreps: number
  /** Greps performed before the first query_chapter; high is the grep-first behaviour working. */
  grepsBeforeFirstQuery: number
  /** greps / llmCalls, or null when nothing was queried. */
  grepToQueryRatio: number | null
  finished: boolean
}

/**
 * Counters for comparing agent behaviour across runs -- most importantly whether the
 * grep-first instruction is actually being followed, which is otherwise guesswork.
 */
export function retrievalMetrics(events: RetrievalEvent[]): RetrievalMetrics {
  let greps = 0
  let llmCalls = 0
  let cachedQueries = 0
  let failedQueries = 0
  let repeatedGreps = 0
  let grepsBeforeFirstQuery = 0
  let sawQuery = false
  let finished = false

  for (const event of events) {
    switch (event.kind) {
      case 'grep':
        greps++
        if (event.repeated) repeatedGreps++
        if (!sawQuery) grepsBeforeFirstQuery++
        break
      case 'query':
        if (event.cached) cachedQueries++
        else llmCalls++
        if (event.failed) failedQueries++
        sawQuery = true
        break
      case 'finish':
        finished = true
        break
    }
  }

  return {
    toolCalls: events.length,
    greps,
    llmCalls,
    cachedQueries,
    failedQueries,
    repeatedGreps,
    grepsBeforeFirstQuery,
    grepToQueryRatio: llmCalls > 0 ? greps / llmCalls : null,
    finished,
  }
}
