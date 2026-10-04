/** Column free text is stored as `NULL` when blank, never `''`. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
