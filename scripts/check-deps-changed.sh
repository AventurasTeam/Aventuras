#!/usr/bin/env sh
# Warns when a git hook moved HEAD across a change to pnpm-lock.yaml or patches/, which pnpm's
# verifyDepsBeforeRun misses unless a package.json changed too. Never installs: in a scratch
# worktree that would reinstall through the symlinked node_modules.
#
# usage: check-deps-changed.sh post-checkout <old> <new> <branch-flag>
#        check-deps-changed.sh post-merge
#        check-deps-changed.sh post-rewrite <amend|rebase>

set -u

case "${1:-}" in
  post-checkout)
    [ "${4:-}" = 1 ] || exit 0
    old="${2:-}"
    new="${3:-}"
    ;;
  post-merge)
    old=ORIG_HEAD
    new=HEAD
    ;;
  post-rewrite)
    [ "${2:-}" = rebase ] || exit 0
    old=ORIG_HEAD
    new=HEAD
    ;;
  *) exit 0 ;;
esac

# A new worktree's checkout starts from the null id, with nothing installed yet to go stale.
git rev-parse -q --verify "$old^{commit}" >/dev/null 2>&1 || exit 0
git diff --quiet "$old" "$new" -- pnpm-lock.yaml patches/
[ $? -eq 1 ] || exit 0
echo "pnpm-lock.yaml or patches/ changed: run \`pnpm install\`, as pnpm won't stop a build for it." >&2
exit 0
