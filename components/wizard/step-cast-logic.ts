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
 * the store's own staging cascade (`setCastStatus`). Route every "is there a
 * lead / which row holds it" question through here; comparing `leadEntityId`
 * raw for that answers a resolution question without resolving it. Comparing
 * it raw for row IDENTITY — is this row the pointer's target — is fine.
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

/**
 * wizard.md → Compact row presentation: any active character can claim the
 * lead in one click, reassigning it away from the current lead.
 */
export function canSetLead(row: WizardCastDraft, leadEntityId: string | null): boolean {
  return row.kind === 'character' && row.status === 'active' && row.id !== leadEntityId
}
