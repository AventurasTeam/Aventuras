import type { ClassifierWindow } from '@/lib/classifier'
import type { CharacterRelationship, Entity, Happening } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'
import { blankToNull } from '@/lib/text'
import { characterFactionId, placeTree } from '@/lib/world'

type RelationshipFact = {
  subject: string
  subjectName: string
  object: string
  objectName: string
  kind: string
}

// One line per entity and place: stored text spanning several would break the list and the tree.
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()
const oneLine = (text: string | null): string | null =>
  text == null ? null : blankToNull(flat(text))

// One row can emit two facts, one per non-null perspective; a row whose character
// has no entity in the snapshot (FK-less, deleted) has no name to inline and is dropped.
function projectRelationships(
  relationships: readonly CharacterRelationship[],
  entities: readonly Entity[],
): RelationshipFact[] {
  const characterNames = new Map(
    entities.filter((e) => e.kind === 'character').map((e) => [e.id, e.name]),
  )
  return relationships.flatMap((r): RelationshipFact[] => {
    const aName = characterNames.get(r.aId)
    const bName = characterNames.get(r.bId)
    if (aName == null || bName == null) return []
    const facts: RelationshipFact[] = []
    if (r.kind != null)
      facts.push({
        subject: r.aId,
        subjectName: aName,
        object: r.bId,
        objectName: bName,
        kind: r.kind,
      })
    if (r.inverseKind != null)
      facts.push({
        subject: r.bId,
        subjectName: bName,
        object: r.aId,
        objectName: aName,
        kind: r.inverseKind,
      })
    return facts
  })
}

// The classifierContext group's one builder. Separate from generationContext
// because the classifier's window carries provenance handles no other agent has,
// and the pinned variable set is parity-tested per group.
export function buildClassifierContext(args: {
  window: ClassifierWindow
  entities: readonly Entity[]
  happenings: readonly Happening[]
  relationships: readonly CharacterRelationship[]
  /** stories.settings.classifierMentionedPlaces, read once when the pass builds its prompt. */
  mentionedPlaces: boolean
  idMap: IdBiMap
}): Record<string, unknown> {
  const { window, entities, happenings, relationships, mentionedPlaces, idMap } = args
  const known = new Set(entities.map((e) => e.id))
  const factions = new Set(entities.filter((e) => e.kind === 'faction').map((e) => e.id))
  // classifier.md → Factions: an id naming no listed faction would reach the prompt raw.
  const factionOf = (e: Entity): string | null => {
    const id = characterFactionId(e)
    return id != null && factions.has(id) ? id : null
  }
  const context = {
    // Before turns: substituteIds allocates in walk order, so the roster numbers first.
    // Narrower than generationContext's on purpose: no injectionMode, a retrieval-time knob.
    // Each entity is one line of the list, as each place is of the tree.
    entities: entities
      .filter((e) => e.kind !== 'location')
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        name: flat(e.name),
        description: oneLine(e.description),
        status: e.status,
        keywords: e.keywords.map(flat),
        faction: factionOf(e),
      })),
    // classifier.md → Mentioned places. Retired places keep their id: a happening can name one.
    places: placeTree(entities).map(({ entity: e, depth }) => ({
      id: e.id,
      name: flat(e.name),
      depth,
      status: e.status,
      retiredReason: e.status === 'retired' ? oneLine(e.retiredReason) : null,
      description: oneLine(e.description),
      keywords: e.keywords.map(flat),
    })),
    // entryId/position stay out: entry_* is not substitutable, so it would leak a raw id.
    // Scene/location ids are filtered to known: a deleted row would get a placeholder.
    turns: window.turns.map((t) => ({
      handle: t.handle,
      content: t.content,
      scene: t.sceneEntities.filter((id) => known.has(id)),
      location:
        t.currentLocationId != null && known.has(t.currentLocationId) ? t.currentLocationId : null,
    })),
    happenings: happenings.map((h) => ({ id: h.id, title: h.title })),
    relationships: projectRelationships(relationships, entities),
    mentionedPlaces,
  }
  return substituteIds(context, idMap) as Record<string, unknown>
}
