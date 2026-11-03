/** The reader route, landing on `entryId` when given; producers build it here, not by hand. */
export function readerHref(branchId: string, entryId?: string): string {
  const path = `/reader-composer/${branchId}`
  if (entryId == null) return path
  const query = new URLSearchParams({ entry: entryId })
  return `${path}?${query.toString()}`
}
