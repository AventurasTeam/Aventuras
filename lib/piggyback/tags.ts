export const STATE_ROOT_TAG = 'state'
export const STATE_TAGS = {
  sceneEntities: 'scene_entities',
  currentLocation: 'current_location',
  worldTimeDelta: 'world_time_delta',
  visualChanges: 'visual_changes',
  transfers: 'transfers',
  summary: 'summary',
} as const

export const SUGGESTIONS_ROOT_TAG = 'suggestions'
export const SUGGESTION_ITEM_TAG = 'item'

// Every top-level block the model may append after prose. Order matters:
// stripTrailingBlocks cuts from the earliest one present.
export const TRAILING_ROOT_TAGS = [STATE_ROOT_TAG, SUGGESTIONS_ROOT_TAG] as const
