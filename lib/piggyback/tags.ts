export const STATE_ROOT_TAG = 'state'
export const STATE_TAGS = {
  sceneEntities: 'scene_entities',
  currentLocation: 'current_location',
  worldTimeDelta: 'world_time_delta',
  visualChanges: 'visual_changes',
  transfers: 'transfers',
  summary: 'summary',
  retrievalQueries: 'retrieval_queries',
} as const

/** The `<query>` children `<retrieval_queries>` nests. */
export const RETRIEVAL_QUERY_ITEM_TAG = 'query'

/** Repeated, attribute-bearing tags inside `<state>`; the block's other tags name them by handle. */
export const STATE_CREATE_TAGS = { newLocation: 'new_location', newItem: 'new_item' } as const

/** A create's handle namespace, so it can't be mistaken for a listed placeholder. */
export const CREATE_HANDLE_PREFIX = 'new:'

/** A ref in the create namespace: the prefix and at least one character after it. */
export function isCreateHandle(ref: string): boolean {
  return ref.startsWith(CREATE_HANDLE_PREFIX) && ref.length > CREATE_HANDLE_PREFIX.length
}

export const SUGGESTIONS_ROOT_TAG = 'suggestions'
export const SUGGESTION_ITEM_TAG = 'item'

// Every top-level block the model may append after prose.
export const TRAILING_ROOT_TAGS = [STATE_ROOT_TAG, SUGGESTIONS_ROOT_TAG] as const
