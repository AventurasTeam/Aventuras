import type { Entity } from '@/lib/db'
import { newTerms } from '@/lib/keyword-terms'
import { nameBasis, nameHolders, realPlacementOf } from '@/lib/world'

import { clampEmbedded, MAX_EMBEDDED_NAME, SOURCE, type PlanContext } from './plan-context'
import type { ClassifierExtraction } from './schema'

/**
 * classifier.md → What the classifier writes → Names. The handler decides between the rename and
 * the clash as each lands; this predicts it for the facts after it, by the handler's holder rule.
 */
export function renamePlanner(
  ctx: PlanContext,
): (rename: ClassifierExtraction['renames'][number]) => void {
  const { deps, planned, index, report, rowById, placedHere, createdPlaces } = ctx
  const { branchId, entities } = deps
  // Only the stored name rules a rename out: the handler may refuse an earlier one.
  const sent = new Set<string>()
  const predict = (row: Entity, name: string): void => {
    const known = index.get(row.id)
    if (known === undefined) return
    const stored = realPlacementOf([
      ...entities.filter((e) => e.kind === 'location'),
      ...createdPlaces,
    ])
    const rows = [...index]
      .filter(([, other]) => other.kind === row.kind)
      .map(([id, other]) => ({ id, name: other.name, createdAt: other.createdAt }))
    const holders = nameHolders(row, name, rows, (id) => placedHere.get(id) ?? stored(id))
    index.set(
      row.id,
      holders.length > 0
        ? { ...known, keywords: [...known.keywords, ...newTerms(known.keywords, [name])] }
        : {
            ...known,
            name,
            keywords: [...known.keywords, ...newTerms(known.keywords, [known.name])],
          },
    )
  }
  return (rename) => {
    const row = rowById.get(rename.ref)
    if (row === undefined) {
      report.unseenRefs.push({ list: 'renames', ref: rename.ref })
      return
    }
    const name = clampEmbedded(rename.name.trim(), MAX_EMBEDDED_NAME)
    if (name === '') {
      report.droppedRenames.push({ ref: rename.ref, cause: 'blank-name' })
      return
    }
    // One name by World's namesake rule, as the handler's test: case and spacing aside.
    if (!sent.has(row.id) && nameBasis(name, row.name) === 'same-name') return
    sent.add(row.id)
    predict(row, name)
    planned.push({
      action: {
        kind: 'renameEntity',
        source: SOURCE,
        payload: { branchId, id: row.id, name, proseEntryId: ctx.proseSource(rename.sourceTurn) },
      },
      entryId: ctx.anchor(rename.sourceTurn),
    })
  }
}

// `index` is keyed by row id, so a handle this reply declares misses: its row has the keywords.
export function planAlias(ctx: PlanContext, alias: ClassifierExtraction['aliases'][number]): void {
  if (!ctx.index.has(alias.ref)) ctx.report.unresolvedRefs.push(alias.ref)
  else ctx.appendNewTerms(alias.ref, alias.terms, alias.sourceTurn)
}
