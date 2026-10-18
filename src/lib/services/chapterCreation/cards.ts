/**
 * Chapter Creation Cards
 *
 * The state of each card that reports an automatic chapter creation in the story. Held for the
 * session only. Plain TypeScript so the transitions are testable;
 * `stores/chapterCards.svelte.ts` adds reactivity and the toast.
 */

import { branchScopeKey } from '#lib/utils/branchScope.ts'
import type { Chapter } from '#lib/types/index.ts'

/**
 * `summarizing` → `lore` → `finished`, or `summary-failed` (no chapter), or `lore-incomplete`
 * (a chapter without its lore), which a restart takes back to `lore`.
 */
export type ChapterCardPhase =
  'summarizing' | 'lore' | 'finished' | 'summary-failed' | 'lore-incomplete'

export interface ChapterCard {
  id: string
  storyId: string
  branchId: string | null
  /** The narration of the turn that cut the chapter; the card sits after it. */
  anchorEntryId: string
  /** The key of the card's activity record. */
  recordKey: string
  number: number
  title: string | null
  chapterId: string | null
  /** Where the chapter's banner is, once the chapter exists. */
  chapterStartEntryId: string | null
  phase: ChapterCardPhase
  /** Why the card stopped short, as the reader is shown it. */
  reason: string | null
  /** Lore changes the incomplete runs wrote before they stopped, all of them. */
  loreChangeCount: number
  /** Lore management runs started, the first included. */
  loreRuns: number
  /** A failed summary can be tried again from the card. */
  retryable: boolean
}

export interface ChapterCardStart {
  storyId: string
  branchId: string | null
  anchorEntryId: string
  number: number
}

/** Running work: the chapter check holds off while one of these is on its branch. */
const RUNNING: ReadonlySet<ChapterCardPhase> = new Set(['summarizing', 'lore'])

export class ChapterCards {
  private cards: ChapterCard[] = []
  private counter = 0
  /** How to try a failed summary again, by card. */
  private retries = new Map<string, () => Promise<void>>()

  constructor(
    private onChange: () => void = () => {},
    /** Warns the reader, wherever they are, that a chapter creation failed. */
    private notify: (message: string) => void = () => {},
  ) {}

  start(start: ChapterCardStart): ChapterCard {
    const id = `card-${++this.counter}`
    const card: ChapterCard = {
      ...start,
      id,
      recordKey: `chapter:${id}`,
      title: null,
      chapterId: null,
      chapterStartEntryId: null,
      phase: 'summarizing',
      reason: null,
      loreChangeCount: 0,
      loreRuns: 0,
      retryable: false,
    }
    this.cards.push(card)
    this.onChange()
    return card
  }

  /** The chapter exists; its lore management starts. */
  summarized(id: string, chapter: Chapter): void {
    this.update(id, (card) => {
      card.title = chapter.title
      card.chapterId = chapter.id
      card.chapterStartEntryId = chapter.startEntryId
      card.phase = 'lore'
      card.loreRuns = 1
    })
  }

  /**
   * `retry`: how to try the summary again, when it still can be. `announce` is off for a retry the
   * reader just asked for, which the card itself answers.
   */
  summaryFailed(id: string, reason: string, retry?: () => Promise<void>, announce = true): void {
    if (retry) this.retries.set(id, retry)
    else this.retries.delete(id)
    const card = this.update(id, (card) => {
      card.phase = 'summary-failed'
      card.reason = reason
      card.retryable = !!retry
    })
    if (card && announce) {
      this.notify(
        'Chapter creation failed, and no chapter was created. The card in the story has the details.',
      )
    }
  }

  /** Try the failed summary again, from the card. */
  async retrySummary(id: string): Promise<void> {
    const retry = this.retries.get(id)
    if (!retry) return
    this.retries.delete(id)
    await retry()
  }

  /** A retried summary has started. */
  summaryRestarted(id: string): void {
    this.update(id, (card) => {
      card.phase = 'summarizing'
      card.reason = null
      card.retryable = false
    })
  }

  /** A restart from the card. */
  loreRestarted(id: string): void {
    this.update(id, (card) => {
      card.phase = 'lore'
      card.reason = null
      card.loreRuns++
    })
  }

  loreFinished(id: string): void {
    this.update(id, (card) => {
      card.phase = 'finished'
      card.reason = null
    })
  }

  loreIncomplete(id: string, reason: string, changeCount: number): void {
    const card = this.update(id, (card) => {
      card.phase = 'lore-incomplete'
      card.reason = reason
      card.loreChangeCount += changeCount
    })
    if (card) {
      this.notify(
        `Chapter ${card.number} was created, but its lore management did not complete. ` +
          'The card in the story has the details.',
      )
    }
  }

  /** Dismissed, or its chapter deleted: gone for the rest of the session. */
  remove(id: string): void {
    const before = this.cards.length
    this.retries.delete(id)
    this.cards = this.cards.filter((card) => card.id !== id)
    if (this.cards.length !== before) this.onChange()
  }

  /** The cards reporting this chapter. */
  withChapter(chapterId: string): ChapterCard[] {
    return this.cards.filter((card) => card.chapterId === chapterId)
  }

  get(id: string): ChapterCard | undefined {
    return this.cards.find((card) => card.id === id)
  }

  /** Whether a card on this branch is still summarizing or running lore management. */
  pending(storyId: string, branchId: string | null): boolean {
    const key = branchScopeKey(storyId, branchId)
    return this.cards.some(
      (card) => RUNNING.has(card.phase) && branchScopeKey(card.storyId, card.branchId) === key,
    )
  }

  /** The cards of one story branch, oldest first. */
  forScope(storyId: string, branchId: string | null): ChapterCard[] {
    const key = branchScopeKey(storyId, branchId)
    return this.cards.filter((card) => branchScopeKey(card.storyId, card.branchId) === key)
  }

  private update(id: string, change: (card: ChapterCard) => void): ChapterCard | undefined {
    const card = this.get(id)
    if (!card) return undefined
    change(card)
    this.onChange()
    return card
  }
}
