/**
 * Choosing the remote `scripts/release.js` pushes a release to. Split out so it can be
 * tested without importing the script, which cuts a release on import.
 *
 * The release must land on the canonical repository and never on a fork, so this cannot
 * simply use `origin`. It used to be a hardcoded HTTPS URL, which held that guarantee but
 * also forced the transport: GitHub dropped password authentication for HTTPS, so anyone
 * without a credential helper could not push at all, while their working SSH remote sat
 * unused two lines away.
 *
 * So: pick a *configured remote* that points at the release repository, and let git use
 * whatever transport and credentials that remote already has. The guarantee is preserved
 * by matching on the repository the remote points to, not on its name.
 */

export const RELEASE_REPO = 'AventurasTeam/Aventuras'
export const RELEASE_REPO_URL = `https://github.com/${RELEASE_REPO}.git`

/**
 * Repository paths that are the release repository.
 *
 * `unkarelian/Aventuras` is the name it had before the rename; GitHub redirects it, so a
 * contributor whose remote predates the move is still pointing here and their push works.
 * The owner is part of every entry on purpose -- forks share the repository *name*, and
 * matching on the name alone would quietly release from someone's fork.
 */
const RELEASE_REPO_PATHS = new Set(['aventurasteam/aventuras', 'unkarelian/aventuras'])

/**
 * `owner/name` for a GitHub remote URL, lowercased, or `null` if it is not one.
 *
 * Handles the forms git actually stores: `git@github.com:owner/name.git`,
 * `https://github.com/owner/name(.git)`, and `ssh://git@github.com/owner/name.git`.
 */
export function githubRepoPath(url) {
  const match = /github\.com[/:]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url).trim())
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

/**
 * Picks the release remote from the output of `git remote -v`.
 *
 * Returns `{ ref, label }`: `ref` is what to hand to git -- a remote name when one matched,
 * otherwise the canonical HTTPS URL, which keeps the previous behaviour for a checkout with
 * no suitable remote (a fresh clone of a fork, say). `label` is for the console, because
 * printing a bare name like "upstream" would hide which repository is about to be released
 * to, and that is the one thing the operator most needs to see.
 *
 * Push URLs only: a remote can fetch and push to different places, and pushing is what
 * this is for.
 */
export function pickReleaseRemote(remoteVerbose) {
  for (const line of String(remoteVerbose ?? '').split('\n')) {
    const [name, url, kind] = line.trim().split(/\s+/)
    if (!name || !url || kind !== '(push)') continue
    if (RELEASE_REPO_PATHS.has(githubRepoPath(url))) {
      return { ref: name, label: `${name} (${url})` }
    }
  }

  return { ref: RELEASE_REPO_URL, label: RELEASE_REPO_URL }
}
