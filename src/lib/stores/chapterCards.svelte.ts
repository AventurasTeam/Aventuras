/**
 * Chapter Cards Store
 *
 * Reactive shell over `ChapterCards`. The logic lives in
 * `#lib/services/chapterCreation/index.ts`; this file wires it to a rune and to the toast.
 */

import { ChapterCards, type ChapterCard } from '#lib/services/chapterCreation/index.ts'
import { ui } from '#lib/stores/ui.svelte.ts'

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
}

export const chapterCards = new ChapterCardsStore()
