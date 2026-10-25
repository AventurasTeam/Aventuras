type BackHandler = () => void

const handlers: BackHandler[] = []

/** Takes Android's back press until the returned function is called; the latest one wins. */
export function claimBackPress(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  }
}

/** Hands the back press to the latest claim, and says whether there was one. */
export function dispatchBackPress(): boolean {
  const handler = handlers[handlers.length - 1]
  if (!handler) return false
  handler()
  return true
}
