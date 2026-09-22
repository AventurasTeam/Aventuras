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
  decayResistance: z.number().min(0).max(1).nullable(),
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

export function happeningPatch(row: Happening, draft: HappeningDraft): HappeningPatch {
  const patch: HappeningPatch = {}
  const title = draft.title.trim()
  if (title !== row.title) patch.title = title
  const description = blankToNull(draft.description)
  if (description !== row.description) patch.description = description
  const category = blankToNull(draft.category)
  if (category !== row.category) patch.category = category
  if (draft.icon !== row.icon) patch.icon = draft.icon
  const temporal = blankToNull(draft.temporal)
  if (temporal !== row.temporal) patch.temporal = temporal
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
  if (source !== baseline.source) {
    payload.source = source
    changed = true
  }
  return changed ? payload : null
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
        payload: { branchId, id, patch },
      })
    }
  }

  // Links match on their natural key — the entity (involvements) or the character
  // (awareness, `haw_natural_uniq`) — never on the draft row's id, so a remove-then-re-add
  // or a swap between two rows becomes updates: the runner rejects two writes to one row.
  // The draft refine guarantees one draft row per key.
  const involvementsByEntity = new Map(links.involvements.map((l) => [l.entityId, l]))
  for (const d of draft.involvements) {
    const role = blankToNull(d.role)
    const original = involvementsByEntity.get(d.entityId)
    if (original == null) {
      const entry: NewHappeningInvolvement = {
        id: newId('hinv'),
        branchId,
        happeningId: id,
        entityId: d.entityId,
        role,
      }
      actions.push({ kind: 'createHappeningInvolvement', source: 'user_edit', payload: { entry } })
    } else if (original.role !== role) {
      actions.push({
        kind: 'updateHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId, id: original.id, patch: { role } },
      })
    }
  }
  const draftEntities = new Set(draft.involvements.map((d) => d.entityId))
  for (const l of links.involvements) {
    // A second committed row for one entity (no unique index) is dropped with its twin kept.
    if (!draftEntities.has(l.entityId) || involvementsByEntity.get(l.entityId) !== l) {
      actions.push({
        kind: 'deleteHappeningInvolvement',
        source: 'user_edit',
        payload: { branchId, id: l.id },
      })
    }
  }

  const awarenessByCharacter = new Map(links.awareness.map((l) => [l.characterId, l]))
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
  for (const l of links.awareness) {
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
