import type {
  Character,
  Entry,
  Item,
  Location,
  StoryBeat,
  TimeTracker,
  TrackedEntityType,
} from '$lib/types'

/** The visible world state of one branch, as the store holds it. */
export interface TrackedState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  lorebookEntries: Entry[]
  timeTracker: TimeTracker | null
}

export type TrackedRow = Character | Location | Item | StoryBeat | Entry

const LIST_KEYS = {
  character: 'characters',
  location: 'locations',
  item: 'items',
  story_beat: 'storyBeats',
  lorebook_entry: 'lorebookEntries',
} as const satisfies Record<TrackedEntityType, keyof TrackedState>

export const TRACKED_ENTITY_TYPES = Object.keys(LIST_KEYS) as TrackedEntityType[]

export function rowsOf(state: TrackedState, type: TrackedEntityType): TrackedRow[] {
  return state[LIST_KEYS[type]]
}

export function withRows(
  state: TrackedState,
  type: TrackedEntityType,
  rows: TrackedRow[],
): TrackedState {
  return { ...state, [LIST_KEYS[type]]: rows }
}

export function cloneState(state: TrackedState): TrackedState {
  return {
    characters: state.characters.map((r) => ({ ...r })),
    locations: state.locations.map((r) => ({ ...r })),
    items: state.items.map((r) => ({ ...r })),
    storyBeats: state.storyBeats.map((r) => ({ ...r })),
    lorebookEntries: state.lorebookEntries.map((r) => ({ ...r })),
    timeTracker: state.timeTracker ? { ...state.timeTracker } : null,
  }
}

/** The identity an override shares with the row it overrides. */
export function canonicalId(row: { id: string; overridesId?: string | null }): string {
  return row.overridesId ?? row.id
}
