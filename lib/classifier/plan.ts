import type { PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'
import { dedupeTerms, newTerms } from '@/lib/keyword-terms'

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

// An embedded pair composites as `${first} ${second}` and must clear the tightest catalog
// window: MiniLM-L6's 512 tokens (the mobile default), ~4 chars/token, so ~330 per pair.
const MAX_EMBEDDED_NAME = 120
const MAX_EMBEDDED_BODY = 1200

// Model free text can come back blank instead of omitted; a blank never reaches a row.
function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

// Past the embedder's window the tail is absent from the vector while `sourceHash` still
// covers the whole string, so nothing re-embeds or reports it. Not a schema `.max()` —
// a violation is a parse failure and the retry re-reads the same prose (cf. schema.ts).
function clampEmbedded(text: string, limit: number): string {
  if (text.length <= limit) return text
  // A lone surrogate half would be stored, hashed into sourceHash and rendered
  // as a replacement character.
  const lead = text.charCodeAt(limit - 1)
  const cut = lead >= 0xd800 && lead <= 0xdbff ? limit - 1 : limit
  return text.slice(0, cut).trimEnd()
}

/**
 * A candidate character as its row will store it.
 *
 * Layer B decides against the stored row (reconcile.ts), so an unclamped candidate is
 * measured against text that will never exist: an unbounded name stops matching the row
 * it created, an unbounded description can carry a genuine match out of TAU_HIGH. Both
 * bounds live here so write path and reconcile key cannot be given one without the other.
 */
export function clampEmbeddedCharacter(candidate: { name: string; description: string }): {
  name: string
  description: string
} {
  return {
    name: clampEmbedded(candidate.name, MAX_EMBEDDED_NAME),
    description: clampEmbedded(candidate.description, MAX_EMBEDDED_BODY),
  }
}

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
  const index = new Map<
    string,
    { kind: Entity['kind']; status: Entity['status']; keywords: string[] }
  >(entities.map((e) => [e.id, { kind: e.kind, status: e.status, keywords: e.keywords }]))

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
      const added = newTerms(promoted?.keywords ?? [], candidate.keywords)
      if (promoted != null)
        index.set(decision.entityId, {
          ...promoted,
          status: 'active',
          keywords: [...promoted.keywords, ...added],
        })
      planned.push({
        action: {
          kind: 'promoteStagedEntity',
          source: SOURCE,
          payload: { branchId, id: decision.entityId },
        },
        entryId,
      })
      if (added.length > 0)
        planned.push({
          action: {
            kind: 'appendEntityKeywords',
            source: SOURCE,
            payload: { branchId, id: decision.entityId, keywords: added },
          },
          entryId,
        })
      continue
    }
    // A known character writes only when the prose named it by something new: keywords aren't
    // frozen after introduction, but a recurring name must not cost a delta row per pass.
    if (decision.kind === 'known') {
      handleMap.set(candidate.handle, decision.entityId)
      const known = index.get(decision.entityId)
      const added = newTerms(known?.keywords ?? [], candidate.keywords)
      if (added.length > 0) {
        if (known != null)
          index.set(decision.entityId, { ...known, keywords: [...known.keywords, ...added] })
        planned.push({
          action: {
            kind: 'appendEntityKeywords',
            source: SOURCE,
            payload: { branchId, id: decision.entityId, keywords: added },
          },
          entryId,
        })
      }
      continue
    }
    const id = newId('char')
    const timestamp = now()
    const keywords = dedupeTerms(candidate.keywords)
    const stored = clampEmbeddedCharacter(candidate)
    handleMap.set(candidate.handle, id)
    index.set(id, { kind: 'character', status: 'active', keywords })
    planned.push({
      action: {
        kind: 'createEntity',
        source: SOURCE,
        payload: {
          entry: {
            id,
            branchId,
            kind: 'character',
            name: stored.name,
            // First introduction is the classifier's one description write; it
            // never amends a description afterwards (authorship contract).
            description: stored.description,
            keywords,
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
    const description = nonBlank(happening.description)
    planned.push({
      action: {
        kind: 'createHappening',
        source: SOURCE,
        payload: {
          entry: {
            id: happeningId,
            branchId,
            title: clampEmbedded(happening.title, MAX_EMBEDDED_NAME),
            description: description == null ? null : clampEmbedded(description, MAX_EMBEDDED_BODY),
            // Mutually exclusive per the table CHECK: an entry ref wins.
            temporal: occurredAtEntryId == null ? (nonBlank(happening.temporal) ?? null) : null,
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
              role: nonBlank(involvement.role) ?? null,
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
            // Undefined, not null: a blank re-emit must leave an existing source alone.
            source: nonBlank(row.source),
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
    index.set(id, { ...current, status: flip.to })
    planned.push({
      action:
        flip.to === 'retired'
          ? {
              kind: 'retireEntity',
              source: SOURCE,
              payload: { branchId, id, retiredReason: nonBlank(flip.reason) ?? null },
            }
          : { kind: 'promoteStagedEntity', source: SOURCE, payload: { branchId, id } },
      entryId: anchor(flip.sourceTurn),
    })
  }

  return { planned, handleMap, fellBackCount, unresolvedRefs }
}
