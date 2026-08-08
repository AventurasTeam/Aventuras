/**
 * Semver comparison for the update check.
 *
 * The desktop updater does its own comparison inside the Tauri plugin, but the Android
 * path has none: it reads a release tag off the GitHub API and has to decide for itself
 * whether that tag is newer than the running build. String comparison is not an option --
 * `'0.10.0' > '0.9.0'` is false lexically and true in every sense that matters here.
 *
 * Kept as a plain module, with no dependency on the settings store or the Tauri APIs, so
 * the suite can import it (`*.svelte.ts` files cannot be imported by tests -- see the
 * README's Tests section).
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /**
   * Dot-separated pre-release identifiers, empty for a stable release. `v1.2.3-pre.4`
   * parses to `['pre', '4']`.
   */
  prerelease: string[]
}

/** `1.2.3`, `v1.2.3`, `1.2.3-pre.4`, with optional `+build` metadata that is discarded. */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parses a version string, returning `null` for anything unrecognised.
 *
 * A caller that gets `null` must not guess: a tag this cannot read is a tag whose ordering
 * is unknown, and treating unknown as "newer" would offer an update on every check.
 */
export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(input.trim())
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/** Numeric identifiers compare numerically; anything else compares as text. */
function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)

  if (aNumeric && bNumeric) return Number(a) - Number(b)
  // Semver: a numeric identifier always sorts below an alphanumeric one.
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePrerelease(a: string[], b: string[]): number {
  // A stable release outranks any pre-release of the same version.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = compareIdentifiers(a[i], b[i])
    if (diff !== 0) return diff < 0 ? -1 : 1
  }

  // Every shared identifier matched, so the longer list is the later release.
  return a.length - b.length === 0 ? 0 : a.length < b.length ? -1 : 1
}

/**
 * Returns a negative number when `a` precedes `b`, positive when it follows, 0 when equal.
 *
 * Throws on an unparseable input rather than guessing an order -- see `parseVersion`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)

  if (!left) throw new Error(`Unparseable version: ${a}`)
  if (!right) throw new Error(`Unparseable version: ${b}`)

  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1

  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Whether `candidate` is a release the user does not have yet.
 *
 * Returns `false` when either version is unparseable: an update prompt the user cannot
 * make sense of, shown on every startup, is worse than a missed update.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  try {
    return compareVersions(candidate, current) > 0
  } catch {
    return false
  }
}
