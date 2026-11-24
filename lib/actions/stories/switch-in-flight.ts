let running: { readonly done: Promise<void> } | null = null

export type ExclusiveRun<T> = { ran: true; value: T } | { ran: false }

/**
 * Runs `body` as the one running switch, registered before this call returns; `ran: false` when
 * one already runs. Settles on every exit of `body`, a throw included.
 */
export async function runExclusiveSwitch<T>(body: () => Promise<T>): Promise<ExclusiveRun<T>> {
  if (running != null) return { ran: false }
  let settle!: () => void
  const entry = {
    done: new Promise<void>((resolve) => {
      settle = resolve
    }),
  }
  running = entry
  try {
    return { ran: true, value: await body() }
  } finally {
    if (running === entry) running = null
    settle()
  }
}

/** Resolves once no switch runs (at once when none does). */
export async function awaitRunningSwitch(): Promise<void> {
  while (running != null) await running.done
}
