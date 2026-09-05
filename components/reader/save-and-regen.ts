import type { StoryEntry } from '@/lib/db'
import { resolveHeadTurn } from '@/lib/head-turn'

export type SaveAndRegenTurn = { originId: string; replyId: string }

/**
 * The head turn's `user_action` + `ai_reply` pair, or null when the tail is not
 * a reply that can be re-answered. Scoped to the head because regenerating any
 * earlier reply destroys every entry after it, which a Save button must not
 * carry — the action cluster's ↻ owns that path behind its cascade confirm.
 */
export function resolveSaveAndRegenTurn(
  rows: readonly StoryEntry[],
  tailEntryId: string | null,
): SaveAndRegenTurn | null {
  const head = resolveHeadTurn(rows)
  // regenerateTurn re-reads the prompt from the surviving tail, so a window whose head
  // turn is not the one the host named describes a different turn.
  if (head == null || head.origin == null || head.tail.id !== tailEntryId) return null
  return { originId: head.origin.id, replyId: head.tail.id }
}
