import type { ClassifierWindow } from '@/lib/classifier'
import type { Entity, Happening } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'

// The classifierContext group's one builder. Separate from generationContext
// because the classifier's window carries provenance handles no other agent has,
// and the pinned variable set is parity-tested per group.
export function buildClassifierContext(args: {
  window: ClassifierWindow
  entities: readonly Entity[]
  happenings: readonly Happening[]
  idMap: IdBiMap
}): Record<string, unknown> {
  const { window, entities, happenings, idMap } = args
  const context = {
    // entryId/position stay out: the model addresses turns by handle only, and
    // entry_* is not substitutable, so leaking it would put a raw id in the prompt.
    turns: window.turns.map((t) => ({ handle: t.handle, content: t.content })),
    entities,
    happenings: happenings.map((h) => ({ id: h.id, title: h.title })),
  }
  return substituteIds(context, idMap) as Record<string, unknown>
}
