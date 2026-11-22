/** A thrown value's message: an `Error`'s own `message`, anything else stringified. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

/**
 * `run`'s value, or what it threw. React Compiler can't lower a try/catch whose block holds a
 * value block, so a hook branches on this instead.
 */
export async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error }
  }
}
