/**
 * Caches a lazy `import()` promise, but drops it if the import rejects so a
 * later call can retry. Both native embedder modules (onnxruntime-react-native,
 * react-native-quick-crypto) perform a JSI install at module-eval and so must
 * stay off the top-level import graph; a plain `promise ??= import(...)` would
 * pin the first rejection forever, turning a transient native-load race into a
 * failure that only an app restart clears. Mirrors the retry-after-failure
 * property `bundles` gets in local/runtime.native.ts.
 */
export function lazyModule<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined
  return () => {
    if (!cached) {
      const promise = load()
      cached = promise
      promise.catch(() => {
        if (cached === promise) cached = undefined
      })
    }
    return cached
  }
}
