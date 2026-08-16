export type LogSubsystem =
  | 'pipeline'
  | 'action_layer'
  | 'classifier'
  | 'retrieval'
  | 'provider'
  | 'embedder'
  | 'translation'
  | 'memory'
  | 'bootstrap'
  | 'calendar'

export type LogKind = `${LogSubsystem}.${string}`

// Applied to the event-name half (after the first dot) at runtime in dev builds.
export const EVENT_NAME_REGEX = /^[a-z][a-z0-9_]*$/

export function eventNameOf(kind: string): string {
  const dot = kind.indexOf('.')
  return dot === -1 ? '' : kind.slice(dot + 1)
}
