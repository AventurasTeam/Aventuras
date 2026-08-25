import { wizardCastDraftSchema, type WizardCastDraft } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { CAST_ID_PREFIX } from '@/lib/stores'
import { CAST_SOFT_CAPS, type CastSuggestion } from '@/lib/wizard'

// AI-imported strings use the entity-state degradation bounds; arrays use the
// lower wizard soft caps, with ARRAY_MAX as a hard backstop. The hand-typed
// editors share these two string caps as their input maxLength, and Finish
// re-checks every built state against entityStateSchemaForKind before insert —
// createStoryWithBranch itself still raw-inserts without validating.
export const VOICE_MAX = 2000
export const ARRAY_MAX = 50
export const FIELD_MAX = 500

function clampStr(value: string, max: number): string {
  return value.slice(0, max)
}

function clampArr(value: readonly string[], softMax: number): string[] {
  return value.slice(0, Math.min(softMax, ARRAY_MAX))
}

function norm(name: string): string {
  return name.trim().toLowerCase()
}

/** A reference the model supplied that resolved to no id, so the row imported without it. */
export type UnresolvedCastRef = {
  /** The importing row's own name — what the user sees missing an affiliation. */
  rowName: string
  field: 'faction' | 'parentLocation'
  /** The name the model asked for. */
  wantedName: string
}

/**
 * The reference a row still wants, re-checked against the live cast rather than the
 * import-time selection. `resolvableId` is set once a matching row exists —
 * "here, just not attached" vs "never imported", and that can flip mid-session.
 */
export function pendingCastRef(
  row: WizardCastDraft,
  cast: readonly WizardCastDraft[],
): { field: 'faction' | 'parentLocation'; wantedName: string; resolvableId: string | null } | null {
  // Kind and self-exclusion only, matching resolveCastImports and the editor's
  // pickers. Status is deliberately not a filter: the pickers offer a staged
  // target and finish.ts's castRef commits the pointer, so calling it missing
  // would be false. Self is the one exclusion all three agree on.
  const match = (kind: WizardCastDraft['kind'], wanted: string): string | null =>
    cast.find((r) => r.id !== row.id && r.kind === kind && norm(r.name) === norm(wanted))?.id ??
    null

  if (row.kind === 'character' && row.factionId == null) {
    const wanted = row.unresolvedFactionName.trim()
    if (wanted.length > 0)
      return { field: 'faction', wantedName: wanted, resolvableId: match('faction', wanted) }
  }
  if (row.kind === 'location' && row.parentLocationId == null) {
    const wanted = row.unresolvedParentLocationName.trim()
    if (wanted.length > 0)
      return {
        field: 'parentLocation',
        wantedName: wanted,
        resolvableId: match('location', wanted),
      }
  }
  return null
}

export type CastImportResult = {
  rows: WizardCastDraft[]
  /**
   * Reported so the caller can tell the user a reference was discarded. The
   * scope rule below makes this reachable through ordinary use — importing
   * three characters but not the faction they all name drops three references —
   * and the editors render that as "No factions yet", which reads as "you have
   * none" rather than "yours were thrown away".
   */
  unresolved: UnresolvedCastRef[]
}

/**
 * wizard.md → AI-suggest: cross-batch references resolve by name against
 * same-kind rows in the IMPORTED SELECTION plus the existing cast — never the
 * whole suggested page, so a suggested-but-unchecked parent or faction cannot
 * become a dangling id. Unresolved → null.
 */
export function resolveCastImports(
  suggestions: readonly CastSuggestion[],
  existingCast: readonly WizardCastDraft[],
  /** Test seam — production mints real prefixed ids. */
  mintId: (kind: WizardCastDraft['kind']) => string = (kind) => generateId(CAST_ID_PREFIX[kind]),
): CastImportResult {
  const idByKey = new Map<string, string>()
  // A blank name (an "Add faction" row nobody has typed into yet) must never
  // be indexed — otherwise a blank/whitespace-only reference on another row
  // would silently bind to it instead of resolving to null.
  for (const row of existingCast) {
    const key = norm(row.name)
    if (key.length > 0) idByKey.set(`${row.kind}:${key}`, row.id)
  }
  const minted = suggestions.map((suggestion) => ({ suggestion, id: mintId(suggestion.kind) }))
  // Batch rows overwrite existing-cast entries: the freshest import wins.
  for (const { suggestion, id } of minted) {
    const key = norm(suggestion.name)
    if (key.length > 0) idByKey.set(`${suggestion.kind}:${key}`, id)
  }

  // Excludes selfId: idByKey is indexed before refs resolve (above), so a
  // suggested location naming itself as parent_location_name would otherwise
  // bind to its own freshly-minted id (finish.ts's castRef self-exclusion
  // guards this at commit time; resolving it here means the store never
  // carries the dangling self-pointer in the first place).
  const unresolved: UnresolvedCastRef[] = []
  // Names that resolved to nothing, keyed by importing row id, so the row carries
  // the ask forward for the list to re-check against a cast still being edited.
  const wantedByRow = new Map<string, string>()
  const ref = (
    kind: 'faction' | 'location',
    name: string | undefined,
    selfId: string,
    rowName: string,
  ): string | null => {
    const key = name == null ? '' : norm(name)
    // A blank reference is the model declining to name one, not a miss.
    if (key.length === 0) return null
    const found = idByKey.get(`${kind}:${key}`) ?? null
    const resolved = found === selfId ? null : found
    // A self-reference counts: the row still imports without the pointer it
    // asked for, which is the thing worth telling the user about.
    if (resolved === null) {
      unresolved.push({
        rowName,
        field: kind === 'faction' ? 'faction' : 'parentLocation',
        wantedName: name ?? '',
      })
      if (name != null) wantedByRow.set(selfId, name.trim())
    }
    return resolved
  }

  const rows = minted.map(({ suggestion: s, id }) => {
    switch (s.kind) {
      case 'character':
        return wizardCastDraftSchema.parse({
          kind: 'character',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          voice: clampStr(s.speech ?? '', VOICE_MAX),
          traits: clampArr(s.traits ?? [], CAST_SOFT_CAPS.traits),
          drives: clampArr(s.drives ?? [], CAST_SOFT_CAPS.drives),
          visual: {
            physique: clampStr(s.visual?.physique ?? '', FIELD_MAX),
            face: clampStr(s.visual?.face ?? '', FIELD_MAX),
            hair: clampStr(s.visual?.hair ?? '', FIELD_MAX),
            eyes: clampStr(s.visual?.eyes ?? '', FIELD_MAX),
            attire: clampStr(s.visual?.attire ?? '', FIELD_MAX),
            distinguishing: clampStr(s.visual?.distinguishing ?? '', FIELD_MAX),
          },
          factionId: ref('faction', s.faction_name, id, s.name),
          unresolvedFactionName: wantedByRow.get(id) ?? '',
        })
      case 'location':
        return wizardCastDraftSchema.parse({
          kind: 'location',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          parentLocationId: ref('location', s.parent_location_name, id, s.name),
          unresolvedParentLocationName: wantedByRow.get(id) ?? '',
          condition: clampStr(s.condition ?? '', FIELD_MAX),
        })
      case 'item':
        return wizardCastDraftSchema.parse({
          kind: 'item',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          condition: clampStr(s.condition ?? '', FIELD_MAX),
        })
      case 'faction':
        return wizardCastDraftSchema.parse({
          kind: 'faction',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          agenda: clampArr(s.agenda ?? [], CAST_SOFT_CAPS.agenda),
          standing: clampStr(s.standing ?? '', FIELD_MAX),
        })
    }
  })

  return { rows, unresolved }
}
