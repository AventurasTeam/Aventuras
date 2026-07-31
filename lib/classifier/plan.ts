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
  // 'haw' is absent on purpose: the upsertHappeningAwareness handler in
  // lib/actions/happenings/register-awareness.ts allocates the awareness id
  // itself, so the planner must not.
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

  // Mutable, not a frozen snapshot: rows this pass plans are visible to later
  // facts in the same reply, so the flip guards read post-plan status and a ref
  // to a just-created character resolves.
  const index = new Map<string, { kind: Entity['kind']; status: Entity['status'] }>(
    entities.map((e) => [e.id, { kind: e.kind, status: e.status }]),
  )

  const resolveRef = (ref: string, expectedKind?: Entity['kind']): string | null => {
    const id = handleMap.get(ref) ?? (index.has(ref) ? ref : null)
    // A kind mismatch is unresolvable, not merely wrong: the awareness and
    // relationship tables are FK-less and their handlers don't re-check kind, so
    // a location landing in character_id would never be caught downstream.
    if (id == null || (expectedKind != null && index.get(id)?.kind !== expectedKind)) {
      unresolvedRefs.push(ref)
      return null
    }
    return id
  }

  // New characters first: later refs in the same reply resolve through handleMap,
  // and involvements/awareness rows must not precede the row they point at.
  for (const candidate of extraction.newCharacters) {
    const decision = decisions.get(candidate.handle)
    if (!decision) {
      unresolvedRefs.push(candidate.handle)
      continue
    }
    // A handle reused for a second character would silently rebind every earlier
    // ref to the later row. Keep the first binding and report the collision.
    if (handleMap.has(candidate.handle)) {
      unresolvedRefs.push(candidate.handle)
      continue
    }
    const entryId = anchor(candidate.sourceTurn)
    if (decision.kind === 'promote') {
      handleMap.set(candidate.handle, decision.entityId)
      const promoted = index.get(decision.entityId)
      if (promoted != null) index.set(decision.entityId, { ...promoted, status: 'active' })
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
    index.set(id, { kind: 'character', status: 'active' })
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
    // Deliberately not through anchor(): occurred_at_entry_id is a story-time
    // claim retrieval and the Plot screen read as fact, not a survival anchor, so
    // a head-fallback would assert the happening occurred at the newest window
    // turn. A bogus handle degrades to the temporal string instead.
    let occurredAtEntryId: string | null = null
    if (happening.occurredAtTurn != null) {
      const resolved = window.resolveHandle(happening.occurredAtTurn)
      if (resolved.fellBack) unresolvedRefs.push(happening.occurredAtTurn)
      else occurredAtEntryId = resolved.entryId
    }
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
      // Unrestricted by kind: happening_involvements is polymorphic — a location,
      // item or faction is valid subject matter.
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
      const characterId = resolveRef(row.ref, 'character')
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
    const subjectId = resolveRef(relationship.subject, 'character')
    const objectId = resolveRef(relationship.object, 'character')
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
    const current = index.get(id)
    if (current == null) continue
    // Monotonic staged->active (the other writer may have landed it already) and
    // hard-finality retirement only; retired->active is user-only in v1.
    if (flip.to === 'active' && current.status !== 'staged') continue
    if (flip.to === 'retired' && current.status !== 'active') continue
    index.set(id, { kind: current.kind, status: flip.to })
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
