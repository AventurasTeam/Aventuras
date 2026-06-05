import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { StorePatch } from '@/lib/actions'

export type WorkingSetStore<Row extends { id: string }> = {
  useRows: <T>(selector: (rows: ReadonlyMap<string, Row>) => T) => T
  getRows: () => ReadonlyMap<string, Row>
  getLoadedBranch: () => string | null
  patch: (branchId: string, patch: StorePatch) => void
  hydrate: (branchId: string, rows: Row[]) => void
  __reset: () => void
}

type State<Row extends { id: string }> = { rows: Map<string, Row>; loadedBranch: string | null }

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
    else rows.set(p.id, { ...(rows.get(p.id) as Row), ...(p.columns as Partial<Row>) })
    store.setState({ rows })
  }

  return {
    useRows: (selector) => useStore(store, (s) => selector(s.rows)),
    // ReadonlyMap is a type-level guard; this is the live snapshot — do not mutate (replaced on next patch).
    getRows: () => store.getState().rows,
    getLoadedBranch: () => store.getState().loadedBranch,
    patch,
    hydrate: (branchId, rows) =>
      store.setState({ loadedBranch: branchId, rows: new Map(rows.map((r) => [r.id, r])) }),
    __reset: () => store.setState({ rows: new Map(), loadedBranch: null }),
  }
}
