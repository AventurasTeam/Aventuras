/**
 * Agentic Retrieval Service
 *
 * Uses agentic reasoning to intelligently search and retrieve lorebook entries
 * and chapter context using the Vercel AI SDK ToolLoopAgent.
 */

import type { Entry, Chapter, StoryEntry, TimeTracker } from '$lib/types'
import type { ServiceId } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { createLogger } from '$lib/log'
import { formatStoryTimeOrNull } from '$lib/utils/storyTime'
import { splitRecentTail } from './recentTail'
import { AGENTIC_RETRIEVAL_DEFAULTS } from '../core/defaults'
import {
  createAgentFromPreset,
  extractTerminalToolResult,
  finishOnlyOnLastStep,
  stopOnTerminalTool,
} from '../sdk/agents'
import type { PrepareStepFunction } from 'ai'
import {
  canGrepChapters,
  createRetrievalTools,
  hasLiveWorldState,
  type RetrievalToolContext,
  type AgenticWorldState,
} from '../sdk/tools'
import { ContextBuilder } from '$lib/services/context'
import { debug } from '$lib/stores/debug.svelte'
import { activity } from '$lib/stores/activity.svelte'
import { retrievalStep, retrievalStepStatus } from './retrievalSteps'
import { recentContent, AS_PROSE } from '$lib/utils/recentContent'
import {
  formatRetrievalHistory,
  retrievalMetrics,
  summarizeProgress,
  type RetrievalEvent,
  type RetrievalEventInput,
} from './retrievalHistory'

const log = createLogger('AgenticRetrieval')

/**
 * Cap on the un-chapterized narrative in the prompt. Only applied when grep can reach past it.
 *
 * Raised from 2,048 after measuring what that bought: on a 40-chapter story the tail's
 * entries averaged 2,688 characters, so the cap was below the size of a *single* entry and
 * the split degenerated to the player's own action alone. See `splitRecentTail`.
 *
 * This block sits at the end of the agent's user prompt, in the volatile section, so
 * enlarging it costs prefill and nothing else -- it cannot break the reusable prefix that
 * the chapter list in front of it depends on.
 */
const RECENT_NARRATIVE_CHARS = 12288

/**
 * Entries of the tail the prompt keeps no matter what the cap says.
 *
 * Four, because a turn appends two entries (action + narration), so this is roughly the
 * last two exchanges -- enough to see what is happening and who is in the scene, which is
 * the minimum for judging what the past needs to supply.
 */
const MIN_RECENT_ENTRIES = 4

/**
 * Result from an agentic retrieval session.
 *
 * Deliberately minimal. This used to also carry the selected entries, the reasoning, the
 * iteration count, a truncated flag, the queried chapter ids, a preformatted query history,
 * the run transcript and the raw event log -- all derived every turn, none of them read by
 * any caller. The transcript still exists; it goes to the log and the debug view, which is
 * where anyone looking for it would look.
 */
export interface RetrievalResult {
  /** Formatted context string for prompt injection. The only thing the pipeline uses. */
  context: string
}

/**
 * Context for running agentic retrieval.
 */
export interface RetrievalContext {
  /** Story whose pack supplies the template; undefined only outside a story. */
  storyId: string | undefined
  userInput: string
  recentNarrative: string
  availableEntries: Entry[]
  /** Chapter summaries for context */
  chapters?: Chapter[]
  /** Optional live WorldState snapshot */
  worldState?: AgenticWorldState
  /**
   * Where the story stands right now, in-story.
   *
   * grep results stamp every excerpt with an in-story time, and the agent is told to
   * judge recency by those stamps rather than by chapter number. That instruction is
   * unfollowable without an anchor: there is no way to tell whether `Year 2, Day 40` is
   * yesterday or last winter, and no way to think in terms of "the last few days" at all.
   */
  currentStoryTime?: TimeTracker | null
  /**
   * What world state and lorebook selection already put in the narrator's prompt. See
   * `formatAlreadyInContext`. Empty when there is nothing, so the template omits the
   * section rather than printing an empty heading.
   */
  alreadyInContext?: string
  /** Optional callback to ask a question about a chapter */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
  /** Optional callback to fetch a chapter's raw story entries, for grep_chapters */
  getChapterEntries?: (chapter: Chapter) => StoryEntry[]
  /** Optional callback for the entries after the last chapter, also searched by grep_chapters */
  getUnchapterizedEntries?: () => StoryEntry[]
  /** Step this run's own steps nest under in the activity record. */
  activityParentId?: string
}

