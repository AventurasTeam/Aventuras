/**
 * The whole-chapter read, shared by the two agents that can ask for one.
 *
 * `query_chapter` is the most expensive thing either agent can do: it hands a whole
 * chapter — ~17,000 tokens on a real save — to a second model. Nothing in the agent loop
 * bounds it on its own, because `maxIterations` counts steps and a run could spend every
 * step on a read. So the three things that keep it in hand live here, once, instead of
 * being written twice and drifting:
 *
 * - **a budget**, spent per call and refused past it;
 * - **a cache**, so a repeated question is free rather than a second read;
 * - **failures cached like answers**, so a question the provider cannot answer is not
 *   re-asked until the step ceiling is gone, with none of it in the transcript.
 *
 * What is *not* shared is the tool: the two agents have different contexts and different
 * result shapes, and merging them would drag the retrieval context's `onEvent` and
 * `describeProgress` into the lorebook. They each build their own tool around this.
 *
 * Plain TypeScript, no store or SDK imports.
 */

/**
 * Retrieval's budget: a per-turn allowance on a shallow pass, paid on every narrator turn,
 * with `grep_chapters` available as the free alternative.
 */
export const MAX_CHAPTER_QUERIES_RETRIEVAL = 3

/**
 * Lore management's budget. A different question, so a different number: the pass is rare
 * (once per chapter) and deep, its step ceiling is far higher, and it has no cheaper tool
 * to fall back on. It is still bounded, because every answer stays in the prompt for the
 * rest of a run that can last dozens of steps.
 */
export const MAX_CHAPTER_QUERIES_LORE = 6

export interface ChapterAnswer {
  answer: string
  /** Served from this run's cache: no model was called and no budget was spent. */
  cached: boolean
  /** The read was attempted and failed. `answer` explains it; asking again is free. */
  failed: boolean
}

export interface ChapterQueryRecord extends ChapterAnswer {
  chapterNumber: number
  question: string
  durationMs: number
}

export interface ChapterQueryOptions {
  /** Whole-chapter reads this run may pay for. */
  max: number
  /** `turn` or `session` — what the refusal calls the window it has spent. */
  scope: string
  /**
   * Sentence naming a cheaper way to get the same material, appended to the refusal.
   *
   * Omitted where there is none, and it must be omitted rather than guessed: pointing the
   * model at a tool that is not registered is the failure `canGrepChapters` exists to stop.
   */
  alternative?: string
  /** Reads a chapter and answers. Absent when the caller cannot read chapters at all. */
  ask?: (chapterNumber: number, question: string) => Promise<string>
  /** Called for every answer, cached or not. Retrieval records these in its transcript. */
  onAnswer?: (record: ChapterQueryRecord) => void
}

/** Two spellings of one question are one question. */
function keyOf(chapterNumber: number, question: string): string {
  return `${chapterNumber}:${question.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

export class ChapterQueryBudget {
  private answers = new Map<string, ChapterAnswer>()
  private paid = 0

  constructor(private options: ChapterQueryOptions) {}

  /** Reads paid for so far. Cache hits are not among them. */
  get spent(): number {
    return this.paid
  }

  /** Whether this exact question has already been answered in this run. */
  knows(chapterNumber: number, question: string): boolean {
    return this.answers.has(keyOf(chapterNumber, question))
  }

  /**
   * Whether a *new* question can still be paid for.
   *
   * Callers check this before looking the chapter up, so a spent budget reads the same
   * whichever chapter was asked for — otherwise the refusal is mistaken for "no such
   * chapter". A question already in the cache should be served regardless: it is free.
   */
  exhausted(): boolean {
    return this.paid >= this.options.max
  }

  exhaustedError(): string {
    const { max, scope, alternative } = this.options
    return (
      `You have used all ${max} whole-chapter reads for this ${scope}. ` +
      (alternative ??
        'Work from the chapter summaries in your instructions, which are complete and untruncated.')
    )
  }

  async ask(chapterNumber: number, question: string): Promise<ChapterAnswer> {
    const key = keyOf(chapterNumber, question)
    const startedAt = Date.now()

    const previous = this.answers.get(key)
    if (previous) {
      const record = { ...previous, cached: true }
      this.options.onAnswer?.({ ...record, chapterNumber, question, durationMs: 0 })
      return record
    }

    // Not charged, and not cached either: no read was attempted and none ever will be, so
    // spending the budget on it would let a handful of questions exhaust an allowance that
    // was never going to buy anything.
    if (!this.options.ask) {
      const unavailable: ChapterAnswer = {
        answer:
          'Chapter reading is not available in this session. The chapter summaries in your instructions are all there is.',
        cached: false,
        failed: true,
      }
      this.options.onAnswer?.({ ...unavailable, chapterNumber, question, durationMs: 0 })
      return unavailable
    }

    this.paid++

    let result: ChapterAnswer
    try {
      result = {
        answer: await this.options.ask(chapterNumber, question),
        cached: false,
        failed: false,
      }
    } catch (error) {
      result = {
        answer:
          `Query failed: ${error instanceof Error ? error.message : String(error)}. ` +
          'Asking this again returns the same answer without a second read; use the ' +
          'chapter summaries in your instructions instead.',
        cached: false,
        failed: true,
      }
    }

    this.answers.set(key, result)
    this.options.onAnswer?.({
      ...result,
      chapterNumber,
      question,
      durationMs: Date.now() - startedAt,
    })
    return result
  }
}
