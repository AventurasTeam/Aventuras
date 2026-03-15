/**
 * Agentic Retrieval Service
 *
 * Uses agentic reasoning to intelligently search and retrieve lorebook entries
 * and chapter context using the Vercel AI SDK ToolLoopAgent.
 */

import type { Entry, Chapter, StoryEntry } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { createLogger } from '$lib/log'
import { createAgentFromPreset, extractTerminalToolResult, stopOnTerminalTool } from '../sdk/agents'
import { createRetrievalTools, type RetrievalToolContext } from '../sdk/tools'
import { ContextBuilder } from '$lib/services/context'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'

const log = createLogger('AgenticRetrieval')

/**
 * Result from an agentic retrieval session.
 */
export interface RetrievalResult {
  /** Selected lorebook entries */
  entries: Entry[]
  /** Agent's reasoning/synthesis */
  agenticReasoning: string
  /** Summary of key facts learned from chapter queries */
  agenticChapterSummary: string
  /** Selected entries mapped to ContextLorebookEntry shape */
  agenticSelectedEntries: ContextLorebookEntry[]
  /** Number of agent iterations */
  iterations: number
  /** IDs of chapters that were queried */
  queriedChapters: string[]
  /** History of queries made */
  queryHistory?: string[]
}

/**
 * Context for running agentic retrieval.
 */
export interface RetrievalContext {
  userInput: string
  recentEntries: StoryEntry[]
  availableEntries: Entry[]
  /** Chapter summaries for context */
  chapters?: Chapter[]
  /** Optional callback to ask a question about a chapter */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
}

// Alias for export compatibility (input context, not output result)
export type AgenticRetrievalContext = RetrievalContext

/**
 * Settings for agentic retrieval behavior.
 */
export interface AgenticRetrievalSettings {
  enabled: boolean
  maxIterations: number
}

export function getDefaultAgenticRetrievalSettings(): AgenticRetrievalSettings {
  return {
    enabled: true,
    maxIterations: 30,
  }
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
  private recentEntryCount: number

  constructor(serviceId: string, maxIterations: number = 30, recentEntryCount: number = 5) {
    super(serviceId)
    this.maxIterations = maxIterations
    this.recentEntryCount = recentEntryCount
  }

  /**
   * Run agentic retrieval to find relevant lorebook entries.
   *
   * @param context - The retrieval context
   * @param signal - Optional abort signal for cancellation
   * @returns Result with selected entries and reasoning
   */
  async runRetrieval(context: RetrievalContext, signal?: AbortSignal): Promise<RetrievalResult> {
    log('Starting agentic retrieval', {
      entryCount: context.availableEntries.length,
      chapterCount: context.chapters?.length ?? 0,
      maxIterations: this.maxIterations,
    })

    // Track selected entries and queried chapters
    const selectedIndices = new Set<number>()
    const queriedChapterIds = new Set<string>()
    const queryHistory: string[] = []

    // Create plain deep copies of reactive arrays to avoid DataCloneError in AI SDK
    // (Svelte reactive proxies cannot be structured cloned)
    const plainEntries = JSON.parse(JSON.stringify(context.availableEntries))
    const plainChapters = JSON.parse(JSON.stringify(context.chapters ?? []))

    // Create tool context with chapter tracking
    const toolContext: RetrievalToolContext = {
      entries: plainEntries,
      chapters: plainChapters,
      onSelectEntry: (index) => {
        selectedIndices.add(index)
        log('Entry selected', { index, name: plainEntries[index]?.name })
      },
      queryChapter: context.queryChapter
        ? async (chapterNumber: number, question: string) => {
            queriedChapterIds.add(String(chapterNumber))
            queryHistory.push(`Queried chapter ${chapterNumber}: ${question}`)
            return context.queryChapter!(chapterNumber, question)
          }
        : undefined,
    }

    // Create tools
    const tools = createRetrievalTools(toolContext)

    // Build typed arrays (apply slice limits before mapping — templates cannot slice)
    const agenticChapters = (context.chapters ?? []).slice(0, 20).map((ch) => ({
      number: ch.number,
      title: ch.title ?? '',
      summary: ch.summary.slice(0, 100) + '...',
    }))
    const agenticEntries = context.availableEntries.slice(0, 30).map((e) => ({
      name: e.name,
      type: e.type,
    }))

    // Map recent entries to ContextStoryEntry shape (character budget removed — configurable count)
    const recentEntries = mapStoryEntriesToContext(
      context.recentEntries.slice(-this.recentEntryCount),
      {
        stripPicTags: false,
      },
    )

    // Render prompts through unified pipeline
    const ctx = new ContextBuilder()
    ctx.add({
      userInput: context.userInput,
      recentEntries,
      chaptersCount: context.chapters?.length ?? 0,
      agenticChapters,
      entriesCount: context.availableEntries.length,
      agenticEntries,
    })
    const { system: systemPrompt, user: userPrompt } = await ctx.render('agentic-retrieval')

    // Create the agent
    const agent = createAgentFromPreset(
      {
        presetId: this.presetId,
        instructions: systemPrompt,
        tools,
        stopWhen: stopOnTerminalTool('finish_retrieval', this.maxIterations),
        signal,
      },
      'agentic-retrieval',
    )

    // Run the agent
    const result = await agent.generate({ prompt: userPrompt })

    // Extract the terminal result

    const terminalResult = extractTerminalToolResult<FinishRetrievalResult>(
      result.steps as any,
      'finish_retrieval',
    )

    const iterations = result.steps.length

    log('Agentic retrieval completed', {
      iterations,
      selectedCount: selectedIndices.size,
      queriedChapters: queriedChapterIds.size,
      hasTerminalResult: !!terminalResult,
      hasChapterSummary: !!terminalResult?.chapterSummary,
    })

    // Build the selected entries array (use plainEntries to avoid proxy issues)
    const selectedEntries = Array.from(selectedIndices)
      .filter((idx) => idx >= 0 && idx < plainEntries.length)
      .map((idx) => plainEntries[idx])

    // Build reasoning from terminal result
    let reasoning = terminalResult?.synthesis
    if (terminalResult?.additionalContext) {
      reasoning = reasoning
        ? `${reasoning}\n\nAdditional context: ${terminalResult.additionalContext}`
        : terminalResult.additionalContext
    }

    return {
      entries: selectedEntries,
      agenticReasoning: reasoning ?? '',
      agenticChapterSummary: terminalResult?.chapterSummary ?? '',
      agenticSelectedEntries: selectedEntries.map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description,
      })),
      iterations,
      queriedChapters: Array.from(queriedChapterIds),
      queryHistory: queryHistory.length > 0 ? queryHistory : undefined,
    }
  }
}
