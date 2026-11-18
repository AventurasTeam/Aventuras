/** The running token total from `series[0]` through `entryId`, inclusive; null when it's absent. */
export function tokensThrough(
  series: readonly { id: string; tokens: number }[],
  entryId: string,
): number | null {
  let total = 0
  for (const row of series) {
    total += row.tokens
    if (row.id === entryId) return total
  }
  return null
}
