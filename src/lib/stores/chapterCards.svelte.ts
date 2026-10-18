/**
 * Chapter Cards Store
 *
 * Reactive shell over `ChapterCards`. The logic lives in
 * `#lib/services/chapterCreation/index.ts`; this file wires it to a rune and to the toast.
 */

import { ChapterCards, type ChapterCard } from '#lib/services/chapterCreation/index.ts'
import { ui } from '#lib/stores/ui.svelte.ts'
import { activity } from '#lib/stores/activity.svelte.ts'
import { isLoreManagementRunning } from '#lib/services/generation/index.ts'

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
