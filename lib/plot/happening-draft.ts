import { z } from 'zod'

import type { PipelineAction } from '@/lib/actions'
import type {
  Happening,
  HappeningAwareness,
  HappeningInvolvement,
  NewHappening,
  NewHappeningInvolvement,
} from '@/lib/db'

import { blankToNull } from './thread-draft'

export const involvementDraftSchema = z.object({
  /** Null for a row added this session. */
  id: z.string().nullable(),
  entityId: z.string().min(1, 'entityRequired'),
  role: z.string(),
})

export const awarenessDraftSchema = z.object({
  id: z.string().nullable(),
  characterId: z.string().min(1, 'characterRequired'),
  learnedAtEntryId: z.string().nullable(),
  decayResistance: z.number().min(0, 'decayRange').max(1, 'decayRange').nullable(),
  source: z.string(),
})

// Issue messages are `plot:validation.*` keys; the pane translates them.
export const happeningDraftSchema = z
  .object({
    title: z.string().trim().min(1, 'titleRequired'),
    description: z.string(),
    category: z.string(),
    icon: z.string().nullable(),
    commonKnowledge: z.boolean(),
    occurredAtEntryId: z.string().nullable(),
    temporal: z.string(),
    involvements: z.array(involvementDraftSchema),
    awareness: z.array(awarenessDraftSchema),
  })
  .superRefine((draft, ctx) => {
    // data-model.md → the two time fields are mutually exclusive; the CHECK is the floor.
    if (draft.occurredAtEntryId != null && draft.temporal.trim() !== '') {
      ctx.addIssue({ code: 'custom', path: ['temporal'], message: 'timeAnchorExclusive' })
    }
    const seenEntities = new Set<string>()
    draft.involvements.forEach((row, index) => {
      if (seenEntities.has(row.entityId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['involvements', index, 'entityId'],
          message: 'duplicateEntity',
        })
      }
      seenEntities.add(row.entityId)
    })
    // `haw_natural_uniq`: one row per character per happening.
    const seenCharacters = new Set<string>()
    draft.awareness.forEach((row, index) => {
      if (seenCharacters.has(row.characterId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['awareness', index, 'characterId'],
          message: 'duplicateCharacter',
        })
      }
      seenCharacters.add(row.characterId)
    })
  })

export type HappeningDraft = z.infer<typeof happeningDraftSchema>
export type InvolvementDraft = z.infer<typeof involvementDraftSchema>
export type AwarenessDraft = z.infer<typeof awarenessDraftSchema>

export type HappeningLinks = {
  involvements: readonly HappeningInvolvement[]
  awareness: readonly HappeningAwareness[]
}

export const EMPTY_HAPPENING_DRAFT: HappeningDraft = {
  title: '',
  description: '',
  category: '',
  icon: null,
  commonKnowledge: false,
  occurredAtEntryId: null,
  temporal: '',
  involvements: [],
  awareness: [],
}

export function happeningDraftFrom(row: Happening | null, links: HappeningLinks): HappeningDraft {
  if (row == null) return EMPTY_HAPPENING_DRAFT
  return {
    title: row.title,
    description: row.description ?? '',
    category: row.category ?? '',
    icon: row.icon,
    commonKnowledge: row.commonKnowledge === 1,
    occurredAtEntryId: row.occurredAtEntryId,
    temporal: row.temporal ?? '',
    involvements: links.involvements.map((l) => ({
      id: l.id,
      entityId: l.entityId,
      role: l.role ?? '',
    })),
    awareness: links.awareness.map((l) => ({
      id: l.id,
      characterId: l.characterId,
      learnedAtEntryId: l.learnedAtEntryId,
      decayResistance: l.decayResistance,
      source: l.source ?? '',
    })),
  }
}

type HappeningPatch = Partial<{
  title: string
  description: string | null
  category: string | null
  icon: string | null
  temporal: string | null
  occurredAtEntryId: string | null
  commonKnowledge: 0 | 1
}>

/**
 * Compares normalized-to-normalized — a committed row can carry untrimmed text or a `''`
 * field (classifier writes verbatim) that would otherwise misdiff against a loaded draft.
 */
export function happeningPatch(row: Happening, draft: HappeningDraft): HappeningPatch {
  const patch: HappeningPatch = {}
  const title = draft.title.trim()
  if (title !== row.title.trim()) patch.title = title
  const description = blankToNull(draft.description)
  if (description !== blankToNull(row.description ?? '')) patch.description = description
  const category = blankToNull(draft.category)
  if (category !== blankToNull(row.category ?? '')) patch.category = category
  if (draft.icon !== row.icon) patch.icon = draft.icon
  const temporal = blankToNull(draft.temporal)
  // A blank-but-non-null committed temporal (classifier writes verbatim) still trips
  // the handler's mutual-exclusion check once an entry ref is set, unless cleared here.
  const clearsBlankTemporal =
    temporal == null && row.temporal != null && draft.occurredAtEntryId != null
  if (temporal !== blankToNull(row.temporal ?? '') || clearsBlankTemporal) patch.temporal = temporal
  if (draft.occurredAtEntryId !== row.occurredAtEntryId)
    patch.occurredAtEntryId = draft.occurredAtEntryId
  const commonKnowledge: 0 | 1 = draft.commonKnowledge ? 1 : 0
  if (commonKnowledge !== row.commonKnowledge) patch.commonKnowledge = commonKnowledge
  return patch
}

