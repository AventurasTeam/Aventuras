import type {
  StoryEntry,
  TrackedEntityType,
  WorldStateChangeRecord,
  WorldStateDelta,
  WorldStateHeaderRecord,
  WorldStateRecord,
} from '$lib/types'

// Names were captured but never restored; restoring them would undo a later, unrecorded rename.
const NOT_RESTORED = new Set(['id', 'name', 'title'])

function fieldsOf(before: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(before).filter(([key, value]) => !NOT_RESTORED.has(key) && value !== undefined),
  )
}

/**
 * Reads a delta written to `story_entries.world_state_delta` as records. It recorded the
 * classifier only, so its header is marked `classifier`.
 */
export function fromWorldStateDelta(entry: StoryEntry, delta: WorldStateDelta): WorldStateRecord[] {
  const base = {
    storyId: entry.storyId,
    branchId: entry.branchId ?? null,
    entryId: entry.id,
    createdAt: entry.createdAt,
  }
  let seq = 0
  const header: WorldStateHeaderRecord = {
    ...base,
    id: `${entry.id}:header`,
    seq: seq++,
    kind: 'header',
    continuous: false,
    clockBefore: delta.previousState.timeTracker ?? null,
    locationBefore: delta.previousState.currentLocationId ?? null,
    coverage: 'classifier',
  }

  const change = (
    entityType: TrackedEntityType,
    entityId: string,
    op: 'create' | 'update',
    before: Record<string, unknown> | null,
  ): WorldStateChangeRecord => ({
    ...base,
    id: `${entry.id}:${seq}`,
    seq: seq++,
    kind: 'change',
    origin: 'agent',
    entityType,
    entityId,
    op,
    before,
    after: null,
  })

  const { previousState: prev, createdEntities: created } = delta
  return [
    header,
    ...prev.characters.map((b) => change('character', b.id, 'update', fieldsOf(b))),
    ...prev.locations.map((b) => change('location', b.id, 'update', fieldsOf(b))),
    ...prev.items.map((b) => change('item', b.id, 'update', fieldsOf(b))),
    ...prev.storyBeats.map((b) => change('story_beat', b.id, 'update', fieldsOf(b))),
    ...created.characterIds.map((id) => change('character', id, 'create', null)),
    ...created.locationIds.map((id) => change('location', id, 'create', null)),
    ...created.itemIds.map((id) => change('item', id, 'create', null)),
    ...created.storyBeatIds.map((id) => change('story_beat', id, 'create', null)),
  ]
}
