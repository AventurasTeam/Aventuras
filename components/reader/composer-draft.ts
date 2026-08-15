/**
 * Whether a composer draft holds nothing worth protecting from an overwrite.
 *
 * Whitespace-only counts as empty, matching the composer's own `canSend` and
 * lint gates — a lone space must not be treated as text the user would miss.
 */
export function isDraftEmpty(draft: { text: string } | undefined): boolean {
  return (draft?.text ?? '').trim().length === 0
}
