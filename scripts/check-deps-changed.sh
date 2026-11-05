#!/usr/bin/env sh
# Warns when a git operation moved HEAD across a change to pnpm-lock.yaml or patches/, which pnpm's
# verifyDepsBeforeRun misses unless a package.json changed too. Never installs: in a scratch
# worktree that would reinstall through the symlinked node_modules.
#
# usage: check-deps-changed.sh post-checkout <old> <new> <branch-flag>
#        check-deps-changed.sh post-merge <squash-flag>
#        check-deps-changed.sh post-rewrite <amend|rebase>
#        check-deps-changed.sh post-commit

set -u

staged=
case "${1:-}" in
  post-checkout)
    [ "${4:-}" = 1 ] || exit 0
    old="${2:-}"
    new="${3:-}"
    ;;
  post-merge)
    old=ORIG_HEAD
    new=HEAD
    # A squash merge leaves HEAD where it was, with the merged changes staged.
    if [ "${2:-}" = 1 ]; then
      old=HEAD
      staged=1
    fi
    ;;
  post-rewrite)
    [ "${2:-}" = rebase ] || exit 0
    old=ORIG_HEAD
    new=HEAD
    ;;
  post-commit)
    # A merge finished by `git commit` after a conflict runs no post-merge.
    git rev-parse -q --verify 'HEAD^2' >/dev/null 2>&1 || exit 0
    old='HEAD^1'
    new=HEAD
    ;;
  *) exit 0 ;;
esac

# A new worktree's checkout starts from the null id, with nothing installed yet to go stale.
git rev-parse -q --verify "$old^{commit}" >/dev/null 2>&1 || exit 0
if [ -n "$staged" ]; then
  git diff --cached --quiet "$old" -- pnpm-lock.yaml patches/
else
  git diff --quiet "$old" "$new" -- pnpm-lock.yaml patches/
fi
[ $? -eq 1 ] || exit 0
if [ -L node_modules ]; then
  echo "pnpm-lock.yaml or patches/ changed, and node_modules here is another checkout's: don't install through it; give this worktree its own install if it needs the change." >&2
else
  echo "pnpm-lock.yaml or patches/ changed: run \`pnpm install\`, as pnpm won't stop a build for it." >&2
fi
exit 0
