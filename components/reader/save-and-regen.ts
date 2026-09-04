import type { StoryEntry } from '@/lib/db'

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
  if (tailEntryId == null) return null
  const replyIndex = rows.findIndex((row) => row.id === tailEntryId)
  const reply = rows[replyIndex]
  if (reply == null || reply.kind !== 'ai_reply') return null
  // regenerateTurn re-reads the prompt from the surviving tail, so the origin
  // must be the reply's positional predecessor for the edit to be what it reads.
  const origin = rows[replyIndex - 1]
  if (origin == null || origin.kind !== 'user_action') return null
  return { originId: origin.id, replyId: reply.id }
}
