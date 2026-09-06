/**
 * Minimal concurrency limiter. Returns a function that wraps tasks and
 * runs at most `n` concurrently.
 */
export function pLimit(n: number) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError('Expected `concurrency` to be a positive integer')
  }
  const queue: Array<() => void> = []
  let active = 0
  const next = () => {
    active--
    if (queue.length > 0) {
      active++
      queue.shift()!()
    }
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        Promise.resolve().then(fn).then(resolve, reject).finally(next)
      }
      if (active < n) {
        active++
        start()
      } else {
        queue.push(start)
      }
    })
  }
}

/**
 * Merges multiple AsyncGenerators into a single AsyncGenerator.
 * Yields values from all generators as they become available.
 * Completes when all generators are finished.
 * Returns a map of the final values returned by each generator.
 */
export async function* mergeGenerators<
  YieldType,
  ReturnMap extends Record<string, any>,
>(generators: { [K in keyof ReturnMap]: AsyncGenerator<YieldType, ReturnMap[K]> }): AsyncGenerator<
  YieldType,
  ReturnMap
> {
  const results = {} as ReturnMap
  const activeGenerators = new Map<keyof ReturnMap, AsyncGenerator<YieldType, any>>(
    Object.entries(generators) as any,
  )

  const pendingPromises = new Map<
    keyof ReturnMap,
    Promise<{ key: keyof ReturnMap; res: IteratorResult<YieldType, any> }>
  >()

  const getNext = (key: keyof ReturnMap) => {
    const gen = activeGenerators.get(key)!
    const promise = gen.next().then((res) => ({ key, res }))
    pendingPromises.set(key, promise)
  }

  for (const key of activeGenerators.keys()) {
    getNext(key)
  }

  try {
    while (activeGenerators.size > 0) {
      const { key, res } = await Promise.race(Array.from(pendingPromises.values()))

      if (res.done) {
        results[key] = res.value
        activeGenerators.delete(key)
        pendingPromises.delete(key)
      } else {
        yield res.value
        getNext(key)
      }
    }
  } finally {
    // One generator throwing, or the consumer walking away, leaves the rest mid-iteration.
    // They are owned here, so closing them is started here rather than left to collection.
    //
    // Started, not awaited: an async generator serialises its own requests, so `return()`
    // queues behind whatever `next()` is already in flight -- a model call, here -- and that
    // read cannot be cancelled from outside. Awaiting would hold the caller, and the failure
    // it is propagating, for as long as an unrelated sibling takes to answer.
    void Promise.allSettled(
      Array.from(activeGenerators.values()).map((gen) => gen.return(undefined)),
    )
  }

  return results
}
