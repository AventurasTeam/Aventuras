/**
 * Timeline Fill Service
 *
 * Answers questions about story timeline and fills in gaps using chapter summaries.
 * Uses the Vercel AI SDK for structured output with Zod schema validation.
 */

import type { Chapter, StoryEntry } from '$lib/types'
import type { ServiceId } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { entryTimeTag, formatTimeSpan } from '$lib/utils/storyTime'
import { generatePlainText } from '../sdk/generate'
import {
  timelineQueriesResultSchema,
  timelineBatchAnswerResultSchema,
  type TimelineBatchAnswerResult,
  type TimelineQuery,
} from '../sdk/schemas/timeline'
import { resolveQueryChapterNumbers, groupByChapterCoverage } from './timelineFillGrouping'
import { buildChapterRead, type ChapterForRead } from './chapterContentBudget'
import { countTokens } from '$lib/services/tokenizer'
import { chapterReadBudget } from '../core/defaults'

const log = createLogger('TimelineFill')

/**
 * Text `answerQuestion` returns when the call failed, so `runTimelineFill` can drop it.
 *
 * It used to reach the narrator: `buildChapterSummariesBlock` writes every response into the
 * prompt under "The following information was retrieved from past chapters and is relevant to
 * the current scene", so a rejected request arrived as a detailed question followed by
 * `A: Unable to answer the question.` -- presented as retrieved material.
 */
const UNANSWERED = 'Unable to answer the question.'

// Type definitions
export interface TimelineAnswer {
  answer: string
  /**
   * 0 when the answer is a give-up string rather than retrieved information -- a failed
   * call, or no chapters resolved. `runTimelineFill` drops those instead of forwarding them
   * to the narrator, so this is the flag that decides it, not a score anyone reads.
   */
  confidence: number
}

export interface TimelineQueryResult {
  query: string
  answer: string
  chapterNumbers: number[]
}

export interface TimelineFillResult {
  queries: TimelineQuery[]
  responses: TimelineQueryResult[]
}

/**
 * Service that answers timeline questions using chapter content.
 */
export class TimelineFillService extends BaseAIService {
  private maxQueries: number

  constructor(serviceId: ServiceId, maxQueries: number = 5) {
    super(serviceId)
    this.maxQueries = maxQueries
  }

  /**
   * Generate queries to fill gaps in timeline knowledge.
   */
  async generateQueries(
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
    alreadyInContext?: string,
  ): Promise<TimelineQuery[]> {
    log('generateQueries called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
    })

    if (chapters.length === 0) {
      log('No chapters available, skipping query generation')
      return []
    }

    // Build chapter history from visible entries
    const chapterHistory = visibleEntries
      .slice(-10)
      .map((e) => `[${e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}]: ${e.content}`)
      .join('\n\n')

    // Build timeline from chapters
    const timeline = chapters
      .map((c) => `Chapter ${c.number}: ${c.summary.trim() || 'No summary'}`)
      .join('\n')

    // Knowing who is present, where, and which threads are open makes the difference
    // between "what happened before" and a question worth an LLM call.
    const ctx = new ContextBuilder()
    ctx.add({ chapterHistory, timeline, alreadyInContext: alreadyInContext ?? '' })
    const { system, user: prompt } = await ctx.render('timeline-fill')

