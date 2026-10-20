/**
 * Chapter Cards Store
 *
 * Reactive shell over `ChapterCards`. The logic lives in
 * `#lib/services/chapterCreation/index.ts`; this file wires it to a rune and to the toast.
 */

import { ChapterCards, type ChapterCard } from '#lib/services/chapterCreation/index.ts'
import { ui } from '#lib/stores/ui.svelte.ts'
import { activity } from '#lib/stores/activity.svelte.ts'
import type { Chapter } from '#lib/types/index.ts'
import { isLoreManagementRunning, runManualLoreManagement } from '#lib/services/generation/index.ts'

class ChapterCardsStore {
  /** Increments on every change. Read it to make a derivation reactive. */
  version = $state(0)

  readonly cards = new ChapterCards(
    () => this.version++,
    (message) => ui.showToast(message, 'warning'),
  )

  // Copies: a card is mutated in place, and a component handed the same object again would not
  // see that it changed.
  get(id: string): ChapterCard | undefined {
    void this.version
    const card = this.cards.get(id)
    return card && { ...card }
  }

  forScope(storyId: string, branchId: string | null): ChapterCard[] {
    void this.version
    return this.cards.forScope(storyId, branchId).map((card) => ({ ...card }))
  }

  pending(storyId: string, branchId: string | null): boolean {
    void this.version
    return this.cards.pending(storyId, branchId)
  }

  /** A card reports its chapter: once the chapter is deleted, by the card or elsewhere, so is it. */
  chapterDeleted(chapterId: string): void {
    for (const card of this.cards.withChapter(chapterId)) {
      this.cards.remove(card.id)
      activity.discardRecord(card.recordKey)
    }
  }

  /**
   * Runs a chapter's lore management again, recorded as the chapter's, and moves its card along.
   * Resolves once the run ends.
   */
  async restartLore(chapter: Chapter, options: { readAfterChapter?: boolean } = {}): Promise<void> {
    const card = this.cards.withChapter(chapter.id)[0]
    if (card) this.cards.loreRestarted(card.id)
    const recordId = card ? activity.reopenRecord(card.recordKey) : null
    const result = await runManualLoreManagement(
      chapter,
      recordId && card
        ? { activity, placement: { recordId }, label: `Lore management (run ${card.loreRuns})` }
        : undefined,
      options,
    )
    if (recordId) activity.endRecord(recordId)
    if (!card) return
    if (result?.completed) this.cards.loreFinished(card.id)
    else this.cards.loreIncomplete(card.id, result?.error ?? 'Lore management did not complete')
  }

  /**
   * Whether chapter work on this branch could cut, or lock out, a new chapter: a chapter check
   * asking the model, a card still working, or a lore management run holding the branch.
   * Not the turn's background tasks as a whole, which include the style review.
   */
  busy(storyId: string, branchId: string | null): boolean {
    return (
      ui.chapterCheckActiveFor(storyId, branchId) ||
      this.pending(storyId, branchId) ||
      isLoreManagementRunning(storyId, branchId)
    )
  }
}

export const chapterCards = new ChapterCardsStore()
