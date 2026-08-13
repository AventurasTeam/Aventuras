import { wizardCastDraftSchema, type WizardCastDraft } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { CAST_ID_PREFIX } from '@/lib/stores'
import type { CastSuggestion } from '@/lib/wizard'

// docs/data-model.md → Zod degradation bounds: voice ≤ 2000 chars,
// traits/drives/agenda arrays ≤ 50 elements, every visual sub-field and
// condition/standing ≤ 500 chars. Nothing downstream re-checks them: wizard rows
// land in entities.state via a raw insert (lib/actions/stories/create-story.ts)
// that never runs entityStateSchemaForKind, and Finish routes through neither of
// register.ts's validating handlers. This clamps the AI-import path only — the
// hand-typed editors and migrateLegacyLead enforce no string bounds at all.
export const VOICE_MAX = 2000
export const ARRAY_MAX = 50
export const FIELD_MAX = 500

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
  /** Test seam — production mints real prefixed ids. */
  mintId: (kind: WizardCastDraft['kind']) => string = (kind) => generateId(CAST_ID_PREFIX[kind]),
): WizardCastDraft[] {
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
  const ref = (
    kind: 'faction' | 'location',
    name: string | undefined,
    selfId: string,
  ): string | null => {
    const key = name == null ? '' : norm(name)
    if (key.length === 0) return null
    const found = idByKey.get(`${kind}:${key}`) ?? null
    return found === selfId ? null : found
  }

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
          factionId: ref('faction', s.faction_name, id),
        })
      case 'location':
        return wizardCastDraftSchema.parse({
          kind: 'location',
          id,
          name: s.name,
          description: s.description,
          status: s.status,
          parentLocationId: ref('location', s.parent_location_name, id),
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
