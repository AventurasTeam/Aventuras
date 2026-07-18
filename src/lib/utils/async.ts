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

  return results
}
