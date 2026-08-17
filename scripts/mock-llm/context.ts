import { RequestLog } from './log'
import { NARRATIVE_LANE } from './routing'
import { STRUCTURED_SHAPES } from './shapes'
import { defaultState, emptyLane, loadState, saveState, type Lane, type MockState } from './state'

/** A structured shape seen on the wire that the registry does not name. */
export type DiscoveredShape = { key: string; block: string | null; firstSeenAt: number }

export type MockContext = {
  state: MockState
  log: RequestLog
  discovered: Map<string, DiscoveredShape>
  save: () => void
  lane: (key: string) => Lane
}

/** `persist: false` keeps a test run off the developer's state.json entirely. */
export function createContext(opts: { persist?: boolean } = {}): MockContext {
  const persist = opts.persist !== false
  const state = persist ? loadState() : defaultState()
  return {
    state,
    log: new RequestLog(),
    discovered: new Map(),
    save: persist ? () => saveState(state) : () => {},
    lane: (key) => (state.lanes[key] ??= emptyLane()),
  }
}

/** Lane keys the UI lists: narrative, every registered shape, then discoveries. */
export function laneCatalog(
  ctx: MockContext,
): { key: string; title: string; kind: 'narrative' | 'registered' | 'unknown' }[] {
  const registered = STRUCTURED_SHAPES.map((s) => ({
    key: s.name,
    title: s.name,
    kind: 'registered' as const,
  }))
  const unknown = [...ctx.discovered.values()].map((d) => ({
    key: d.key,
    title: d.key,
    kind: 'unknown' as const,
  }))
  return [
    { key: NARRATIVE_LANE, title: 'narrative', kind: 'narrative' as const },
    ...registered,
    ...unknown,
  ]
}
