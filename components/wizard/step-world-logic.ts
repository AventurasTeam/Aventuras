import type { WizardLoreDraft } from '@/lib/db'

function blank(value: string): boolean {
  return value.trim().length === 0
}

/**
 * wizard.md → Step 3 validation: a lore row that exists must carry a title and
 * a body. Genre and setting are encouraged, never gated.
 */
export function invalidLoreRowIds(rows: readonly WizardLoreDraft[]): string[] {
  return rows.filter((r) => blank(r.title) || blank(r.body)).map((r) => r.id)
}

export function worldStepValid(rows: readonly WizardLoreDraft[]): boolean {
  return invalidLoreRowIds(rows).length === 0
}

/** wizard.md → Replace-on-existing: confirm before clobbering authored content. */
export function needsReplaceConfirm(field: { label: string; promptBody: string }): boolean {
  return !blank(field.label) || !blank(field.promptBody)
}
