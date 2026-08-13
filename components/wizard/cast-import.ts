import { wizardCastDraftSchema, type WizardCastDraft } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { CAST_ID_PREFIX } from '@/lib/stores'
import type { CastSuggestion } from '@/lib/wizard'

// docs/data-model.md → Zod degradation bounds, enforced at the DB write
// boundary (lib/db/entities/entity-state-schema.ts): voice ≤ 2000 chars,
// traits/drives/agenda arrays ≤ 50 elements, every visual sub-field and
// condition/standing ≤ 500 chars. Clamping here means acceptance can never
// surface a raw per-entity Zod rejection after the user already committed.
const VOICE_MAX = 2000
const ARRAY_MAX = 50
const FIELD_MAX = 500

function clampStr(value: string, max: number): string {
  return value.slice(0, max)
}

function clampArr(value: readonly string[]): string[] {
  return value.slice(0, ARRAY_MAX)
}

function norm(name: string): string {
  return name.trim().toLowerCase()
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
  mintId: (kind: WizardCastDraft['kind']) => string = (kind) => generateId(CAST_ID_PREFIX[kind]),
): WizardCastDraft[] {
  const idByKey = new Map<string, string>()
  for (const row of existingCast) idByKey.set(`${row.kind}:${norm(row.name)}`, row.id)
  const minted = suggestions.map((suggestion) => ({ suggestion, id: mintId(suggestion.kind) }))
  // Minting runs after the existing cast is indexed, so a same-kind/same-name
  // batch row overwrites the existing row's map entry — the freshest import
  // wins for reference-resolution purposes within this call.
  for (const { suggestion, id } of minted)
    idByKey.set(`${suggestion.kind}:${norm(suggestion.name)}`, id)

  const ref = (kind: 'faction' | 'location', name: string | undefined): string | null =>
    name == null ? null : (idByKey.get(`${kind}:${norm(name)}`) ?? null)

  return minted.map(({ suggestion: s, id }) => {
    switch (s.kind) {
      case 'character':
        return wizardCastDraftSchema.parse({
          kind: 'character',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          voice: clampStr(s.voice ?? '', VOICE_MAX),
          traits: clampArr(s.traits ?? []),
          drives: clampArr(s.drives ?? []),
          visual: {
            physique: clampStr(s.visual?.physique ?? '', FIELD_MAX),
            face: clampStr(s.visual?.face ?? '', FIELD_MAX),
            hair: clampStr(s.visual?.hair ?? '', FIELD_MAX),
            eyes: clampStr(s.visual?.eyes ?? '', FIELD_MAX),
            attire: clampStr(s.visual?.attire ?? '', FIELD_MAX),
            distinguishing: clampStr(s.visual?.distinguishing ?? '', FIELD_MAX),
          },
          factionId: ref('faction', s.faction_name),
        })
      case 'location':
        return wizardCastDraftSchema.parse({
          kind: 'location',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          parentLocationId: ref('location', s.parent_location_name),
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
          agenda: clampArr(s.agenda ?? []),
          standing: clampStr(s.standing ?? '', FIELD_MAX),
        })
    }
  })
}