/**
 * Finish retrieval tool result type.
 */
interface FinishRetrievalResult {
  completed: boolean
  synthesis: string
  chapterSummary?: string
  confidence: 'low' | 'medium' | 'high'
  additionalContext?: string
}

/**
 * Service that uses agentic reasoning for intelligent lorebook retrieval.
 * Uses ToolLoopAgent for multi-turn tool calling.
 */
export class AgenticRetrievalService extends BaseAIService {
  private maxIterations: number
  private grepEnabled: boolean
  private grepExcerptsPerSearch: number

  constructor(
    serviceId: ServiceId,
    maxIterations: number = AGENTIC_RETRIEVAL_DEFAULTS.maxIterations,
    /** See AgenticRetrievalSettings.grepEnabled. */
    grepEnabled: boolean = true,
    /** Excerpts one grep call may quote. See AgenticRetrievalSettings. */
    grepExcerptsPerSearch: number = AGENTIC_RETRIEVAL_DEFAULTS.grepExcerptsPerSearch,
  ) {
    super(serviceId)
    this.maxIterations = maxIterations
    this.grepEnabled = grepEnabled
    this.grepExcerptsPerSearch = grepExcerptsPerSearch
  }

  /**
   * Run agentic retrieval to find relevant lorebook entries.
   *
   * @param context - The retrieval context
   * @param signal - Optional abort signal for cancellation
   * @returns Result with the chapter context it gathered
   */
  async runRetrieval(context: RetrievalContext, signal?: AbortSignal): Promise<RetrievalResult> {
    const startedAt = Date.now()
    log('Starting agentic retrieval', {
      entryCount: context.availableEntries.length,
      chapterCount: context.chapters?.length ?? 0,
      maxIterations: this.maxIterations,
    })

    // Single append-only record of the run. Selections, queried chapters and the query
    // history are all derived from it rather than tracked separately.
    // Set once the agent step is open; tool calls before then nest under the phase's step.
    let agentStepId = ''

    const events: RetrievalEvent[] = []
    const record = (event: RetrievalEventInput) => {
      const stamped = { ...event, at: events.length } as RetrievalEvent
      events.push(stamped)
      reportStep(stamped)
    }

    // The agent's steps are reported as they happen, under the step the phase opened. Each
    // tool call is already over by the time it is recorded, so it is a closed step rather
    // than one opened and closed around the work.
    const reportStep = (event: RetrievalEvent) => {
      const { label, options } = retrievalStep(event)
      activity.recordStep(label, {
        ...options,
        parentId: agentStepId || context.activityParentId,
        status: retrievalStepStatus(event),
      })
    }
    /**
     * Chapter answers this run paid for, salvaged if the agent never reaches its summary.
     *
     * Derived from the event log rather than tracked beside it — `ChapterQueryBudget` owns
     * the cache now, and records every answer through `onEvent`, so a second copy here
     * could only disagree with it. Cached replays are excluded: they are the same answer.
     */
    const paidChapterAnswers = () =>
      events.filter(
        (e): e is Extract<RetrievalEvent, { kind: 'query' }> =>
          e.kind === 'query' && !e.cached && !e.failed,
      )

    const availableEntries = context.availableEntries
    const availableChapters = context.chapters ?? []

    // Written by the stop condition below -- the only place that sees the real count.
    let stepsTaken = 0

    // The un-chapterized tail reaches the agent two ways, and it must not be both at once.
    //
    // `recentNarrative` and `getUnchapterizedEntries()` are two derivations of the same
    // slice of the story -- `entries.slice(lastChapterEnd + 1)` either way. Capping the
    // prompt while handing grep the whole tail therefore left the overlap searchable: the
    // tool could spend excerpt budget quoting back prose already sitting in the prompt, and
    // on a story just past a chapter cut, where the whole tail fits, every tail hit was of
    // that kind.
    //
    // So the tail is cut once and each half goes to one consumer: the newest entries are
    // quoted, the rest is searchable. Nothing becomes unreachable, and nothing arrives twice.
    // Without grep there is no second route, so the prompt keeps the tail whole.
    // The split itself runs below, once `canGrepChapters` has decided -- `searchableTail` is
    // read through a closure, so the tool context can be built before it is narrowed.
    const tailEntries = context.getUnchapterizedEntries?.() ?? []
    let recentContext = context.recentNarrative
    let searchableTail = tailEntries

    // The tools get the arrays as they are. They used to get a full JSON round-trip deep
    // copy of the entire lorebook on every generation turn -- to avoid a DataCloneError,
    // but the proxies only ever escaped through arrays the tools handed straight back in
    // their results (keywords, aliases, ...). Those are spread at the point of return
    // instead, so the only thing still deep-copied is the handful of entries actually
    // selected, at the end.
    const toolContext: RetrievalToolContext = {
      entries: availableEntries,
      chapters: availableChapters,
      worldState: context.worldState,
      onEvent: record,
      describeProgress: () =>
        summarizeProgress(events, { steps: stepsTaken, maxIterations: this.maxIterations }),
      // Passed straight through: the repeat cache, the failure handling and the event
      // recording all live in `ChapterQueryBudget`, which the tool owns.
      onQueryChapter: context.queryChapter,
      getChapterEntries: context.getChapterEntries,
      getUnchapterizedEntries: context.getUnchapterizedEntries ? () => searchableTail : undefined,
      grepEnabled: this.grepEnabled,
      grepExcerptsPerSearch: this.grepExcerptsPerSearch,
    }

    // One expression, three readers: the tool registration inside `createRetrievalTools`, the
    // tail split below, and the template. It used to reach only the template, so with the
    // feature off the model still got the tool -- undocumented -- while the split that stops
    // grep quoting back prose already in the prompt was skipped.
    const grepAvailable = canGrepChapters(toolContext)

    if (grepAvailable && tailEntries.length > 0) {
      const split = splitRecentTail(tailEntries, RECENT_NARRATIVE_CHARS, MIN_RECENT_ENTRIES)
      recentContext = recentContent(split.shown, split.shown.length, AS_PROSE)
      searchableTail = split.searchable
    }

    // Create tools
    const tools = createRetrievalTools(toolContext)

    // Wrapped so the real step count reaches describeProgress. Runs after each step, so
    // inside a tool call it reports steps finished, not the one in flight.
    //
    // Writing from inside a stop predicate is only safe because the SDK evaluates the
    // conditions exactly once per loop iteration (`isStopConditionMet`, called at the foot
    // of the generate loop). It is not contractual, so the count is kept monotonic: were a
    // future version to re-evaluate with a stale array, progress could read as going
    // backwards, which is worse than being one step behind.
    const terminalStop = stopOnTerminalTool<typeof tools>('finish_retrieval', this.maxIterations)
    const stopWhen: typeof terminalStop = (input) => {
      stepsTaken = Math.max(stepsTaken, input.steps.length)
      return terminalStop(input)
    }

    // The agent's only view of the chapter index -- there is no list_chapters tool, so the
    // same summaries never exist in two places for it to reconcile. Summaries are not
    // truncated: they are what the agent uses to decide where to look.
    //
    // Header and summary only. Each chapter also carries characters/locations/threads/
    // keywords/tone, and emitting them cost 25% of this prompt on a 39-chapter story --
    // to restate names the summary above already mentions. grep_chapters finds a name in
    // the actual text better than a facet list does.
    const chapterList =
      availableChapters
        .map((ch) => `- Chapter ${ch.number}${ch.title ? `: ${ch.title}` : ''}\n  ${ch.summary}`)
        .join('\n') || 'No chapters available.'

    // One line per entry, so the full list stays cheap. No index: the agent addresses
    // entries by id through search_entries/get_entry, and cannot select them at all.
    const entryList =
      availableEntries.map((e) => `- [${e.type}] ${e.name}`).join('\n') || 'No entries available.'

    // Render prompts through unified pipeline
    const ctx = await ContextBuilder.forPack(context.storyId)
    ctx.add({
      userInput: context.userInput,
      recentContext,
      chaptersCount: availableChapters.length,
      chapterList,
      entriesCount: availableEntries.length,
      entryList,
      // Same compact format `entryTimeTag` stamps the grep excerpts with, so "now" and
      // the times the agent reads in results are directly comparable. Empty when the
      // story has no time tracker; the template then omits the line rather than
      // inventing a start-of-story default.
      currentStoryTime: formatStoryTimeOrNull(context.currentStoryTime) ?? '',
      alreadyInContext: context.alreadyInContext ?? '',
      // The template describes grep_chapters only when the tool is actually registered.
      grepEnabled: grepAvailable,
      // Same for inspect_world_state, which `createRetrievalTools` registers only when
      // there is live state to inspect. The instruction was unconditional, so a story with
      // an empty world state was told to use a tool it had not been given.
      worldStateEnabled: hasLiveWorldState(context.worldState),
    })
    const { system: systemPrompt, user: userPrompt } = await ctx.render('agentic-retrieval')

    const prepareStep = finishOnlyOnLastStep(
      'finish_retrieval',
      this.maxIterations,
    ) as PrepareStepFunction<typeof tools>

    agentStepId = activity.startStep('Agent', {
      parentId: context.activityParentId,
      detail: `0/${this.maxIterations} steps`,
    })

    // Create the agent
    const agent = createAgentFromPreset(
      {
        presetId: this.presetId,
        instructions: systemPrompt,
        tools,
        stopWhen,
        prepareStep,
        signal,
      },
      'agentic-retrieval',
    )

    // A failed run still holds everything gathered before it died -- chapter answers cost
    // a full LLM call each. Throwing here loses them and, upstream, leaves the turn with
    // no retrieval at all; a context-window overflow mid-run did exactly that. Aborts
    // still propagate: the caller is waiting to discard the turn, not to salvage it.
    let terminalResult: FinishRetrievalResult | undefined
    let failure: string | null = null
    try {
      const result = await agent.generate({ prompt: userPrompt })
      stepsTaken = result.steps.length
      terminalResult = extractTerminalToolResult<FinishRetrievalResult>(
        result.steps as any,
        'finish_retrieval',
      )
    } catch (error) {
      if (signal?.aborted) throw error
      failure = error instanceof Error ? error.message : String(error)
      log('Agent run failed -- salvaging what it gathered', { failure, steps: stepsTaken })
    }

    activity.endStep(
      agentStepId,
      failure ? 'failed' : 'done',
      `${stepsTaken}/${this.maxIterations} steps`,
    )

    const metrics = retrievalMetrics(events)
    const transcript = formatRetrievalHistory(events)

    log('Agentic retrieval completed', {
      iterations: stepsTaken,
      hasTerminalResult: !!terminalResult,
      hasChapterSummary: !!terminalResult?.chapterSummary,
      ...metrics,
    })
    log('Retrieval transcript:\n' + transcript)

    // The app logger is a no-op outside dev, so on a real install this transcript would
    // exist nowhere. Debug mode is where a user goes to find out what a turn actually
    // did, so put it there too -- as a request/response pair, which is the shape
    // DebugLogView already renders.
    const debugId = debug.addDebugRequest('agentic-retrieval', {
      userInput: context.userInput,
      chapters: availableChapters.length,
      entries: availableEntries.length,
    })
    if (debugId) {
      debug.addDebugResponse(debugId, 'agentic-retrieval', { transcript, ...metrics }, startedAt)
    }

    // Build reasoning from terminal result
    let reasoning = terminalResult?.synthesis
    if (terminalResult?.additionalContext) {
      reasoning = reasoning
        ? `${reasoning}\n\nAdditional context: ${terminalResult.additionalContext}`
        : terminalResult.additionalContext
    }

    // No finish_retrieval: the agent ran out of steps, or the run failed. Either way the
    // chapter answers were already paid for, so salvage them instead of discarding.
    const truncated = !terminalResult
    if (truncated) {
      log('No terminal result -- salvaging what the session gathered', {
        iterations: stepsTaken,
        failure,
        answers: paidChapterAnswers().length,
      })
      // One line, not the transcript: this goes into the narrator's prompt, where a dump
      // of the agent's tool calls is noise it may read as story material.
      reasoning = failure
        ? 'Retrieval was cut short by an error; raw findings below.'
        : 'Retrieval ended before the agent could summarize; raw findings below.'
    }

    const salvagedChapterContext = truncated
      ? paidChapterAnswers()
          .map((a) => `**Chapter ${a.chapterNumber} — ${a.question}**\n${a.answer}`)
          .join('\n\n')
      : ''

    const narratorContext = buildRetrievalContext({
      reasoning: reasoning ?? '',
      chapterContext: terminalResult?.chapterSummary || salvagedChapterContext,
      reachedFinish: !truncated,
    })

    if (!narratorContext) {
      log('Run produced no findings -- returning empty context', {
        iterations: stepsTaken,
        failure,
        truncated,
      })
    }

    return { context: narratorContext }
  }
}

