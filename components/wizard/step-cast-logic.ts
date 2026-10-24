import type { WizardCastDraft, WizardCharacterDraft, WizardLocationDraft } from '@/lib/db'
import { checkParentChain, type PlacePlacement } from '@/lib/world'

/**
 * Single-member today, and callers lean on that: both the compact row and the
 * editor render the name error from the row-level `invalid` flag alone. Adding
 * a second field means teaching them to attribute the error per-field.
 */
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

/**
 * Locations `row` may take as parent — none whose chain leads back to it (Finish refuses loops);
 * the current parent stays, so a stored loop still shows what it points at.
 */
export function parentCandidates(
  row: WizardLocationDraft,
  cast: readonly WizardCastDraft[],
): WizardLocationDraft[] {
  const locations = cast.filter((r): r is WizardLocationDraft => r.kind === 'location')
  const parents = new Map(locations.map((r) => [r.id, r.parentLocationId]))
  const parentOf = (id: string) => parents.get(id) ?? null
  return locations.filter(
    (r) =>
      r.id !== row.id &&
      (r.id === row.parentLocationId || checkParentChain(row.id, r.id, parentOf) === 'ok'),
  )
}

/**
 * Where `row` lands at Finish, and so what its parent picker selects (wizard.md → Location editor):
 * under the cast location it names, top-level if no parent was picked or asked for, else unplaced.
 */
export function castPlacement(
  row: WizardLocationDraft,
  cast: readonly WizardCastDraft[],
): PlacePlacement {
  const parentId = row.parentLocationId
  if (
    parentId != null &&
    parentId !== row.id &&
    cast.some((r) => r.id === parentId && r.kind === 'location')
  )
    return { kind: 'under', parentId }
  const unknown =
    parentId != null || row.parentUnknown || row.unresolvedParentLocationName.trim() !== ''
  return unknown ? { kind: 'unplaced' } : { kind: 'top' }
}
