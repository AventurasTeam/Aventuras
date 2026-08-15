// Serializes concurrent dispatches that target the same key: the second
// caller's body doesn't start until the first's has fully settled. Needed
// wherever a read-then-decide isn't atomic with its write — two interleaved
// callers can both observe the pre-write state and both commit, producing two
// delta log entries for one conceptual change (breaks the
// one-CTRL-Z-undoes-it acceptance criterion). The lock must wrap the read, not
// just the write, so it goes wherever that sequence actually lives. This app is
// single-process (Electron main owns the db), so an in-process key lock is
// sufficient — no cross-process writers.
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
