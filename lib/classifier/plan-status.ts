import { nonBlank, SOURCE, type PlanContext } from './plan-context'

export function planStatusFlips(ctx: PlanContext): void {
  const { extraction, deps, planned, index, report } = ctx
  const { branchId } = deps
  for (const flip of ctx.inTurnOrder(extraction.statusFlips)) {
    const id = ctx.resolveRef(flip.ref)
    if (id == null) continue
    const current = index.get(id)
    if (current == null) continue
    // classifier.md → What the classifier writes → Status transitions: only a character returns.
    const returning = flip.to === 'active' && current.status === 'retired'
    if (returning && current.kind !== 'character') {
      report.droppedReturns.push({ ref: flip.ref, cause: 'not-a-character' })
      continue
    }
    // Monotonic staged->active (the other writer may have landed it already), a return, and
    // hard-finality retirement only.
    if (flip.to === 'active' && current.status !== 'staged' && !returning) continue
    if (flip.to === 'retired' && current.status !== 'active') continue
    // A destroyed place stays active, its destruction a condition: only the user retires one.
    if (flip.to === 'retired' && current.kind === 'location') continue
    index.set(id, { ...current, status: flip.to })
    const proseEntryId = ctx.proseSource(flip.sourceTurn)
    planned.push({
      action:
        flip.to === 'retired'
          ? {
              kind: 'retireEntity',
              source: SOURCE,
              payload: {
                branchId,
                id,
                retiredReason: nonBlank(flip.reason) ?? null,
                proseEntryId,
              },
            }
          : returning
            ? {
                kind: 'returnFromRetirement',
                source: SOURCE,
                payload: { branchId, id, proseEntryId },
              }
            : {
                kind: 'promoteStagedEntity',
                source: SOURCE,
                payload: { branchId, id, proseEntryId },
              },
      entryId: ctx.anchor(flip.sourceTurn),
    })
  }
}
