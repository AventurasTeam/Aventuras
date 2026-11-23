let running: { readonly done: Promise<void> } | null = null

/** Registers a running switch; null when one already runs. Call the returned settle on every exit. */
export function beginSwitch(): (() => void) | null {
  if (running != null) return null
  let resolve!: () => void
  const entry = {
    done: new Promise<void>((res) => {
      resolve = res
    }),
  }
  running = entry
  return () => {
    if (running === entry) running = null
    resolve()
  }
}

/** Resolves once no switch runs (at once when none does). */
export async function awaitRunningSwitch(): Promise<void> {
  while (running != null) await running.done
}
