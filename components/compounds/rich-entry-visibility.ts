import { createContext, useContext, useEffect, useState } from 'react'

// WebView residency control for rich entry cards: the reader publishes which
// rows are near the viewport, and each card boots or tears down its WebView
// accordingly. A pub-sub store (not context state) so a viewability change
// re-renders only the cards whose membership flipped, not every row.
type RichEntryVisibilityStore = {
  isActive: (id: string) => boolean
  subscribe: (listener: () => void) => () => void
  setActiveIds: (ids: ReadonlySet<string>) => void
}

export function createRichEntryVisibilityStore(): RichEntryVisibilityStore {
  let active: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  return {
    isActive: (id) => active.has(id),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setActiveIds: (ids) => {
      if (ids.size === active.size && [...ids].every((id) => active.has(id))) return
      active = ids
      listeners.forEach((listener) => listener())
    },
  }
}

export const RichEntryVisibilityContext = createContext<RichEntryVisibilityStore | null>(null)

/** Always active when no provider (dev screens, Storybook) or no stable id. */
export function useRichEntryActive(entryId: string | undefined): boolean {
  const store = useContext(RichEntryVisibilityContext)
  const trackable = store != null && entryId != null
  const [active, setActive] = useState(() => (trackable ? store.isActive(entryId) : true))

  useEffect(() => {
    if (!trackable) return
    const update = () => setActive(store.isActive(entryId))
    update()
    return store.subscribe(update)
  }, [trackable, store, entryId])

  return trackable ? active : true
}