/**
 * Assemble the block the narrator receives, or `''` when there is nothing worth sending.
 *
 * Split out of `runRetrieval` because it is the one part of the run whose rules are worth
 * pinning and the only one testable without an agent: everything above it needs a provider,
 * a prompt pack and the debug store.
 *
 * **Nothing gathered means an empty context, not a context containing an apology** -- but
 * "nothing gathered" is not the same as "chapterSummary is empty". That field is optional in
 * `finish_retrieval`'s schema, and a run that puts its findings in `synthesis` instead is a
 * normal outcome, so keying the whole result off `chapterSummary` threw away completed work
 * whenever the model made that choice. What has to be suppressed is narrower: a run that did
 * not reach `finish_retrieval` and salvaged nothing, whose only output would be a note about
 * the retrieval agent's own troubles -- which the narrator reads as story material. Hence
 * `reachedFinish`: a truncated run needs real findings to be worth reporting, a finished one
 * is reported on whatever it produced.
 *
 * **One heading, because this is one block.** The two label conventions in this codebase are
 * structural, not stylistic: `[BRACKETS]` is a top-level block of the narrator's prompt
 * (`MemoryService.buildRelevantContextBlock`), `##` is a markdown subsection inside one
 * (`buildChapterSummariesBlock`, which sits within `<story_history>` beside the chapter
 * summaries). This block is top-level, so it takes the bracket form. Emitting both -- as this
 * did -- gave the block a subsection carrying its own name, which reads as two separate
 * pieces of retrieved context rather than one.
 *
 * `reasoning` and `chapterContext` stay two paragraphs rather than two headings: the prompt
 * already tells the agent they are a sentence of framing and the material itself, and on a
 * salvaged run the first is literally "raw findings below".
 */
export function buildRetrievalContext(input: {
  /** The agent's synthesis, or the salvage note when the run did not finish. */
  reasoning: string
  /** `chapterSummary`, or the chapter answers salvaged from a run that died. */
  chapterContext: string
  /** Whether the run reached `finish_retrieval`. */
  reachedFinish: boolean
}): string {
  const { reasoning, chapterContext, reachedFinish } = input

  const synthesis = reachedFinish ? reasoning : ''
  if (!chapterContext && !synthesis) return ''

  const parts = [reasoning, chapterContext].filter((part) => part.length > 0)
  if (parts.length === 0) return ''

  return `[RELEVANT STORY DATA]\n${parts.join('\n\n')}`
}
