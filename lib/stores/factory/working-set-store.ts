import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { StorePatch } from '@/lib/actions'

export type RowsHook<Row> = {
  <T>(branchId: string | null, selector: (rows: ReadonlyMap<string, Row>) => T): T
  /** @deprecated Unscoped read: name the branch. */
  <T>(selector: (rows: ReadonlyMap<string, Row>) => T): T
}
export type RowsGetter<Row> = {
  (branchId: string | null): ReadonlyMap<string, Row>
  /** @deprecated Unscoped read: name the branch. */
  (): ReadonlyMap<string, Row>
}
export type ByIdGetter<Row> = {
  (branchId: string | null, id: string): Row | undefined
  /** @deprecated Unscoped read: name the branch. */
  (id: string): Row | undefined
}

export type WorkingSetStore<Row extends { id: string }> = {
  /**
   * An unheld branch or `null` reads as one shared empty map; select it or a primitive, never a
   * fresh array.
   */
  useRows: RowsHook<Row>
  /** The branch's live rows (replaced on next write; never mutate), else the shared empty map. */
  getRows: RowsGetter<Row>
  getById: ByIdGetter<Row>
  useById: (branchId: string | null, id: string) => Row | undefined
  getLoadedBranch: () => string | null
  patch: (branchId: string, patch: StorePatch) => void
  insertMany: (branchId: string, rows: readonly Row[]) => void
  hydrate: (branchId: string, rows: Row[]) => void
  hydrateIfLoaded: (branchId: string, rows: Row[]) => boolean
  /** Fires after every state change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
  __reset: () => void
}

type State<Row extends { id: string }> = { rows: Map<string, Row>; loadedBranch: string | null }
type Selector<Row, T> = (rows: ReadonlyMap<string, Row>) => T

// One reference for every store and call, so a selector that returns it stays stable.
const EMPTY_ROWS: ReadonlyMap<string, never> = new Map<string, never>()

function rowsOf<Row extends { id: string }>(
  state: State<Row>,
  branchId: string | null,
): ReadonlyMap<string, Row> {
  return branchId != null && state.loadedBranch === branchId ? state.rows : EMPTY_ROWS
}

export function createWorkingSetStore<Row extends { id: string }>(): WorkingSetStore<Row> {
  const store = createStore<State<Row>>()(() => ({ rows: new Map(), loadedBranch: null }))

  const patch = (branchId: string, p: StorePatch) => {
    const s = store.getState()
    // A delta can target a branch other than the loaded one (e.g. background generation on another branch); the store mirrors only the held branch.
    if (branchId !== s.loadedBranch) return
    const rows = new Map(s.rows)
    if (p.op === 'delete') rows.delete(p.id)
    // row/columns are Record<> on StorePatch (domain-agnostic); the action handler that emits the patch guarantees they match Row.
    else if (p.op === 'create') rows.set(p.id, p.row as Row)
    else {
      const existing = rows.get(p.id)
      // An update for a row absent from the working set is a no-op — never synthesize a partial row from the column delta (e.g. a stale operational write after the row was deleted or never hydrated on the held branch).
      if (existing === undefined) return
      rows.set(p.id, { ...existing, ...(p.columns as Partial<Row>) })
    }
    store.setState({ rows })
  }

  const insertMany = (branchId: string, incoming: readonly Row[]) => {
    const s = store.getState()
    if (branchId !== s.loadedBranch) return
    // The row already held wins: an edit may have landed while the caller's read was in flight.
    const fresh = incoming.filter((row) => !s.rows.has(row.id))
    if (fresh.length === 0) return
    const rows = new Map(s.rows)
    for (const row of fresh) rows.set(row.id, row)
    store.setState({ rows })
  }

  const hydrate = (branchId: string, rows: Row[]) =>
    store.setState({ loadedBranch: branchId, rows: new Map(rows.map((r) => [r.id, r])) })

  // loadedBranch and rows are read in one selector, so a hydrate for another branch re-renders.
  function useRows<T>(branchId: string | null, selector: Selector<Row, T>): T
  function useRows<T>(selector: Selector<Row, T>): T
  function useRows<T>(...args: [Selector<Row, T>] | [string | null, Selector<Row, T>]): T {
    return useStore(store, (s) =>
      args.length === 2 ? args[1](rowsOf(s, args[0])) : args[0](s.rows),
    )
  }

  function getRows(branchId: string | null): ReadonlyMap<string, Row>
  function getRows(): ReadonlyMap<string, Row>
  function getRows(...args: [] | [string | null]): ReadonlyMap<string, Row> {
    const s = store.getState()
    return args.length === 0 ? s.rows : rowsOf(s, args[0])
  }

  function getById(branchId: string | null, id: string): Row | undefined
  function getById(id: string): Row | undefined
  function getById(...args: [string] | [string | null, string]): Row | undefined {
    const s = store.getState()
    return args.length === 2 ? rowsOf(s, args[0]).get(args[1]) : s.rows.get(args[0])
  }

  const useById = (branchId: string | null, id: string): Row | undefined =>
    useStore(store, (s) => rowsOf(s, branchId).get(id))

  return {
    useRows,
    getRows,
    getById,
    useById,
    getLoadedBranch: () => store.getState().loadedBranch,
    patch,
    insertMany,
    hydrate,
    hydrateIfLoaded: (branchId, rows) => {
      if (store.getState().loadedBranch !== branchId) return false
      hydrate(branchId, rows)
      return true
    },
    subscribe: (listener) => store.subscribe(() => listener()),
    __reset: () => store.setState({ rows: new Map(), loadedBranch: null }),
  }
}
