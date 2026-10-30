import { isPlotIconKey } from '@/lib/plot'

import {
  clampEmbedded,
  MAX_EMBEDDED_BODY,
  MAX_EMBEDDED_NAME,
  nonBlank,
  SOURCE,
  type PlanContext,
  type PlannedWrite,
} from './plan-context'
import type { NewThreadReply, ThreadStatusChange } from './schema'

// classifier.md → What the classifier writes → Happenings: an icon from the catalog, or none.
function iconOf(ctx: PlanContext, icon: string | undefined, title: string): string | null {
  const key = nonBlank(icon)?.toLowerCase()
  if (key === undefined) return null
  if (isPlotIconKey(key)) return key
  ctx.report.unknownIcons.push({ title, icon: key })
  return null
}

export function planHappenings(ctx: PlanContext): void {
  const { extraction, deps, planned, report, resolveRef } = ctx
  const { branchId, window, now, newId } = deps
  for (const happening of extraction.happenings) {
    // Its involvements and awareness nest under it, so dropping it strands nothing.
    const title = nonBlank(happening.title)
    if (title == null) {
      report.droppedHappenings.push({
        sourceTurn: happening.sourceTurn ?? null,
        cause: 'blank-title',
      })
      continue
    }
    const parentAnchor = ctx.anchor(happening.sourceTurn)
    const happeningId = newId('hap')
    const timestamp = now()
    // Not anchor(): a head fallback would place it at the newest turn, which Plot, the ranker and a
    // later pass's Known happenings read as fact. A temporal nulls it (happenings_mutual_excl).
    const temporal = nonBlank(happening.temporal) ?? null
    const source = window.resolveHandle(happening.sourceTurn)
    const occurredAtEntryId = temporal == null && !source.fellBack ? source.entryId : null
    const description = nonBlank(happening.description)
    planned.push({
      action: {
        kind: 'createHappening',
        source: SOURCE,
        payload: {
          entry: {
            id: happeningId,
            branchId,
            title: clampEmbedded(title, MAX_EMBEDDED_NAME),
            description: description == null ? null : clampEmbedded(description, MAX_EMBEDDED_BODY),
            category: nonBlank(happening.category) ?? null,
            icon: iconOf(ctx, happening.icon, title),
            temporal,
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
      // Unrestricted by kind: happening_involvements is polymorphic (location, item, faction ok).
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

    // One row a character: the first stands (the happening's own, before any knownAwareness entry
    // foldOwnAwareness moved in); two refs reconciled to one character would upsert over it.
    const aware = new Set<string>()
    for (const row of happening.awareness) {
      const characterId = resolveRef(row.ref, 'character')
      if (characterId == null || aware.has(characterId)) continue
      aware.add(characterId)
      // Learning of an OLD happening anchors to the narrating turn, not the happening's.
      const learnedEntryId =
        row.learnedAtTurn != null ? ctx.anchor(row.learnedAtTurn) : parentAnchor
      planned.push({
        action: {
          kind: 'upsertHappeningAwareness',
          source: SOURCE,
          payload: {
            branchId,
            characterId,
            happeningId,
            learnedAtEntryId: learnedEntryId,
            // Clamped here, not in the schema, which must stay JSON-Schema-representable.
            decayResistance: Math.min(1, Math.max(0, row.severity)),
            // Undefined, not null: a blank re-emit must leave an existing source alone.
            source: nonBlank(row.source),
            proseEntryId: ctx.proseSource(happening.sourceTurn),
          },
        },
        entryId: learnedEntryId,
      })
    }
  }
}

/**
 * classifier.md → What the classifier writes → Happenings. Create-only: the upsert would merge a
 * stored pair's source and decay resistance, which chapter close tunes.
 */
export function planKnownAwareness(ctx: PlanContext): void {
  const { extraction, deps, planned, report } = ctx
  const { branchId } = deps
  const listedHappenings = new Set(deps.happenings.map((h) => h.id))
  const pairKey = (characterId: string, happeningId: string): string =>
    `${characterId} ${happeningId}`
  const storedPairs = new Set(deps.awareness.map((a) => pairKey(a.characterId, a.happeningId)))
  // In learning-turn order, so a pair the reply repeats lands at its earliest turn.
  const learnings = extraction.knownAwareness.map((known) => ({
    sourceTurn: known.learnedAtTurn,
    known,
  }))
  for (const { known } of ctx.inTurnOrder(learnings)) {
    // An unknown placeholder passes substituteClassifierIds untouched, so only this check sees it.
    if (!listedHappenings.has(known.happening)) {
      report.unseenRefs.push({ list: 'knownAwareness', ref: known.happening })
      continue
    }
    const characterId = ctx.resolveRef(known.ref, 'character')
    if (characterId == null) continue
    const pair = pairKey(characterId, known.happening)
    if (storedPairs.has(pair)) continue
    storedPairs.add(pair)
    const learnedEntryId = ctx.anchor(known.learnedAtTurn)
    planned.push({
      action: {
        kind: 'upsertHappeningAwareness',
        source: SOURCE,
        payload: {
          branchId,
          characterId,
          happeningId: known.happening,
          learnedAtEntryId: learnedEntryId,
          decayResistance: Math.min(1, Math.max(0, known.severity)),
          source: nonBlank(known.source),
          proseEntryId: ctx.proseSource(known.learnedAtTurn),
        },
      },
      entryId: learnedEntryId,
    })
  }
}

/** classifier.md → Threads. */
export function planThreads(ctx: PlanContext): void {
  const { extraction, deps, planned, report, entryPosition, proseSource } = ctx
  const { branchId, window, now, newId } = deps
  const threadStatusWrite = (
    id: string,
    status: ThreadStatusChange['status'],
    entryId: string,
    proseEntryId: string,
  ): PlannedWrite => ({
    action: {
      kind: 'setThreadStatus',
      source: SOURCE,
      payload:
        status === 'active'
          ? { branchId, id, status, proseEntryId }
          : { branchId, id, status, resolvedAtEntryId: entryId, proseEntryId },
    },
    entryId,
  })
  // A status change can't precede its thread, so a closing turn before the open closes it there.
  const closingTurnOf = (
    thread: NewThreadReply,
    title: string,
    openedAt: string,
  ): { entryId: string; proseEntryId: string } => {
    const { resolvedAtTurn } = thread
    if (resolvedAtTurn !== undefined) {
      const closed = window.resolveHandle(resolvedAtTurn)
      if (closed.fellBack) report.unresolvedRefs.push(resolvedAtTurn)
      else if (entryPosition(closed.entryId) >= entryPosition(openedAt))
        return { entryId: closed.entryId, proseEntryId: closed.entryId }
      else report.earlyCloses.push({ title, resolvedAtTurn, sourceTurn: thread.sourceTurn ?? null })
    }
    return { entryId: openedAt, proseEntryId: proseSource(thread.sourceTurn) }
  }
  for (const thread of extraction.newThreads) {
    const title = nonBlank(thread.title)
    if (title == null) {
      report.droppedThreads.push({ sourceTurn: thread.sourceTurn ?? null, cause: 'blank-title' })
      continue
    }
    const entryId = ctx.anchor(thread.sourceTurn)
    // Create and close are two writes, each kept by its own turn: reversing the close reopens it.
    const closedAs =
      thread.status === 'resolved' || thread.status === 'failed' ? thread.status : null
    const id = newId('thr')
    const description = nonBlank(thread.description)
    const timestamp = now()
    planned.push({
      action: {
        kind: 'createThread',
        source: SOURCE,
        payload: {
          entry: {
            id,
            branchId,
            title: clampEmbedded(title, MAX_EMBEDDED_NAME),
            description: description == null ? null : clampEmbedded(description, MAX_EMBEDDED_BODY),
            category: nonBlank(thread.category) ?? null,
            icon: iconOf(ctx, thread.icon, title),
            status: closedAs === null ? thread.status : 'active',
            injectionMode: 'auto',
            // Non-null on every thread a pass creates: setThreadStatus resolves only those.
            triggeredAtEntryId: entryId,
            resolvedAtEntryId: null,
            embeddingStale: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
      entryId,
    })
    if (closedAs !== null) {
      const closing = closingTurnOf(thread, title, entryId)
      planned.push(threadStatusWrite(id, closedAs, closing.entryId, closing.proseEntryId))
    }
  }
  const storedStatusOf = new Map(deps.threads.map((t) => [t.id, t.status]))
  // Only the stored status rules a change out: the handler may refuse an earlier planned one.
  const statusSentFor = new Set<string>()
  for (const change of ctx.inTurnOrder(extraction.threadStatuses)) {
    const stored = storedStatusOf.get(change.thread)
    if (stored === undefined) {
      report.unseenRefs.push({ list: 'threadStatuses', ref: change.thread })
      continue
    }
    if (stored === change.status && !statusSentFor.has(change.thread)) continue
    statusSentFor.add(change.thread)
    planned.push(
      threadStatusWrite(
        change.thread,
        change.status,
        ctx.anchor(change.sourceTurn),
        proseSource(change.sourceTurn),
      ),
    )
  }
}