    try {
      const result = await this.generate(
        timelineQueriesResultSchema,
        system,
        prompt,
        'timeline-fill',
      )

      log('Generated queries:', result.queries.length)
      return result.queries.slice(0, this.maxQueries)
    } catch (error) {
      log('Query generation failed:', error)
      return []
    }
  }

  /** Which chapters a query targets. An empty/absent list means "all of them". */
  private resolveTargetChapters(
    chapterNumbers: number[] | undefined,
    chapters: Chapter[],
  ): Chapter[] {
    return chapterNumbers && chapterNumbers.length > 0
      ? chapters.filter((c) => chapterNumbers.includes(c.number))
      : chapters
  }

  /**
   * Render each chapter for `buildChapterRead`: one text block per entry, each with the cost
   * of including it.
   *
   * Token counts come from `metadata.tokenCount`, computed once when the entry was written --
   * the same source `story.tokensOutsideBuffer` and `ChapterBatchPlanner` use. `countTokens`
   * is only the fallback for entries written before it was stored.
   *
   * A chapter with no entry text falls back to its summary. That is a real absence, not a
   * size decision: shrinking a chapter to its summary to save room would spend an LLM call
   * producing text the reader already has, since every summary is already in both the agent's
   * chapter list and the narrator's `<story_history>`.
   */
  private renderChapters(
    targetChapters: Chapter[],
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
  ): ChapterForRead[] {
    // Oldest first, defensively: chapters are sorted when loaded but a new one is appended
    // without re-sorting, and this text reads as a timeline.
    return [...targetChapters]
      .sort((a, b) => a.number - b.number)
      .map((c) => {
        const span = formatTimeSpan(c.startTime, c.endTime)
        const header =
          `## Chapter ${c.number}${c.title ? `: ${c.title}` : ''}` + (span ? ` (${span})` : '')

        const storyEntries = getChapterEntries?.(c) ?? []
        // The time tag is emitted only when it changes from the previous entry: repeating it
        // on every line costs tokens to say nothing.
        let previousTag: string | null = null
        const entries = storyEntries.map((e) => {
          const role = e.type === 'user_action' ? 'ACTION' : 'NARRATIVE'
          const tag = entryTimeTag(e, c)
          const prefix = tag === previousTag ? '' : `${tag} `
          previousTag = tag
          return {
            text: `${prefix}[${role}]: ${e.content}`,
            tokens: e.metadata?.tokenCount ?? countTokens(e.content),
          }
        })

        if (entries.length > 0) return { number: c.number, header, entries }
        return {
          number: c.number,
          header,
          entries: [{ text: c.summary, tokens: countTokens(c.summary) }],
        }
      })
  }

  /** Assemble the chapter text for one prompt, truncated to `maxChapterTokens`. */
  private buildContent(
    targetChapters: Chapter[],
    maxChapterTokens: number,
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
  ): string {
    const read = buildChapterRead(
      this.renderChapters(targetChapters, getChapterEntries),
      maxChapterTokens,
    )
    if (read.omittedChapters.length > 0 || read.partialChapters.length > 0) {
      log('Chapter text truncated to budget', {
        budget: maxChapterTokens,
        omitted: read.omittedChapters,
        partial: read.partialChapters,
      })
    }
    return read.content
  }

  /**
   * Answer a question about the story timeline.
   *
   * Also the entry point for the agentic `query_chapter` tool, through
   * `aiService.answerChapterQuestion`.
   *
   * @param maxChapterTokens Budget for the chapter text; see `chapterReadBudget`.
   */
  async answerQuestion(
    query: string,
    chapters: Chapter[],
    chapterNumbers?: number[],
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
    maxChapterTokens: number = chapterReadBudget(undefined),
  ): Promise<TimelineAnswer> {
    log('answerQuestion called', {
      query,
      chaptersCount: chapters.length,
      targetChapters: chapterNumbers,
      hasEntriesCallback: !!getChapterEntries,
      maxChapterTokens,
    })

    const targetChapters = this.resolveTargetChapters(chapterNumbers, chapters)
    if (targetChapters.length === 0) {
      return { answer: 'No relevant chapters found.', confidence: 0 }
    }

    return this.answerQuestionWithContent(
      query,
      this.buildContent(targetChapters, maxChapterTokens, getChapterEntries),
    )
  }

  /**
   * `answerQuestion` once the chapter content has already been assembled. Separate so
   * `runTimelineFill` can build that content once per chunk and reuse it across the questions
   * that need it, instead of reassembling the full story text per question -- which on a long
   * story is a large, repeated allocation on the generation hot path.
   */
  private async answerQuestionWithContent(
    query: string,
    chapterContent: string,
  ): Promise<TimelineAnswer> {
    const ctx = new ContextBuilder()
    ctx.add({ chapterContent, query })
    const { system, user: prompt } = await ctx.render('timeline-fill-answer')

    try {
      const answer = await generatePlainText(
        {
          presetId: this.presetId,
          system,
          prompt,
        },
        'timeline-fill-answer',
      )

      return { answer: answer.trim(), confidence: 0.8 }
    } catch (error) {
      log('Answer generation failed:', error)
      return { answer: UNANSWERED, confidence: 0 }
    }
  }

  /**
   * Answer several questions about one already-assembled chunk in a single call: the chapter
   * content is sent once and the model returns one answer per question.
   *
   * The batch path uses structured output, while the single-question path uses plain text.
   * That asymmetry matters: a provider with weak JSON-schema support answers one question
   * fine but fails the batch, and a batch failure would otherwise lose N answers where the
   * unbatched path loses one. So any question the batch does not come back with -- whether
   * the whole call threw or the model simply skipped an index -- is retried individually
   * rather than reported as unanswerable.
   */
  private async answerQuestionsWithContent(
    queries: string[],
    chapterContent: string,
  ): Promise<{ answers: TimelineAnswer[]; llmCalls: number }> {
    const questionsList = queries.map((q, index) => `${index}. ${q}`).join('\n')

    const ctx = new ContextBuilder()
    ctx.add({ chapterContent, questionsList })
    const { system, user: prompt } = await ctx.render('timeline-fill-batch-answer')

    let batched: TimelineBatchAnswerResult['answers'] = []
    try {
      const result = await this.generate(
        timelineBatchAnswerResultSchema,
        system,
        prompt,
        'timeline-fill-batch-answer',
      )
      batched = result.answers
    } catch (error) {
      log('Batch answer generation failed, falling back to individual calls:', error)
    }

    const answers = queries.map((_, index) => {
      const match = batched.find((a) => a.index === index)
      return match ? { answer: match.answer.trim(), confidence: 0.8 } : null
    })

    const missing: number[] = []
    answers.forEach((a, i) => {
      if (!a) missing.push(i)
    })

    // One for the batch call itself, whether or not it came back usable.
    let llmCalls = 1

    if (missing.length > 0) {
      log('Batch answer incomplete, retrying individually', {
        missing: missing.length,
        of: queries.length,
      })
      const retried = await Promise.all(
        missing.map((index) => this.answerQuestionWithContent(queries[index], chapterContent)),
      )
      missing.forEach((index, i) => {
        answers[index] = retried[i]
      })
      llmCalls += missing.length
    }

    return { answers: answers as TimelineAnswer[], llmCalls }
  }

  /**
   * Run the full timeline fill process.
   *
   * @param maxChapterTokens Budget for each answer prompt's chapter text; see `chapterReadBudget`.
   */
  async runTimelineFill(
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
    getChapterEntries?: (chapter: Chapter) => StoryEntry[],
    alreadyInContext?: string,
    maxChapterTokens: number = chapterReadBudget(undefined),
  ): Promise<TimelineFillResult> {
    log('runTimelineFill called', {
      visibleEntriesCount: visibleEntries.length,
      chaptersCount: chapters.length,
      hasEntriesCallback: !!getChapterEntries,
      maxChapterTokens,
    })

    if (chapters.length === 0) {
      return { queries: [], responses: [] }
    }

    const queries = await this.generateQueries(visibleEntries, chapters, alreadyInContext)
    if (queries.length === 0) {
      return { queries: [], responses: [] }
    }

    // Resolved against the chapters that actually exist, not against what the query asked
    // for: an open-ended query and one listing every chapter resolve to the same set.
    const pending = queries.map((q, index) => ({
      index,
      query: q.query,
      chapterNumbers: this.resolveTargetChapters(resolveQueryChapterNumbers(q), chapters).map(
        (c) => c.number,
      ),
    }))

    // Sparse: a question whose answer never arrived leaves its slot empty and is compacted
    // away below, rather than reaching the narrator as a non-answer.
    const results = new Array<TimelineQueryResult | undefined>(pending.length)

    // Questions whose chapters are a subset of a wider question's join that group and are
    // answered from its content -- see `groupByChapterCoverage`.
    const groups = groupByChapterCoverage(pending)

    const perGroupCalls = await Promise.all(
      groups.map(async (group) => {
        // Filtered directly, not through `resolveTargetChapters`: the group's list is already
        // resolved, and there an empty list means "all chapters" -- so a query naming only
        // chapters that do not exist would come back having read the whole story.
        const targetChapters = chapters.filter((c) => group.chapterNumbers.includes(c.number))
        if (targetChapters.length === 0) return 0

        const content = this.buildContent(targetChapters, maxChapterTokens, getChapterEntries)

        const { answers, llmCalls } =
          group.items.length === 1
            ? {
                answers: [await this.answerQuestionWithContent(group.items[0].query, content)],
                llmCalls: 1,
              }
            : await this.answerQuestionsWithContent(
                group.items.map((i) => i.query),
                content,
              )

        group.items.forEach((item, i) => {
          // `confidence: 0` is what every give-up path sets. None of it is retrieved
          // information, and `buildChapterSummariesBlock` presents whatever it is given as
          // material "relevant to the current scene", so it must not get there at all.
          if (answers[i].confidence === 0) return
          results[item.index] = {
            query: item.query,
            answer: answers[i].answer,
            chapterNumbers: item.chapterNumbers,
          }
        })

        return llmCalls
      }),
    )

    const answered = results.filter((r): r is TimelineQueryResult => r !== undefined)

    log('Timeline fill complete', {
      queriesGenerated: queries.length,
      responsesGenerated: answered.length,
      unanswered: results.length - answered.length,
      groups: groups.length,
      // Not the group count: a batch the model answers incompletely is retried question by
      // question, so the group count understates what the turn actually paid for.
      llmCallsMade: perGroupCalls.reduce((n, c) => n + c, 0),
    })

    return { queries, responses: answered }
  }
}
