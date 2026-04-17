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
import { story } from '$lib/stores/story/index.svelte'
import { aiService } from '../generation'

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
  /** Selected entries for template consumption */
  agenticSelectedEntries: Entry[]
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
  async runRetrieval(): Promise<RetrievalResult> {
    const generationContext = story.generationContext
    const promptContext = generationContext.promptContext
    const availableEntries = story.lorebook.lorebookEntries
    const chapters = story.chapter.currentBranchChapters
    log('Starting agentic retrieval', {
      entryCount: availableEntries.length,
      chapterCount: chapters?.length ?? 0,
      maxIterations: this.maxIterations,
    })

    // Track selected entries and queried chapters
    const selectedIndices = new Set<number>()
    const queriedChapterIds = new Set<string>()
    const queryHistory: string[] = []

    // Create plain deep copies of reactive arrays to avoid DataCloneError in AI SDK
    // (Svelte reactive proxies cannot be structured cloned)
    const plainEntries = JSON.parse(JSON.stringify(promptContext.lorebookEntries)) as Entry[]
    const plainChapters = JSON.parse(JSON.stringify(promptContext.chapters)) as Chapter[]

    // Create tool context with chapter tracking
    const toolContext: RetrievalToolContext = {
      entries: plainEntries,
      chapters: plainChapters,
      onSelectEntry: (index) => {
        selectedIndices.add(index)
        log('Entry selected', { index, name: plainEntries[index]?.name })
      },
      queryChapter: async (chapterNumber: number, question: string) => {
        queriedChapterIds.add(String(chapterNumber))
        queryHistory.push(`Queried chapter ${chapterNumber}: ${question}`)
        return aiService.answerChapterQuestion(chapterNumber, question)
      },
    }

    // Create tools
    const tools = createRetrievalTools(toolContext)

    // Render prompts through unified pipeline
    const ctx = new ContextBuilder()
    ctx.add(promptContext)
    const { system: systemPrompt, user: userPrompt } = await ctx.render('agentic-retrieval')

    // Create the agent
    const agent = createAgentFromPreset(
      {
        presetId: this.presetId,
        instructions: systemPrompt,
        tools,
        stopWhen: stopOnTerminalTool('finish_retrieval', this.maxIterations),
        signal: story.generationContext.abortSignal,
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
      agenticSelectedEntries: selectedEntries,
      iterations,
      queriedChapters: Array.from(queriedChapterIds),
      queryHistory: queryHistory.length > 0 ? queryHistory : undefined,
    }
  }
}
