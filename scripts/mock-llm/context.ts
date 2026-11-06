import { RequestLog } from './log'
import { NARRATIVE_LANE, TOOL_LANE_PREFIX } from './routing'
import { STRUCTURED_SHAPES } from './shapes'
import { defaultState, emptyLane, loadState, saveState, type Lane, type MockState } from './state'

/** A lane seen on the wire that no registry entry names: an unknown shape or a tool lane. */
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

export type LaneMeta = {
  key: string
  title: string
  kind: 'narrative' | 'registered' | 'unknown' | 'tool'
  /** Nav section the panel files this lane under. */
  group: 'narrative' | 'story' | 'wizard' | 'tools' | 'unknown'
}

/** Lane keys the UI lists: narrative, every registered shape, then discoveries. */
export function laneCatalog(ctx: MockContext): LaneMeta[] {
  const registered = STRUCTURED_SHAPES.map((s) => ({
    key: s.name,
    title: s.name,
    kind: 'registered' as const,
    group: s.group,
  }))
  // By key, not by a null block: an unregistered shape that declared no block has a null one too.
  const discovered = [...ctx.discovered.values()].map(
    (d): LaneMeta =>
      d.key.startsWith(TOOL_LANE_PREFIX)
        ? { key: d.key, title: d.key, kind: 'tool', group: 'tools' }
        : { key: d.key, title: d.key, kind: 'unknown', group: 'unknown' },
  )
  return [
    { key: NARRATIVE_LANE, title: 'narrative', kind: 'narrative' as const, group: 'narrative' },
    ...registered,
    ...discovered,
  ]
}
