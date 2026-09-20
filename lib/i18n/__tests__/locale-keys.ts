import { t } from '../i18n'

/**
 * Whether `key` resolves to real copy.
 *
 * i18next echoes a missing key back **with its namespace stripped**
 * (`storySettings:a.b` misses as `a.b`), and there is no
 * `parseMissingKeyHandler` to change that — so `expect(t(key)).not.toBe(key)`
 * can never fail for a namespaced key, and a test built on it passes while the
 * screen shows a raw key. Compare against both forms instead.
 */
export function hasCopy(key: string): boolean {
  // `t` is typed to the bundled resource keys, and is overloaded; callers here
  // build keys by template literal from a registry, which is the thing under test.
  const resolved = (t as unknown as (k: string) => string)(key)
  const colon = key.indexOf(':')
  const withoutNamespace = colon === -1 ? key : key.slice(colon + 1)
  return resolved !== key && resolved !== withoutNamespace
}
