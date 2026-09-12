/** `onValueChange` minus a re-pick of `current`: native items report every press, a re-pick too. */
export function changesOnly(
  current: string | undefined,
  onValueChange: (value: string) => void,
): (value: string) => void {
  return (value) => {
    if (value !== current) onValueChange(value)
  }
}
