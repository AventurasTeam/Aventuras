type LeaveRequest = (proceed: () => void) => void

// Both guards' beforeRemove listeners fire on one pop, and the unsaved guard's replay carries the
// route as visited, so it reaches no listener again: ordering must happen here, keyed by route.
const unsavedArmed = new Map<string, number>()
const storyLeavePops = new Map<string, { token: object; check: { current: LeaveRequest } }>()

const passThrough: LeaveRequest = (proceed) => proceed()

/** Marks the route's unsaved guard as owning its pops until the returned release runs. */
export function armUnsavedPop(routeKey: string): () => void {
  unsavedArmed.set(routeKey, (unsavedArmed.get(routeKey) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (unsavedArmed.get(routeKey) ?? 1) - 1
    if (count > 0) unsavedArmed.set(routeKey, count)
    else unsavedArmed.delete(routeKey)
  }
}

export function isUnsavedPopArmed(routeKey: string): boolean {
  return unsavedArmed.has(routeKey)
}

/** Registers the route's story-leave pop check; the latest registration wins. */
export function registerStoryLeavePop(
  routeKey: string,
  check: { current: LeaveRequest },
): () => void {
  const token = {}
  storyLeavePops.set(routeKey, { token, check })
  return () => {
    if (storyLeavePops.get(routeKey)?.token === token) storyLeavePops.delete(routeKey)
  }
}

/** What a pop the unsaved guard released passes through before it replays. */
export function storyLeavePop(routeKey: string): LeaveRequest {
  const entry = storyLeavePops.get(routeKey)
  return entry == null ? passThrough : (proceed) => entry.check.current(proceed)
}
