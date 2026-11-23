import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { RedoGroup } from '@/lib/actions'

type UndoRedoState = {
  /** Newest group last. A branch with nothing to redo has no entry. */
  stacks: ReadonlyMap<string, readonly RedoGroup[]>
}

const store = createStore<UndoRedoState>()(() => ({ stacks: new Map() }))

const stackOf = (branchId: string): readonly RedoGroup[] | undefined =>
  store.getState().stacks.get(branchId)

// An emptied stack loses its entry: a kept one could outlive a deleted branch.
function setStack(branchId: string, stack: readonly RedoGroup[]): void {
  const { stacks } = store.getState()
  if (stack.length === 0 && !stacks.has(branchId)) return
  const next = new Map(stacks)
  if (stack.length === 0) next.delete(branchId)
  else next.set(branchId, stack)
  store.setState({ stacks: next })
}

const removeStack = (branchId: string): void => setStack(branchId, [])

export const undoRedoStore = {
  pushRedoGroup: (group: RedoGroup): void =>
    setStack(group.branchId, [...(stackOf(group.branchId) ?? []), group]),
  peekRedoGroup: (branchId: string): RedoGroup | undefined => stackOf(branchId)?.at(-1),
  popRedoGroup: (branchId: string): RedoGroup | undefined => {
    const stack = stackOf(branchId)
    const top = stack?.at(-1)
    if (stack != null && top != null) setStack(branchId, stack.slice(0, -1))
    return top
  },
  /** A write that can change the branch: its redo can no longer replay exactly. */
  clear: removeStack,
  /** The branch, or its story, is deleted. */
  drop: removeStack,
  hasRedo: (branchId: string): boolean => (stackOf(branchId)?.length ?? 0) > 0,
  useRedoTop: (branchId: string): RedoGroup | undefined =>
    useStore(store, (s) => s.stacks.get(branchId)?.at(-1)),
  /** Test seam: the branches holding a non-empty stack. */
  __branches: (): readonly string[] => [...store.getState().stacks.keys()],
  __reset: (): void => store.setState({ stacks: new Map() }),
}
