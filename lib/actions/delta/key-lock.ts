// Serializes concurrent dispatches that target the same key: the second
// caller's body doesn't start until the first's has fully settled. Needed
// wherever a read-then-decide isn't atomic with its write — two interleaved
// callers can both observe the pre-write state and both commit, producing two
// delta log entries for one conceptual change (breaks the
// one-CTRL-Z-undoes-it acceptance criterion). The lock must wrap the read, not
// just the write, so it goes wherever that sequence actually lives. An
// in-process map suffices because every domain write originates from a single
// JS realm (the renderer, or the native host); Electron main owns the db file
// and serves queries but never writes domain rows itself. Not reentrant — a
// locked body must not re-enter the same key.
const inFlightByKey = new Map<string, Promise<unknown>>()

export function withKeyLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prior = inFlightByKey.get(key) ?? Promise.resolve()
  const settled = prior.then(run, run)
  const current = settled.catch(() => undefined)
  inFlightByKey.set(key, current)
  current.finally(() => {
    if (inFlightByKey.get(key) === current) {
      inFlightByKey.delete(key)
    }
  })
  return settled
}
