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
 * The turn's text a system entry keeps, verbatim; undefined when absent or blank. The card's
 * quote and the hand-back both decide through it, so the quote's custody line stays true.
 */
export function keptSubmissionText(
  submission: { content: string } | undefined,
): string | undefined {
  return submission === undefined || submission.content.trim().length === 0
    ? undefined
    : submission.content
}

/**
 * What a path that destroys a failure entry owes the composer. The entry's
 * `submission` is the only copy of a failed turn's text — the `user_action` went with
 * its reverse-replayed action group — so dropping the notice without handing it back
 * deletes the user's words. A non-empty draft wins: an older turn must not overwrite it.
 */
export type SubmissionHandback =
  | { action: 'none' }
  | { action: 'restore'; content: string }
  | { action: 'keep-draft' }
  /** The reader closed under the caller's awaits: nothing can take the text, nor claim it did. */
  | { action: 'no-composer' }

export function planSubmissionHandback(
  submission: { content: string } | undefined,
  /** The mounted composer's draft; undefined once the reader has unmounted. */
  draft: { text: string } | undefined,
): SubmissionHandback {
  const content = keptSubmissionText(submission)
  if (content === undefined) return { action: 'none' }
  if (draft === undefined) return { action: 'no-composer' }
  if (!isDraftEmpty(draft)) return { action: 'keep-draft' }
  return { action: 'restore', content }
}
