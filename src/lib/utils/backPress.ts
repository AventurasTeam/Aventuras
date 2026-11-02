/** Returns whether it took the press; one that declines lets the next claim or the caller try. */
type BackHandler = () => boolean

const handlers: BackHandler[] = []

/** Offers Android's back press to `handler` until the returned function is called. */
export function claimBackPress(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  }
}

/** Offers the back press to the claims, latest first, and says whether one took it. */
export function dispatchBackPress(): boolean {
  return handlers.toReversed().some((handler) => handler())
}
