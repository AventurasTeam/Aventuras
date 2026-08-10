import type { WizardLoreDraft } from '@/lib/db'

function blank(value: string): boolean {
  return value.trim().length === 0
}

export type LoreRowErrorField = 'title' | 'body'

/**
 * wizard.md → Step 3 validation: a lore row that exists must carry a title and
 * a body. Genre and setting are encouraged, never gated. Single source of
 * truth for row validity — both the compact-row list and the inline editor
 * derive their error display from this, not a local recompute of `blank()`.
 */
export function loreRowErrors(row: WizardLoreDraft): LoreRowErrorField[] {
  const errors: LoreRowErrorField[] = []
  if (blank(row.title)) errors.push('title')
  if (blank(row.body)) errors.push('body')
  return errors
}

export function invalidLoreRowIds(rows: readonly WizardLoreDraft[]): string[] {
  return rows.filter((r) => loreRowErrors(r).length > 0).map((r) => r.id)
}

export function worldStepValid(rows: readonly WizardLoreDraft[]): boolean {
  return invalidLoreRowIds(rows).length === 0
}

/** wizard.md → Replace-on-existing: confirm before clobbering authored content. */
export function needsReplaceConfirm(field: { label: string; promptBody: string }): boolean {
  return !blank(field.label) || !blank(field.promptBody)
}

export const PRIORITY_MIN = 0
export const PRIORITY_MAX = 100

/**
 * Parses a priority field's raw text into the value to store, or `null` while
 * the field is mid-edit and has no digits yet (an emptied field must not write
 * `0` or `NaN` — the row keeps its last committed value until digits return).
 * Non-digits are dropped rather than rejected: priority is a whole number in
 * `[PRIORITY_MIN, PRIORITY_MAX]`, so a pasted `"-5"` or `"7.5"` resolves to the
 * nearest thing the field can hold instead of blocking the keystroke.
 */
export function parsePriorityInput(text: string): number | null {
  const digits = text.replace(/\D/g, '')
  if (digits === '') return null
  // Digits-only and non-empty, so Number() is finite and never negative — the
  // PRIORITY_MIN floor is already structurally satisfied and a Math.max here
  // would be a branch no input can exercise. Only the ceiling needs clamping.
  return Math.min(PRIORITY_MAX, Number(digits))
}
