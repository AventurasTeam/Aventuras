export type MultiSelectOption = {
  value: string
  label?: string
  disabled?: boolean
}

export type SelectionState =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'partial'; selectedCount: number; total: number }

export function normalizeSelection(
  selected: ReadonlySet<string> | readonly string[],
  options: readonly MultiSelectOption[],
): Set<string> {
  const optionValues = new Set(options.map((o) => o.value))
  const source = selected instanceof Set ? Array.from(selected) : selected
  const result = new Set<string>()
  for (const value of source) {
    if (optionValues.has(value)) result.add(value)
  }
  return result
}

export function computeSelectionState(
  selected: ReadonlySet<string>,
  options: readonly MultiSelectOption[],
): SelectionState {
  const total = options.length
  let selectedCount = 0
  for (const option of options) {
    if (selected.has(option.value)) selectedCount++
  }
  if (selectedCount === 0) return { kind: 'none' }
  if (selectedCount === total) return { kind: 'all' }
  return { kind: 'partial', selectedCount, total }
}

export function selectionLabel(state: SelectionState): string {
  if (state.kind === 'all') return 'all'
  if (state.kind === 'none') return 'none'
  return `${state.selectedCount} of ${state.total}`
}

export function toggleValue(selected: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(selected)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function selectAll(options: readonly MultiSelectOption[]): Set<string> {
  return new Set(options.map((o) => o.value))
}

export function clearAll(): Set<string> {
  return new Set()
}
