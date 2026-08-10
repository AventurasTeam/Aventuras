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
