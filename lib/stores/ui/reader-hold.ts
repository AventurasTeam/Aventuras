import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type ReaderHoldToken = { readonly branchId: string }

type ReaderHoldState = {
  /** A branch with no live token has no entry. */
  held: ReadonlyMap<string, ReadonlySet<ReaderHoldToken>>
}

const store = createStore<ReaderHoldState>()(() => ({ held: new Map() }))

function setTokens(branchId: string, tokens: ReadonlySet<ReaderHoldToken>): void {
  const held = new Map(store.getState().held)
  if (tokens.size === 0) held.delete(branchId)
  else held.set(branchId, tokens)
  store.setState({ held })
}

// Each take is its own token, so an older release cannot drop a newer hold on the same branch.
export const readerHoldStore = {
  take: (branchId: string): ReaderHoldToken => {
    const token: ReaderHoldToken = { branchId }
    setTokens(branchId, new Set(store.getState().held.get(branchId)).add(token))
    return token
  },
  /** Ends this token only; the branch stays held while another token is live. */
  release: (token: ReaderHoldToken): void => {
    const tokens = store.getState().held.get(token.branchId)
    if (tokens == null || !tokens.has(token)) return
    const next = new Set(tokens)
    next.delete(token)
    setTokens(token.branchId, next)
  },
  isHeld: (branchId: string): boolean => store.getState().held.has(branchId),
  useHeld: (branchId: string): boolean => useStore(store, (s) => s.held.has(branchId)),
  /** Ends every token on the branch: the reader's unmount. */
  clear: (branchId: string): void => {
    if (store.getState().held.has(branchId)) setTokens(branchId, new Set())
  },
  __reset: (): void => store.setState({ held: new Map() }),
}
