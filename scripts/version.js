/**
 * Version arithmetic for `scripts/release.js`. Split out so it can be tested.
 *
 * The rules match `semver.inc`. `semver` is not imported: it is only a transitive
 * dependency here, and a release script that breaks when an unrelated package drops it is
 * worse than forty lines of arithmetic.
 */

/**
 * Versions this project can release. Stricter than semver, because a tag is only worth
 * making if a workflow builds it: `release.yml` triggers on `v[0-9]+.[0-9]+.[0-9]+` and
 * `ci.yml` on `v*-pre*`, so a legal `1.2.3-beta.1` would tag, push and build nothing.
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-pre\.(\d+))?$/

export function isValidVersion(version) {
  return typeof version === 'string' && VERSION_PATTERN.test(version)
}

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? null : Number(match[4]),
  }
}

/** Negative if `a` precedes `b`, positive if it follows, zero if equal. */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Cannot compare unparseable versions: "${a}", "${b}"`)

  for (const part of ['major', 'minor', 'patch']) {
    if (x[part] !== y[part]) return x[part] - y[part]
  }
  // A pre-release precedes the release it leads to: 0.7.6-pre.1 < 0.7.6.
  if (x.pre === null && y.pre === null) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre - y.pre
}

/**
 * Apply `type` to `current`: a bump type, or a literal version string.
 *
 * A pre-release already sitting at the level being bumped is promoted rather than
 * incremented — `0.7.6-pre.1` + `patch` is `0.7.6` — because only the suffix stands
 * between it and release.
 */
export function bumpVersion(current, type) {
  const v = parseVersion(current)
  if (!v) throw new Error(`Current version is not a version this project can release: ${current}`)
  if (!type) return undefined

  const isPre = v.pre !== null

  switch (type) {
    case 'major':
      // Promote only on the major boundary (X.0.0-pre.N).
      return isPre && v.minor === 0 && v.patch === 0 ? `${v.major}.0.0` : `${v.major + 1}.0.0`

    case 'minor':
      return isPre && v.patch === 0 ? `${v.major}.${v.minor}.0` : `${v.major}.${v.minor + 1}.0`

    case 'patch':
      return isPre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`

    case 'prerelease':
      // From a stable version the patch moves first: `0.7.6-pre.1` sorts *before* the
      // `0.7.6` already shipped, so an updater would offer users a downgrade.
      return isPre
        ? `${v.major}.${v.minor}.${v.patch}-pre.${v.pre + 1}`
        : `${v.major}.${v.minor}.${v.patch + 1}-pre.1`

    default:
      return type
  }
}
