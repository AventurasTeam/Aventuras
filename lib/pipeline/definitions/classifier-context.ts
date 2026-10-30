import type { ClassifierWindow } from '@/lib/classifier'
import type { CharacterRelationship, Entity, Happening, Thread } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'
import { normalizeTerm } from '@/lib/keyword-terms'
import { blankToNull, oneLine } from '@/lib/text'
import { characterFactionId, placeTree, stateOf, type PlaceTreeRow } from '@/lib/world'

type RelationshipFact = {
  subject: string
  subjectName: string
  object: string
  objectName: string
  kind: string
}

// One line per entity and place: stored text spanning several would break the list and the tree.
const lineOrNull = (text: string | null): string | null =>
  text == null ? null : blankToNull(oneLine(text))

// The line shows the name, so "also called" leaves out a stored keyword equal to it; the row's
// keywords stay as stored.
const aliasesOf = (e: Pick<Entity, 'name' | 'keywords'>): string[] => {
  const name = normalizeTerm(oneLine(e.name))
  return e.keywords.map(oneLine).filter((term) => normalizeTerm(term) !== name)
}

// One row can emit two facts, one per non-null perspective; a row whose character
// has no entity in the snapshot (FK-less, deleted) has no name to inline and is dropped.
function projectRelationships(
  relationships: readonly CharacterRelationship[],
  entities: readonly Entity[],
): RelationshipFact[] {
  const characterNames = new Map(
    entities.filter((e) => e.kind === 'character').map((e) => [e.id, oneLine(e.name)]),
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
        kind: oneLine(r.kind),
      })
    if (r.inverseKind != null)
      facts.push({
        subject: r.bId,
        subjectName: bName,
        object: r.aId,
        objectName: aName,
        kind: oneLine(r.inverseKind),
      })
    return facts
  })
}

// classifier.md → Mentioned places. Retired places keep their id: a happening can name one.
function leadOf(entities: readonly Entity[], leadId: string | null) {
  const lead = entities.find((e) => e.id === leadId && e.kind === 'character')
  return lead == null ? null : { id: lead.id, name: oneLine(lead.name) }
}

const placeRow = ({ entity: e, depth }: PlaceTreeRow) => ({
  id: e.id,
  name: oneLine(e.name),
  depth,
  status: e.status,
  retiredReason: e.status === 'retired' ? lineOrNull(e.retiredReason) : null,
  description: lineOrNull(e.description),
  keywords: aliasesOf(e),
})

// The classifierContext group's one builder. Separate from generationContext
// because the classifier's window carries provenance handles no other agent has,
// and the pinned variable set is parity-tested per group.
export function buildClassifierContext(args: {
  window: ClassifierWindow
  entities: readonly Entity[]
  happenings: readonly Happening[]
  relationships: readonly CharacterRelationship[]
  /** classifier.md → Threads → What the pass sees: every thread on the branch, user's included. */
  threads: readonly Thread[]
  /** stories.settings.classifierMentionedPlaces, read once when the pass builds its prompt. */
  mentionedPlaces: boolean
  /** The story's lead on this branch (resolveLead), or null. */
  leadId: string | null
  idMap: IdBiMap
}): Record<string, unknown> {
  const { window, entities, happenings, relationships, threads, mentionedPlaces, leadId, idMap } =
    args
  const known = new Set(entities.map((e) => e.id))
  const factions = new Set(entities.filter((e) => e.kind === 'faction').map((e) => e.id))
  // classifier.md → Factions: an id naming no listed faction would otherwise reach the prompt as
  // a placeholder no faction's line holds.
  const factionOf = (e: Entity): string | null => {
    const id = characterFactionId(e)
    return id != null && factions.has(id) ? id : null
  }
  const places = placeTree(entities)
  const context = {
    // Before turns: substituteIds allocates in walk order, so the roster numbers first.
    // No injectionMode, which generationContext's carries: a retrieval-time knob.
    entities: entities
      .filter((e) => e.kind !== 'location')
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        name: oneLine(e.name),
        description: lineOrNull(e.description),
        status: e.status,
        keywords: aliasesOf(e),
        faction: factionOf(e),
        // classifier.md → Factions → What the pass sees: a standing change needs the standing.
        standing: e.kind === 'faction' ? lineOrNull(stateOf(e, 'faction').standing ?? null) : null,
      })),
    places: places.tree.map(placeRow),
    // After the tree, so its places number first; ids kept, so a pass can place one.
    placesUnplaced: places.unplaced.map(placeRow),
    // entryId/position stay out: entry_* is not substitutable, so it would leak a raw id.
    // Scene/location ids are filtered to known: a deleted row would get a placeholder.
    turns: window.turns.map((t) => ({
      handle: t.handle,
      kind: t.kind,
      content: t.content,
      scene: t.sceneEntities.filter((id) => known.has(id)),
      location:
        t.currentLocationId != null && known.has(t.currentLocationId) ? t.currentLocationId : null,
    })),
    happenings: happenings.map((h) => ({ id: h.id, title: oneLine(h.title) })),
    threads: threads.map((t) => ({ id: t.id, title: oneLine(t.title), status: t.status })),
    relationships: projectRelationships(relationships, entities),
    // classifier.md → What the classifier reads: who "I" and "you" are; a lead no line lists has
    // no placeholder to name it by.
    lead: leadOf(entities, leadId),
    mentionedPlaces,
  }
  return substituteIds(context, idMap) as Record<string, unknown>
}
