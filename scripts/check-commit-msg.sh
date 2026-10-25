#!/usr/bin/env sh
# Enforces CLAUDE.md → Workflow rules → Commit messages.
# Blocks commits whose subject exceeds MAX_SUBJECT_CHARS or runs onto a
# second line, or whose body exceeds MAX_BODY_LINES.
# Skips merge/revert commits (auto-generated bodies).

set -eu

msgfile="${1:?usage: check-commit-msg.sh <commit-msg-file>}"
MAX_SUBJECT_CHARS=72
MAX_BODY_LINES=6

first_line=$(head -n1 "$msgfile" 2>/dev/null || true)
case "$first_line" in
  Merge\ *|Revert\ *|"fixup! "*|"squash! "*) exit 0 ;;
esac

# Judge the message git will store: its cleanup drops comments, trailing
# whitespace and leading blank lines.
message=$(sed -e '/^#/d' -e 's/[[:space:]]*$//' "$msgfile" | sed -e '/./,$!d')
subject=$(printf '%s\n' "$message" | sed -n 1p)
second_line=$(printf '%s\n' "$message" | sed -n 2p)

# Counts UTF-8 code points, not bytes, so an em dash is one character.
subject_chars=$(printf '%s' "$subject" | LC_ALL=C tr -d '\200-\277' | wc -c)

if [ "$subject_chars" -gt "$MAX_SUBJECT_CHARS" ]; then
  echo "✗ Commit subject is ${subject_chars} characters (max ${MAX_SUBJECT_CHARS})." >&2
  echo "See CLAUDE.md → Workflow rules → Commit messages." >&2
  exit 1
fi

if [ -n "$second_line" ]; then
  cat >&2 <<EOF
✗ Commit subject runs onto a second line.

Git joins every line before the first blank one into the subject.
Leave line 2 blank and start the body on line 3.
See CLAUDE.md → Workflow rules → Commit messages.
EOF
  exit 1
fi

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
