export function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v !== '')
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}
