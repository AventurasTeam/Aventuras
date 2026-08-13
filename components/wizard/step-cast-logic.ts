import type { WizardCastDraft, WizardCastDraftByKind } from '@/lib/db'

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
 * the store's own staging cascade (`setCastStatus`), and the three UI
 * consumers all want the resolved row, not just a boolean.
 */
export function activeLead(
  cast: readonly WizardCastDraft[],
  leadEntityId: string | null,
): WizardCastDraftByKind<'character'> | null {
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
 * wizard.md → Compact rows: visible on character rows when no other
 * character is the lead AND status='active'. "No other character is the
 * lead" collapses to "no active lead at all" — if `row` itself already held
 * it, `activeLead` would resolve to `row`, but the caller only needs the
 * button hidden then too (there's nothing left to promote), so a single
 * null-check covers both "someone else is lead" and "I already am."
 */
export function canSetLead(
  row: WizardCastDraft,
  cast: readonly WizardCastDraft[],
  leadEntityId: string | null,
): boolean {
  if (row.kind !== 'character' || row.status !== 'active') return false
  return activeLead(cast, leadEntityId) == null
}
