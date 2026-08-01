/**
 * Chapter Read Budget
 *
 * Assembling the chapter text of one answer prompt, truncated to a token budget.
 *
 * The path was unbounded. A chapter runs ~17,000 tokens of verbatim entry text, so a query
 * naming three chapters built a 50,000-token prompt and one naming four built 68,000 -- both
 * rejected outright by a 49,152-token server. The prompt already asked for at most three
 * chapters and the model asked for four anyway.
 *
 * Entries in order, stop when the budget is spent. Tokens come from `metadata.tokenCount`,
 * already computed and stored per entry, so this costs a sum of integers.
 *
 * Pure, so the truncation is testable without an LLM.
 */

/** One entry, already rendered, with the cost of including it. */
export interface ChapterReadEntry {
  text: string
  tokens: number
}

export interface ChapterForRead {
  number: number
  /** `## Chapter N ...` line. Not charged: it is a rounding error against the budget. */
  header: string
  entries: ChapterReadEntry[]
}

export interface ChapterReadResult {
  content: string
  /** Chapters that got no text at all. */
  omittedChapters: number[]
  /** Chapters included only in part. At most one, since the cut is a single stop point. */
  partialChapters: number[]
}

const JOIN = '\n\n'

/**
 * Assemble `chapters` in order, cutting off once `maxTokens` is spent.
 *
 * A chapter left out entirely is named in a leading marker rather than silently dropped: the
 * answering model would otherwise report on chapters it never saw.
 */
export function buildChapterRead(chapters: ChapterForRead[], maxTokens: number): ChapterReadResult {
  const blocks: string[] = []
  const omittedChapters: number[] = []
  const partialChapters: number[] = []
  let remaining = maxTokens

  for (const chapter of chapters) {
    const kept: string[] = []
    for (const entry of chapter.entries) {
      // Always take the first entry of the first chapter: an empty prompt is worse than an
      // over-budget one, and only a budget below a single entry can reach this.
      if (entry.tokens > remaining && (kept.length > 0 || blocks.length > 0)) break
      kept.push(entry.text)
      remaining -= entry.tokens
    }

    if (kept.length === 0) {
      omittedChapters.push(chapter.number)
      continue
    }
    if (kept.length < chapter.entries.length) partialChapters.push(chapter.number)

    blocks.push(`${chapter.header}\n${kept.join(JOIN)}`)
  }

  const content = blocks.join(JOIN)
  if (omittedChapters.length === 0 && partialChapters.length === 0) {
    return { content, omittedChapters, partialChapters }
  }

  const notes = ['[TRUNCATED: the chapter text below was cut to fit.']
  if (partialChapters.length > 0) {
    notes.push(` Chapter ${partialChapters.join(', ')} is incomplete.`)
  }
  if (omittedChapters.length > 0) {
    notes.push(
      ` Chapter${omittedChapters.length === 1 ? '' : 's'} ${omittedChapters.join(', ')} ` +
        'not included at all — say so rather than answering for them.',
    )
  }
  notes.push(']')

  return { content: `${notes.join('')}\n\n${content}`, omittedChapters, partialChapters }
}
