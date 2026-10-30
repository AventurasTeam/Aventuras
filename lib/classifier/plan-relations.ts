import { oneLine } from '@/lib/text'
import { characterFactionId, stateOf } from '@/lib/world'

import { nonBlank, SOURCE, stateText, type PlanContext } from './plan-context'
import type { ClassifierExtraction } from './schema'

/**
 * classifier.md → Factions: a listed faction's standing, on a change. Bounded as the handler bounds
 * it, so a restatement compares what it would store, on one line as the prompt shows it.
 */
export function planStandings(ctx: PlanContext): void {
  const { extraction, deps, planned, report, rowById } = ctx
  const { branchId } = deps
  // Only the stored standing rules a fact out: the handler may refuse an earlier planned one.
  const sentFor = new Set<string>()
  for (const fact of ctx.inTurnOrder(extraction.standings)) {
    const row = rowById.get(fact.ref)
    if (row === undefined) {
      report.unseenRefs.push({ list: 'standings', ref: fact.ref })
      continue
    }
    if (row.kind !== 'faction') {
      report.droppedStandings.push({ faction: fact.ref, cause: 'not-a-faction' })
      continue
    }
    // The pre-reply row, so a faction this reply retires keeps the standings from its turns.
    if (row.status === 'retired') {
      report.droppedStandings.push({ faction: fact.ref, cause: 'retired-faction' })
      continue
    }
    const standing = stateText(fact.standing, (cut) =>
      report.cutTexts.push({ kind: 'standing', ref: fact.ref, ...cut }),
    )
    if (standing === undefined) continue
    const stored = stateOf(row, 'faction').standing
    const restated = stored !== undefined && oneLine(standing) === oneLine(stored)
    if (restated && !sentFor.has(row.id)) continue
    sentFor.add(row.id)
    planned.push({
      action: {
        kind: 'setFactionStanding',
        source: SOURCE,
        payload: { branchId, id: row.id, standing, proseEntryId: ctx.proseSource(fact.sourceTurn) },
      },
      entryId: ctx.anchor(fact.sourceTurn),
    })
  }
}

export function planRelationships(ctx: PlanContext): void {
  const { extraction, deps, planned, resolveRef } = ctx
  const { branchId } = deps
  for (const relationship of extraction.relationships) {
    const subjectId = resolveRef(relationship.subject, 'character')
    const objectId = resolveRef(relationship.object, 'character')
    if (subjectId == null || objectId == null || subjectId === objectId) continue
    // A blank kind would be rejected or stored as whitespace, and a null view could make a later
    // CTRL-Z refuse (generation-pipeline.md → Reverse-replay): drop the fact instead of failing.
    const kind = nonBlank(relationship.kind)
    if (kind == null) continue
    planned.push({
      action: {
        kind: 'upsertCharacterRelationship',
        source: SOURCE,
        // Canonical a_id < b_id ordering and the POV merge live in the action
        // (lib/actions/relationships/register.ts) — emit the raw perspective.
        payload: {
          branchId,
          subjectId,
          objectId,
          kind,
          proseEntryId: ctx.proseSource(relationship.sourceTurn),
        },
      },
      entryId: ctx.anchor(relationship.sourceTurn),
    })
  }
}

/**
 * classifier.md → Factions → Memberships. Retired per the pre-reply `rowById`, not `index`, so the
 * reply's own flips never count. Anchor-ordered: a head-turn reversal undoes only the latest.
 */
export function planMemberships(ctx: PlanContext): void {
  const { extraction, deps, planned, handleMap, index, report, rowById, resolveRef } = ctx
  const { branchId } = deps
  // Only the stored faction rules a fact out: the handler may refuse an earlier planned one.
  const sentFor = new Set<string>()
  const storedFaction = (id: string): string | null => {
    const row = rowById.get(id)
    return row == null ? null : characterFactionId(row)
  }
  // A none beside a join of another faction at one turn, for a character who held one before it,
  // is a change of sides: the leave first, whatever the reply's order. Looked up without
  // resolveRef, which would log a miss the loop below logs again.
  const peekRef = (ref: string): string | null =>
    handleMap.get(ref) ?? (index.has(ref) ? ref : null)
  const held = new Map<string, string | null>()
  const heldBefore = (id: string): string | null =>
    held.has(id) ? (held.get(id) ?? null) : storedFaction(id)
  const byTurn = new Map<number, ClassifierExtraction['memberships']>()
  for (const fact of ctx.inTurnOrder(extraction.memberships)) {
    const at = ctx.turnPosition(fact.sourceTurn)
    byTurn.set(at, [...(byTurn.get(at) ?? []), fact])
  }
  const membershipFacts = [...byTurn.values()].flatMap((facts) => {
    // The faction of a join the loop below keeps: no other kind, and not a retired one. A join it
    // drops neither changes sides nor changes the faction held.
    const joined = (fact: (typeof facts)[number]): string | null => {
      const faction = fact.faction === null ? null : peekRef(fact.faction)
      return faction != null &&
        index.get(faction)?.kind === 'faction' &&
        rowById.get(faction)?.status !== 'retired'
        ? faction
        : null
    }
    const switching = new Set(
      facts.flatMap((fact) => {
        const id = peekRef(fact.character)
        if (id == null || fact.faction !== null) return []
        const before = heldBefore(id)
        const joinsAnother = facts.some((other) => {
          const faction = joined(other)
          return peekRef(other.character) === id && faction != null && faction !== before
        })
        return before != null && joinsAnother ? [id] : []
      }),
    )
    const rank = (fact: (typeof facts)[number]): number =>
      switching.has(peekRef(fact.character) ?? '') ? Number(fact.faction !== null) : 0
    const ordered = [...facts].sort((a, b) => rank(a) - rank(b))
    for (const fact of ordered) {
      const id = peekRef(fact.character)
      const faction = joined(fact)
      if (id != null && (fact.faction === null || faction != null)) held.set(id, faction)
    }
    return ordered
  })
  for (const fact of membershipFacts) {
    const characterId = resolveRef(fact.character, 'character')
    if (characterId == null) continue
    let factionId: string | null = null
    if (fact.faction !== null) {
      factionId = resolveRef(fact.faction, 'faction')
      if (factionId == null) continue
      if (rowById.get(factionId)?.status === 'retired') {
        report.droppedMemberships.push({
          character: fact.character,
          faction: fact.faction,
          cause: 'retired-faction',
        })
        continue
      }
    }
    if (!sentFor.has(characterId) && storedFaction(characterId) === factionId) continue
    sentFor.add(characterId)
    planned.push({
      action: {
        kind: 'setCharacterFaction',
        source: SOURCE,
        payload: {
          branchId,
          id: characterId,
          factionId,
          proseEntryId: ctx.proseSource(fact.sourceTurn),
        },
      },
      entryId: ctx.anchor(fact.sourceTurn),
    })
  }
}
