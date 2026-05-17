#!/usr/bin/env sh
# Enforces CLAUDE.md → Workflow rules → Commit messages.
# Blocks commits whose body exceeds MAX_BODY_LINES.
# Skips merge/revert commits (auto-generated bodies).

set -eu

msgfile="${1:?usage: check-commit-msg.sh <commit-msg-file>}"
MAX_BODY_LINES=6

first_line=$(head -n1 "$msgfile" 2>/dev/null || true)
case "$first_line" in
  Merge\ *|Revert\ *|"fixup! "*|"squash! "*) exit 0 ;;
esac

body_lines=$(awk '
  NR == 1 { next }
  /^#/ { next }
  !found && /^$/ { found = 1; next }
  found { print }
' "$msgfile" | sed -e '/./,$!d' -e :a -e '/^\n*$/{$d;N;ba' -e '}' | wc -l)

if [ "$body_lines" -gt "$MAX_BODY_LINES" ]; then
  cat >&2 <<EOF
✗ Commit message body is ${body_lines} lines (max ${MAX_BODY_LINES}).

See CLAUDE.md → Workflow rules → Commit messages.
  Skip: diff restatement, adversarial-pass / drift-pass enumerations,
        mini-changelogs of sub-followups, substrate sections
        re-summarizing the doc being committed.
  Keep: resolved-followup name, key contract/architectural decision
        in one paragraph, new sub-followups (one line each).
EOF
  exit 1
fi
