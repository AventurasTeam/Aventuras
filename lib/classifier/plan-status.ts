import { nonBlank, SOURCE, type PlanContext } from './plan-context'
import type { ClassifierExtraction } from './schema'

/** classifier.md → What the classifier writes → Status transitions, against the reply's view. */
export function planStatusFlip(
  ctx: PlanContext,
  flip: ClassifierExtraction['statusFlips'][number],
): void {
  const { deps, planned, index, report } = ctx
  const { branchId } = deps
  const id = ctx.resolveRef(flip.ref)
  if (id == null) return
  const current = index.get(id)
  if (current == null) return
  // classifier.md → What the classifier writes → Status transitions: only a character returns.
  const returning = flip.to === 'active' && current.status === 'retired'
  if (returning && current.kind !== 'character') {
    report.droppedReturns.push({ ref: flip.ref, cause: 'not-a-character' })
    return
  }
  // Monotonic staged->active (the other writer may have landed it already), a return, and
  // hard-finality retirement only.
  if (flip.to === 'active' && current.status !== 'staged' && !returning) return
  if (flip.to === 'retired' && current.status !== 'active') return
  // A destroyed place stays active, its destruction a condition: only the user retires one.
  if (flip.to === 'retired' && current.kind === 'location') return
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
