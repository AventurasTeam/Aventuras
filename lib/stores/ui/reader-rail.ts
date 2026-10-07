import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  DEFAULT_RAIL_VIEW,
  initialRailDisplay,
  railViewFor,
  reduceRailDisplay,
  type RailCategory,
  type RailDisplayEvent,
  type RailDisplayState,
  type RailView,
} from '@/lib/reader-rail'

// Session-scoped, never persisted (collapse.md → State preservation on reflow): the view and
// display survive a collapse, a reader remount and a phone ↔ tablet reflow.
type ReaderRailState = {
  view: RailView
  display: RailDisplayState
  /** False until the first real window width lands; until then nothing is forced. */
  seeded: boolean
  /** The branch the reader last entered; `null` until the first. */
  branchId: string | null
}

const INITIAL: ReaderRailState = {
  view: DEFAULT_RAIL_VIEW,
  display: initialRailDisplay(Number.POSITIVE_INFINITY),
  seeded: false,
  branchId: null,
}

const store = createStore<ReaderRailState>()(() => INITIAL)

/** Whether `view` is already the view a switch to its category lands on. */
function isFreshView(view: RailView): boolean {
  const fresh: Record<string, unknown> = railViewFor(view.category)
  const current: Record<string, unknown> = view
  const keys = Object.keys(fresh)
  return keys.length === Object.keys(current).length && keys.every((k) => fresh[k] === current[k])
}

function seed(width: number): void {
  store.setState({ display: initialRailDisplay(width), seeded: true })
}

export const readerRailStore = {
  useView: (): RailView => useStore(store, (s) => s.view),
  /** A primitive, so a filter or search edit doesn't re-render the caller. */
  useCategory: (): RailCategory => useStore(store, (s) => s.view.category),
  getView: (): RailView => store.getState().view,
  /** A switch resets filter and search, as World and Plot do; the current category is a no-op. */
  setCategory: (category: RailCategory): void =>
    store.setState((s) => (s.view.category === category ? s : { view: railViewFor(category) })),
  setView: (view: RailView): void => store.setState({ view }),
  /** A search or filter typed for one branch shouldn't apply to another; the category carries over. */
  enterBranch: (branchId: string): void =>
    store.setState((s) =>
      s.branchId === branchId
        ? s
        : {
            branchId,
            view: isFreshView(s.view) ? s.view : railViewFor(s.view.category),
            display: reduceRailDisplay(s.display, { type: 'closePeek' }),
          },
    ),
  /** `selector` must return a stable value (a field or a primitive), as zustand requires. */
  useDisplay: <T>(selector: (display: RailDisplayState) => T): T =>
    useStore(store, (s) => selector(s.display)),
  getDisplay: (): RailDisplayState => store.getState().display,
  /** Seeds the display from the window width once per app session; later calls are no-ops. */
  seedViewport: (width: number): void => {
    if (!store.getState().seeded) seed(width)
  },
  /** A resize before any seed seeds instead: a width with no prior one is not a cross. */
  dispatchDisplay: (event: RailDisplayEvent): void => {
    if (event.type === 'resize' && !store.getState().seeded) {
      seed(event.width)
      return
    }
    store.setState((s) => {
      const display = reduceRailDisplay(s.display, event)
      return display === s.display ? s : { display }
    })
  },
  __reset: (): void => store.setState(INITIAL),
}
