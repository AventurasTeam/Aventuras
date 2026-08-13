import type { WizardCastDraft, WizardCharacterDraft } from '@/lib/db'

export type CastRowField = 'name'

export function castRowErrors(row: WizardCastDraft): CastRowField[] {
  return row.name.trim().length === 0 ? ['name'] : []
}

export function invalidCastRowIds(cast: readonly WizardCastDraft[]): string[] {
  return cast.filter((row) => castRowErrors(row).length > 0).map((row) => row.id)
}

/**
 * The lead is only real while it points at an ACTIVE character row (canon:
 * staged can't lead). Re-derives from `cast` rather than trusting
 * `leadEntityId` directly — a hydrated draft can carry a stale pointer past
 * the store's own staging cascade (`setCastStatus`). This is the only
 * sanctioned reader of `leadEntityId`; a consumer that compares the pointer
 * directly instead defeats the re-derivation.
 */
export function activeLead(
  cast: readonly WizardCastDraft[],
  leadEntityId: string | null,
): WizardCharacterDraft | null {
  if (leadEntityId == null) return null
  const row = cast.find((r) => r.id === leadEntityId)
  return row != null && row.kind === 'character' && row.status === 'active' ? row : null
}

export function castStepValid(
  leadRequired: boolean,
  cast: readonly WizardCastDraft[],
  leadEntityId: string | null,
): boolean {
  if (invalidCastRowIds(cast).length > 0) return false
  return !leadRequired || activeLead(cast, leadEntityId) != null
}

/** wizard.md → Compact row presentation: any active character can claim the lead with one click, including reassigning it away from the current lead. */
export function canSetLead(
  row: WizardCastDraft,
  cast: readonly WizardCastDraft[],
  leadEntityId: string | null,
): boolean {
  return row.kind === 'character' && row.status === 'active' && row.id !== leadEntityId
}
