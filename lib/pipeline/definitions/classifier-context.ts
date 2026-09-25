import type { ClassifierWindow } from '@/lib/classifier'
import type { CharacterRelationship, Entity, Happening } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'

// The classifierContext group's one builder. Separate from generationContext
// because the classifier's window carries provenance handles no other agent has,
// and the pinned variable set is parity-tested per group.
export function buildClassifierContext(args: {
  window: ClassifierWindow
  entities: readonly Entity[]
  happenings: readonly Happening[]
  relationships: readonly CharacterRelationship[]
  idMap: IdBiMap
}): Record<string, unknown> {
  const { window, entities, happenings, relationships, idMap } = args
  const context = {
    // entryId/position stay out: the model addresses turns by handle only, and
    // entry_* is not substitutable, so leaking it would put a raw id in the prompt.
    turns: window.turns.map((t) => ({ handle: t.handle, content: t.content })),
    // Projected to the fields templateContextMap documents, like happenings
    // below. Narrower than generationContext's on purpose: the classifier reads
    // prose and has no use for injectionMode, which is a retrieval-time knob.
    entities: entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      description: e.description,
      status: e.status,
    })),
    happenings: happenings.map((h) => ({ id: h.id, title: h.title })),
    // One row per non-null perspective, not per pair: a row with both views set
    // becomes two facts, each already shaped like the (subject, object, kind)
    // upsert the model is asked to emit.
    relationships: relationships.flatMap((r) => {
      const rows: { subject: string; object: string; kind: string }[] = []
      if (r.kind != null) rows.push({ subject: r.aId, object: r.bId, kind: r.kind })
      if (r.inverseKind != null) rows.push({ subject: r.bId, object: r.aId, kind: r.inverseKind })
      return rows
    }),
  }
  return substituteIds(context, idMap) as Record<string, unknown>
}
