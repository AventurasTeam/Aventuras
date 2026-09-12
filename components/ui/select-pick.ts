/** The value a dropdown pick changes to, or null for an empty pick or a re-pick of `current`. */
export function changedPick(
  current: string | undefined,
  picked: { value: string } | undefined,
): string | null {
  return picked == null || picked.value === current ? null : picked.value
}
