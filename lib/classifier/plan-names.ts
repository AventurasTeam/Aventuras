import { nameBasis } from '@/lib/world'

import { clampEmbedded, MAX_EMBEDDED_NAME, SOURCE, type PlanContext } from './plan-context'
import type { ClassifierExtraction } from './schema'

/**
 * classifier.md → What the classifier writes → Names. A keyword write's undo is the whole prior
 * list, so a row's renames, aliases, mention and reuse terms plan in turn order: reversing a turn
 * then never writes an earlier turn's terms away (classifier.md → Provenance attribution).
 */
export function planKeywordWrites(ctx: PlanContext): void {
  const { extraction, deps, planned, index, report, rowById } = ctx
  const { branchId } = deps
  // Only the stored name rules a rename out: the handler may refuse an earlier one, and decides
  // between the rename and the clash as each lands.
  const sent = new Set<string>()
  const planRename = (rename: ClassifierExtraction['renames'][number]): void => {
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
    planned.push({
      action: {
        kind: 'renameEntity',
        source: SOURCE,
        payload: { branchId, id: row.id, name, proseEntryId: ctx.proseSource(rename.sourceTurn) },
      },
      entryId: ctx.anchor(rename.sourceTurn),
    })
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
