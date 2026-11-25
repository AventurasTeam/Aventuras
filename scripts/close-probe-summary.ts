import { personWords } from './classifier-eval/person'

/** A completed close's chapter, read back from the row it wrote. */
export type ChapterText = { run: number; title: string; summary: string }

/** The summary's first- and second-person words outside quoted speech (personWords). */
export function summaryPersonWords(chapter: ChapterText): string[] {
  return personWords(chapter.summary)
}

/** "summaries in the first or second person: x of y completed", then one line per offending run. */
export function summaryPersonLines(chapters: readonly ChapterText[]): string[] {
  const offending = chapters.flatMap((chapter) => {
    const words = summaryPersonWords(chapter)
    return words.length === 0 ? [] : [`  run ${chapter.run}: ${words.join(', ')}`]
  })
  return [
    `summaries in the first or second person: ${offending.length} of ${chapters.length} completed`,
    ...offending,
  ]
}
