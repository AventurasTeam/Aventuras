import type { PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'

import type { ReconcileDecision } from './reconcile'
import type { ClassifierExtraction } from './schema'
import type { ClassifierWindow } from './window'

/** A delta the phase will emit, with its own survival anchor. */
export type PlannedWrite = { action: PipelineAction; entryId: string }

export type PlanResult = {
  planned: readonly PlannedWrite[]
  /** Temp handle -> allocated entity id, for refs later in the same reply. */
  handleMap: Map<string, string>
  fellBackCount: number
  unresolvedRefs: readonly string[]
}

export type PlanDeps = {
  branchId: string
  window: ClassifierWindow
  entities: readonly Entity[]
  /** Reconcile decision per newCharacters handle, resolved before planning. */
  decisions: Map<string, ReconcileDecision>
  now: () => number
  // 'haw' is absent on purpose: upsertHappeningAwareness allocates the awareness
  // id itself (register-awareness.ts:95), so the planner must not.
  newId: (kind: 'hap' | 'char' | 'hinv') => string
}

const SOURCE = 'periodic_classifier' as const

export function buildClassifierActions(
  extraction: ClassifierExtraction,
  deps: PlanDeps,
): PlanResult {
  const { branchId, window, entities, decisions, now, newId } = deps
  const planned: PlannedWrite[] = []
  const handleMap = new Map<string, string>()
  const unresolvedRefs: string[] = []
  let fellBackCount = 0

  const anchor = (turn: string | undefined): string => {
    const { entryId, fellBack } = window.resolveHandle(turn)
    if (fellBack) fellBackCount++
    return entryId
  }

  const known = new Set(entities.map((e) => e.id))
  const resolveRef = (ref: string): string | null => {
    if (handleMap.has(ref)) return handleMap.get(ref)!
    if (known.has(ref)) return ref
    unresolvedRefs.push(ref)
    return null
  }

  // New characters first: later refs in the same reply resolve through handleMap,
  // and involvements/awareness rows must not precede the row they point at.
  for (const candidate of extraction.newCharacters) {
    const decision = decisions.get(candidate.handle)
    if (!decision) {
      unresolvedRefs.push(candidate.handle)
      continue
    }
    const entryId = anchor(candidate.sourceTurn)
    if (decision.kind === 'promote') {
      handleMap.set(candidate.handle, decision.entityId)
      planned.push({
        action: {
          kind: 'updateEntity',
          source: SOURCE,
          payload: { branchId, id: decision.entityId, patch: { status: 'active' } },
        },
        entryId,
      })
      continue
    }
    if (decision.kind === 'known') {
      handleMap.set(candidate.handle, decision.entityId)
      continue
    }
    const id = newId('char')
    const timestamp = now()
    handleMap.set(candidate.handle, id)
    planned.push({
      action: {
        kind: 'createEntity',
        source: SOURCE,
        payload: {
          entry: {
            id,
            branchId,
            kind: 'character',
            name: candidate.name,
            // First introduction is the classifier's one description write; it
            // never amends a description afterwards (authorship contract).
            description: candidate.description,
            status: 'active',
            injectionMode: 'auto',
            nameCollisionFlag: decision.flagged ? 1 : 0,
            // Nothing embeds on the write path: the sync stage owns the vector.
            embeddingStale: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      entryId,
    })
  }

  for (const happening of extraction.happenings) {
    const parentAnchor = anchor(happening.sourceTurn)
    const happeningId = newId('hap')
    const timestamp = now()
    const occurredAtEntryId =
      happening.occurredAtTurn != null
        ? window.resolveHandle(happening.occurredAtTurn).entryId
        : null
    planned.push({
      action: {
        kind: 'createHappening',
        source: SOURCE,
        payload: {
          entry: {
            id: happeningId,
            branchId,
            title: happening.title,
            description: happening.description ?? null,
            // Mutually exclusive per the table CHECK: an entry ref wins.
            temporal: occurredAtEntryId == null ? (happening.temporal ?? null) : null,
            occurredAtEntryId,
            embeddingStale: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      entryId: parentAnchor,
    })

    for (const involvement of happening.involvements) {
      const entityId = resolveRef(involvement.ref)
      if (entityId == null) continue
      planned.push({
        action: {
          kind: 'createHappeningInvolvement',
          source: SOURCE,
          payload: {
            entry: {
              id: newId('hinv'),
              branchId,
              happeningId,
              entityId,
              role: involvement.role ?? null,
            },
          },
        },
        // Sub-rows inherit the parent's anchor unless independently sourced.
        entryId: parentAnchor,
      })
    }

    for (const row of happening.awareness) {
      const characterId = resolveRef(row.ref)
      if (characterId == null) continue
      // A character learning of an OLD happening anchors to the turn that
      // narrated the learning, not the happening's.
      const learnedEntryId = row.learnedAtTurn != null ? anchor(row.learnedAtTurn) : parentAnchor
      planned.push({
        action: {
          kind: 'upsertHappeningAwareness',
          source: SOURCE,
          payload: {
            branchId,
            characterId,
            happeningId,
            learnedAtEntryId: learnedEntryId,
            // Clamped here, not in the schema: the wire contract must stay
            // JSON-Schema-representable, so it carries the raw number.
            decayResistance: Math.min(1, Math.max(0, row.severity)),
            source: row.source,
          },
        },
        entryId: learnedEntryId,
      })
    }
  }

  for (const relationship of extraction.relationships) {
    const subjectId = resolveRef(relationship.subject)
    const objectId = resolveRef(relationship.object)
    if (subjectId == null || objectId == null || subjectId === objectId) continue
    planned.push({
      action: {
        kind: 'upsertCharacterRelationship',
        source: SOURCE,
        // Canonical a_id < b_id ordering and the POV merge live in the action
        // (lib/actions/relationships/register.ts) — emit the raw perspective.
        payload: { branchId, subjectId, objectId, kind: relationship.kind },
      },
      entryId: anchor(relationship.sourceTurn),
    })
  }

  for (const flip of extraction.statusFlips) {
    const id = resolveRef(flip.ref)
    if (id == null) continue
    const current = entities.find((e) => e.id === id)
    // Monotonic staged->active (the other writer may have landed it already) and
    // hard-finality retirement only; retired->active is user-only in v1.
    if (flip.to === 'active' && current?.status !== 'staged') continue
    if (flip.to === 'retired' && current?.status !== 'active') continue
    planned.push({
      action: {
        kind: 'updateEntity',
        source: SOURCE,
        payload: {
          branchId,
          id,
          patch:
            flip.to === 'retired'
              ? { status: 'retired', retiredReason: flip.reason ?? null }
              : { status: 'active' },
        },
      },
      entryId: anchor(flip.sourceTurn),
    })
  }

  return { planned, handleMap, fellBackCount, unresolvedRefs }
}
