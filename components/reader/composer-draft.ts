/**
 * Whether a composer draft holds nothing worth protecting from an overwrite.
 *
 * Whitespace-only counts as empty, matching the composer's own `canSend` and
 * lint gates — a lone space must not be treated as text the user would miss.
 */
export function isDraftEmpty(draft: { text: string } | undefined): boolean {
  return (draft?.text ?? '').trim().length === 0
}

/**
 * What a path that destroys a failure entry owes the composer.
 *
 * The entry's `submission` is the only copy of a failed turn's text — the
 * `user_action` was reverse-replayed with its action group — so dropping the
 * notice without handing it back deletes the user's words. A non-empty draft
 * wins: an older turn must not overwrite what is being typed now.
 */
export type SubmissionHandback =
  | { action: 'none' }
  | { action: 'restore'; content: string }
  | { action: 'keep-draft' }

export function planSubmissionHandback(
  submission: { content: string } | undefined,
  draft: { text: string } | undefined,
): SubmissionHandback {
  // Whitespace-only is unreachable through the composer's own send gate, and
  // restoring it would announce a recovery that put nothing back.
  if (submission === undefined || submission.content.trim().length === 0) return { action: 'none' }
  if (!isDraftEmpty(draft)) return { action: 'keep-draft' }
  return { action: 'restore', content: submission.content }
}