type AwarenessUpsert = {
  branchId: string
  characterId: string
  happeningId: string
  learnedAtEntryId?: string | null
  decayResistance?: number | null
  source?: string | null
}

// Only changed fields ride the payload; null baseline means a full create.
function awarenessUpsert(
  branchId: string,
  happeningId: string,
  draft: AwarenessDraft,
  baseline: HappeningAwareness | null,
): AwarenessUpsert | null {
  const source = blankToNull(draft.source)
  if (baseline == null) {
    return {
      branchId,
      characterId: draft.characterId,
      happeningId,
      learnedAtEntryId: draft.learnedAtEntryId,
      decayResistance: draft.decayResistance,
      source,
    }
  }
  const payload: AwarenessUpsert = { branchId, characterId: draft.characterId, happeningId }
  let changed = false
  if (draft.learnedAtEntryId !== baseline.learnedAtEntryId) {
    payload.learnedAtEntryId = draft.learnedAtEntryId
    changed = true
  }
  if (draft.decayResistance !== baseline.decayResistance) {
    payload.decayResistance = draft.decayResistance
    changed = true
  }
  if (source !== blankToNull(baseline.source ?? '')) {
    payload.source = source
    changed = true
  }
  return changed ? payload : null
}

/**
 * Prefers the committed row matching both id and entity, else the first unmatched row for
 * that entity — a re-added row carries `id: null`, an entity change leaves a stale id.
 * Avoids double-writing one row on a swap or arbitrarily deleting a duplicate-pair twin.
 */
function matchInvolvement(
  committed: readonly HappeningInvolvement[],
  matched: ReadonlySet<string>,
  draftRow: InvolvementDraft,
): HappeningInvolvement | null {
  const byId = committed.find(
    (l) => l.id === draftRow.id && l.entityId === draftRow.entityId && !matched.has(l.id),
  )
  if (byId != null) return byId
  return committed.find((l) => l.entityId === draftRow.entityId && !matched.has(l.id)) ?? null
}

type HappeningActionArgs = {
  branchId: string
  /** Null in create mode. */
  row: Happening | null
  /** The committed link rows the draft started from. */
  links: HappeningLinks
  draft: HappeningDraft
  /** The row id — pre-generated in create mode so link actions can reference it. */
  id: string
  now: number
  newId: (prefix: string) => string
}

/** Row create/update plus link creates, updates and deletes for ONE `applyDeltaActionGroup`. */
export function happeningActions({
  branchId,
  row,
  links,
  draft,
  id,
  now,
  newId,
}: HappeningActionArgs): PipelineAction[] {
  const actions: PipelineAction[] = []
  if (row == null) {
    const entry: NewHappening = {
      id,
      branchId,
      title: draft.title.trim(),
      description: blankToNull(draft.description),
      category: blankToNull(draft.category),
      icon: draft.icon,
      temporal: blankToNull(draft.temporal),
      occurredAtEntryId: draft.occurredAtEntryId,
      commonKnowledge: draft.commonKnowledge ? 1 : 0,
      embeddingStale: 1,
      createdAt: now,
      updatedAt: now,
    }
    actions.push({ kind: 'createHappening', source: 'user_edit', payload: { entry } })
  } else {
    const patch = happeningPatch(row, draft)
    if (Object.keys(patch).length > 0) {
      actions.push({
        kind: 'updateHappening',
        source: 'user_edit',
        payload: { branchId, id: row.id, patch },
      })
    }
  }

  // A new happening has no committed links yet; a caller-supplied `links` for a
  // different happening must never leak into this diff as rows to delete.
  const baseline: HappeningLinks = row == null ? { involvements: [], awareness: [] } : links

  const matchedInvolvementIds = new Set<string>()
  for (const d of draft.involvements) {
    const role = blankToNull(d.role)
    const original = matchInvolvement(baseline.involvements, matchedInvolvementIds, d)
    if (original == null) {
      const entry: NewHappeningInvolvement = {
        id: newId('hinv'),
        branchId,
        happeningId: id,
        entityId: d.entityId,
        role,
      }
      actions.push({ kind: 'createHappeningInvolvement', source: 'user_edit', payload: { entry } })
      continue
    }
    matchedInvolvementIds.add(original.id)
    if (blankToNull(original.role ?? '') !== role) {
      actions.push({
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId, id: original.id, patch: { role } },
      })
    }
  }
  for (const l of baseline.involvements) {
    if (!matchedInvolvementIds.has(l.id)) {
      actions.push({
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId, id: l.id },
      })
    }
  }

  // Diffs by character (`haw_natural_uniq`), not draft row id: an id-keyed diff could pair
  // a delete with an upsert resolving to the same pre-group row, silently dropping it.
  const awarenessByCharacter = new Map(baseline.awareness.map((l) => [l.characterId, l]))
  for (const d of draft.awareness) {
    const payload = awarenessUpsert(
      branchId,
      id,
      d,
      awarenessByCharacter.get(d.characterId) ?? null,
    )
    if (payload != null)
      actions.push({ kind: 'upsertHappeningAwareness', source: 'user_edit', payload })
  }
  const draftCharacters = new Set(draft.awareness.map((d) => d.characterId))
  for (const l of baseline.awareness) {
    if (!draftCharacters.has(l.characterId)) {
      actions.push({
        kind: 'deleteHappeningAwareness',
        source: 'user_edit',
        payload: { branchId, id: l.id },
      })
    }
  }
  return actions
}
