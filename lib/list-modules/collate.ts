// Intl.Collator amortizes setup once; this sort reruns on every keystroke/store patch.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
export const collate = (a: string, b: string): number => collator.compare(a, b)

export function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
