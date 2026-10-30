import type { Entity, LocationState } from '@/lib/db'
import { newTerms } from '@/lib/keyword-terms'
import { compareAge } from '@/lib/list-modules'
import {
  flagStillHolds,
  nameBasis,
  realPlacementOf,
  samePlacement,
  withPlacement,
  type PlacePlacement,
} from '@/lib/world'

import { clampEmbedded, MAX_EMBEDDED_NAME, SOURCE, type PlanContext } from './plan-context'
import type { ClassifierExtraction } from './schema'

/**
 * classifier.md → What the classifier writes → Names. A name is taken when a row of the kind holds
 * it, one this reply creates or renames included. A keyword write's undo is the whole prior list,
 * so a row's renames, aliases, mention and reuse terms plan in turn order: reversing a turn then
 * never writes an earlier turn's terms away (classifier.md → Provenance attribution).
 */
export function planKeywordWrites(ctx: PlanContext): void {
  const { extraction, deps, planned, index, report, rowById } = ctx
  const { placedHere, createdPlaces, anchorOnce, proseSource } = ctx
  const { branchId, entities } = deps
  const nameRows = new Map(
    entities.map((e) => [e.id, { kind: e.kind, name: e.name, createdAt: e.createdAt }]),
  )
  for (const { action } of planned)
    if (action.kind === 'createEntity') {
      const { entry } = action.payload
      nameRows.set(entry.id, { kind: entry.kind, name: entry.name, createdAt: entry.createdAt })
    }
  // piggyback.md → Matching before creating: a place is compared with its real siblings, the top
  // level counting as one parent, and with every place when either is unplaced.
  const storedPlacement = realPlacementOf([
    ...entities.filter((e) => e.kind === 'location'),
    ...createdPlaces,
  ])
  const placementAt = (id: string): PlacePlacement => placedHere.get(id) ?? storedPlacement(id)
  const placesCompared = (a: string, b: string): boolean => {
    const [first, second] = [placementAt(a), placementAt(b)]
    return first.kind === 'unplaced' || second.kind === 'unplaced' || samePlacement(first, second)
  }
  // A listed row as this reply's planned writes leave it, for World's pairing rule.
  const asPlanned = (id: string): Entity | undefined => {
    const stored = rowById.get(id)
    if (stored === undefined) return undefined
    const placed = stored.kind === 'location' && placedHere.has(id)
    return {
      ...stored,
      name: nameRows.get(id)?.name ?? stored.name,
      keywords: index.get(id)?.keywords ?? stored.keywords,
      state: placed ? withPlacement(stored.state as LocationState, placementAt(id)) : stored.state,
    }
  }
  // Only the stored name rules a rename out: the handler may refuse an earlier planned one.
  const renamed = new Set<string>()
  const planRename = (rename: ClassifierExtraction['renames'][number]): void => {
    const row = rowById.get(rename.ref)
    if (row === undefined) {
      report.unseenRefs.push({ list: 'renames', ref: rename.ref })
      return
    }
    // Both hold every listed row; the check narrows their lookups.
    const current = nameRows.get(row.id)
    const known = index.get(row.id)
    if (current === undefined || known === undefined) return
    const name = clampEmbedded(rename.name.trim(), MAX_EMBEDDED_NAME)
    // One name by World's namesake rule, as renameEntity's holder test: case and spacing aside.
    const sameName = (other: string): boolean => nameBasis(name, other) === 'same-name'
    if (name === '') {
      report.droppedRenames.push({ ref: rename.ref, cause: 'blank-name' })
      return
    }
    if (!renamed.has(row.id) && sameName(row.name)) return
    const holders = [...nameRows]
      .filter(
        ([id, r]) =>
          id !== row.id &&
          r.kind === row.kind &&
          sameName(r.name) &&
          (row.kind !== 'location' || placesCompared(row.id, id)),
      )
      .sort(([idA, a], [idB, b]) => compareAge({ ...a, id: idA }, { ...b, id: idB }))
    const at = anchorOnce(rename.sourceTurn)
    const proseEntryId = proseSource(rename.sourceTurn)
    const holder = holders[0]
    if (holder === undefined) {
      renamed.add(row.id)
      nameRows.set(row.id, { ...current, name })
      // renameEntity keeps the old name as a keyword, which World's pairing rule reads.
      index.set(row.id, {
        ...known,
        keywords: [...known.keywords, ...newTerms(known.keywords, [current.name])],
      })
      planned.push({
        action: {
          kind: 'renameEntity',
          source: SOURCE,
          payload: { branchId, id: row.id, name, proseEntryId },
        },
        entryId: at(),
      })
      return
    }
    const [partnerId] = holder
    // The revealed name is one the prose used for it, so the pair stays namesakes (world.md →
    // Surfacing) and the user merges them. Judged against the stored row, as appendTerms is.
    const added = newTerms(row.keywords, [name])
    if (added.length > 0) {
      index.set(row.id, {
        ...known,
        keywords: [...known.keywords, ...newTerms(known.keywords, added)],
      })
      planned.push({
        action: {
          kind: 'appendEntityKeywords',
          source: SOURCE,
          payload: { branchId, id: row.id, keywords: added, proseEntryId },
        },
        entryId: at(),
      })
    }
    // A flag that still holds keeps its partner, a dormant one counts as none (classifier.md →
    // Names). Only the stored flag rules a raise out: the handler may refuse an earlier planned
    // one, and no-ops a later one once an earlier landed.
    const landed = asPlanned(row.id)
    const partnerOf = row.nameCollisionPartnerId
    const holds =
      landed !== undefined &&
      flagStillHolds(landed, partnerOf === null ? undefined : asPlanned(partnerOf))
    const flagged = !holds
    if (flagged) {
      planned.push({
        action: {
          kind: 'raiseCollisionFlag',
          source: SOURCE,
          payload: { branchId, id: row.id, partnerId, reason: 'name-taken', proseEntryId },
        },
        entryId: at(),
      })
    }
    report.renameClashes.push({ ref: rename.ref, name, partnerId, flagged })
  }
  // `index` is keyed by row id, so a handle this reply declares misses: its row has the keywords.
  const planAlias = (alias: ClassifierExtraction['aliases'][number]): void => {
    if (!index.has(alias.ref)) report.unresolvedRefs.push(alias.ref)
    else ctx.appendNewTerms(alias.ref, alias.terms, alias.sourceTurn)
  }
  // Ties keep this order: a mention's terms, then a rename, then an alias.
  const facts = [
    ...ctx.mentionTerms.map((mention) => ({ sourceTurn: mention.sourceTurn, mention })),
    ...extraction.renames.map((rename) => ({ sourceTurn: rename.sourceTurn, rename })),
    ...extraction.aliases.map((alias) => ({ sourceTurn: alias.sourceTurn, alias })),
  ]
  for (const fact of ctx.inTurnOrder(facts)) {
    if ('mention' in fact) {
      const { id, terms, proseEntryId, entryId } = fact.mention
      ctx.appendTerms(id, terms, proseEntryId, entryId)
    } else if ('rename' in fact) planRename(fact.rename)
    else planAlias(fact.alias)
  }
}
